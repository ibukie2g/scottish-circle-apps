const test = require('node:test');
const assert = require('node:assert/strict');
const { basketballRoundScores: calc } = require('../src/core_basket');
const courts = [['A', 'B'], ['C', 'D']];

test('クイズバスケ: 前半+難しさごとの先/後の点を、コートごとに足す', () => {
  const r = calc({ firstHalf: { A: 6, B: 4, C: 0, D: 7 }, questions: [
    { difficulty: 'かんたん', orders: [['A', 'B'], ['D', 'C']] },
    { difficulty: 'ふつう', orders: [['B'], []] },
    { difficulty: 'むずかしい', orders: [['B', 'A'], ['C']] }
  ] }, courts);
  assert.deepEqual(r.quizPoints, { A: 5, B: 9, C: 6, D: 2 });
  assert.deepEqual(r.totals, { A: 11, B: 13, C: 6, D: 9 });
  assert.equal(r.ready, true);
});
test('クイズバスケ: 未入力の前半は確定不可、0点とクイズ0問は有効', () => {
  assert.equal(calc({}, courts).ready, false);
  assert.equal(calc({ firstHalf: { A: '', B: 0, C: 0, D: 0 } }, courts).ready, false);
  assert.equal(calc({ firstHalf: { A: 0, B: 0, C: 0, D: 0 } }, courts).ready, true);
});
test('クイズバスケ: 他コート・同じチームの二重正解・不正な難しさと点数を拒否', () => {
  for (const orders of [[['A','A'], []], [['C'], []], [['A','B','A'], []]]) {
    assert.throws(() => calc({ questions: [{ difficulty: 'ふつう', orders }] }, courts));
  }
  for (const n of [-1, 1.5, 'abc', Infinity]) assert.throws(() => calc({ firstHalf: { A: n } }, courts));
  assert.throws(() => calc({ questions: [{ difficulty: 'toString', orders: [[], []] }] }, courts));
  assert.throws(() => calc({}, [['A','B'],['A','D']]));
});
