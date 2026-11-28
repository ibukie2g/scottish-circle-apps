-- 11/29 伊吹:だれがいつ答えた・出欠を送ったかを運営の画面で見たい
-- 1. 出欠(行く/途中から/行かない)の変更も記録する(○△× は answer_log にもう記録している)
-- 2. 結果(運営用)に、メンバーごとの「最後に答えた日時」「最後に出欠を送った日時」を足す
-- 3. 変更の記録を新しい順に返す staff_change_log
-- 引っ越しで入れた分(changed_by が空)は「A案で回答」とし、日時は出さない(引っ越した日時になってしまうため)

create table public.attendance_log (
  id bigint generated always as identity primary key,
  group_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  old_status text,
  new_status text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index attendance_log_event on public.attendance_log (event_id, changed_at);
alter table public.attendance_log enable row level security;
create policy attendance_log_select on public.attendance_log for select to authenticated using (private.can_manage_event(event_id));
grant select on public.attendance_log to authenticated;
grant select, insert, update, delete on public.attendance_log to service_role;

create function private.log_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.attendance is not distinct from old.attendance then return new; end if;
  if tg_op = 'INSERT' and new.attendance is null then return new; end if;
  insert into public.attendance_log (group_id, event_id, member_id, old_status, new_status, changed_by)
  values (new.group_id, new.event_id, new.member_id, case when tg_op = 'UPDATE' then old.attendance end, new.attendance, auth.uid());
  return new;
end $$;
create trigger responses_attendance_log after insert or update on public.responses
  for each row execute function private.log_attendance();

create or replace function public.staff_event_results(p_event uuid) returns jsonb
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
        'att_comment', coalesce(r.att_comment, ''), 'course_id', r.course_id, 'paid', coalesce(r.paid, false),
        -- 最後に答えた日時(引っ越しで入った分は数えない)と、引っ越しで入った答えがあるか
        'answered_at', (select max(l.changed_at) from public.answer_log l where l.event_id = e.id and l.member_id = m.id and l.changed_by is not null),
        'imported', exists (select 1 from public.answer_log l where l.event_id = e.id and l.member_id = m.id and l.changed_by is null),
        'responded_at', (select max(l.changed_at) from public.attendance_log l where l.event_id = e.id and l.member_id = m.id))
        order by coalesce(m.kana, m.name))
      from public.members m left join public.responses r on r.event_id = e.id and r.member_id = m.id
      where m.group_id = e.group_id and m.active), '[]'));
end $$;

-- 変更の記録(新しい順)。だれが変えたか:本人/運営(名前)/引っ越し
create function public.staff_change_log(p_event uuid, p_limit integer default 300) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.events;
begin
  e := private.require_event(p_event);
  return coalesce((
    select jsonb_agg(t.x order by t.at desc) from (
      select l.changed_at as at, jsonb_build_object(
        'at', l.changed_at, 'kind', 'answer', 'member', m.name,
        'date', c.date, 'time', c.time, 'stage', c.stage, 'old', l.old_mark, 'new', l.new_mark,
        'by', case when l.changed_by is null then 'import' when s.user_id is not null then 'staff' else 'self' end,
        'by_name', s.display_name) as x
      from public.answer_log l
      left join public.members m on m.id = l.member_id
      left join public.candidates c on c.id = l.candidate_id
      left join public.staff s on s.user_id = l.changed_by
      where l.event_id = e.id and l.changed_by is not null
      union all
      select l.changed_at, jsonb_build_object(
        'at', l.changed_at, 'kind', 'attendance', 'member', m.name, 'old', l.old_status, 'new', l.new_status,
        'by', case when l.changed_by is null then 'import' when s.user_id is not null then 'staff' else 'self' end,
        'by_name', s.display_name)
      from public.attendance_log l
      left join public.members m on m.id = l.member_id
      left join public.staff s on s.user_id = l.changed_by
      where l.event_id = e.id
      order by at desc
      limit greatest(1, least(coalesce(p_limit, 300), 1000))
    ) t), '[]');
end $$;

revoke all on function public.staff_change_log(uuid, integer) from public, anon;
grant execute on function public.staff_change_log(uuid, integer) to authenticated;
revoke all on function private.log_attendance() from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
