// A案の書き出し → B案の表(scripts/transform-a.mjs)のテスト。名前はすべて架空
import { expect, test } from 'vitest';
// @ts-expect-error 型のない .mjs
import { listGroups, transformA } from '../scripts/transform-a.mjs';
import { TestDb } from './db/db';

const exportData = {
  format: 'schedule-a-export-v1', exportedAt: '2026-11-28T00:00:00Z', moveMode: 'moving',
  groups: [
    {
      id: 'G001', name: 'サークル', kind: 'サークル', mascot: true,
      members: [
        { memberId: 'M001', rosterId: 'P01', name: '青木 ひなた', kana: 'あおき ひなた', grade: '1年', gender: '女性', active: true },
        { memberId: 'M002', rosterId: 'P02', name: '石井 蓮', kana: 'いしい れん', grade: '2年', gender: '男性', active: true },
        { memberId: 'M003', rosterId: 'P03', name: '石井蓮', kana: '', grade: '', gender: '', active: true }, // 空白ちがいの二重
        { memberId: 'M004', rosterId: 'P04', name: '抜けた人', kana: '', grade: '', gender: '', active: false },
      ],
      events: [{
        id: 'E01', name: '忘年会', description: '', status: '時間調整中', visibility: '名前', deadline: '2026-12-12', decidedId: 'C02',
        place: '駅前', cost: '', url: 'https://maps.app.goo.gl/abc', createdAt: '2026-11-27',
        candidates: [
          { id: 'C01', date: '2026-12-18', time: '19:00', memo: '', stage: 'date' },
          { id: 'C02', date: '2026-12-19', time: '', memo: '', stage: 'date' },
          { id: 'C03', date: '2026-12-19', time: '9:30', memo: '', stage: 'time' },
          { id: 'C04', date: 'bad', time: '', memo: '', stage: 'date' },
        ],
        answers: [
          { memberId: 'M001', answers: 'C01:○,C02:△', comment: '古い', updatedAt: 1 },
          { memberId: 'M001', answers: 'C01:×,C02:○,C03:○,C99:○', comment: 'よろしく', updatedAt: 2 },
          { memberId: 'M002', answers: 'C02:○', comment: '', updatedAt: 1 },
          { memberId: 'M999', answers: 'C01:○', comment: '', updatedAt: 1 },
        ],
        attendance: [], wanted: ['M002'],
      }],
    },
    {
      id: 'G002', name: '男子会', kind: 'グループ', mascot: false,
      members: [{ memberId: 'M001', rosterId: '', name: 'たろう', kana: '', grade: '', gender: '', active: true }],
      events: [{
        id: 'E01', name: '飲み会', description: '', status: '出欠確認中', visibility: '人数', deadline: '', decidedId: 'C01',
        place: '', cost: '', url: 'https://example.com/menu', createdAt: '',
        candidates: [{ id: 'C01', date: '2026-12-20', time: '19:00', memo: '', stage: 'date' }],
        answers: [{ memberId: 'M001', answers: 'C01:○', comment: '', updatedAt: 1 }],
        attendance: [{ memberId: 'M001', status: '途中から', comment: '遅れます', arriveAt: '20:30', updatedAt: 1 }], wanted: [],
      }],
    },
    { id: 'G003', name: '入れないグループ', kind: 'グループ', mascot: true, members: [], events: [] },
  ],
};

test('グループの一覧(入れる前に見せる)にはメンバーの名前を出さない', () => {
  const list = listGroups(exportData);
  expect(list).toEqual([
    { id: 'G001', name: 'サークル', kind: 'サークル', members: 3, events: 1 },
    { id: 'G002', name: '男子会', kind: 'グループ', members: 1, events: 1 },
    { id: 'G003', name: '入れないグループ', kind: 'グループ', members: 0, events: 0 },
  ]);
  expect(JSON.stringify(list)).not.toMatch(/青木|石井|たろう/);
  expect(() => transformA({ format: 'x' })).toThrow(/形がちがいます/);
});

test('変換:新しいほうの答え・決まった日・地図のリンク・二重登録・選んだグループだけ', () => {
  const { rows, counts, warnings, groupMap } = transformA(exportData, { only: ['G001', 'G002'] });
  expect(Object.keys(groupMap)).toEqual(['G001', 'G002']);
  expect(counts).toMatchObject({ groups: 2, members: 5, events: 2, candidates: 4 });
  expect(rows.members.filter((m: any) => m.active).length).toBe(3); // 二重の1人と抜けた人は「削除した」
  expect(rows.events[0]).toMatchObject({ status: 'time', place_url: 'https://maps.app.goo.gl/abc', links: [], deadline: '2026-12-12' });
  expect(rows.events[1]).toMatchObject({ status: 'rsvp', visibility: 'counts', place_url: '', links: [{ label: 'リンク', url: 'https://example.com/menu' }] });
  expect(rows.candidates.find((c: any) => c.stage === 'time').time).toBe('09:30');
  expect(rows.answers.length).toBe(5); // M001 の新しい3つ(C99 は捨てる)+ M002 の1つ + 男子会の1つ
  expect(rows.responses.find((r: any) => r.attendance === 'partial')).toMatchObject({ arrive_at: '20:30', att_comment: '遅れます' });
  expect(warnings.some((w: string) => /同じ名前/.test(w))).toBe(true);
  expect(warnings.some((w: string) => /日付の読めない/.test(w))).toBe(true);
  expect(warnings.join('\n')).not.toMatch(/青木|石井|たろう/); // 注意にも名前は出さない
});

test('B の表に入れられ、名前を選び直すと前の答えがそのまま見える', async () => {
  const db = await TestDb.create();
  const { rows } = transformA(exportData, { only: ['G001', 'G002'] });
  const ins = async (table: string, list: any[]) => {
    for (const r of list) {
      const cols = Object.keys(r);
      await db.as(null, `insert into public.${table} (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
        cols.map((c) => (c === 'links' ? JSON.stringify(r[c]) : r[c])));
    }
  };
  await ins('groups', rows.groups);
  await ins('members', rows.members);
  await ins('events', rows.events);
  await ins('candidates', rows.candidates);
  for (const d of rows.decided) await db.as(null, `update public.events set decided_candidate_id = $2, decided_date_id = $3 where id = $1`, [d.id, d.decided_candidate_id, d.decided_date_id]);
  await ins('answers', rows.answers);
  await ins('responses', rows.responses);
  await ins('wanted', rows.wanted);

  const token = (await db.as(null, `select token from public.groups where import_key = 'G001'`))[0]!.token;
  const p = await db.user(true);
  const list = await db.rpc(p, 'list_members', [token]);
  expect(list.length).toBe(2);
  const aoki = list.find((m: any) => m.kana === 'あおき ひなた');
  await db.rpc(p, 'claim_member', [token, aoki.id]);
  const g = await db.rpc(p, 'open_group', [token]);
  const ev = await db.rpc(p, 'get_event', [token, g.events[0].id]);
  expect(ev.event.status).toBe('time');
  expect(ev.event.decided).toEqual({ date: '2026-12-19', time: '' });
  expect(Object.values(ev.mine.answers)).toEqual(['o']); // 時間の候補への答え
  expect(ev.mine.comment).toBe('よろしく');
  expect(ev.date_stage.by_candidate.map((c: any) => [c.date, c.o])).toEqual([['2026-12-18', 0], ['2026-12-19', 2]]);
});
