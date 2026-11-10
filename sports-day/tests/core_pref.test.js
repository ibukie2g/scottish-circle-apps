// 出身地の選択肢のテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/core_pref.js');

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

test('都道府県は47', () => {
  assert.equal(P.PREFECTURES.length, 47);
  assert.equal(new Set(P.PREFECTURES.map(p => p[0])).size, 47);
});

test('normalizePrefecture', () => {
  assert.equal(P.normalizePrefecture('福島県'), '福島県');
  assert.equal(P.normalizePrefecture('福島'), '福島県');
  assert.equal(P.normalizePrefecture(' 東京 '), '東京都');
  assert.equal(P.normalizePrefecture('京都'), '京都府');
  assert.equal(P.normalizePrefecture('北海道'), '北海道');
  assert.equal(P.normalizePrefecture('海外'), null);
  assert.equal(P.normalizePrefecture(''), null);
});

test('prefsByDistance: 福島の近くは宮城・山形・栃木など', () => {
  const near = P.prefsByDistance('福島県').slice(0, 6);
  assert.ok(near.includes('宮城県'));
  assert.ok(near.includes('山形県'));
  assert.ok(near.includes('栃木県'));
  assert.ok(!near.includes('沖縄県'));
});

test('makeOriginChoices: 4つ、重複なし、正解を含む、近い県から', () => {
  for (let seed = 1; seed < 200; seed++) {
    const ans = P.PREFECTURES[seed % 47][0];
    const r = P.makeOriginChoices(ans, ['東京都', '北海道', '沖縄県', '福島', 'あいうえお'], seeded(seed));
    assert.equal(r.answer, ans);
    assert.equal(r.choices.length, 4);
    assert.equal(new Set(r.choices).size, 4);
    assert.ok(r.choices.includes(ans));
    const range = P.prefsByDistance(ans).slice(0, 15);
    for (const c of r.choices) if (c !== ans) assert.ok(range.includes(c), `${ans} -> ${c}`);
  }
});

test('makeOriginChoices: 参加者の出身地(近い範囲)が候補に入りうる', () => {
  let seen = false;
  for (let seed = 1; seed < 300 && !seen; seed++) {
    const r = P.makeOriginChoices('福島県', ['神奈川県'], seeded(seed));
    if (r.choices.includes('神奈川県')) seen = true;
  }
  assert.ok(seen);
});

test('makeOriginChoices: 正解が読めなければ null', () => {
  assert.equal(P.makeOriginChoices('', []), null);
  assert.equal(P.makeOriginChoices('海外', []), null);
});
