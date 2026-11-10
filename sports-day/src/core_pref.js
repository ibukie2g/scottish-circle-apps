/**
 * 出身地の4択の選択肢づくり(純粋関数。GASにもNode.jsにも依存しない)
 *
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PREFECTURES: PREFECTURES,
    normalizePrefecture: normalizePrefecture,
    prefsByDistance: prefsByDistance,
    makeOriginChoices: makeOriginChoices
  };
}
