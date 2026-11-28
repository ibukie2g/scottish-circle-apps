-- 11/28 伊吹:カレンダーに追加するとき、長さ(何時間か)と詳しい情報(案内・説明・リンク)も入れたい
-- あわせて、場所のリンク(地図など)と、名前つきのほかのリンク(いくつでも。最大5つ)を分けて持つ
alter table public.events
  add column duration_min integer not null default 120 check (duration_min between 15 and 1440),
  add column place_url text not null default '' check (char_length(place_url) <= 500),
  add column links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5 and char_length(links::text) <= 3000);

-- これまでの「リンク」(url)を移す:地図のリンクなら「場所のリンク」へ、それ以外は名前「リンク」で「ほかのリンク」へ
update public.events set place_url = url, url = ''
  where url ~* '^https?://(maps\.app\.goo\.gl|goo\.gl/maps|(www\.)?google\.[a-z.]+/maps|maps\.google\.)';
update public.events set links = jsonb_build_array(jsonb_build_object('label', 'リンク', 'url', url)), url = ''
  where url <> '';

create or replace function public.get_event(p_token text, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare base jsonb; g public.groups; me public.members;
begin
  base := private.get_event_v1(p_token, p_event);
  g := private.group_by_token(p_token);
  me := private.my_member(g.id);
  return base
    || jsonb_build_object('event', (base -> 'event') || (select jsonb_build_object(
         'notice', notice, 'style', style, 'duration_min', duration_min, 'place_url', place_url, 'links', links)
         from public.events where id = p_event))
    -- コースは飲み会のときだけ見せる
    || jsonb_build_object('courses', case when (select style from public.events where id = p_event) <> 'party' then '[]'::jsonb else coalesce((
         select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price) order by sort, price desc, name)
         from public.event_courses where event_id = p_event), '[]') end)
    || case when base -> 'mine' = 'null'::jsonb or base -> 'mine' is null then '{}'::jsonb
            else jsonb_build_object('mine', (base -> 'mine') || jsonb_build_object('course_id',
              (select course_id from public.responses where event_id = p_event and member_id = me.id))) end;
end $$;
