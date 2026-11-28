-- 11/28 伊吹の要望
-- 1. 日にちが決まったあとの参加者の画面に、運営が書いた案内(値段・持ち物など)を出す → events.notice
-- 2. 時間を聞いている間にも、コース(飲み放題/ソフトドリンクなど)を答えてもらう → choose_course

alter table public.events add column notice text not null default '' check (char_length(notice) <= 500);
-- 3. イベントの種類(11/28 伊吹):飲み会(コース・会費・割り勘を使う)/イベント(遊び・運動会など。お金まわりは出さない)
alter table public.events add column style text not null default 'event' check (style in ('event', 'party'));

-- 参加者がコースを選ぶ(時間調整中・出欠確認中)。null で「まだ決めていない」に戻す
create function public.choose_course(p_token text, p_event uuid, p_course uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.groups; e public.events; me public.members;
begin
  g := private.group_by_token(p_token);
  e := private.event_in_group(g.id, p_event);
  me := private.my_member(g.id);
  if me.id is null then raise exception 'NO_MEMBER'; end if;
  if e.status not in ('time', 'rsvp') then raise exception 'CLOSED'; end if;
  if e.style <> 'party' then raise exception 'INVALID'; end if;
  if p_course is not null and not exists (select 1 from public.event_courses where id = p_course and event_id = e.id) then
    raise exception 'INVALID';
  end if;
  insert into public.responses (group_id, event_id, member_id, course_id) values (g.id, e.id, me.id, p_course)
  on conflict (event_id, member_id) do update set course_id = excluded.course_id, updated_at = now();
  return public.get_event(p_token, p_event);
end $$;

-- get_event:案内(notice)を event に足す
create or replace function public.get_event(p_token text, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare base jsonb; g public.groups; me public.members;
begin
  base := private.get_event_v1(p_token, p_event);
  g := private.group_by_token(p_token);
  me := private.my_member(g.id);
  return base
    || jsonb_build_object('event', (base -> 'event') || (select jsonb_build_object('notice', notice, 'style', style)
         from public.events where id = p_event))
    -- コースは飲み会のときだけ見せる
    || jsonb_build_object('courses', case when (select style from public.events where id = p_event) <> 'party' then '[]'::jsonb else coalesce((
         select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price) order by sort, price desc, name)
         from public.event_courses where event_id = p_event), '[]') end)
    || case when base -> 'mine' = 'null'::jsonb or base -> 'mine' is null then '{}'::jsonb
            else jsonb_build_object('mine', (base -> 'mine') || jsonb_build_object('course_id',
              (select course_id from public.responses where event_id = p_event and member_id = me.id))) end;
end $$;

revoke all on function public.choose_course(text, uuid, uuid) from public, anon;
grant execute on function public.choose_course(text, uuid, uuid) to authenticated;
