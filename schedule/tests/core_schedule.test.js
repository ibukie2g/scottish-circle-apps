// 日程調整の計算(core_schedule.js)のテスト。名前はすべて架空
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core_schedule.js');

const cands = [
  { id: 'C01', date: '2026-12-15', time: '19:00' },
  { id: 'C02', date: '2026-12-18', time: '19:00' },
  { id: 'C03', date: '2026-12-22', time: '19:00' }
];
const members = [
  { memberId: 'M001', name: '青木', grade: '1年', gender: '男性' },
  { memberId: 'M002', name: '石井', grade: '2年', gender: '女性' },
  { memberId: 'M003', name: '上田', grade: '1年', gender: '女性' },
  { memberId: 'M004', name: '江口', grade: '3年', gender: '男性' },
  { memberId: 'M005', name: '抜けた人', active: false }
];
const rows = [
  { memberId: 'M001', answers: 'C01:○,C02:×,C03:○', updatedAt: 1 },
  { memberId: 'M002', answers: 'C01:△,C03:○', updatedAt: 1 },
  { memberId: 'M003', answers: 'C03:×', updatedAt: 1 },
  { memberId: 'M003', answers: 'C01:○,C03:○', updatedAt: 2 }, // 送り直し(新しいほう)
  { memberId: 'M005', answers: 'C01:○', updatedAt: 1 }        // 抜けた人は数えない
];

test('答えの文字列の読み書き', () => {
  assert.deepEqual(C.parseAnswers('C01:○, C02:△,C03:x,bad,C04:×'), { C01: '○', C02: '△', C04: '×' });
  assert.equal(C.formatAnswers({ C02: '×', C01: '○', C09: '?' }, ['C01', 'C02', 'C09']), 'C01:○,C02:×');
  assert.deepEqual(C.parseAnswers(''), {});
});

test('日ごとの集計:○の多い順、いちばん多い日に印、名前つき', () => {
  const s = C.summarize(cands, rows, members, { wanted: ['M004', 'M002'] });
  assert.equal(s.answeredCount, 3);
  assert.equal(s.memberCount, 4);
  assert.deepEqual(s.byDate.map(d => [d.candidateId, d.o, d.t, d.x]), [['C03', 3, 0, 0], ['C01', 2, 1, 0], ['C02', 0, 0, 1]]);
  assert.equal(s.byDate[0].best, true);
  assert.equal(s.byDate[1].best, false);
  assert.deepEqual(s.byDate[0].names.o, ['青木', '石井', '上田']);
  assert.deepEqual(s.byDate[1].wanted, { ok: [], maybe: ['石井'], ng: [], none: ['江口'] });
});

test('名前を見せない設定では names が null', () => {
  const s = C.summarize(cands, rows, members, { withNames: false });
  assert.equal(s.byDate[0].names, null);
  assert.equal(s.byDate[0].wanted, null);
});

test('だれも答えていなければ best はつかない', () => {
  const s = C.summarize(cands, [], members, {});
  assert.equal(s.byDate.some(d => d.best), false);
  assert.deepEqual(s.byDate.map(d => d.candidateId), ['C01', 'C02', 'C03']); // 同数なら日付順
});

test('未回答と絞り込み', () => {
  assert.deepEqual(C.unanswered(members, rows).map(m => m.memberId), ['M004']);
  assert.deepEqual(C.filterMembers(members, { grade: '1年' }).map(m => m.memberId), ['M001', 'M003']);
  assert.deepEqual(C.filterMembers(members, { gender: '女性' }).map(m => m.memberId), ['M002', 'M003']);
  assert.equal(C.filterMembers(members, {}).length, 4);
});

test('候補日の一括作成:12/1(火)から火曜と金曜を2週分', () => {
  assert.deepEqual(C.expandDates({ from: '2026-12-01', weekdays: [2, 5], weeks: 2, time: '19:00' }),
    [{ date: '2026-12-01', time: '19:00' }, { date: '2026-12-04', time: '19:00' },
     { date: '2026-12-08', time: '19:00' }, { date: '2026-12-11', time: '19:00' }]);
  assert.deepEqual(C.expandDates({ from: 'bad', weekdays: [2], weeks: 1 }), []);
  assert.equal(C.expandDates({ from: '2026-12-01', weekdays: [0, 1, 2, 3, 4, 5, 6], weeks: 99 }).length, 84); // 12週まで
});

test('日付の表示と並べ替え', () => {
  assert.equal(C.formatDateJa('2026-12-15'), '12/15(火)');
  assert.deepEqual(C.sortCandidates([{ id: 'b', date: '2026-12-02', time: '' }, { id: 'a', date: '2026-12-02', time: '18:00' }, { id: 'c', date: '2026-12-01' }]).map(c => c.id), ['c', 'a', 'b']);
});

test('出欠の集計と仮入れ', () => {
  const att = [
    { memberId: 'M001', status: '行く', updatedAt: 1 },
    { memberId: 'M002', status: '途中から', arriveAt: '20:30', updatedAt: 1 },
    { memberId: 'M003', status: '行かない', updatedAt: 1 },
    { memberId: 'M005', status: '行く', updatedAt: 1 }
  ];
  const s = C.summarizeAttendance(att, members);
  assert.deepEqual([s.go, s.partial, s.no], [1, 1, 1]);
  assert.deepEqual(s.names.partial, ['石井(20:30〜)']);
  assert.equal(C.summarizeAttendance(att, members, false).names, null);
  assert.equal(C.presetAttendance({ C03: '○' }, 'C03'), '行く');
  assert.equal(C.presetAttendance({ C03: '×' }, 'C03'), '行かない');
  assert.equal(C.presetAttendance({ C03: '△' }, 'C03'), '');
});

test('催促文', () => {
  const t = C.remindText({ name: '忘年会の日程', deadline: '2026-12-05' }, ['青木', '石井'], 'https://example.com/x');
  assert.equal(t, '【忘年会の日程】まだの人お願いします🙏\n青木さん、石井さん\n締め切り 12/5(土)\nhttps://example.com/x');
});

test('LINEに流す文(名指しなし)', () => {
  assert.equal(C.shareText({ name: '忘年会', deadline: '2026-12-05', place: '駅前' }, null, 'https://x'),
    '【忘年会】来られる日を教えてください🙌\n締め切り 12/5(土)\n📍 駅前\nhttps://x');
  assert.equal(C.shareText({ name: '忘年会' }, { date: '2026-12-22', time: '19:00' }, 'https://x'),
    '【忘年会】12/22(火) 19:00 に決まりました!\n行けるかどうか、ここから教えてください🙌\nhttps://x');
});

test('締め切りと、終わったものをしまう判定', () => {
  const ev = { status: '日程調整中', deadline: '2026-12-05' };
  assert.equal(C.isClosed(ev, '2026-12-05'), false);
  assert.equal(C.isClosed(ev, '2026-12-06'), true);
  assert.equal(C.isClosed({ status: '終了' }, '2000-01-01'), true);
  assert.equal(C.isClosed({ status: '日程調整中', deadline: '' }, '2099-01-01'), false);
  assert.equal(C.isArchived({ decidedId: 'C01' }, cands, '2027-01-14'), false);
  assert.equal(C.isArchived({ decidedId: 'C01' }, cands, '2027-01-15'), true);  // 12/15 から30日たった翌日
  assert.equal(C.isArchived({}, cands, '2027-01-21'), false);                  // 決まっていなければ最後の候補日 12/22 から
  assert.equal(C.isArchived({}, cands, '2027-01-22'), true);
});

test('名前を整える・IDの採番', () => {
  assert.equal(C.normalizeName('  たろう\n  です '), 'たろう です');
  assert.equal(C.nameLength('🍜たろう'), 4);
  assert.equal(C.nextId('C', ['C01', 'C07', 'X99']), 'C08');
  assert.equal(C.nextId('M', [], 3), 'M001');
});

test('カレンダー:時刻あり(日本時間→UTC)と終日', () => {
  const a = C.calendarData({ title: '忘年会', date: '2026-12-22', time: '19:00', place: '駅前', url: 'https://x' });
  assert.match(a.googleUrl, /dates=20261222T100000Z\/20261222T120000Z/);
  assert.match(a.googleUrl, /location=%E9%A7%85%E5%89%8D/);
  assert.match(a.ics, /DTSTART:20261222T100000Z/);
  assert.match(a.ics, /LOCATION:駅前/);
  const b = C.calendarData({ title: '遊び', date: '2026-12-31', time: '' });
  assert.match(b.ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.equal(C.calendarData({ title: 'x', date: 'bad' }), null);
});

test('同点(○も△も同じ数)なら、すべてに「いちばん多い」の印がつく', () => {
  const r = [
    { memberId: 'M001', answers: 'C01:○,C02:○,C03:○' },
    { memberId: 'M002', answers: 'C01:△,C02:△,C03:○' }
  ];
  const s = C.summarize(cands, r, members, {});
  assert.deepEqual(s.byDate.map(d => [d.candidateId, d.best]), [['C03', true], ['C01', false], ['C02', false]]);
  const r2 = [
    { memberId: 'M001', answers: 'C01:○,C02:○,C03:×' },
    { memberId: 'M002', answers: 'C01:△,C02:△,C03:○' }
  ];
  const s2 = C.summarize(cands, r2, members, {});
  assert.deepEqual(s2.byDate.map(d => [d.candidateId, d.best]), [['C01', true], ['C02', true], ['C03', false]]);
});
