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

// ---- 出身地クイズ(3問・2種類)。名前の代わりに参加者IDだけを使う ----
const mk = (id, origin) => ({ id, origin });
const ALL = ['福島県', '宮城県', '東京都', '新潟県', '北海道'];

function checkQuiz(qs, mates) {
  const pref = Object.fromEntries(mates.map(m => [m.id, P.normalizePrefecture(m.origin)]));
  const asked = [];
  for (const q of qs) {
    if (q.type === 'B') {
      assert.equal(q.choices.length, 4);
      assert.equal(new Set(q.choices).size, 4);
      assert.equal(q.answer, pref[q.targetId]);
      assert.ok(q.choices.includes(q.answer));
      asked.push(q.targetId);
    } else {
      assert.equal(q.type, 'C');
      assert.equal(q.choices.length, 4);
      assert.equal(new Set(q.choices).size, 4);
      assert.ok(q.answerIds.length >= 1 && q.answerIds.length <= 3);
      // 正解は、その県の人の全員。ほかの選択肢は、ちがう県の人
      assert.deepEqual([...q.answerIds].sort(), mates.filter(m => pref[m.id] === q.pref).map(m => m.id).sort());
      for (const id of q.choices) assert.equal(pref[id] === q.pref, q.answerIds.includes(id));
      asked.push(...q.answerIds);
    }
  }
  assert.equal(new Set(asked).size, asked.length, '同じ人は2回出さない');
}

test('makeOriginQuiz: 3問。同じ人は2回出さない。順番は人ごとにランダム', () => {
  const mates = [mk('P01', '福島県'), mk('P02', '福島'), mk('P03', '宮城県'), mk('P04', '宮城県'), mk('P05', '東京都'), mk('P06', '新潟県'), mk('P07', '北海道')];
  const firsts = new Set();
  for (let seed = 1; seed < 300; seed++) {
    const qs = P.makeOriginQuiz(mates, ALL, seeded(seed));
    assert.equal(qs.length, 3);
    checkQuiz(qs, mates);
    assert.equal(qs.filter(q => q.type === 'C').length, 1); // C は1問
    firsts.add(qs[0].type);
  }
  assert.deepEqual([...firsts].sort(), ['B', 'C']); // 先頭が B のことも C のこともある
});

test('makeOriginQuiz: B の出題は福島以外を優先する', () => {
  // 福島4人(C には出せない)+ 福島以外3人 → C は福島以外の県、B 2問も福島以外
  const mates = [mk('P01', '福島県'), mk('P02', '福島県'), mk('P03', '福島県'), mk('P04', '福島県'), mk('P05', '宮城県'), mk('P06', '東京都'), mk('P07', '新潟県')];
  for (let seed = 1; seed < 200; seed++) {
    const qs = P.makeOriginQuiz(mates, ALL, seeded(seed));
    assert.equal(qs.length, 3);
    checkQuiz(qs, mates);
    for (const q of qs) {
      if (q.type === 'B') assert.notEqual(q.answer, '福島県');
      else assert.notEqual(q.pref, '福島県'); // 同じ県が4人以上なら、その県は出さない
    }
  }
  // 福島以外が足りなければ、福島の人も B に出す
  const few = [mk('P01', '福島県'), mk('P02', '福島県'), mk('P03', '福島県'), mk('P04', '福島県'), mk('P05', '宮城県')];
  for (let seed = 1; seed < 100; seed++) {
    const qs = P.makeOriginQuiz(few, ALL, seeded(seed));
    assert.equal(qs.length, 3);
    checkQuiz(qs, few);
    assert.ok(qs.some(q => q.type === 'B' && q.answer === '福島県'));
  }
});

test('makeOriginQuiz: C は2人以上いる県を先に選び、人数ぶんの正解を持つ', () => {
  const mates = [mk('P01', '宮城県'), mk('P02', '宮城県'), mk('P03', '東京都'), mk('P04', '新潟県'), mk('P05', '北海道')];
  for (let seed = 1; seed < 100; seed++) {
    const c = P.makeOriginQuiz(mates, ALL, seeded(seed)).find(q => q.type === 'C');
    assert.equal(c.pref, '宮城県');
    assert.deepEqual([...c.answerIds].sort(), ['P01', 'P02']);
  }
});

test('makeOriginQuiz: C が作れなければ B だけ。出身地が読めない人は使わない。足りなければ作れた数だけ', () => {
  // 3人だけ:C は選択肢が4人そろわないので出せない
  const three = [mk('P01', '宮城県'), mk('P02', '東京都'), mk('P03', '福島県')];
  for (let seed = 1; seed < 50; seed++) {
    const qs = P.makeOriginQuiz(three, ALL, seeded(seed));
    assert.deepEqual(qs.map(q => q.type), ['B', 'B', 'B']);
    checkQuiz(qs, three);
  }
  const unknown = [mk('P01', '海外'), mk('P02', ''), mk('P03', '宮城県')];
  const qs = P.makeOriginQuiz(unknown, ALL, seeded(7));
  assert.deepEqual(qs.map(q => [q.type, q.targetId]), [['B', 'P03']]);
  assert.deepEqual(P.makeOriginQuiz([], ALL, seeded(1)), []);
  assert.deepEqual(P.makeOriginQuiz(null, null), []);
});

test('makeOriginQuiz: 少人数で同じ県が3人いても、対象が3人以上なら3問をそろえる', () => {
  for (const prefs of [
    ['宮城県', '宮城県', '宮城県', '東京都'],
    ['宮城県', '宮城県', '宮城県', '東京都', '東京都'],
    ['福島県', '福島県', '福島県', '福島県']
  ]) {
    const mates = prefs.map((pref, i) => mk('P0' + (i + 1), pref));
    for (let seed = 1; seed <= 100; seed++) {
      const qs = P.makeOriginQuiz(mates, ALL, seeded(seed));
      assert.equal(qs.length, 3);
      checkQuiz(qs, mates);
    }
  }
});

test('scoreOriginAnswers: B は県名、C はぴったり同じ人を選んだら正解', () => {
  const qs = [
    { type: 'B', targetId: 'P01', choices: ['宮城県', '山形県', '福島県', '岩手県'], answer: '宮城県' },
    { type: 'C', pref: '東京都', choices: ['P02', 'P03', 'P04', 'P05'], answerIds: ['P02', 'P04'] },
    { type: 'B', targetId: 'P06', choices: ['新潟県', '富山県', '長野県', '群馬県'], answer: '新潟県' }
  ];
  let s = P.scoreOriginAnswers(qs, ['宮城県', ['P04', 'P02'], '富山県']);
  assert.deepEqual([s.correct, s.total], [2, 3]);
  assert.deepEqual(s.results.map(r => r.correct), [true, true, false]);
  // C:1人だけ・ちがう人・多すぎ(人数までしか使わない)は不正解
  assert.equal(P.scoreOriginAnswers(qs, ['', ['P02'], '']).correct, 0);
  assert.equal(P.scoreOriginAnswers(qs, ['', ['P02', 'P03'], '']).correct, 0);
  s = P.scoreOriginAnswers(qs, ['', ['P03', 'P02', 'P04'], '']);
  assert.equal(s.correct, 0);
  assert.deepEqual(s.results[1].answer, ['P03', 'P02']);
  // 選択肢にない答え・時間切れ(未回答)・形がちがう答えは不正解で、保存する形からも外す
  s = P.scoreOriginAnswers(qs, ['秘密の文字列', 'P02', undefined]);
  assert.deepEqual(s.results.map(r => r.answer), ['', [], '']);
  assert.equal(s.correct, 0);
  assert.deepEqual(P.scoreOriginAnswers(qs, '宮城県').results.map(r => r.correct), [true, false, false]); // 古い形(文字列1つ)
  assert.deepEqual(P.scoreOriginAnswers([], []), { correct: 0, total: 0, results: [] });
});
