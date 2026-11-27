// 表の鍵(RLS)と参加者の RPC のテスト。docs/設計.md の「7. テスト」の項目を1つずつ確かめる。名前はすべて架空
import { beforeEach, describe, expect, test } from 'vitest';
import { ANON, TestDb, fails, type Who } from './db';

type U = { id: string; role: 'authenticated' };

let db: TestDb;
let admin: U, orgA: U, orgB: U, orgC: U, outsider: U, p1: U, p2: U, p3: U;
let gA: { id: string; token: string }, gB: { id: string; token: string };
let mA: Record<string, string>; // 名前 → member id(グループA)
let mB: string; // グループBの人
let evA1: string, evA2: string, evB1: string;
let c1: string, c2: string, c3: string, cB: string;

const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 日本時間
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

async function one<T = any>(who: Who, sql: string, params: unknown[] = []): Promise<T> {
  return (await db.as<T>(who, sql, params))[0]!;
}

beforeEach(async () => {
  db = await TestDb.create();
  admin = await db.user(false);
  orgA = await db.user(false);
  orgB = await db.user(false);
  orgC = await db.user(false);
  outsider = await db.user(false);
  p1 = await db.user(true);
  p2 = await db.user(true);
  p3 = await db.user(true);
  // 準備は postgres で(RLS を通らない)
  await db.as(null, `insert into public.staff (user_id, role, display_name) values
    ($1, 'admin', '管理者'), ($2, 'organizer', '幹事A'), ($3, 'organizer', '幹事B'), ($4, 'organizer', '幹事C')`,
  [admin.id, orgA.id, orgB.id, orgC.id]);
  gA = await one(null, `insert into public.groups (name, kind, owner_id) values ('サークル', 'circle', $1) returning id, token`, [orgA.id]);
  gB = await one(null, `insert into public.groups (name, kind, owner_id) values ('男子会', 'group', $1) returning id, token`, [orgB.id]);
  mA = {};
  for (const [name, kana] of [['青木', 'あおき'], ['石井', 'いしい'], ['上田', 'うえだ']]) {
    mA[name!] = (await one(null, `insert into public.members (group_id, name, kana, grade) values ($1, $2, $3, '1年') returning id`, [gA.id, name, kana])).id;
  }
  mB = (await one(null, `insert into public.members (group_id, name) values ($1, '江口') returning id`, [gB.id])).id;
  const deadline = addDays(today(), 7);
  evA1 = (await one(null, `insert into public.events (group_id, name, deadline, created_by) values ($1, '忘年会', $2, $3) returning id`, [gA.id, deadline, orgA.id])).id;
  evA2 = (await one(null, `insert into public.events (group_id, name, created_by) values ($1, '新歓', $2) returning id`, [gA.id, orgA.id])).id;
  evB1 = (await one(null, `insert into public.events (group_id, name, created_by) values ($1, '飲み会', $2) returning id`, [gB.id, orgB.id])).id;
  [c1, c2, c3] = (await db.as<{ id: string }>(null, `insert into public.candidates (event_id, date, time) values
    ($1, '2026-12-15', '19:00'), ($1, '2026-12-18', '19:00'), ($1, '2026-12-22', '') returning id`, [evA1])).map((r) => r.id) as [string, string, string];
  cB = (await one(null, `insert into public.candidates (event_id, date) values ($1, '2026-12-20') returning id`, [evB1])).id;
  // 幹事C はグループAの「忘年会」だけを任されている
  await db.as(null, `insert into public.event_organizers (event_id, user_id) values ($1, $2)`, [evA1, orgC.id]);
});

const TABLES = ['staff', 'groups', 'members', 'events', 'event_organizers', 'candidates', 'answers', 'responses', 'wanted', 'answer_log'];

describe('参加者(匿名)は表を直接さわれない', () => {
  test('匿名の参加者は、どの表も読めない(0行)', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o' }]);
    for (const t of TABLES) expect(await db.as(p1, `select * from public.${t}`), t).toEqual([]);
  });

  test('匿名の参加者・幹事でない Google の人は、staff・groups・event_organizers・members に書けない', async () => {
    for (const who of [p1, outsider]) {
      await fails(db.as(who, `insert into public.staff (user_id, role) values ($1, 'admin')`, [who.id]));
      await fails(db.as(who, `insert into public.groups (name, kind, owner_id) values ('x', 'group', $1)`, [who.id]));
      await fails(db.as(who, `insert into public.event_organizers (event_id, user_id) values ($1, $2)`, [evA1, orgA.id]));
      await fails(db.as(who, `insert into public.members (group_id, name) values ($1, 'なりすまし')`, [gA.id]));
      expect(await db.as(who, `update public.members set name = 'x' where group_id = $1 returning id`, [gA.id])).toEqual([]);
    }
  });

  test('ログインしていない状態(anon)では RPC を実行できない', async () => {
    expect(await fails(db.rpc(ANON, 'open_group', [gA.token]))).toMatch(/permission denied/);
    expect(await fails(db.rpc(ANON, 'my_events'))).toMatch(/permission denied/);
    expect(await fails(db.as(ANON, 'select * from public.members'))).toMatch(/permission denied/);
  });

  test('匿名の人は staff にできない', async () => {
    expect(await fails(db.as(admin, `insert into public.staff (user_id, role) values ($1, 'organizer')`, [p1.id]))).toMatch(/INVALID/);
  });
});

describe('合言葉', () => {
  test('合言葉を知らないグループは開けない/しまった・合言葉を変えたグループも開けない', async () => {
    expect(await fails(db.rpc(p1, 'open_group', ['wrong-token-xxxxxxxxxxxxxxx']))).toMatch(/NOT_FOUND/);
    const g = await db.rpc(p1, 'open_group', [gA.token]);
    expect(g.group.name).toBe('サークル');
    expect(g.member_count).toBe(3);
    expect(g.events.map((e: any) => e.name).sort()).toEqual(['忘年会', '新歓']);
    await db.as(orgA, `update public.groups set archived = true where id = $1`, [gA.id]);
    expect(await fails(db.rpc(p1, 'open_group', [gA.token]))).toMatch(/NOT_FOUND/);
    await db.as(orgB, `update public.groups set token = 'new-token-aaaaaaaaaaaaaaaaaaa' where id = $1`, [gB.id]);
    expect(await fails(db.rpc(p1, 'open_group', [gB.token]))).toMatch(/NOT_FOUND/);
    expect((await db.rpc(p1, 'open_group', ['new-token-aaaaaaaaaaaaaaaaaaa'])).group.name).toBe('男子会');
  });

  test('合言葉は推測できない長さ', () => {
    expect(gA.token.length).toBeGreaterThanOrEqual(40);
    expect(gA.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('グループAの合言葉で、グループBのイベントを読む・答えることはできない', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    expect(await fails(db.rpc(p1, 'get_event', [gA.token, evB1]))).toMatch(/NOT_FOUND/);
    expect(await fails(db.rpc(p1, 'submit_answers', [gA.token, evB1, { [cB]: 'o' }]))).toMatch(/NOT_FOUND/);
    // ほかのイベントの候補日を混ぜても入らない
    expect(await fails(db.rpc(p1, 'submit_answers', [gA.token, evA1, { [cB]: 'o' }]))).toMatch(/INVALID/);
  });
});

describe('名前を選ぶ・加わる', () => {
  test('選んだ名前で答え、自分の答えだけが mine に出る', async () => {
    const r = await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    expect(r.me.name).toBe('青木');
    const ev = await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o', [c2]: 'x' }, '15日なら']);
    expect(ev.mine.answers).toEqual({ [c1]: 'o', [c2]: 'x' });
    expect(ev.mine.comment).toBe('15日なら');
    expect((await db.rpc(p1, 'open_group', [gA.token])).me.name).toBe('青木');
  });

  test('ほかのスマホで使われている名前は、確認してから選べる(案イ)。1人1つの名前', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    expect(await db.rpc(p2, 'claim_member', [gA.token, mA['青木']])).toEqual({ needs_confirm: true });
    const list = await db.rpc(p2, 'list_members', [gA.token]);
    expect(list.find((m: any) => m.name === '青木')).toMatchObject({ taken: true, mine: false, kana: 'あおき' });
    await db.rpc(p2, 'claim_member', [gA.token, mA['青木'], true]);
    expect((await db.rpc(p1, 'open_group', [gA.token])).me).toBeNull();
    // 別の名前を選び直すと、前の名前は外れる
    await db.rpc(p2, 'claim_member', [gA.token, mA['石井']]);
    const owned = await db.as(null, `select name from public.members where user_id = $1`, [p2.id]);
    expect(owned.map((r) => r.name)).toEqual(['石井']);
  });

  test('同じ名前(空白ちがいも)では加われない。サークル以外ではふりがな等を持たない', async () => {
    expect(await fails(db.rpc(p1, 'join_group', [gA.token, ' 青　木 ']))).toMatch(/DUPLICATE_NAME/);
    const j = await db.rpc(p1, 'join_group', [gA.token, '  遠藤   太郎 ', 'えんどう', '2年']);
    expect(j.me.name).toBe('遠藤 太郎');
    expect(await fails(db.rpc(p2, 'join_group', [gA.token, '遠藤太郎']))).toMatch(/DUPLICATE_NAME/);
    await db.rpc(p2, 'join_group', [gB.token, '小川', 'おがわ', '1年']);
    const row = await one(null, `select kana, grade from public.members where group_id = $1 and name = '小川'`, [gB.id]);
    expect(row).toEqual({ kana: null, grade: null });
    expect(await fails(db.rpc(p3, 'join_group', [gA.token, 'あ'.repeat(21)]))).toMatch(/INVALID/);
  });

  test('参加者は、ほかの人として答えられない(member_id を受け取らない)', async () => {
    expect(await fails(db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o' }]))).toMatch(/NO_MEMBER/);
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o' }]);
    const rows = await db.as(null, `select member_id from public.answers`);
    expect(rows).toEqual([{ member_id: mA['青木'] }]);
  });
});

describe('答える', () => {
  test('締め切り(日本時間のその日まで)・日程調整中以外は submit_answers できない', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    await db.as(null, `update public.events set deadline = $2 where id = $1`, [evA1, today()]);
    await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o' }]); // 今日まではOK
    await db.as(null, `update public.events set deadline = $2 where id = $1`, [evA1, addDays(today(), -1)]);
    expect(await fails(db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'x' }]))).toMatch(/CLOSED/);
    await db.as(null, `update public.events set deadline = null, status = 'rsvp', decided_candidate_id = $2 where id = $1`, [evA1, c1]);
    expect(await fails(db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'x' }]))).toMatch(/CLOSED/);
  });

  test('おかしな記号・ひとことの長さは止める', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    expect(await fails(db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'maybe' }]))).toMatch(/INVALID/);
    expect(await fails(db.rpc(p1, 'submit_answers', [gA.token, evA1, { 'not-a-uuid': 'o' }]))).toMatch(/INVALID/);
    expect(await fails(db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o' }, 'あ'.repeat(101)]))).toMatch(/INVALID/);
  });

  test('2段階:時間調整中は時間の候補だけ書きかえ、日にちの答えとひとことは残る', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o', [c3]: 't' }, 'よろしく']);
    const [t1, t2] = (await db.as<{ id: string }>(orgA, `insert into public.candidates (event_id, date, time, stage) values
      ($1, '2026-12-15', '17:00', 'time'), ($1, '2026-12-15', '19:00', 'time') returning id`, [evA1])).map((r) => r.id);
    await db.as(orgA, `update public.events set status = 'time', decided_candidate_id = $2 where id = $1`, [evA1, c1]);
    let ev = await db.rpc(p1, 'get_event', [gA.token, evA1]);
    expect(ev.event.stage).toBe('time');
    expect(ev.event.decided).toEqual({ date: '2026-12-15', time: '' }); // 時刻は目安だったので出さない
    expect(ev.candidates.map((c: any) => c.time)).toEqual(['17:00', '19:00']);
    expect(ev.mine.answers).toEqual({});
    expect(await fails(db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c2]: 'o' }]))).toMatch(/INVALID/); // 日にちの候補は不可
    ev = await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [t1!]: 'x', [t2!]: 'o' }]);
    expect(ev.mine.answers).toEqual({ [t1!]: 'x', [t2!]: 'o' });
    expect(ev.mine.comment).toBe('よろしく');
    expect(ev.date_stage.by_candidate.find((c: any) => c.candidate_id === c1).o).toBe(1);
    const all = await db.as(null, `select candidate_id, mark from public.answers order by mark`);
    expect(all).toHaveLength(4);
    // 時間を決める → 出欠確認中
    await db.as(orgA, `update public.events set status = 'rsvp', decided_candidate_id = $2 where id = $1`, [evA1, t2]);
    expect((await db.rpc(p1, 'get_event', [gA.token, evA1])).event.decided).toEqual({ date: '2026-12-15', time: '19:00' });
  });

  test('出欠は出欠確認中だけ', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['石井']]);
    expect(await fails(db.rpc(p1, 'submit_attendance', [gA.token, evA1, 'go']))).toMatch(/CLOSED/);
    await db.as(null, `update public.events set status = 'rsvp', decided_candidate_id = $2 where id = $1`, [evA1, c1]);
    expect(await fails(db.rpc(p1, 'submit_attendance', [gA.token, evA1, 'yes']))).toMatch(/INVALID/);
    const ev = await db.rpc(p1, 'submit_attendance', [gA.token, evA1, 'partial', '20:30', '遅れます']);
    expect(ev.mine).toMatchObject({ attendance: 'partial', arrive_at: '20:30' });
    expect(ev.attendance).toEqual({ go: 0, partial: 1, no: 0, names: { go: [], partial: ['石井(20:30〜)'], no: [] } });
    expect((await db.rpc(p1, 'open_group', [gA.token])).events.find((e: any) => e.id === evA1).answered).toBe(true);
  });
});

describe('結果の見せ方(visibility)とひとこと', () => {
  async function answerAll() {
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    await db.rpc(p2, 'claim_member', [gA.token, mA['石井']]);
    await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o', [c2]: 'o' }, 'ひみつのひとこと']);
    await db.rpc(p2, 'submit_answers', [gA.token, evA1, { [c1]: 'o', [c2]: 't' }]);
    await db.as(null, `insert into public.wanted (group_id, event_id, member_id) values ($1, $2, $3)`, [gA.id, evA1, mA['上田']]);
  }

  test('names:名前つきの集計。ほかの人のひとことは返さない', async () => {
    await answerAll();
    const ev = await db.rpc(p2, 'get_event', [gA.token, evA1]);
    expect(ev.results.answered_count).toBe(2);
    expect(ev.results.by_candidate.map((c: any) => [c.o, c.t, c.x])).toEqual([[2, 0, 0], [1, 1, 0], [0, 0, 0]]);
    expect(ev.results.by_candidate[0].names.o).toEqual(['青木', '石井']);
    expect(ev.wanted).toEqual(['上田']);
    expect(JSON.stringify(ev)).not.toContain('ひみつのひとこと');
  });

  test('counts:人数だけで名前は入らない/hidden:結果は null', async () => {
    await answerAll();
    await db.as(orgA, `update public.events set visibility = 'counts' where id = $1`, [evA1]);
    let ev = await db.rpc(p2, 'get_event', [gA.token, evA1]);
    expect(ev.results.by_candidate[0].o).toBe(2);
    expect(ev.results.by_candidate[0].names).toBeNull();
    expect(ev.wanted).toBe(1);
    expect(JSON.stringify({ ...ev, mine: null })).not.toMatch(/青木|石井|上田/);
    await db.as(orgA, `update public.events set visibility = 'hidden', status = 'rsvp', decided_candidate_id = $2 where id = $1`, [evA1, c1]);
    await db.rpc(p1, 'submit_attendance', [gA.token, evA1, 'go']);
    ev = await db.rpc(p2, 'get_event', [gA.token, evA1]);
    expect([ev.results, ev.date_stage, ev.attendance, ev.wanted]).toEqual([null, null, null, null]);
  });
});

describe('幹事・管理者', () => {
  test('幹事Aは、幹事Bのグループと、そのイベントを読めない。管理者はすべて読める', async () => {
    const names = async (who: Who, t: string) => (await db.as(who, `select name from public.${t} order by name`)).map((r) => r.name);
    expect(await names(orgA, 'groups')).toEqual(['サークル']);
    expect(await names(orgB, 'groups')).toEqual(['男子会']);
    expect(await names(orgA, 'events')).toEqual(['忘年会', '新歓'].sort());
    expect(await names(orgA, 'members')).toEqual(['上田', '石井', '青木'].sort());
    expect(await names(admin, 'groups')).toEqual(['サークル', '男子会'].sort());
    expect((await names(admin, 'members')).length).toBe(4);
    expect(await names(outsider, 'groups')).toEqual([]);
  });

  test('任された幹事は、そのイベントは読めるが、同じグループのほかのイベントは読めない。名前は直接読めない', async () => {
    expect((await db.as(orgC, `select name from public.events`)).map((r) => r.name)).toEqual(['忘年会']);
    expect((await db.as(orgC, `select name from public.groups`)).map((r) => r.name)).toEqual(['サークル']);
    expect(await db.as(orgC, `select * from public.members`)).toEqual([]);
    expect((await db.as(orgC, `select id from public.candidates`)).length).toBe(3);
  });

  test('任された幹事は、events.group_id を変えられない/event_organizers に書けない/候補日を別のイベントへ移せない', async () => {
    expect(await fails(db.as(orgC, `update public.events set group_id = $2 where id = $1`, [evA1, gB.id]))).toMatch(/IMMUTABLE/);
    await fails(db.as(orgC, `insert into public.event_organizers (event_id, user_id) values ($1, $2)`, [evA2, orgC.id]));
    expect(await fails(db.as(orgA, `update public.candidates set event_id = $2 where id = $1`, [c1, evA2]))).toMatch(/IMMUTABLE/);
  });

  test('運営は、ほかのグループの member_id や、ほかのイベントの候補日で answers を入れられない', async () => {
    await fails(db.as(orgA, `insert into public.answers (group_id, event_id, member_id, candidate_id, mark) values ($1, $2, $3, $4, 'o')`, [gA.id, evA1, mB, c1]));
    await fails(db.as(orgA, `insert into public.answers (group_id, event_id, member_id, candidate_id, mark) values ($1, $2, $3, $4, 'o')`, [gA.id, evA1, mA['青木'], cB]));
    // 正しい組み合わせなら代わりに入れられる(変更の記録も残る)
    await db.as(orgA, `insert into public.answers (group_id, event_id, member_id, candidate_id, mark) values ($1, $2, $3, $4, 'o')`, [gA.id, evA1, mA['青木'], c1]);
    expect(await db.as(orgA, `select new_mark, changed_by from public.answer_log`)).toEqual([{ new_mark: 'o', changed_by: orgA.id }]);
    expect(await db.as(orgB, `select * from public.answer_log`)).toEqual([]);
  });

  test('外された幹事は何も読めなくなり、任されたイベントも自動で外れる', async () => {
    await db.as(admin, `delete from public.staff where user_id = $1`, [orgC.id]);
    expect(await db.as(orgC, `select * from public.events`)).toEqual([]);
    expect(await db.as(null, `select * from public.event_organizers`)).toEqual([]);
    await db.as(admin, `delete from public.staff where user_id = $1`, [orgA.id]);
    expect(await db.as(orgA, `select * from public.groups`)).toEqual([]); // owner_id が残っていても
  });

  test('グループを消すのは管理者だけ。owner_id を変えるのも管理者だけ', async () => {
    expect(await db.as(orgA, `delete from public.groups where id = $1 returning id`, [gA.id])).toEqual([]);
    expect(await fails(db.as(orgA, `update public.groups set owner_id = $2 where id = $1`, [gA.id, orgB.id]))).toMatch(/FORBIDDEN/);
    await db.as(admin, `update public.groups set owner_id = $2 where id = $1`, [gA.id, orgB.id]);
    expect((await db.as(admin, `delete from public.groups where id = $1 returning id`, [gA.id])).length).toBe(1);
  });

  test('幹事は自分のグループを作れる(owner は自分)。ほかの人を owner にしては作れない', async () => {
    const g = await one(orgB, `insert into public.groups (name, kind) values ('新グループ', 'once') returning owner_id`);
    expect(g.owner_id).toBe(orgB.id);
    // イベントと候補日も、作った直後に読み返せる(画面は insert().select() で使う)
    const ev = await one(orgB, `insert into public.events (group_id, name) select id, '集まり' from public.groups where name = '新グループ' returning id, created_by`);
    expect(ev.created_by).toBe(orgB.id);
    expect((await db.as(orgB, `insert into public.candidates (event_id, date) values ($1, '2027-01-10') returning id`, [ev.id])).length).toBe(1);
    // 幹事Bは、幹事Aのグループにイベントを作れない
    await fails(db.as(orgB, `insert into public.events (group_id, name) values ($1, 'x')`, [gA.id]));
    await fails(db.as(orgB, `insert into public.groups (name, kind, owner_id) values ('x', 'once', $1)`, [orgA.id]));
  });
});

describe('メンバーの削除・匿名ユーザーの削除', () => {
  test('削除(active=false)すると名前を選んでいた人が外れ、集計・一覧から消える。戻すとき同じ名前がいれば止まる', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o' }]);
    await db.as(orgA, `update public.members set active = false where id = $1`, [mA['青木']]);
    expect((await one(null, `select user_id from public.members where id = $1`, [mA['青木']])).user_id).toBeNull();
    const ev = await db.rpc(p2, 'get_event', [gA.token, evA1]);
    expect(ev.results.member_count).toBe(2);
    expect(ev.results.by_candidate[0].o).toBe(0);
    expect((await db.rpc(p2, 'list_members', [gA.token])).map((m: any) => m.name)).not.toContain('青木');
    // 同じ名前(空白ちがい)で加わった人がいると、戻せない
    await db.rpc(p2, 'join_group', [gA.token, '青 木']);
    await fails(db.as(orgA, `update public.members set active = true where id = $1`, [mA['青木']]));
  });

  test('匿名ユーザーを消しても、名前と答えは残る', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['上田']]);
    await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c2]: 'o' }]);
    await db.as(null, `delete from auth.users where id = $1`, [p1.id]);
    expect(await one(null, `select name, user_id from public.members where id = $1`, [mA['上田']])).toEqual({ name: '上田', user_id: null });
    expect((await db.as(null, `select * from public.answers`)).length).toBe(1);
  });
});

describe('ほかのグループのイベントもまとめて見る(my_events)', () => {
  test('自分が名前を選んだグループだけ。名前では結ばない', async () => {
    await db.rpc(p1, 'claim_member', [gA.token, mA['青木']]);
    await db.rpc(p1, 'join_group', [gB.token, 'あおき']);
    await db.rpc(p1, 'submit_answers', [gA.token, evA1, { [c1]: 'o' }]);
    const mine = await db.rpc(p1, 'my_events');
    expect(mine.map((g: any) => [g.group.name, g.me.name])).toEqual([['サークル', '青木'], ['男子会', 'あおき']]);
    const a = mine[0].events.find((e: any) => e.id === evA1);
    expect(a.answered).toBe(true);
    // 同じ名前で入った別の人(p2)には、p1 のグループは出ない
    await db.rpc(p2, 'join_group', [gB.token, '青木']);
    expect((await db.rpc(p2, 'my_events')).map((g: any) => g.group.name)).toEqual(['男子会']);
    // しまったグループ・削除された名前は出ない
    await db.as(orgB, `update public.groups set archived = true where id = $1`, [gB.id]);
    await db.as(orgA, `update public.members set active = false where id = $1`, [mA['青木']]);
    expect(await db.rpc(p1, 'my_events')).toEqual([]);
  });
});
