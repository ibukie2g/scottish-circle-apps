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

test('judgeNames: 漢字・ひらがな・カタカナ・異体字・混ぜ書きのフルネームは1人分', () => {
  const r = N.judgeNames(['齋藤花子', 'ワタナベ タロウ', '高橋健', 'やまさきみさき', '小島さくら'], members);
  assert.deepEqual(r.fullIds, ['P01', 'P02', 'P03', 'P04', 'P05']);
  assert.deepEqual(r.halfIds, []);
  assert.equal(r.rate, 1.2); // 全員フルネーム +20%
  assert.equal(r.writtenCount, 5);
  const mix = N.judgeNames(['渡辺たろう', 'さいとう花子'], members);
  assert.deepEqual(mix.results.map(x => [x.status, x.id]), [['full', 'P02'], ['full', 'P01']]);
});

test('judgeNames: 名字だけ・名前だけは0.5人分', () => {
  const r = N.judgeNames(['斎藤', 'たろう', 'タカハシ', '美咲'], members);
  assert.deepEqual(r.fullIds, []);
  assert.deepEqual(r.halfIds, ['P01', 'P02', 'P03', 'P04']);
  assert.deepEqual(r.results.map(x => x.status), ['half', 'half', 'half', 'half']);
  assert.equal(r.rate, 2 / 5);
});

test('judgeNames: 名簿の名前が空白で分かれていない人は、名前だけが0.5人分にならない(惜しい側に回る)', () => {
  const ms = [{ id: 'P01', name: '架空花子', kana: 'かくうはなこ' }, { id: 'P02', name: '見本 次郎', kana: 'みほん じろう' }];
  const r = N.judgeNames(['架空花子', 'はなこ', 'かくう'], ms);
  assert.deepEqual(r.results.map(x => x.status), ['full', 'unknown', 'unknown']); // P01 は1人分なので候補にもならない
  const r2 = N.judgeNames(['かくう'], ms);
  assert.deepEqual(r2.nearMisses, [{ input: 'かくう', candidateId: 'P01' }]); // 頭3文字が同じ → 運営が判断
  assert.equal(N.isSplitName(ms[0]), false);
  assert.equal(N.isSplitName(ms[1]), true);
  assert.equal(N.isSplitName({ name: '見本 次郎', kana: 'みほんじろう' }), false);
});

test('judgeNames: 登録したあだ名は0.5人分(「、」「,」「/」区切り・3つまで・敬称は外して比べる)', () => {
  const ms = [
    { id: 'P01', name: '斎藤 花子', kana: 'さいとう はなこ', nickname: 'はな、はなちゃん/さいちゃん' },
    { id: 'P02', name: '渡辺 太郎', kana: 'わたなべ たろう', nickname: 'たっくん, ナベさん,わたぽん,よっつめ' }
  ];
  assert.deepEqual(N.parseNicknames('はな、はなちゃん/さいちゃん'), ['はな', 'はなちゃん', 'さいちゃん']);
  assert.deepEqual(N.parseNicknames(' たっくん ，ナベ　さん／'), ['たっくん', 'ナベ さん']);
  assert.deepEqual(N.parseNicknames('はな はなこ'), ['はな はなこ']); // スペースは区切りにしない
  assert.deepEqual(N.parseNicknames(''), []);
  assert.equal(N.judgeNames(['はな'], ms).credits.P01, 0.5);
  assert.equal(N.judgeNames(['さい'], ms).credits.P01, 0.5);       // あだ名「さいちゃん」の敬称を外した形
  assert.equal(N.judgeNames(['はな先輩'], ms).credits.P01, 0.5);   // 入力の敬称を外す
  assert.equal(N.judgeNames(['ナベ'], ms).credits.P02, 0.5);
  assert.equal(N.judgeNames(['たっくん'], ms).credits.P02, 0.5);
  assert.equal(N.judgeNames(['よっつめ'], ms).credits.P02, undefined); // 4つ目は使わない
});

test('judgeNames: 最後の敬称は、まずそのまま比べ、だめなら外して比べる', () => {
  for (const s of ['斎藤花子さん', 'さいとうはなこ先輩', 'サイトウハナコセンパイ', '斎藤花子ちゃん', '斎藤 花子 様']) {
    assert.equal(N.judgeNames([s], members).credits.P01, 1, s);
  }
  assert.equal(N.judgeNames(['渡辺くん'], members).credits.P02, 0.5);
  assert.equal(N.judgeNames(['健君'], members).credits.P03, 0.5);
  assert.equal(N.stripHonorific('さん'), 'さん'); // 敬称だけなら外さない
  // 名前が敬称で終わる人:そのまま比べるのが先なので、正しく当たる
  const ms = [{ id: 'P09', name: '見本 さくん', kana: 'みほん さくん' }];
  assert.equal(N.judgeNames(['みほんさくん'], ms).credits.P09, 1);
  assert.equal(N.judgeNames(['さくん'], ms).credits.P09, 0.5);
});

test('judgeNames: 同じ人を何回書いても、いちばん高い1回だけ', () => {
  const r = N.judgeNames(['斎藤花子', 'さいとうはなこ', 'はなこ'], members);
  assert.deepEqual(r.fullIds, ['P01']);
  assert.deepEqual(r.results.map(x => x.status), ['full', 'duplicate', 'duplicate']);
  assert.equal(r.rate, 1 / 5);
  // 名前だけを先に書いて、あとからフルネームを書いても1人分
  const r2 = N.judgeNames(['はなこ', '斎藤', '斎藤花子'], members);
  assert.equal(r2.credits.P01, 1);
  assert.deepEqual(r2.halfIds, []);
  assert.equal(r2.rate, 1 / 5);
});

test('judgeNames: 1つの答えが何人かに当てはまるときは、どちらか1人分', () => {
  const ms = [
    { id: 'P01', name: '佐藤 一郎', kana: 'さとう いちろう' },
    { id: 'P02', name: '佐藤 次郎', kana: 'さとう じろう' },
    { id: 'P03', name: '鈴木 三郎', kana: 'すずき さぶろう' }
  ];
  const once = N.judgeNames(['佐藤'], ms);
  assert.deepEqual(once.halfIds, ['P01']);
  const twice = N.judgeNames(['佐藤', 'さとう'], ms); // 2回書けば2人分(0.5人分ずつ)
  assert.deepEqual(twice.halfIds, ['P01', 'P02']);
  const mixed = N.judgeNames(['佐藤', '佐藤一郎'], ms); // フルネームが先に決まり、名字は残りの人へ
  assert.equal(mixed.credits.P01, 1);
  assert.equal(mixed.credits.P02, 0.5);
});

test('judgeNames: 近いものは運営の判断へ(1文字違い・頭2文字以上)。近くないものは unknown', () => {
  const r = N.judgeNames(['さいとうはなこ', 'わたなべたろ', 'たかは', 'やまざきみさき', 'ぜんぜんちがう', 'こ'], members);
  assert.deepEqual(r.fullIds, ['P01']);
  assert.deepEqual(r.results.map(x => [x.status, x.id]), [
    ['full', 'P01'], ['near', 'P02'], ['near', 'P03'], ['near', 'P04'], ['unknown', null], ['unknown', null]
  ]);
  assert.deepEqual(r.nearMisses.map(x => x.candidateId), ['P02', 'P03', 'P04']);
  assert.deepEqual(r.unknowns, ['ぜんぜんちがう', 'こ']);
  assert.equal(r.rate, 1 / 5); // 運営が判断するまでは数えない
});

test('judgeNames: もう1人分になっている人は候補にしない。0.5人分の人は候補になる', () => {
  const r = N.judgeNames(['さいとうはなこ', 'さいとうはなご'], members);
  assert.deepEqual(r.nearMisses, []);
  assert.equal(r.results[1].status, 'unknown');
  const r2 = N.judgeNames(['はなこ', 'さいとうはなご'], members);
  assert.equal(r2.credits.P01, 0.5);
  assert.deepEqual(r2.nearMisses, [{ input: 'さいとうはなご', candidateId: 'P01' }]);
});

test('nearNameScore: 近さの基準', () => {
  const forms = ['斎藤花子', 'さいとうはなこ', '斎藤', 'さいとう', '花子', 'はなこ'];
  assert.equal(N.nearNameScore('さいとうはなこ', forms), 0);
  assert.equal(N.nearNameScore('さいとはなこ', forms), 1);       // 1文字足りない
  assert.equal(N.nearNameScore('はなっち', forms) > 1, true);     // 頭2文字が同じ(未登録のあだ名)
  assert.equal(N.nearNameScore('はなさん', forms), 1);            // 敬称を外して比べる(はな → はなこ と1文字違い)
  assert.equal(N.nearNameScore('斎木', forms), 1);                // 2文字は、頭が同じなら1文字違いを拾う
  assert.equal(N.nearNameScore('佐藤', forms), null);             // 2文字で頭もちがう
  assert.equal(N.nearNameScore('は', forms), null);               // 1文字は比べない
  assert.equal(N.nearNameScore('たなか', forms), null);
});

test('judgeNames: 空欄は数えない、メンバー0人なら正答率 null', () => {
  const r = N.judgeNames(['', '  ', '斎藤花子'], members);
  assert.equal(r.writtenCount, 1);
  assert.equal(r.results[0].status, 'empty');
  const none = N.judgeNames(['だれか'], []);
  assert.equal(none.rate, null);
  assert.equal(none.total, 0);
});

test('nameQuizRate: ボーナス(全員コンプリート +10%、全員フルネーム +20%。100%を超えてよい)', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' vs ' + b);
  near(N.nameQuizRate(5, 0, 7), 5 / 7);
  near(N.nameQuizRate(5, 1, 7), 5.5 / 7);
  near(N.nameQuizRate(5, 2, 7), 6 / 7 + 0.1);   // 0.5人分を含めて全員
  near(N.nameQuizRate(0, 7, 7), 0.5 + 0.1);
  near(N.nameQuizRate(7, 0, 7), 1.2);           // 全員フルネーム(+10% とは重ねない)
  assert.equal(N.nameQuizRate(0, 0, 0), null);
  const s = N.summarizeCredits({ P01: 1, P02: 0.5, P99: 1 }, ['P01', 'P02']);
  assert.deepEqual([s.fullIds, s.halfIds, s.allFull, s.complete], [['P01'], ['P02'], false, true]);
  near(s.rate, 0.75 + 0.1);
});
