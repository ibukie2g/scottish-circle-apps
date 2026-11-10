/**
 * 名前の判定(純粋関数。GASにもNode.jsにも依存しない)
 *
 * - 入力は漢字でもひらがなでもカタカナでもよい
 * - 正規化:全角半角(NFKC)、スペース・中黒の除去、異体字(斎/齋/齊 など)、カタカナ→ひらがな
 * - 登録の漢字名・ひらがな名の両方と比べ、どちらかと完全一致すれば正解
 *   (名字が漢字・名前がひらがな、のような混ぜ書きも、登録名が「名字 名前」と空白で分かれていれば正解にする)
 * - 完全一致しないが1文字違い(編集距離1)の人がいれば「惜しい答え」
 */

// 異体字 → 代表字。必要になったらここに足す
var NAME_VARIANTS = {
  '齋': '斎', '齊': '斎',
  '邊': '辺', '邉': '辺',
  '髙': '高',
  '﨑': '崎', '嵜': '崎',
  '澤': '沢',
  '嶋': '島', '嶌': '島',
  '濱': '浜', '濵': '浜',
  '𠮷': '吉',
  '國': '国',
  '廣': '広',
  '櫻': '桜',
  '淵': '渕',
  '惠': '恵',
  '榮': '栄',
  '眞': '真',
  '冨': '富',
  '德': '徳',
  '瀨': '瀬',
  '槇': '槙',
  '籐': '藤'
};

/** カタカナ(ァ〜ヶ)をひらがなに直す */
function katakanaToHiragana(s) {
  return String(s).replace(/[ァ-ヶ]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0x60);
  });
}

/** 名前の比較用の正規化 */
function normalizeName(s) {
  if (s === null || s === undefined) return '';
  var t = String(s).normalize('NFKC');
  // 空白(全角スペースを含む)・中黒・句読点を消す
  t = t.replace(/[\s・･.,、。\-‐_]/g, '');
  var out = '';
  var chars = Array.from(t);
  for (var i = 0; i < chars.length; i++) {
    out += NAME_VARIANTS[chars[i]] || chars[i];
  }
  return katakanaToHiragana(out).toLowerCase();
}

/** 登録名を「名字」「名前」に分ける(空白で2つに分かれるときだけ) */
function splitName_(s) {
  var parts = String(s || '').normalize('NFKC').trim().split(/\s+/);
  return parts.length === 2 ? parts : null;
}

/** 1人分の、正解として受け付ける表記(正規化済み)の一覧 */
function nameForms(member) {
  var forms = [];
  function add(x) {
    var n = normalizeName(x);
    if (n && forms.indexOf(n) < 0) forms.push(n);
  }
  add(member.name);
  add(member.kana);
  var k = splitName_(member.name);
  var h = splitName_(member.kana);
  if (k && h) {
    add(k[0] + h[1]);
    add(h[0] + k[1]);
  }
  return forms;
}

/** 編集距離(レーベンシュタイン距離)。サロゲートペアも1文字として数える */
function editDistance(a, b) {
  var x = Array.from(String(a));
  var y = Array.from(String(b));
  var prev = [];
  for (var j = 0; j <= y.length; j++) prev.push(j);
  for (var i = 1; i <= x.length; i++) {
    var cur = [i];
    for (var j2 = 1; j2 <= y.length; j2++) {
      var cost = x[i - 1] === y[j2 - 1] ? 0 : 1;
      cur.push(Math.min(prev[j2] + 1, cur[j2 - 1] + 1, prev[j2 - 1] + cost));
    }
    prev = cur;
  }
  return prev[y.length];
}

/**
 * 入力された名前をまとめて判定する
 * @param {string[]} inputs 入力(1件ずつ)
 * @param {{id:string,name:string,kana:string}[]} members 対象のメンバー(自分以外)
 * @return {{
 *   correctIds: string[],
 *   nearMisses: {input:string, candidateId:string}[],
 *   results: {input:string, status:string, id:(string|null)}[],
 *   writtenCount: number,
 *   total: number,
 *   rate: (number|null)
 * }}
 *   status は correct(正解)/duplicate(同じ人を2回)/near(惜しい)/wrong(不正解)/empty(空欄)
 */
function judgeNames(inputs, members) {
  inputs = inputs || [];
  members = members || [];
  var formsById = {};
  var nearFormsById = {}; // 惜しい答えは、登録の漢字名・ひらがな名とだけ比べる(混ぜ書きの組み合わせは使わない)
  members.forEach(function (m) {
    formsById[m.id] = nameForms(m);
    nearFormsById[m.id] = [normalizeName(m.name), normalizeName(m.kana)].filter(function (x) { return x; });
  });

  var correct = [];
  var results = inputs.map(function (raw) {
    var n = normalizeName(raw);
    if (!n) return { input: raw, status: 'empty', id: null, _n: n };
    for (var i = 0; i < members.length; i++) {
      var id = members[i].id;
      if (formsById[id].indexOf(n) >= 0) {
        if (correct.indexOf(id) >= 0) return { input: raw, status: 'duplicate', id: id, _n: n };
        correct.push(id);
        return { input: raw, status: 'correct', id: id, _n: n };
      }
    }
    return { input: raw, status: 'pending', id: null, _n: n };
  });

  // 完全一致しなかったものは、まだ当たっていない人の中で1文字違いを探す
  var nearClaimed = [];
  var nearMisses = [];
  results.forEach(function (r) {
    if (r.status !== 'pending') return;
    var best = null;
    var bestD = Infinity;
    members.forEach(function (m) {
      if (correct.indexOf(m.id) >= 0 || nearClaimed.indexOf(m.id) >= 0) return;
      nearFormsById[m.id].forEach(function (f) {
        var d = editDistance(r._n, f);
        if (d < bestD) { bestD = d; best = m.id; }
      });
    });
    if (bestD === 1) {
      r.status = 'near';
      r.id = best;
      nearClaimed.push(best);
      nearMisses.push({ input: r.input, candidateId: best });
    } else {
      r.status = 'wrong';
    }
  });

  results.forEach(function (r) { delete r._n; });
  var written = results.filter(function (r) { return r.status !== 'empty'; }).length;
  return {
    correctIds: correct,
    nearMisses: nearMisses,
    results: results,
    writtenCount: written,
    total: members.length,
    rate: nameRate(correct.length, members.length)
  };
}

/** 正答率 = 正解人数 ÷ 対象人数(対象0人なら null) */
function nameRate(correctCount, total) {
  if (!total) return null;
  return correctCount / total;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NAME_VARIANTS: NAME_VARIANTS,
    katakanaToHiragana: katakanaToHiragana,
    normalizeName: normalizeName,
    nameForms: nameForms,
    editDistance: editDistance,
    judgeNames: judgeNames,
    nameRate: nameRate
  };
}
