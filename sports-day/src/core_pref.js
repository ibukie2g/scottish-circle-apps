/**
 * 出身地クイズの出題と採点(純粋関数。GASにもNode.jsにも依存しない)
 *
 * 出題は3問、形は2種類(本番前の変更 5。makeOriginQuiz):
 *   B「〇〇さんの出身は?」    → 4つの県から選ぶ
 *   C「〇〇県出身はだれ?(2人)」→ チームメイトの名前4人から、その人数まで選ぶ
 *
 * B の4択の選択肢(makeOriginChoices):
 * 選択肢 = 正解 + 正解と違う都道府県3つ。
 * 3つは「正解に近い県(県庁所在地の距離が近い順に6つ)」と
 * 「参加者全体の出身地のうち、正解から近い15県に入るもの」から、ランダムに選ぶ。
 */

// [都道府県名, 県庁所在地の緯度, 経度](おおよそ)
var PREFECTURES = [
  ['北海道', 43.06, 141.35], ['青森県', 40.82, 140.74], ['岩手県', 39.70, 141.15],
  ['宮城県', 38.27, 140.87], ['秋田県', 39.72, 140.10], ['山形県', 38.24, 140.36],
  ['福島県', 37.75, 140.47], ['茨城県', 36.34, 140.45], ['栃木県', 36.57, 139.88],
  ['群馬県', 36.39, 139.06], ['埼玉県', 35.86, 139.65], ['千葉県', 35.61, 140.12],
  ['東京都', 35.69, 139.69], ['神奈川県', 35.45, 139.64], ['新潟県', 37.90, 139.02],
  ['富山県', 36.70, 137.21], ['石川県', 36.59, 136.63], ['福井県', 36.07, 136.22],
  ['山梨県', 35.66, 138.57], ['長野県', 36.65, 138.18], ['岐阜県', 35.39, 136.72],
  ['静岡県', 34.98, 138.38], ['愛知県', 35.18, 136.91], ['三重県', 34.73, 136.51],
  ['滋賀県', 35.00, 135.87], ['京都府', 35.02, 135.76], ['大阪府', 34.69, 135.52],
  ['兵庫県', 34.69, 135.18], ['奈良県', 34.69, 135.83], ['和歌山県', 34.23, 135.17],
  ['鳥取県', 35.50, 134.24], ['島根県', 35.47, 133.05], ['岡山県', 34.66, 133.93],
  ['広島県', 34.40, 132.46], ['山口県', 34.19, 131.47], ['徳島県', 34.07, 134.56],
  ['香川県', 34.34, 134.04], ['愛媛県', 33.84, 132.77], ['高知県', 33.56, 133.53],
  ['福岡県', 33.61, 130.42], ['佐賀県', 33.25, 130.30], ['長崎県', 32.74, 129.87],
  ['熊本県', 32.79, 130.74], ['大分県', 33.24, 131.61], ['宮崎県', 31.91, 131.42],
  ['鹿児島県', 31.56, 130.56], ['沖縄県', 26.21, 127.68]
];

var PREF_NEAR_COUNT = 6;    // 近い県として候補に入れる数
var PREF_OTHERS_RANGE = 15; // 参加者の出身地を候補に入れる範囲(近い順に何県まで)

var ORIGIN_QUIZ_COUNT = 3;       // 出身地クイズの問題数
var ORIGIN_HOME_PREF = '福島県'; // B の出題で後回しにする県(地元の人が多いので)
var ORIGIN_C_MAX_ANSWERS = 3;    // C の正解は3人まで(同じ県が4人以上なら、その県は出さない)
var ORIGIN_C_CHOICES = 4;        // C の選択肢の人数

/** 「福島」「福島県」「ﾌｸｼﾏ県」などを正式名にする。わからなければ null */
function normalizePrefecture(s) {
  if (s === null || s === undefined) return null;
  var t = String(s).normalize('NFKC').replace(/\s/g, '');
  if (!t) return null;
  for (var i = 0; i < PREFECTURES.length; i++) {
    var name = PREFECTURES[i][0];
    if (t === name) return name;
  }
  for (var j = 0; j < PREFECTURES.length; j++) {
    var n = PREFECTURES[j][0];
    var base = n === '北海道' ? n : n.replace(/[都府県]$/, '');
    if (t === base) return n;
  }
  return null;
}

function prefIndex_(name) {
  for (var i = 0; i < PREFECTURES.length; i++) if (PREFECTURES[i][0] === name) return i;
  return -1;
}

/** 正解以外の都道府県を、近い順に並べる */
function prefsByDistance(name) {
  var p = PREFECTURES[prefIndex_(name)];
  var latScale = Math.cos(p[1] * Math.PI / 180);
  return PREFECTURES
    .filter(function (q) { return q[0] !== name; })
    .map(function (q) {
      var dy = q[1] - p[1];
      var dx = (q[2] - p[2]) * latScale;
      return { name: q[0], d: dx * dx + dy * dy };
    })
    .sort(function (a, b) { return a.d - b.d; })
    .map(function (x) { return x.name; });
}

function shuffle_(arr, rng) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * 出身地の4択を作る
 * @param {string} answer 正解の出身地
 * @param {string[]} participantPrefs 参加者全体の出身地(重複・不正な値があってもよい)
 * @param {function():number} [rng] 0以上1未満の乱数(テスト用に差し替え可)
 * @return {{choices:string[], answer:string}|null} 正解が都道府県として読めなければ null
 */
function makeOriginChoices(answer, participantPrefs, rng) {
  rng = rng || Math.random;
  var ans = normalizePrefecture(answer);
  if (!ans) return null;
  var sorted = prefsByDistance(ans);
  var pool = sorted.slice(0, PREF_NEAR_COUNT);
  var range = sorted.slice(0, PREF_OTHERS_RANGE);
  (participantPrefs || []).forEach(function (s) {
    var n = normalizePrefecture(s);
    if (n && n !== ans && range.indexOf(n) >= 0 && pool.indexOf(n) < 0) pool.push(n);
  });
  var distractors = shuffle_(pool, rng).slice(0, 3);
  return { choices: shuffle_([ans].concat(distractors), rng), answer: ans };
}

/**
 * 出身地クイズの問題を作る(1人分)
 *
 * - B「〇〇さんの出身は?」:出題する人は福島以外を優先。同じ人は2回出さない
 * - C「〇〇県出身はだれ?」:その県の人が1〜3人で、ほかの県の人と合わせて4人の選択肢を作れるときだけ。1問まで
 *   (B の人と重ならないようにする。C で名前が正解に出た人を、B でもう一度聞かない)
 * - B で足りないときは、C をもう1問足す。それでも足りなければ、作れた数だけ
 * - 問題の順番は人ごとにランダム
 *
 * @param {{id:string, origin:string}[]} mates チームメイト(自分以外)。出身地が読めない人は出題にも選択肢にも使わない
 * @param {string[]} participantPrefs 参加者全体の出身地(B の選択肢の候補)
 * @param {function():number} [rng] 0以上1未満の乱数(テスト用に差し替え可)
 * @param {number} [count] 問題数(既定 3)
 * @return {object[]} 問題の配列
 *   B: { type:'B', targetId, choices:[県名×4], answer:県名 }
 *   C: { type:'C', pref:県名, choices:[参加者ID×4], answerIds:[参加者ID×1〜3] }
 */
function makeOriginQuiz(mates, participantPrefs, rng, count) {
  rng = rng || Math.random;
  count = count || ORIGIN_QUIZ_COUNT;
  var known = (mates || []).map(function (m) {
    return { id: m.id, pref: normalizePrefecture(m.origin) };
  }).filter(function (m) { return m.id && m.pref; });
  var byPref = {};
  known.forEach(function (m) { (byPref[m.pref] = byPref[m.pref] || []).push(m.id); });

  var questions = [];
  var used = {}; // もう出題した人
  function addC(pref) {
    var answers = byPref[pref];
    var others = shuffle_(known.filter(function (m) { return m.pref !== pref; }), rng)
      .slice(0, ORIGIN_C_CHOICES - answers.length).map(function (m) { return m.id; });
    questions.push({ type: 'C', pref: pref, choices: shuffle_(answers.concat(others), rng), answerIds: answers.slice() });
    answers.forEach(function (id) { used[id] = true; });
  }
  function canC(pref) {
    var k = byPref[pref].length;
    return k <= ORIGIN_C_MAX_ANSWERS && known.length - k >= ORIGIN_C_CHOICES - k &&
      byPref[pref].every(function (id) { return !used[id]; });
  }
  // C の県:2人以上いる県を先に(「〇〇県出身はだれ?(2人)」のほうが盛り上がるので)
  var cPrefs = shuffle_(Object.keys(byPref), rng).sort(function (a, b) {
    return (byPref[a].length >= 2 ? 0 : 1) - (byPref[b].length >= 2 ? 0 : 1);
  });

  // 1) C を1問(問題が2問以上あるとき)
  if (count >= 2) {
    for (var i = 0; i < cPrefs.length; i++) {
      if (canC(cPrefs[i])) { addC(cPrefs[i]); break; }
    }
  }
  // 2) B:福島以外の人を先に
  var rest = known.filter(function (m) { return !used[m.id]; });
  var order = shuffle_(rest.filter(function (m) { return m.pref !== ORIGIN_HOME_PREF; }), rng)
    .concat(shuffle_(rest.filter(function (m) { return m.pref === ORIGIN_HOME_PREF; }), rng));
  for (var j = 0; j < order.length && questions.length < count; j++) {
    var oc = makeOriginChoices(order[j].pref, participantPrefs, rng);
    if (!oc) continue;
    questions.push({ type: 'B', targetId: order[j].id, choices: oc.choices, answer: oc.answer });
    used[order[j].id] = true;
  }
  // 3) まだ足りなければ、C を足す
  for (var k2 = 0; k2 < cPrefs.length && questions.length < count; k2++) {
    if (canC(cPrefs[k2])) addC(cPrefs[k2]);
  }
  return shuffle_(questions, rng);
}

/**
 * 出身地クイズの採点。1問1点
 * - B:選択肢にある県名で、正解と同じなら正解
 * - C:選んだ人が正解の人とぴったり同じなら正解(選べるのは正解の人数まで。それより多く来たら先頭から人数分だけ使う)
 * - 選択肢にない答え・未回答は不正解
 * @param {object[]} questions makeOriginQuiz の問題
 * @param {Array} answers 問題と同じ順番。B は県名の文字列、C は参加者IDの配列
 * @return {{correct:number, total:number, results:{answer:(string|string[]), correct:boolean}[]}}
 *   results[i].answer は、選択肢にあるものだけにした答え(保存してよい形)
 */
function scoreOriginAnswers(questions, answers) {
  var list = Array.isArray(answers) ? answers : [answers];
  var results = (questions || []).map(function (q, i) {
    var a = list[i];
    if (q.type === 'C') {
      var ids = [];
      (Array.isArray(a) ? a : []).forEach(function (x) {
        var id = String(x);
        if (q.choices.indexOf(id) >= 0 && ids.indexOf(id) < 0) ids.push(id);
      });
      ids = ids.slice(0, q.answerIds.length);
      var ok = ids.length === q.answerIds.length && q.answerIds.every(function (id) { return ids.indexOf(id) >= 0; });
      return { answer: ids, correct: ok };
    }
    var s = typeof a === 'string' && q.choices.indexOf(a) >= 0 ? a : '';
    return { answer: s, correct: s !== '' && s === q.answer };
  });
  return {
    correct: results.filter(function (r) { return r.correct; }).length,
    total: results.length,
    results: results
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PREFECTURES: PREFECTURES,
    ORIGIN_QUIZ_COUNT: ORIGIN_QUIZ_COUNT,
    normalizePrefecture: normalizePrefecture,
    prefsByDistance: prefsByDistance,
    makeOriginChoices: makeOriginChoices,
    makeOriginQuiz: makeOriginQuiz,
    scoreOriginAnswers: scoreOriginAnswers
  };
}
