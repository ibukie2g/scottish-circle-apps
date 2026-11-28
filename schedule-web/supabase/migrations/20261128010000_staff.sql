-- 運営の操作(決める・時間も聞く・戻す・結果を見る)と、コース・会費の受け取り(設計.md の 10-1・11-1)
-- 運営は RLS で許された表を直接読み書きできる。何段階もまとめて変える操作だけ、ここの関数で行う

-- =====================================================================
-- コースと会費
-- =====================================================================

create table public.event_courses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  price integer not null default 0 check (price between 0 and 100000),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, event_id)
);
alter table public.event_courses enable row level security;
create policy courses_all on public.event_courses for all to authenticated
  using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));
grant select, insert, update, delete on public.event_courses to authenticated;

alter table public.responses
  add column course_id uuid,
  add column paid boolean not null default false, -- 会費を受け取ったか(運営だけが見る・変える)
  add column paid_at timestamptz,
  add foreign key (course_id, event_id) references public.event_courses (id, event_id) on delete set null (course_id);

-- 時間も聞くときに「決めた日」の候補を覚えておく(時間を決めたあと1段戻すため)
alter table public.events
  add column decided_date_id uuid,
  add foreign key (decided_date_id, id) references public.candidates (id, event_id) on delete set null (decided_date_id);

-- =====================================================================
-- 参加者:出欠でコースも選べるようにする(get_event にコースを足す)
-- =====================================================================

drop function public.submit_attendance(text, uuid, text, text, text);

create function public.submit_attendance(p_token text, p_event uuid, p_status text,
                                         p_arrive_at text default '', p_comment text default '',
                                         p_course uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.groups; e public.events; me public.members; c uuid;
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
  -- コースは「行く・途中から」のときだけ。そのイベントのコースでなければ止める
  c := case when p_status = 'no' then null else p_course end;
  if c is not null and not exists (select 1 from public.event_courses where id = c and event_id = e.id) then
    raise exception 'INVALID';
  end if;
  insert into public.responses (group_id, event_id, member_id, attendance, arrive_at, att_comment, course_id)
  values (g.id, e.id, me.id, p_status, case when p_status = 'partial' then coalesce(p_arrive_at, '') else '' end, coalesce(p_comment, ''), c)
  on conflict (event_id, member_id) do update
    set attendance = excluded.attendance, arrive_at = excluded.arrive_at, att_comment = excluded.att_comment,
        course_id = excluded.course_id, updated_at = now();
  return public.get_event(p_token, p_event);
end $$;

-- get_event の結果に、コースの一覧と自分が選んだコースを足す(会費の受け取りは返さない)
alter function public.get_event(text, uuid) rename to get_event_v1;
revoke all on function public.get_event_v1(text, uuid) from public, anon, authenticated;
alter function public.get_event_v1(text, uuid) set schema private;

create function public.get_event(p_token text, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare base jsonb; g public.groups; me public.members;
begin
  base := private.get_event_v1(p_token, p_event);
  g := private.group_by_token(p_token);
  me := private.my_member(g.id);
  return base
    || jsonb_build_object('courses', coalesce((
         select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price) order by sort, price desc, name)
         from public.event_courses where event_id = p_event), '[]'))
    || case when base -> 'mine' = 'null'::jsonb or base -> 'mine' is null then '{}'::jsonb
            else jsonb_build_object('mine', (base -> 'mine') || jsonb_build_object('course_id',
              (select course_id from public.responses where event_id = p_event and member_id = me.id))) end;
end $$;

-- submit_answers の最後で呼んでいる get_event も新しいほうになる(名前で呼んでいるため)

-- =====================================================================
-- 運営の関数(最初に「そのイベントを管理できるか」を確かめる)
-- =====================================================================

create function private.require_event(p_event uuid) returns public.events
language plpgsql stable set search_path = '' as $$
declare e public.events;
begin
  if not private.can_manage_event(p_event) then raise exception 'FORBIDDEN'; end if;
  select * into e from public.events where id = p_event;
  return e;
end $$;

-- 決まった候補の答えから、出欠を仮に入れる(○→行く、×→行かない)。もう出欠を答えている人は変えない
create function private.preset_attendance(e public.events, p_candidate uuid) returns void
language sql set search_path = '' as $$
  insert into public.responses (group_id, event_id, member_id, attendance)
  select e.group_id, e.id, a.member_id, case a.mark when 'o' then 'go' else 'no' end
  from public.answers a where a.candidate_id = p_candidate and a.mark in ('o', 'x')
  on conflict (event_id, member_id) do update
    set attendance = coalesce(public.responses.attendance, excluded.attendance)
$$;

-- 結果(運営用):メンバー全員の答え・ひとこと・出欠・会費。任された幹事にも名前を渡す(学年などは渡さない)
create function public.staff_event_results(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.events; show_full boolean;
begin
  e := private.require_event(p_event);
  show_full := private.can_manage_group(e.group_id);
  return jsonb_build_object(
    'event', to_jsonb(e) || jsonb_build_object('decided', private.decided(e)),
    'group', (select jsonb_build_object('id', id, 'name', name, 'kind', kind, 'token', token) from public.groups where id = e.group_id),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'date', c.date, 'time', c.time, 'memo', c.memo, 'stage', c.stage)
                                             order by c.date, c.time = '', c.time)
                            from public.candidates c where c.event_id = e.id), '[]'),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price) order by sort, price desc, name)
                         from public.event_courses where event_id = e.id), '[]'),
    'wanted', coalesce((select jsonb_agg(member_id) from public.wanted where event_id = e.id), '[]'),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name,
        'kana', case when show_full then m.kana end, 'grade', case when show_full then m.grade end, 'gender', case when show_full then m.gender end,
        'answers', coalesce((select jsonb_object_agg(a.candidate_id, a.mark) from public.answers a where a.event_id = e.id and a.member_id = m.id), '{}'),
        'comment', coalesce(r.comment, ''), 'attendance', r.attendance, 'arrive_at', coalesce(r.arrive_at, ''),
        'att_comment', coalesce(r.att_comment, ''), 'course_id', r.course_id, 'paid', coalesce(r.paid, false))
        order by coalesce(m.kana, m.name))
      from public.members m left join public.responses r on r.event_id = e.id and r.member_id = m.id
      where m.group_id = e.group_id and m.active), '[]'));
end $$;

-- この日に決める。p_times があれば「時間も聞く」(時間調整中へ)、なければ出欠確認へ
create function public.staff_decide(p_event uuid, p_candidate uuid, p_times text[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.events; c public.candidates; t text;
begin
  e := private.require_event(p_event);
  if e.status <> 'poll' then raise exception 'INVALID'; end if;
  select * into c from public.candidates where id = p_candidate and event_id = e.id and stage = 'date';
  if not found then raise exception 'NOT_FOUND'; end if;
  if coalesce(cardinality(p_times), 0) > 0 then
    foreach t in array p_times loop
      if t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID'; end if;
    end loop;
    insert into public.candidates (event_id, date, time, stage)
    select e.id, c.date, x, 'time' from (select distinct unnest(p_times) as x) s order by x;
    update public.events set status = 'time', decided_candidate_id = c.id, decided_date_id = c.id where id = e.id;
  else
    update public.events set status = 'rsvp', decided_candidate_id = c.id, decided_date_id = null where id = e.id;
    select * into e from public.events where id = e.id;
    perform private.preset_attendance(e, c.id);
  end if;
  return public.staff_event_results(e.id);
end $$;

-- 時間を決める(時間調整中 → 出欠確認中)
create function public.staff_decide_time(p_event uuid, p_candidate uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  e := private.require_event(p_event);
  if e.status <> 'time' then raise exception 'INVALID'; end if;
  if not exists (select 1 from public.candidates where id = p_candidate and event_id = e.id and stage = 'time') then
    raise exception 'NOT_FOUND';
  end if;
  update public.events set status = 'rsvp', decided_candidate_id = p_candidate where id = e.id;
  select * into e from public.events where id = e.id;
  perform private.preset_attendance(e, p_candidate);
  return public.staff_event_results(e.id);
end $$;

-- 1段戻す:出欠確認中(時間まで決めた)→ 時間調整中 → 日程調整中。日程調整中に戻すときは時間の候補を消す
create function public.staff_undecide(p_event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.events; st text;
begin
  e := private.require_event(p_event);
  select stage into st from public.candidates where id = e.decided_candidate_id;
  if e.status = 'rsvp' and st = 'time' and e.decided_date_id is not null then
    update public.events set status = 'time', decided_candidate_id = e.decided_date_id where id = e.id;
  elsif e.status in ('rsvp', 'time') then
    update public.events set status = 'poll', decided_candidate_id = null, decided_date_id = null where id = e.id;
    delete from public.candidates where event_id = e.id and stage = 'time';
  else
    raise exception 'INVALID';
  end if;
  return public.staff_event_results(e.id);
end $$;

-- =====================================================================
-- 権限
-- =====================================================================

revoke all on function public.submit_attendance(text, uuid, text, text, text, uuid), public.get_event(text, uuid),
  public.staff_event_results(uuid), public.staff_decide(uuid, uuid, text[]), public.staff_decide_time(uuid, uuid),
  public.staff_undecide(uuid) from public, anon;
grant execute on function public.submit_attendance(text, uuid, text, text, text, uuid), public.get_event(text, uuid),
  public.staff_event_results(uuid), public.staff_decide(uuid, uuid, text[]), public.staff_decide_time(uuid, uuid),
  public.staff_undecide(uuid) to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_staff(), private.is_admin(), private.can_manage_group(uuid), private.can_manage_event(uuid),
  private.organizes_in_group(uuid), private.organizes_event(uuid), private.new_token(), private.name_key(text) to authenticated;
revoke execute on function private.get_event_v1(text, uuid), private.require_event(uuid),
  private.preset_attendance(public.events, uuid) from authenticated;

-- =====================================================================
-- グループの種類の切りかえ(11/28 伊吹):グループ ⇄ 1回きり だけ。サークルは名簿を使うので切りかえない
-- 1回きりにできるのは、終わっていないイベントが1つ以下のとき(リンクを開くとそのイベントが直接開くため)
-- =====================================================================

create function private.guard_kind() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then
    if old.kind = 'circle' or new.kind = 'circle' then
      raise exception 'INVALID: サークルの種類は切りかえられません';
    end if;
    if new.kind = 'once' and (select count(*) from public.events where group_id = new.id and status <> 'done') > 1 then
      raise exception 'INVALID: 終わっていないイベントが2つ以上あるので、1回きりにはできません';
    end if;
  end if;
  return new;
end $$;
create trigger groups_kind_switch before update on public.groups for each row execute function private.guard_kind();
