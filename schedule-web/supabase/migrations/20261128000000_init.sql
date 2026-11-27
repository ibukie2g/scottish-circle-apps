-- schedule-web(B案)の表・鍵(RLS)・参加者用の関数
-- 設計:docs/設計.md。テスト:tests/db/(PGlite でパソコンの中で動かす)
--
-- 安全の基本:
-- 1. すべての表に RLS。参加者(匿名ログイン)はどの表も直接読めない。参加者の操作は下の RPC だけ
-- 2. 幹事・管理者は RLS で許された行だけを直接読み書きする
-- 3. 関数は anon から実行できないようにし、参加者用 RPC だけ authenticated に許す

create schema if not exists private;

-- =====================================================================
-- 小さな道具
-- =====================================================================

-- リンクの合言葉(推測できない 43 文字。uuid 2つ分の乱数を base64url にしたもの)
create function private.new_token() returns text
language sql volatile set search_path = '' as $$
  select translate(rtrim(encode(decode(
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_')
$$;

-- 表示名を整える(制御文字・改行・続く空白(全角も)を1つの半角空白に、前後を取る)
create function private.normalize_name(v text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(coalesce(v, ''), '[[:cntrl:]]', ' ', 'g'),
                              '[[:space:]' || chr(12288) || ']+', ' ', 'g'))
$$;

-- 同じ人かどうかを比べる用。空白(全角も)を全部取る(「山田 太郎」=「山田太郎」)
create function private.name_key(v text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(v, ''), '[[:space:][:cntrl:]' || chr(12288) || ']', '', 'g')
$$;

-- 日本時間の今日(締め切りの判定。current_date は UTC なので使わない)
create function private.today_jst() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Tokyo')::date
$$;

-- =====================================================================
-- 表
-- =====================================================================

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'organizer')),
  display_name text not null default '' check (char_length(display_name) <= 40),
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('circle', 'group', 'once')),
  token text not null unique default private.new_token() check (char_length(token) >= 20),
  owner_id uuid not null default auth.uid() references auth.users (id),
  mascot boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- 名前はここだけ(出身地・学籍番号は入れない)
create table public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null, -- 名前を選んだ人(匿名ログインのID)
  name text not null check (char_length(name) between 1 and 20),
  name_norm text generated always as (private.name_key(name)) stored,
  kana text check (char_length(kana) <= 40),
  grade text check (char_length(grade) <= 10),
  gender text check (char_length(gender) <= 10),
  roster_key text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, group_id),
  unique (group_id, roster_key),
  unique (group_id, user_id) -- 1人1つの名前
);
create unique index members_name_active on public.members (group_id, name_norm) where active;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 1000),
  place text not null default '' check (char_length(place) <= 100),
  cost text not null default '' check (char_length(cost) <= 100),
  url text not null default '' check (char_length(url) <= 500),
  status text not null default 'poll' check (status in ('poll', 'time', 'rsvp', 'done')),
  visibility text not null default 'names' check (visibility in ('names', 'counts', 'hidden')),
  deadline date,
  decided_candidate_id uuid,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, group_id)
);

create table public.event_organizers (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.staff (user_id) on delete cascade, -- 幹事を外すと自動で外れる
  primary key (event_id, user_id)
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  date date not null,
  time text not null default '' check (time = '' or time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  memo text not null default '' check (char_length(memo) <= 40),
  stage text not null default 'date' check (stage in ('date', 'time')),
  created_at timestamptz not null default now(),
  unique (id, event_id)
);

alter table public.events
  add foreign key (decided_candidate_id, id) references public.candidates (id, event_id)
  on delete set null (decided_candidate_id);

-- ○△×(1候補日 × 1人 = 1行)
create table public.answers (
  group_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  candidate_id uuid not null,
  mark text not null check (mark in ('o', 't', 'x')),
  updated_at timestamptz not null default now(),
  primary key (member_id, candidate_id),
  foreign key (member_id, group_id) references public.members (id, group_id) on delete cascade,
  foreign key (event_id, group_id) references public.events (id, group_id) on delete cascade,
  foreign key (candidate_id, event_id) references public.candidates (id, event_id) on delete cascade
);

-- イベントごとの「ひとこと」と出欠
create table public.responses (
  group_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  comment text not null default '' check (char_length(comment) <= 100),
  attendance text check (attendance in ('go', 'partial', 'no')),
  arrive_at text not null default '' check (char_length(arrive_at) <= 10),
  att_comment text not null default '' check (char_length(att_comment) <= 100),
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id),
  foreign key (member_id, group_id) references public.members (id, group_id) on delete cascade,
  foreign key (event_id, group_id) references public.events (id, group_id) on delete cascade
);

-- 来てほしい人
create table public.wanted (
  group_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  primary key (event_id, member_id),
  foreign key (member_id, group_id) references public.members (id, group_id) on delete cascade,
  foreign key (event_id, group_id) references public.events (id, group_id) on delete cascade
);

-- 答えの変更の記録(だれの答えがいつどう変わったか。運営が見て戻せるように。11/27 決定)
-- イベントを消しても記録が残るように外部キーはつけない(名前は持たない)
create table public.answer_log (
  id bigint generated always as identity primary key,
  group_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  candidate_id uuid not null,
  old_mark text,
  new_mark text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index answer_log_event on public.answer_log (event_id, changed_at);

-- =====================================================================
-- だれかを確かめる関数(RLS で使う。private スキーマは画面から呼べない)
-- =====================================================================

-- 匿名でなく、staff にいる。ほかの関数はすべて最初にこれを確かめる
create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s join auth.users u on u.id = s.user_id
    where s.user_id = auth.uid() and not coalesce(u.is_anonymous, false))
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff() and exists (select 1 from public.staff where user_id = auth.uid() and role = 'admin')
$$;

create function private.can_manage_group(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.is_staff() and exists (select 1 from public.groups where id = g and owner_id = auth.uid()))
$$;

-- そのイベントを任されている
create function private.organizes_event(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff() and exists (select 1 from public.event_organizers o where o.event_id = e and o.user_id = auth.uid())
$$;

create function private.can_manage_event(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.organizes_event(e)
      or exists (select 1 from public.events ev where ev.id = e and private.can_manage_group(ev.group_id))
$$;

-- そのグループのイベントを1つでも任されている(グループの名前を見るため)
create function private.organizes_in_group(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff() and exists (
    select 1 from public.event_organizers o join public.events e on e.id = o.event_id
    where e.group_id = g and o.user_id = auth.uid())
$$;

-- =====================================================================
-- トリガー
-- =====================================================================

-- 作ったあと変えられない列(任された幹事が events.group_id を書きかえて、ほかのグループを読む穴をふさぐ)
create function private.guard_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) ->> tg_argv[0]) is distinct from (to_jsonb(old) ->> tg_argv[0]) then
    raise exception 'IMMUTABLE: %.% は変えられません', tg_table_name, tg_argv[0];
  end if;
  return new;
end $$;
create trigger events_group_fixed before update on public.events for each row execute function private.guard_immutable('group_id');
create trigger candidates_event_fixed before update on public.candidates for each row execute function private.guard_immutable('event_id');
create trigger members_group_fixed before update on public.members for each row execute function private.guard_immutable('group_id');

-- groups.owner_id を変えられるのは管理者だけ(引っ越しスクリプトなど API 以外からは可)
create function private.guard_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id
     and current_user in ('authenticated', 'anon') and not private.is_admin() then
    raise exception 'FORBIDDEN: owner_id を変えられるのは管理者だけです';
  end if;
  return new;
end $$;
create trigger groups_owner_admin_only before update on public.groups for each row execute function private.guard_owner();

-- メンバーを削除(active=false)したら、名前を選んでいた人を外す(unique(group_id,user_id) のため)
create function private.release_on_deactivate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.active and not new.active then new.user_id := null; end if;
  return new;
end $$;
create trigger members_release before update on public.members for each row execute function private.release_on_deactivate();

-- 候補日は1イベント60まで
create function private.limit_candidates() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.candidates where event_id = new.event_id) >= 60 then
    raise exception 'TOO_MANY: 候補日は60まで';
  end if;
  return new;
end $$;
create trigger candidates_limit before insert on public.candidates for each row execute function private.limit_candidates();

-- 匿名の人は staff にできない
create function private.staff_not_anonymous() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users where id = new.user_id and coalesce(is_anonymous, false)) then
    raise exception 'INVALID: 匿名の人は幹事にできません';
  end if;
  return new;
end $$;
create trigger staff_not_anon before insert or update on public.staff for each row execute function private.staff_not_anonymous();

-- 答えの変更を記録
create function private.log_answer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.answer_log (group_id, event_id, member_id, candidate_id, old_mark, new_mark, changed_by)
    values (old.group_id, old.event_id, old.member_id, old.candidate_id, old.mark, null, auth.uid());
    return old;
  end if;
  if tg_op = 'UPDATE' and new.mark = old.mark then return new; end if;
  insert into public.answer_log (group_id, event_id, member_id, candidate_id, old_mark, new_mark, changed_by)
  values (new.group_id, new.event_id, new.member_id, new.candidate_id,
          case when tg_op = 'UPDATE' then old.mark end, new.mark, auth.uid());
  return new;
end $$;
create trigger answers_log after insert or update or delete on public.answers for each row execute function private.log_answer();

-- =====================================================================
-- RLS(幹事・管理者が直接読む分。参加者=匿名は is_staff() が偽なので何も読めない)
-- =====================================================================

alter table public.staff enable row level security;
alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.events enable row level security;
alter table public.event_organizers enable row level security;
alter table public.candidates enable row level security;
alter table public.answers enable row level security;
alter table public.responses enable row level security;
alter table public.wanted enable row level security;
alter table public.answer_log enable row level security;

create policy staff_select on public.staff for select to authenticated
  using (private.is_admin() or (user_id = auth.uid() and private.is_staff()));
create policy staff_write on public.staff for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- 作った直後の行(insert ... returning)も読めるように、行そのものの列で判定する
create policy groups_select on public.groups for select to authenticated
  using (private.is_admin() or (private.is_staff() and owner_id = auth.uid()) or private.organizes_in_group(id));
create policy groups_insert on public.groups for insert to authenticated
  with check (private.is_staff() and owner_id = auth.uid());
create policy groups_update on public.groups for update to authenticated
  using (private.can_manage_group(id)) with check (private.can_manage_group(id));
create policy groups_delete on public.groups for delete to authenticated
  using (private.is_admin()); -- グループを消すのは管理者だけ(幹事は「しまう」)

-- 任された幹事は members を直接読めない(名前は運営用 RPC で必要な分だけ。あとで作る)
create policy members_all on public.members for all to authenticated
  using (private.can_manage_group(group_id)) with check (private.can_manage_group(group_id));

create policy events_select on public.events for select to authenticated
  using (private.can_manage_group(group_id) or private.organizes_event(id));
create policy events_insert on public.events for insert to authenticated
  with check (private.can_manage_group(group_id));
create policy events_update on public.events for update to authenticated
  using (private.can_manage_group(group_id) or private.organizes_event(id))
  with check (private.can_manage_group(group_id) or private.organizes_event(id));
create policy events_delete on public.events for delete to authenticated
  using (private.can_manage_group(group_id));

create policy organizers_select on public.event_organizers for select to authenticated
  using (private.is_staff() and (user_id = auth.uid()
         or exists (select 1 from public.events e where e.id = event_id and private.can_manage_group(e.group_id))));
create policy organizers_write on public.event_organizers for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and private.can_manage_group(e.group_id)))
  with check (exists (select 1 from public.events e where e.id = event_id and private.can_manage_group(e.group_id)));

create policy candidates_all on public.candidates for all to authenticated
  using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));
create policy answers_all on public.answers for all to authenticated
  using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));
create policy responses_all on public.responses for all to authenticated
  using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));
create policy wanted_all on public.wanted for all to authenticated
  using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));
create policy answer_log_select on public.answer_log for select to authenticated
  using (private.can_manage_event(event_id));

-- =====================================================================
-- 参加者の RPC の下請け(private。RPC の中からだけ使う)
-- =====================================================================

create function private.group_by_token(p_token text) returns public.groups
language plpgsql stable set search_path = '' as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'AUTH'; end if;
  select * into g from public.groups where token = p_token and not archived;
  if not found then raise exception 'NOT_FOUND'; end if;
  return g;
end $$;

create function private.event_in_group(p_group uuid, p_event uuid) returns public.events
language plpgsql stable set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event and group_id = p_group;
  if not found then raise exception 'NOT_FOUND'; end if;
  return e;
end $$;

-- 自分のメンバー(members.user_id = auth.uid())。いなければ id が null
create function private.my_member(p_group uuid) returns public.members
language sql stable set search_path = '' as $$
  select * from public.members where group_id = p_group and user_id = auth.uid() and active
$$;

create function private.current_stage(p_status text) returns text
language sql immutable set search_path = '' as $$
  select case when p_status = 'time' then 'time' else 'date' end
$$;

create function private.event_closed(e public.events) returns boolean
language sql stable set search_path = '' as $$
  select e.status = 'done' or (e.status = 'poll' and e.deadline is not null and private.today_jst() > e.deadline)
$$;

-- 決まった日。時間調整中は日にちだけ(時刻は目安だったので出さない)
create function private.decided(e public.events) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('date', c.date, 'time', case when e.status = 'time' then '' else c.time end)
  from public.candidates c where c.id = e.decided_candidate_id
$$;

create function private.answered(e public.events, p_member uuid) returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_member is null then false
    when e.status in ('rsvp', 'done') then exists (
      select 1 from public.responses r where r.event_id = e.id and r.member_id = p_member and r.attendance is not null)
    else exists (
      select 1 from public.answers a join public.candidates c on c.id = a.candidate_id
      where a.event_id = e.id and a.member_id = p_member and c.stage = private.current_stage(e.status))
  end
$$;

create function private.event_summary(e public.events, p_member uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'status', e.status, 'deadline', e.deadline,
    'closed', private.event_closed(e), 'decided', private.decided(e),
    'last_date', (select max(date) from public.candidates where event_id = e.id),
    'answered', private.answered(e, p_member))
$$;

-- ある段階の候補ごとの集計。p_names = 名前も入れるか
create function private.stage_results(p_event uuid, p_group uuid, p_stage text, p_names boolean) returns jsonb
language sql stable set search_path = '' as $$
  with act as (select id, name, kana from public.members where group_id = p_group and active),
  cs as (select * from public.candidates where event_id = p_event and stage = p_stage),
  an as (select a.candidate_id, a.mark, a.member_id, m.name, m.kana
         from public.answers a join act m on m.id = a.member_id join cs on cs.id = a.candidate_id)
  select jsonb_build_object(
    'member_count', (select count(*) from act),
    'answered_count', (select count(distinct member_id) from an),
    'by_candidate', coalesce((
      select jsonb_agg(jsonb_build_object(
        'candidate_id', c.id, 'date', c.date, 'time', c.time, 'memo', c.memo,
        'o', (select count(*) from an where candidate_id = c.id and mark = 'o'),
        't', (select count(*) from an where candidate_id = c.id and mark = 't'),
        'x', (select count(*) from an where candidate_id = c.id and mark = 'x'),
        'names', case when p_names then jsonb_build_object(
          'o', (select coalesce(jsonb_agg(name order by coalesce(kana, name)), '[]') from an where candidate_id = c.id and mark = 'o'),
          't', (select coalesce(jsonb_agg(name order by coalesce(kana, name)), '[]') from an where candidate_id = c.id and mark = 't'),
          'x', (select coalesce(jsonb_agg(name order by coalesce(kana, name)), '[]') from an where candidate_id = c.id and mark = 'x'))
        end) order by c.date, c.time = '', c.time)
      from cs c), '[]'))
$$;

-- =====================================================================
-- 参加者の RPC(security definer。最初に合言葉と本人を確かめる)
-- エラーは英大文字のコード:AUTH / NOT_FOUND / NO_MEMBER / CLOSED / INVALID / DUPLICATE_NAME
-- =====================================================================

create function public.open_group(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g public.groups; me public.members;
begin
  g := private.group_by_token(p_token);
  me := private.my_member(g.id);
  return jsonb_build_object(
    'group', jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'mascot', g.mascot),
    'me', case when me.id is null then null else jsonb_build_object('id', me.id, 'name', me.name) end,
    'member_count', (select count(*) from public.members where group_id = g.id and active),
    'events', coalesce((select jsonb_agg(private.event_summary(e, me.id) order by e.created_at desc)
                        from public.events e where e.group_id = g.id), '[]'));
end $$;

create function public.list_members(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g public.groups;
begin
  g := private.group_by_token(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name,
      'kana', case when g.kind = 'circle' then m.kana end,
      'grade', case when g.kind = 'circle' then m.grade end,
      'taken', m.user_id is not null and m.user_id <> auth.uid(),
      'mine', m.user_id is not distinct from auth.uid())
      order by coalesce(m.kana, m.name))
    from public.members m where m.group_id = g.id and m.active), '[]');
end $$;

-- 名前を選ぶ。別のスマホで使われている名前は、p_confirm = true のときだけ選べる(案イ+うっかり防止)
create function public.claim_member(p_token text, p_member uuid, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.groups; m public.members;
begin
  g := private.group_by_token(p_token);
  select * into m from public.members where id = p_member and group_id = g.id and active for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if m.user_id is not null and m.user_id <> auth.uid() and not coalesce(p_confirm, false) then
    return jsonb_build_object('needs_confirm', true);
  end if;
  update public.members set user_id = null where group_id = g.id and user_id = auth.uid() and id <> m.id;
  update public.members set user_id = auth.uid() where id = m.id;
  return jsonb_build_object('me', jsonb_build_object('id', m.id, 'name', m.name));
end $$;

-- 一覧にいない人が加わる。同じ名前(空白ちがいも)がいれば止める
create function public.join_group(p_token text, p_name text, p_kana text default null,
                                  p_grade text default null, p_gender text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.groups; nm text := private.normalize_name(p_name); new_id uuid;
begin
  g := private.group_by_token(p_token);
  if char_length(nm) < 1 or char_length(nm) > 20 then raise exception 'INVALID'; end if;
  if exists (select 1 from public.members where group_id = g.id and active and name_norm = private.name_key(nm)) then
    raise exception 'DUPLICATE_NAME';
  end if;
  update public.members set user_id = null where group_id = g.id and user_id = auth.uid();
  insert into public.members (group_id, user_id, name, kana, grade, gender)
  values (g.id, auth.uid(), nm,
          case when g.kind = 'circle' then nullif(private.normalize_name(p_kana), '') end,
          case when g.kind = 'circle' then nullif(btrim(p_grade), '') end,
          case when g.kind = 'circle' then nullif(btrim(p_gender), '') end)
  returning id into new_id;
  return jsonb_build_object('me', jsonb_build_object('id', new_id, 'name', nm));
end $$;

create function public.get_event(p_token text, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g public.groups; e public.events; me public.members; st text; show_names boolean; r public.responses;
begin
  g := private.group_by_token(p_token);
  e := private.event_in_group(g.id, p_event);
  me := private.my_member(g.id);
  st := private.current_stage(e.status);
  show_names := e.visibility = 'names';
  select * into r from public.responses where event_id = e.id and member_id = me.id;
  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', e.id, 'name', e.name, 'description', e.description, 'place', e.place, 'cost', e.cost, 'url', e.url,
      'status', e.status, 'visibility', e.visibility, 'deadline', e.deadline, 'stage', st,
      'closed', private.event_closed(e), 'decided', private.decided(e)),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'date', c.date, 'time', c.time, 'memo', c.memo)
                       order by c.date, c.time = '', c.time)
      from public.candidates c where c.event_id = e.id and c.stage = st), '[]'),
    'mine', case when me.id is null then null else jsonb_build_object(
      'answers', coalesce((
        select jsonb_object_agg(a.candidate_id, a.mark)
        from public.answers a join public.candidates c on c.id = a.candidate_id
        where a.member_id = me.id and a.event_id = e.id and c.stage = st), '{}'),
      'comment', coalesce(r.comment, ''),
      'attendance', r.attendance, 'arrive_at', coalesce(r.arrive_at, ''), 'att_comment', coalesce(r.att_comment, '')) end,
    'results', case when e.visibility = 'hidden' then null
                    else private.stage_results(e.id, g.id, st, show_names) end,
    'date_stage', case when e.visibility = 'hidden' or e.status = 'poll' then null
                       else private.stage_results(e.id, g.id, 'date', show_names) end,
    'attendance', case when e.visibility = 'hidden' or e.status not in ('rsvp', 'done') then null else (
      select jsonb_build_object(
        'go', count(*) filter (where x.attendance = 'go'),
        'partial', count(*) filter (where x.attendance = 'partial'),
        'no', count(*) filter (where x.attendance = 'no'),
        'names', case when show_names then jsonb_build_object(
          'go', coalesce(jsonb_agg(m.name order by coalesce(m.kana, m.name)) filter (where x.attendance = 'go'), '[]'),
          'partial', coalesce(jsonb_agg(m.name || case when x.arrive_at <> '' then '(' || x.arrive_at || '〜)' else '' end
                                        order by coalesce(m.kana, m.name)) filter (where x.attendance = 'partial'), '[]'),
          'no', coalesce(jsonb_agg(m.name order by coalesce(m.kana, m.name)) filter (where x.attendance = 'no'), '[]')) end)
      from public.responses x join public.members m on m.id = x.member_id and m.active
      where x.event_id = e.id and x.attendance is not null) end,
    'wanted', case when e.visibility = 'hidden' then null
                   when show_names then coalesce((
                     select jsonb_agg(m.name order by coalesce(m.kana, m.name))
                     from public.wanted w join public.members m on m.id = w.member_id and m.active
                     where w.event_id = e.id), '[]')
                   else to_jsonb((select count(*) from public.wanted w join public.members m on m.id = w.member_id and m.active
                                  where w.event_id = e.id)) end);
end $$;

-- いまの段階の候補の答えだけ書きかえる(ほかの段階の答えは残す)。p_comment が null ならひとことは変えない
create function public.submit_answers(p_token text, p_event uuid, p_answers jsonb, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.groups; e public.events; me public.members; st text; k text; v text; n int := 0;
begin
  g := private.group_by_token(p_token);
  e := private.event_in_group(g.id, p_event);
  me := private.my_member(g.id);
  if me.id is null then raise exception 'NO_MEMBER'; end if;
  if not (e.status = 'time' or (e.status = 'poll' and not private.event_closed(e))) then raise exception 'CLOSED'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'INVALID'; end if;
  if p_comment is not null and char_length(p_comment) > 100 then raise exception 'INVALID'; end if;
  st := private.current_stage(e.status);
  for k, v in select key, value from jsonb_each_text(p_answers) loop
    n := n + 1;
    if n > 60 or v is null or v not in ('o', 't', 'x', '') then raise exception 'INVALID'; end if;
    if not exists (select 1 from public.candidates c where c.id::text = k and c.event_id = e.id and c.stage = st) then
      raise exception 'INVALID';
    end if;
  end loop;

  delete from public.answers a using public.candidates c
   where a.member_id = me.id and a.candidate_id = c.id and c.event_id = e.id and c.stage = st
     and coalesce(p_answers ->> c.id::text, '') = '';
  insert into public.answers (group_id, event_id, member_id, candidate_id, mark)
  select g.id, e.id, me.id, key::uuid, value from jsonb_each_text(p_answers) where value <> ''
  on conflict (member_id, candidate_id) do update set mark = excluded.mark, updated_at = now()
    where public.answers.mark is distinct from excluded.mark;

  if p_comment is not null then
    insert into public.responses (group_id, event_id, member_id, comment) values (g.id, e.id, me.id, p_comment)
    on conflict (event_id, member_id) do update set comment = excluded.comment, updated_at = now();
  end if;
  return public.get_event(p_token, p_event);
end $$;

create function public.submit_attendance(p_token text, p_event uuid, p_status text,
                                         p_arrive_at text default '', p_comment text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.groups; e public.events; me public.members;
begin
  g := private.group_by_token(p_token);
  e := private.event_in_group(g.id, p_event);
  me := private.my_member(g.id);
  if me.id is null then raise exception 'NO_MEMBER'; end if;
  if e.status <> 'rsvp' then raise exception 'CLOSED'; end if;
  if p_status is null or p_status not in ('go', 'partial', 'no')
     or char_length(coalesce(p_arrive_at, '')) > 10 or char_length(coalesce(p_comment, '')) > 100 then
    raise exception 'INVALID';
  end if;
  insert into public.responses (group_id, event_id, member_id, attendance, arrive_at, att_comment)
  values (g.id, e.id, me.id, p_status, case when p_status = 'partial' then coalesce(p_arrive_at, '') else '' end, coalesce(p_comment, ''))
  on conflict (event_id, member_id) do update
    set attendance = excluded.attendance, arrive_at = excluded.arrive_at, att_comment = excluded.att_comment, updated_at = now();
  return public.get_event(p_token, p_event);
end $$;

-- ほかのグループのイベントもまとめて見る(名前では結ばない。自分が選んだメンバーのあるグループだけ)
create function public.my_events() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'group', jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'token', g.token),
      'me', jsonb_build_object('id', m.id, 'name', m.name),
      'events', coalesce((select jsonb_agg(private.event_summary(e, m.id) order by e.created_at desc)
                          from public.events e where e.group_id = g.id and e.status <> 'done'), '[]'))
      order by g.name)
    from public.members m join public.groups g on g.id = m.group_id
    where m.user_id = auth.uid() and m.active and not g.archived), '[]');
end $$;

-- =====================================================================
-- 権限
-- =====================================================================

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on
  public.staff, public.groups, public.members, public.events, public.event_organizers,
  public.candidates, public.answers, public.responses, public.wanted to authenticated;
grant select on public.answer_log to authenticated;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.open_group(text), public.list_members(text), public.claim_member(text, uuid, boolean),
  public.join_group(text, text, text, text, text), public.get_event(text, uuid),
  public.submit_answers(text, uuid, jsonb, text), public.submit_attendance(text, uuid, text, text, text),
  public.my_events() to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
-- RLS・既定値・生成列から呼ばれるものだけ
grant execute on function
  private.is_staff(), private.is_admin(), private.can_manage_group(uuid), private.can_manage_event(uuid),
  private.organizes_in_group(uuid), private.organizes_event(uuid), private.new_token(), private.name_key(text) to authenticated;
