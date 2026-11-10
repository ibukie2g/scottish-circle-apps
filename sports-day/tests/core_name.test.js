// 名前の判定のテスト: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/core_name.js');

const members = [
  { id: 'P01', name: '斎藤 花子', kana: 'さいとう はなこ' },
  { id: 'P02', name: '渡邊 太郎', kana: 'わたなべ たろう' },
  { id: 'P03', name: '髙橋 健', kana: 'たかはし けん' },
  { id: 'P04', name: '山﨑 美咲', kana: 'やまさき みさき' },
  { id: 'P05', name: '小島 さくら', kana: 'こじま さくら' }
];

test('normalizeName: 全角半角・スペース・カタカナ', () => {
  assert.equal(N.normalizeName('サイトウ　ハナコ'), 'さいとうはなこ');
  assert.equal(N.normalizeName('ｻｲﾄｳ ﾊﾅｺ'), 'さいとうはなこ');
  assert.equal(N.normalizeName(' 斎藤  花子 '), '斎藤花子');
  assert.equal(N.normalizeName(null), '');
  assert.equal(N.normalizeName('ガギグ'), 'がぎぐ');
  assert.equal(N.normalizeName('ｶﾞｷﾞ'), 'がぎ');
});

test('normalizeName: 異体字', () => {
  const pairs = [['齋藤', '斎藤'], ['齊藤', '斎藤'], ['渡邊', '渡辺'], ['渡邉', '渡辺'], ['髙橋', '高橋'],
    ['山﨑', '山崎'], ['澤田', '沢田'], ['嶋田', '島田'], ['濱田', '浜田'], ['𠮷田', '吉田']];
  for (const [a, b] of pairs) assert.equal(N.normalizeName(a), N.normalizeName(b), a);
});

test('katakanaToHiragana', () => {
  assert.equal(N.katakanaToHiragana('ワタナベ ヴ'), 'わたなべ ゔ');
});

test('editDistance', () => {
  assert.equal(N.editDistance('', ''), 0);
  assert.equal(N.editDistance('abc', 'abc'), 0);
  assert.equal(N.editDistance('さいとう', 'さいと'), 1);
  assert.equal(N.editDistance('斎藤花子', '斎籐花子'.replace('籐', '藤')), 0);
  assert.equal(N.editDistance('kitten', 'sitting'), 3);
  assert.equal(N.editDistance('𠮷田', '吉田'), 1); // サロゲートペアも1文字
});

test('judgeNames: 漢字・ひらがな・カタカナ・異体字・混ぜ書きで正解', () => {
  const r = N.judgeNames(['齋藤花子', 'ワタナベ タロウ', '高橋健', 'やまさきみさき', '小島さくら'], members);
  assert.deepEqual(r.correctIds, ['P01', 'P02', 'P03', 'P04', 'P05']);
  assert.equal(r.rate, 1);
  assert.equal(r.writtenCount, 5);
  const mix = N.judgeNames(['渡辺たろう', 'さいとう花子'], members);
  assert.deepEqual(mix.correctIds, ['P02', 'P01']);
});

test('judgeNames: 名字だけ・名前だけは不正解', () => {
  const r = N.judgeNames(['斎藤', 'はなこ', 'たかはし'], members);
  assert.deepEqual(r.correctIds, []);
  assert.deepEqual(r.results.map(x => x.status), ['wrong', 'wrong', 'wrong']);
});

test('judgeNames: 同じ人を2回書いても1回分', () => {
  const r = N.judgeNames(['斎藤花子', 'さいとうはなこ', 'サイトウハナコ'], members);
  assert.deepEqual(r.correctIds, ['P01']);
  assert.deepEqual(r.results.map(x => x.status), ['correct', 'duplicate', 'duplicate']);
  assert.equal(r.rate, 1 / 5);
});

test('judgeNames: 1文字違いは惜しい答え、2文字違いは不正解', () => {
  const r = N.judgeNames(['さいとうはなこ', 'わたなべたろ', 'たかはしけんじろう', '渡部太郎'], members);
  assert.deepEqual(r.correctIds, ['P01']);
  assert.equal(r.results[1].status, 'near');
  assert.equal(r.results[1].id, 'P02');
  assert.equal(r.results[2].status, 'wrong');
  // 「渡部太郎」も P02 と1文字違いだが、P02 はすでに惜しい候補なので重ねない
  assert.equal(r.results[3].status, 'wrong');
  assert.deepEqual(r.nearMisses, [{ input: 'わたなべたろ', candidateId: 'P02' }]);
});

test('judgeNames: すでに正解した人への1文字違いは惜しいにしない', () => {
  const r = N.judgeNames(['さいとうはなこ', 'さいとうはなご'], members);
  assert.deepEqual(r.nearMisses, []);
  assert.equal(r.results[1].status, 'wrong');
});

test('judgeNames: 空欄は数えない、メンバー0人なら正答率 null', () => {
  const r = N.judgeNames(['', '  ', '斎藤花子'], members);
  assert.equal(r.writtenCount, 1);
  assert.equal(r.results[0].status, 'empty');
  const none = N.judgeNames(['だれか'], []);
  assert.equal(none.rate, null);
  assert.equal(none.total, 0);
});

test('nameRate', () => {
  assert.equal(N.nameRate(5, 7), 5 / 7);
  assert.equal(N.nameRate(0, 0), null);
});
