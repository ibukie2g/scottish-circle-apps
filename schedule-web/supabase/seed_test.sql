-- 試し用のデータ(名前はすべて架空)。参加者の画面を試すためだけに使う。本番の引っ越しでは使わない
-- 何度流しても同じ状態になるように、先に「試し用」のグループを消してから入れる
delete from public.groups where name in ('試し用サークル', '試し用の友達');

with g as (
  insert into public.groups (name, kind) values ('試し用サークル', 'circle') returning id
), m as (
  insert into public.members (group_id, name, kana, grade, gender)
  select g.id, x.name, x.kana, x.grade, x.gender from g, (values
    ('青木 たろう', 'あおき たろう', '1年', '男性'),
    ('石井 はなこ', 'いしい はなこ', '2年', '女性'),
    ('上田 じろう', 'うえだ じろう', '3年', '男性'),
    ('江口 さくら', 'えぐち さくら', '1年', '女性')) as x(name, kana, grade, gender)
  returning id
), e as (
  insert into public.events (group_id, name, description, place, deadline)
  select g.id, '忘年会(試し)', '試し用のイベントです', '駅前', ((now() at time zone 'Asia/Tokyo')::date + 14) from g
  returning id
)
insert into public.candidates (event_id, date, time)
select e.id, d.date, d.time from e, (values
  ((now() at time zone 'Asia/Tokyo')::date + 20, '19:00'),
  ((now() at time zone 'Asia/Tokyo')::date + 23, '19:00'),
  ((now() at time zone 'Asia/Tokyo')::date + 27, '')) as d(date, time);

with g as (
  insert into public.groups (name, kind) values ('試し用の友達', 'group') returning id
), e as (
  insert into public.events (group_id, name, visibility)
  select g.id, '飲み会(試し)', 'counts' from g returning id
)
insert into public.candidates (event_id, date, time)
select e.id, (now() at time zone 'Asia/Tokyo')::date + d, '19:00' from e, (values (10), (17)) as x(d);

-- 開くためのリンク
select name, 'https://scottish-circle-apps.vercel.app/g/' || token as link
from public.groups where name in ('試し用サークル', '試し用の友達') order by name;
