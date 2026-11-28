// 運営の操作(決める・時間も聞く・戻す・結果)と、コース・会費のテスト。名前はすべて架空
import { beforeEach, expect, test } from 'vitest';
import { TestDb, fails } from './db';

type U = { id: string; role: 'authenticated' };
let db: TestDb;
let admin: U, owner: U, delegated: U, otherOrg: U, p1: U, p2: U;
let g: { id: string; token: string };
let m1: string, m2: string, m3: string;
let ev: string, d1: string, d2: string;

const one = async (who: U | null, sql: string, params: unknown[] = []) => (await db.as(who, sql, params))[0]!;

beforeEach(async () => {
  db = await TestDb.create();
  admin = await db.user(false); owner = await db.user(false); delegated = await db.user(false); otherOrg = await db.user(false);
  p1 = await db.user(true); p2 = await db.user(true);
  await db.as(null, `insert into public.staff (user_id, role) values ($1,'admin'),($2,'organizer'),($3,'organizer'),($4,'organizer')`,
    [admin.id, owner.id, delegated.id, otherOrg.id]);
  g = await one(null, `insert into public.groups (name, kind, owner_id) values ('サークル','circle',$1) returning id, token`, [owner.id]) as any;
  m1 = (await one(null, `insert into public.members (group_id, name, kana, grade) values ($1,'青木','あおき','1年') returning id`, [g.id])).id;
  m2 = (await one(null, `insert into public.members (group_id, name, kana, grade) values ($1,'石井','いしい','2年') returning id`, [g.id])).id;
  m3 = (await one(null, `insert into public.members (group_id, name, kana, grade) values ($1,'上田','うえだ','3年') returning id`, [g.id])).id;
  ev = (await one(null, `insert into public.events (group_id, name) values ($1,'忘年会') returning id`, [g.id])).id;
  [d1, d2] = (await db.as<{ id: string }>(null, `insert into public.candidates (event_id, date, time) values ($1,'2026-12-19','18:00'),($1,'2026-12-20','') returning id`, [ev])).map((r) => r.id) as [string, string];
  await db.as(null, `insert into public.event_organizers (event_id, user_id) values ($1,$2)`, [ev, delegated.id]);
  await db.rpc(p1, 'claim_member', [g.token, m1]);
  await db.rpc(p2, 'claim_member', [g.token, m2]);
  await db.rpc(p1, 'submit_answers', [g.token, ev, { [d1]: 'o', [d2]: 'x' }, 'よろしく']);
  await db.rpc(p2, 'submit_answers', [g.token, ev, { [d1]: 'x', [d2]: 'o' }]);
});

test('結果(運営用):全員の答え・ひとこと。任された幹事には学年などを渡さない。ほかの幹事・参加者は見られない', async () => {
  const r = await db.rpc(owner, 'staff_event_results', [ev]);
  expect(r.members.map((m: any) => m.name)).toEqual(['青木', '石井', '上田']);
  expect(r.members[0]).toMatchObject({ answers: { [d1]: 'o', [d2]: 'x' }, comment: 'よろしく', grade: '1年', paid: false });
  expect(r.members[2].answers).toEqual({}); // 答えていない人も入る
  const rd = await db.rpc(delegated, 'staff_event_results', [ev]);
  expect(rd.members[0].grade).toBeNull();
  expect(rd.members[0].name).toBe('青木');
  expect(await fails(db.rpc(otherOrg, 'staff_event_results', [ev]))).toMatch(/FORBIDDEN/);
  expect(await fails(db.rpc(p1, 'staff_event_results', [ev]))).toMatch(/FORBIDDEN/);
  expect(await fails(db.rpc(p1, 'staff_decide', [ev, d1]))).toMatch(/FORBIDDEN/);
});

test('この日に決める → 出欠確認。○→行く、×→行かないが仮に入る。1段戻すと日程調整中', async () => {
  const r = await db.rpc(owner, 'staff_decide', [ev, d1]);
  expect(r.event.status).toBe('rsvp');
  expect(r.event.decided).toEqual({ date: '2026-12-19', time: '18:00' });
  expect(r.members.map((m: any) => m.attendance)).toEqual(['go', 'no', null]);
  const v = await db.rpc(p2, 'get_event', [g.token, ev]);
  expect(v.mine.attendance).toBe('no');
  expect(await fails(db.rpc(owner, 'staff_decide', [ev, d2]))).toMatch(/INVALID/); // もう決まっている
  const back = await db.rpc(owner, 'staff_undecide', [ev]);
  expect(back.event.status).toBe('poll');
  expect(back.event.decided).toBeNull();
});

test('時間も聞く → 時間調整中(同じ日の時間の候補)→ 時間を決める → 戻すのは1段ずつ', async () => {
  let r = await db.rpc(owner, 'staff_decide', [ev, d1, ['19:00', '17:00', '19:00']]);
  expect(r.event.status).toBe('time');
  const times = r.candidates.filter((c: any) => c.stage === 'time');
  expect(times.map((c: any) => [c.date, c.time])).toEqual([['2026-12-19', '17:00'], ['2026-12-19', '19:00']]);
  expect(await fails(db.rpc(owner, 'staff_decide', [ev, d1, ['25:00']]))).toMatch(/INVALID/);
  const [t17, t19] = times.map((c: any) => c.id);
  await db.rpc(p1, 'submit_answers', [g.token, ev, { [t17]: 'x', [t19]: 'o' }]);
  expect(await fails(db.rpc(owner, 'staff_decide_time', [ev, d2]))).toMatch(/NOT_FOUND/);
  r = await db.rpc(owner, 'staff_decide_time', [ev, t19]);
  expect(r.event.status).toBe('rsvp');
  expect(r.event.decided).toEqual({ date: '2026-12-19', time: '19:00' });
  expect(r.members[0].attendance).toBe('go');
  // 1段目:時間調整中に戻る(時間の候補と答えは残る)
  r = await db.rpc(owner, 'staff_undecide', [ev]);
  expect(r.event.status).toBe('time');
  expect(r.event.decided).toEqual({ date: '2026-12-19', time: '' });
  expect(r.members[0].answers[t19]).toBe('o');
  // 2段目:日程調整中に戻る(時間の候補は消え、日にちの答えは残る)
  r = await db.rpc(owner, 'staff_undecide', [ev]);
  expect(r.event.status).toBe('poll');
  expect(r.candidates.every((c: any) => c.stage === 'date')).toBe(true);
  expect(r.members[0].answers).toEqual({ [d1]: 'o', [d2]: 'x' });
  expect(await fails(db.rpc(owner, 'staff_undecide', [ev]))).toMatch(/INVALID/);
});

test('コース:参加者が選べる(そのイベントのコースだけ)。会費の受け取りは運営だけが変えられ、参加者には見えない', async () => {
  const [c1, c2] = (await db.as<{ id: string }>(owner, `insert into public.event_courses (event_id, name, price, sort) values
    ($1,'飲み放題つき',4000,1),($1,'ソフトドリンク',3000,2) returning id`, [ev])).map((r) => r.id);
  await db.as(owner, `update public.events set style = 'party' where id = $1`, [ev]); // 飲み会
  const evB = (await one(null, `insert into public.events (group_id, name) values ($1,'別') returning id`, [g.id])).id;
  const cOther = (await one(null, `insert into public.event_courses (event_id, name) values ($1,'別のコース') returning id`, [evB])).id;
  await db.rpc(owner, 'staff_decide', [ev, d1]);
  let v = await db.rpc(p1, 'get_event', [g.token, ev]);
  expect(v.courses.map((c: any) => [c.name, c.price])).toEqual([['飲み放題つき', 4000], ['ソフトドリンク', 3000]]);
  expect(await fails(db.rpc(p1, 'submit_attendance', [g.token, ev, 'go', '', '', cOther]))).toMatch(/INVALID/);
  v = await db.rpc(p1, 'submit_attendance', [g.token, ev, 'go', '', '', c2]);
  expect(v.mine.course_id).toBe(c2);
  expect(JSON.stringify(v)).not.toContain('paid');
  // 「行かない」にするとコースは外れる
  v = await db.rpc(p2, 'submit_attendance', [g.token, ev, 'no', '', '', c1]);
  expect(v.mine.course_id).toBeNull();
  // 運営が受け取りをチェック
  await db.as(owner, `update public.responses set paid = true, paid_at = now() where event_id = $1 and member_id = $2`, [ev, m1]);
  const r = await db.rpc(owner, 'staff_event_results', [ev]);
  expect(r.members[0]).toMatchObject({ course_id: c2, paid: true });
  expect(r.courses.length).toBe(2);
  // 参加者は表を直接さわれないので、受け取りを自分で付けられない
  expect(await db.as(p1, `update public.responses set paid = true where member_id = $1 returning *`, [m1])).toEqual([]);
  expect(await db.as(p1, `select * from public.event_courses`)).toEqual([]);
  // 出欠を答え直しても、受け取りのチェックは消えない
  await db.rpc(p1, 'submit_attendance', [g.token, ev, 'partial', '20:00', '', c1]);
  expect((await db.rpc(owner, 'staff_event_results', [ev])).members[0].paid).toBe(true);
});

test('出欠を答えた人の仮入れは上書きしない。任された幹事も決められる。ほかの幹事は決められない', async () => {
  await db.as(null, `update public.responses set attendance = 'partial' where event_id = $1 and member_id = $2`, [ev, m1]);
  expect(await fails(db.rpc(otherOrg, 'staff_decide', [ev, d1]))).toMatch(/FORBIDDEN/);
  const r = await db.rpc(delegated, 'staff_decide', [ev, d1]);
  expect(r.members[0].attendance).toBe('partial');
  void m3;
});

test('グループの種類:グループ ⇄ 1回きりだけ。終わっていないイベントが2つ以上なら1回きりにできない。サークルは切りかえない', async () => {
  const fr = await one(owner, `insert into public.groups (name, kind) values ('飲み会','once') returning id`);
  const e1 = (await one(owner, `insert into public.events (group_id, name) values ($1,'1回目') returning id`, [fr.id])).id;
  await db.as(owner, `update public.groups set kind = 'group' where id = $1`, [fr.id]);
  await db.as(owner, `insert into public.events (group_id, name) values ($1,'2回目')`, [fr.id]);
  expect(await fails(db.as(owner, `update public.groups set kind = 'once' where id = $1`, [fr.id]))).toMatch(/INVALID/);
  await db.as(owner, `update public.events set status = 'done' where id = $1`, [e1]);
  await db.as(owner, `update public.groups set kind = 'once' where id = $1`, [fr.id]);
  expect(await fails(db.as(owner, `update public.groups set kind = 'group' where id = $1`, [g.id]))).toMatch(/INVALID/);
  expect(await fails(db.as(owner, `update public.groups set kind = 'circle' where id = $1`, [fr.id]))).toMatch(/INVALID/);
});

test('案内(notice)は参加者に出る。コースは時間調整中・出欠確認中に選べる(日程調整中は不可)', async () => {
  const [c1] = (await db.as<{ id: string }>(owner, `insert into public.event_courses (event_id, name, price) values ($1,'飲み放題',4000) returning id`, [ev])).map((r) => r.id);
  await db.as(owner, `update public.events set notice = '会費は当日集めます' where id = $1`, [ev]);
  // イベント(飲み会でない)のときは、コースを見せない・選べない
  expect((await db.rpc(p1, 'get_event', [g.token, ev])).courses).toEqual([]);
  await db.as(owner, `update public.events set style = 'party' where id = $1`, [ev]);
  expect((await db.rpc(p1, 'get_event', [g.token, ev])).event.notice).toBe('会費は当日集めます');
  expect(await fails(db.rpc(p1, 'choose_course', [g.token, ev, c1]))).toMatch(/CLOSED/);
  await db.rpc(owner, 'staff_decide', [ev, d1, ['19:00']]);
  let v = await db.rpc(p1, 'choose_course', [g.token, ev, c1]);
  expect(v.mine.course_id).toBe(c1);
  v = await db.rpc(p1, 'choose_course', [g.token, ev, null]);
  expect(v.mine.course_id).toBeNull();
  expect(await fails(db.rpc(p1, 'choose_course', [g.token, ev, '00000000-0000-0000-0000-000000000000']))).toMatch(/INVALID/);
  await db.as(owner, `update public.events set style = 'event' where id = $1`, [ev]);
  expect(await fails(db.rpc(p1, 'choose_course', [g.token, ev, c1]))).toMatch(/INVALID/);
});

test('場所のリンクと、名前つきのほかのリンク(最大5つ)が参加者に届く', async () => {
  await db.as(owner, `update public.events set place = '上酒林', place_url = 'https://maps.app.goo.gl/x',
    links = '[{"label":"メニュー","url":"https://example.com/menu"}]', duration_min = 180 where id = $1`, [ev]);
  const v = await db.rpc(p1, 'get_event', [g.token, ev]);
  expect(v.event).toMatchObject({ place: '上酒林', place_url: 'https://maps.app.goo.gl/x', duration_min: 180,
    links: [{ label: 'メニュー', url: 'https://example.com/menu' }] });
  const six = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ label: 'L' + i, url: 'https://e.com/' + i })));
  await fails(db.as(owner, `update public.events set links = $2::jsonb where id = $1`, [ev, six]));
});
