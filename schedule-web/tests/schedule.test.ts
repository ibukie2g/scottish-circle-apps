// 日程調整の計算のテスト。A案 schedule/tests/core_schedule.test.js から移したもの。名前はすべて架空
import { describe, expect, test } from 'vitest';
import * as C from '../src/core/schedule';
import type { Answer, Candidate, Member, Mark } from '../src/core/types';

const cands: Candidate[] = [
  { id: 'C01', date: '2026-12-15', time: '19:00' },
  { id: 'C02', date: '2026-12-18', time: '19:00' },
  { id: 'C03', date: '2026-12-22', time: '19:00' },
];
const members: Member[] = [
  { id: 'M001', name: '青木', grade: '1年', gender: '男性' },
  { id: 'M002', name: '石井', grade: '2年', gender: '女性' },
  { id: 'M003', name: '上田', grade: '1年', gender: '女性' },
  { id: 'M004', name: '江口', grade: '3年', gender: '男性' },
  { id: 'M005', name: '抜けた人', active: false },
];

/** 'C01:o,C02:x' の短い書き方から answers 表の行を作る(テスト用) */
function rows(spec: Record<string, string>): Answer[] {
  return Object.entries(spec).flatMap(([memberId, s]) =>
    s.split(',').map((p) => {
      const [candidateId, mark] = p.split(':') as [string, Mark];
      return { memberId, candidateId, mark };
    }),
  );
}
const answers = rows({
  M001: 'C01:o,C02:x,C03:o',
  M002: 'C01:t,C03:o',
  M003: 'C01:o,C03:o',
  M005: 'C01:o', // 抜けた人は数えない
});

describe('集計', () => {
  test('○の多い順、いちばん多い日に印、名前つき', () => {
    const s = C.summarize(cands, answers, members, { wanted: ['M004', 'M002'] });
    expect(s.answeredCount).toBe(3);
    expect(s.memberCount).toBe(4);
    expect(s.byDate.map((d) => [d.candidateId, d.o, d.t, d.x])).toEqual([['C03', 3, 0, 0], ['C01', 2, 1, 0], ['C02', 0, 0, 1]]);
    expect(s.byDate[0]!.best).toBe(true);
    expect(s.byDate[1]!.best).toBe(false);
    expect(s.byDate[0]!.names!.o).toEqual(['青木', '石井', '上田']);
    expect(s.byDate[1]!.wanted).toEqual({ ok: [], maybe: ['石井'], ng: [], none: ['江口'] });
  });

  test('名前を見せない設定では names が null', () => {
    const s = C.summarize(cands, answers, members, { withNames: false });
    expect(s.byDate[0]!.names).toBeNull();
    expect(s.byDate[0]!.wanted).toBeNull();
  });

  test('だれも答えていなければ best はつかず、日付順', () => {
    const s = C.summarize(cands, [], members);
    expect(s.byDate.some((d) => d.best)).toBe(false);
    expect(s.byDate.map((d) => d.candidateId)).toEqual(['C01', 'C02', 'C03']);
  });

  test('同点(○も△も同じ数)なら、すべてに「いちばん多い」', () => {
    const s = C.summarize(cands, rows({ M001: 'C01:o,C02:o,C03:o', M002: 'C01:t,C02:t,C03:o' }), members);
    expect(s.byDate.map((d) => [d.candidateId, d.best])).toEqual([['C03', true], ['C01', false], ['C02', false]]);
    const s2 = C.summarize(cands, rows({ M001: 'C01:o,C02:o,C03:x', M002: 'C01:t,C02:t,C03:o' }), members);
    expect(s2.byDate.map((d) => [d.candidateId, d.best])).toEqual([['C01', true], ['C02', true], ['C03', false]]);
  });

  test('ほかの段階の候補への答えは数えない(B案で追加)', () => {
    const T1: Candidate = { id: 'T1', date: '2026-12-22', time: '18:00', stage: 'time' };
    const all = [...cands, T1];
    const a = [...answers, ...rows({ M004: 'T1:o' })];
    // 日にちの段階:江口は時間にしか答えていないので「答えた」に入らない
    const dateStage = C.summarize(C.stageCandidates(all, 'date'), a, members);
    expect(dateStage.answeredCount).toBe(3);
    expect(C.unanswered(members, a, ['C01', 'C02', 'C03']).map((m) => m.id)).toEqual(['M004']);
    // 時間の段階
    const timeStage = C.summarize(C.stageCandidates(all, 'time'), a, members);
    expect(timeStage.answeredCount).toBe(1);
    expect(timeStage.byDate.map((d) => d.candidateId)).toEqual(['T1']);
    expect(C.currentStage('time')).toBe('time');
    expect(C.currentStage('rsvp')).toBe('date');
  });
});

test('サーバーの人数を並べる(rankResults):summarize と同じ順番と印', () => {
  const s = C.summarize(cands, answers, members);
  const fromServer = s.byDate.map(({ candidateId, date, time, o, t, x }) => ({ candidateId, date, time, o, t, x })).reverse();
  expect(C.rankResults(fromServer).map((r) => [r.candidateId, r.best])).toEqual(s.byDate.map((d) => [d.candidateId, d.best]));
  const tie = [
    { id: 'b', date: '2026-12-18', time: '19:00', o: 2, t: 1, x: 0 },
    { id: 'a', date: '2026-12-15', time: '19:00', o: 2, t: 1, x: 0 },
    { id: 'c', date: '2026-12-10', time: '', o: 0, t: 0, x: 3 },
  ];
  expect(C.rankResults(tie).map((r) => [r.id, r.best])).toEqual([['a', true], ['b', true], ['c', false]]);
  expect(C.rankResults([{ date: '2026-12-01', time: '', o: 0, t: 2 }])[0]!.best).toBe(false);
});

test('未回答と絞り込み', () => {
  expect(C.unanswered(members, answers, ['C01', 'C02', 'C03']).map((m) => m.id)).toEqual(['M004']);
  expect(C.filterMembers(members, { grade: '1年' }).map((m) => m.id)).toEqual(['M001', 'M003']);
  expect(C.filterMembers(members, { gender: '女性' }).map((m) => m.id)).toEqual(['M002', 'M003']);
  expect(C.filterMembers(members).length).toBe(4);
});

test('候補日の一括作成:12/1(火)から火曜と金曜を2週分', () => {
  expect(C.expandDates({ from: '2026-12-01', weekdays: [2, 5], weeks: 2, time: '19:00' })).toEqual([
    { date: '2026-12-01', time: '19:00' }, { date: '2026-12-04', time: '19:00' },
    { date: '2026-12-08', time: '19:00' }, { date: '2026-12-11', time: '19:00' },
  ]);
  expect(C.expandDates({ from: 'bad', weekdays: [2], weeks: 1 })).toEqual([]);
  expect(C.expandDates({ from: '2026-12-01', weekdays: [0, 1, 2, 3, 4, 5, 6], weeks: 99 }).length).toBe(84); // 12週まで
});

test('日付の表示と並べ替え', () => {
  expect(C.formatDateJa('2026-12-15')).toBe('12/15(火)');
  const sorted = C.sortCandidates([
    { id: 'b', date: '2026-12-02', time: '' },
    { id: 'a', date: '2026-12-02', time: '18:00' },
    { id: 'c', date: '2026-12-01', time: '' },
  ]);
  expect(sorted.map((c) => c.id)).toEqual(['c', 'a', 'b']);
});

test('日本時間の今日(UTC 15:00 で日付が変わる)', () => {
  expect(C.todayJst(new Date('2026-12-05T14:59:59Z'))).toBe('2026-12-05'); // 日本 23:59
  expect(C.todayJst(new Date('2026-12-05T15:00:00Z'))).toBe('2026-12-06'); // 日本 0:00
});

test('出欠の集計と仮入れ', () => {
  const att = [
    { memberId: 'M001', status: 'go' as const },
    { memberId: 'M002', status: 'partial' as const, arriveAt: '20:30' },
    { memberId: 'M003', status: 'no' as const },
    { memberId: 'M004', status: null },
    { memberId: 'M005', status: 'go' as const },
  ];
  const s = C.summarizeAttendance(att, members);
  expect([s.go, s.partial, s.no]).toEqual([1, 1, 1]);
  expect(s.names!.partial).toEqual(['石井(20:30〜)']);
  expect(C.summarizeAttendance(att, members, false).names).toBeNull();
  expect(C.presetAttendance('o')).toBe('go');
  expect(C.presetAttendance('x')).toBe('no');
  expect(C.presetAttendance('t')).toBeNull();
  expect(C.presetAttendance(undefined)).toBeNull();
});

test('締め切りと、終わったものをしまう判定', () => {
  const ev = { status: 'poll' as const, deadline: '2026-12-05' };
  expect(C.isClosed(ev, '2026-12-05')).toBe(false);
  expect(C.isClosed(ev, '2026-12-06')).toBe(true);
  expect(C.isClosed({ status: 'done' }, '2000-01-01')).toBe(true);
  expect(C.isClosed({ status: 'poll', deadline: null }, '2099-01-01')).toBe(false);
  expect(C.isArchived({ status: 'rsvp', decidedCandidateId: 'C01' }, cands, '2027-01-14')).toBe(false);
  expect(C.isArchived({ status: 'rsvp', decidedCandidateId: 'C01' }, cands, '2027-01-15')).toBe(true); // 12/15 から30日たった翌日
  expect(C.isArchived({ status: 'poll' }, cands, '2027-01-21')).toBe(false); // 決まっていなければ最後の候補日 12/22 から
  expect(C.isArchived({ status: 'poll' }, cands, '2027-01-22')).toBe(true);
});

test('名前を整える・空白ちがいを同じとみなす', () => {
  expect(C.normalizeName('  たろう\n  です ')).toBe('たろう です');
  expect(C.nameLength('🍜たろう')).toBe(4);
  expect(C.nameKey('山田 太郎')).toBe('山田太郎');
  expect(C.nameKey('山田　太郎')).toBe('山田太郎');
  expect(C.nameKey(' 山田  太郎 ')).toBe(C.nameKey('山田太郎'));
});

test('カレンダー:時刻あり(日本時間→UTC)と終日', () => {
  const a = C.calendarData({ title: '忘年会', date: '2026-12-22', time: '19:00', place: '駅前', url: 'https://x' })!;
  expect(a.googleUrl).toMatch(/dates=20261222T100000Z\/20261222T120000Z/);
  expect(a.googleUrl).toMatch(/location=%E9%A7%85%E5%89%8D/);
  expect(a.ics).toMatch(/DTSTART:20261222T100000Z/);
  expect(a.ics).toMatch(/LOCATION:駅前/);
  const b = C.calendarData({ title: '遊び', date: '2026-12-31', time: '' })!;
  expect(b.ics).toMatch(/DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  expect(C.calendarData({ title: 'x', date: 'bad' })).toBeNull();
});

test('カレンダー:長さ(分)と、案内・説明・リンクの入ったメモ', () => {
  const details = C.calendarDetails({
    notice: '現地集合', description: '', placeUrl: 'https://maps.example/x',
    links: [{ label: 'メニュー', url: 'https://e.com/m' }], page: 'https://app/g/t/e/1',
  });
  expect(details).toBe('現地集合\n\n📍 地図:https://maps.example/x\n\n🔗 メニュー:https://e.com/m\n\n出欠の確認・変更:https://app/g/t/e/1');
  const c = C.calendarData({ title: '忘年会', date: '2026-12-19', time: '19:00', minutes: 180, details })!;
  expect(c.googleUrl).toMatch(/dates=20261219T100000Z\/20261219T130000Z/);
  expect(c.ics).toMatch(/DESCRIPTION:現地集合\\n\\n📍 地図:https:\/\/maps.example\/x/);
  expect(C.durationLabel(90)).toBe('1時間30分');
  expect(C.durationLabel(120)).toBe('2時間');
});
