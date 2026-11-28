// 「状況をコピー(名前なし)」のテスト。名前・ひとことが入らないことを確かめる
import { expect, test } from 'vitest';
import { statusText, type StatusEventInput } from '../src/core/status';

const base: StatusEventInput = {
  groupName: '男子会', name: '飲み会', status: 'poll', style: 'party', deadline: '2026-12-12', decided: null,
  candidates: [{ id: 'A', date: '2026-12-19', time: '' }, { id: 'B', date: '2026-12-20', time: '' }],
  courses: [{ id: 'k1', name: '飲み放題' }],
  members: [
    { id: 'm1', answers: { A: 'o', B: 'x' }, attendance: null, course_id: null, paid: false },
    { id: 'm2', answers: { A: 'o', B: 't' }, attendance: null, course_id: null, paid: false },
    { id: 'm3', answers: {}, attendance: null, course_id: null, paid: false },
  ],
};

test('日程調整中:回答数・日ごとの○△×・いちばん多い日', () => {
  expect(statusText([base], '12/1 10:00')).toBe([
    '12/1 10:00 時点の状況(名前なし)', '',
    '【男子会】飲み会 ・ 日程調整中 ・ 締め切り 12/12(土)',
    ' 回答 2/3人 ・ まだ 1人',
    ' 12/19(土) ○2 △0 ×0 ← いちばん多い',
    ' 12/20(日) ○0 △1 ×1',
  ].join('\n'));
});

test('出欠確認中(飲み会):出欠・コース・受け取り。終了したものは出さない', () => {
  const rsvp: StatusEventInput = {
    ...base, status: 'rsvp', decided: { date: '2026-12-19', time: '19:00' },
    members: [
      { id: 'm1', answers: {}, attendance: 'go', course_id: 'k1', paid: true },
      { id: 'm2', answers: {}, attendance: 'partial', course_id: null, paid: false },
      { id: 'm3', answers: {}, attendance: null, course_id: null, paid: false },
    ],
  };
  const text = statusText([rsvp, { ...base, name: '終わった会', status: 'done' }], 'now');
  expect(text).toContain('【男子会】飲み会 ・ 出欠確認中 ・ 決定 12/19(土) 19:00〜');
  expect(text).toContain(' 行く 1 ・ 途中から 1 ・ 行かない 0 ・ まだ 1');
  expect(text).toContain(' コース:飲み放題 1 ・ 未定 1');
  expect(text).toContain(' 受け取り済み 1人');
  expect(text).not.toContain('終わった会');
  expect(statusText([], 'now')).toBe('now 時点:進行中のイベントはありません');
});
