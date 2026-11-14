/**
 * 名前の判定(純粋関数。GASにもNode.jsにも依存しない)
 *
 * - 入力は漢字でもひらがなでもカタカナでもよい
 * - 正規化:全角半角(NFKC)、スペース・中黒の除去、異体字(斎/齋/齊 など)、カタカナ→ひらがな
 * - 判定(本番前の変更 3。2026-11-13):
 *     フルネームと完全一致(漢字・ひらがな・混ぜ書き)       → 自動で1人分
 *     名前だけ・名字だけ・登録したあだ名と完全一致           → 自動で0.5人分
 *     それ以外で、だれかに近いもの(頭2文字以上が同じ、1文字違い)→ 運営が判断(near)
 *     だれにも近くないもの                                   → unknown(運営の一覧に出すかは呼ぶ側で決める)
 * - 最後の敬称(さん・先輩・くん・ちゃん など)は、まずそのまま比べ、だめなら外して比べる
 * - 同じ人を何回書いても、いちばん高い1回だけ数える。1つの答えが何人かに当てはまるときは、どちらか1人分
 * - 「名前だけ・名字だけ」は、登録名が「名字 名前」と空白で分かれているときだけ使える
 */

// 最後に付いていたら外す敬称(正規化のあとの形。カタカナはひらがなになっている)。長いものから比べる
var NAME_HONORIFICS = ['せんぱい', 'ぱいせん', 'ちゃん', '先輩', 'さん', 'くん', 'さま', '君', '様', '氏'];

// ボーナス(その人の正答率に足す)。全員フルネーム = +20%、全員コンプリート(0.5人分を含めて全員)= +10%。重ねない
var NAME_BONUS_ALL_FULL = 0.2;
var NAME_BONUS_COMPLETE = 0.1;

var NICKNAME_MAX_COUNT = 3; // あだ名は3つまで

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

/** 最後の敬称を1つ外す(正規化済みの文字列に使う)。敬称だけの文字列は外さない */
function stripHonorific(n) {
  var s = String(n || '');
  for (var i = 0; i < NAME_HONORIFICS.length; i++) {
    var h = NAME_HONORIFICS[i];
    if (s.length > h.length && s.slice(-h.length) === h) return s.slice(0, -h.length);
  }
  return s;
}

/**
 * あだ名の欄を分ける。「、」「,」「/」で区切る(スペースは区切りにしない)。重複と空は除く
 * 例:'はな、はなちゃん' → ['はな', 'はなちゃん']
 */
function parseNicknames(s) {
  var out = [];
  String(s === null || s === undefined ? '' : s).normalize('NFKC').split(/[、,\/]/).forEach(function (x) {
    var t = x.trim();
    if (t && out.indexOf(t) < 0) out.push(t);
  });
  return out;
}

/** 名字と名前に分かれているか(名簿の直し忘れを数えるのに使う) */
function isSplitName(member) {
  return !!(splitName_(member && member.name) && splitName_(member && member.kana));
}

/**
 * 1人分の、0.5人分として受け付ける表記(正規化済み):名字だけ・名前だけ・あだ名(敬称を外した形も)
 * フルネームと同じになるものは入れない
 * @param {{name:string, kana:string, nickname?:string}} member nickname は自己紹介のあだ名の欄そのまま
 */
function halfForms(member) {
  var full = nameForms(member);
  var forms = [];
  function add(n) {
    if (n && full.indexOf(n) < 0 && forms.indexOf(n) < 0) forms.push(n);
  }
  var k = splitName_(member.name);
  var h = splitName_(member.kana);
  if (k) { add(normalizeName(k[0])); add(normalizeName(k[1])); }
  if (h) { add(normalizeName(h[0])); add(normalizeName(h[1])); }
  parseNicknames(member.nickname).slice(0, NICKNAME_MAX_COUNT).forEach(function (nk) {
    var n = normalizeName(nk);
    add(n);
    add(stripHonorific(n));
  });
  return forms;
}

function commonPrefixLen_(a, b) {
  var n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * 「惜しい」かどうか:入力がその人の表記にどれくらい近いか。近くなければ null、近いほど小さい数
 *
 * 運営の判断に回す基準はここだけで決めている(判断はあまり厳密でなくてよい、という方針):
 *   - 1文字違い(足りない・多い・ちがう)。2文字の表記は、頭の1文字が同じときだけ
 *   - 頭の2文字以上が同じ(名前・名字の頭2文字以上)
 * 入力も表記も2文字以上のときだけ比べる。敬称を外した形でも比べる
 * @param {string} input 正規化済みの入力
 * @param {string[]} forms その人の表記(フルネーム・名字・名前・あだ名。正規化済み)
 */
function nearNameScore(input, forms) {
  var tries = [input];
  var stripped = stripHonorific(input);
  if (stripped !== input) tries.push(stripped);
  var best = null;
  tries.forEach(function (t) {
    var a = Array.from(t);
    if (a.length < 2) return;
    forms.forEach(function (f) {
      var b = Array.from(f);
      if (b.length < 2) return;
      var score = null;
      var d = editDistance(t, f);
      var p = commonPrefixLen_(a, b);
      if (d <= 1 && (Math.max(a.length, b.length) >= 3 || p >= 1)) score = d;
      else if (p >= 2) score = 2 + 1 / p; // 頭が長く合っているほど近い
      if (score !== null && (best === null || score < best)) best = score;
    });
  });
  return best;
}

/**
 * 正答率 = (1人分の人数 + 0.5 × 0.5人分の人数) ÷ 対象人数 + ボーナス(対象0人なら null)
 * ボーナスで 1(100%)を超えてよい
 */
function nameQuizRate(fullCount, halfCount, total) {
  if (!total) return null;
  var base = (fullCount + 0.5 * halfCount) / total;
  var bonus = fullCount >= total ? NAME_BONUS_ALL_FULL : (fullCount + halfCount >= total ? NAME_BONUS_COMPLETE : 0);
  return base + bonus;
}

/** {参加者ID: 1 | 0.5} と対象者の一覧から、人数と正答率をまとめる */
function summarizeCredits(credits, targetIds) {
  var full = [], half = [];
  (targetIds || []).forEach(function (id) {
    if (credits[id] === 1) full.push(id);
    else if (credits[id] === 0.5) half.push(id);
  });
  var total = (targetIds || []).length;
  return {
    fullIds: full, halfIds: half, total: total,
    allFull: total > 0 && full.length === total,
    complete: total > 0 && full.length + half.length === total,
    rate: nameQuizRate(full.length, half.length, total)
  };
}

/**
 * 入力された名前をまとめて判定する
 * @param {string[]} inputs 入力(1件ずつ)
 * @param {{id:string,name:string,kana:string,nickname?:string}[]} members 対象のメンバー(自分以外)
 * @return {{
 *   credits: Object<string, number>,   自動で決まった分。参加者ID → 1(1人分)| 0.5(0.5人分)
 *   fullIds: string[], halfIds: string[],
 *   nearMisses: {input:string, candidateId:string}[],  運営が判断するもの(候補あり)
 *   unknowns: string[],                                だれにも近くない入力
 *   results: {input:string, status:string, id:(string|null)}[],
 *   writtenCount: number, total: number, rate: (number|null)
 * }}
 *   status は full(1人分)/half(0.5人分)/duplicate(もう数えた人)/near(惜しい)/unknown(近い人なし)/empty(空欄)
 */
function judgeNames(inputs, members) {
  inputs = inputs || [];
  members = members || [];
  var info = members.map(function (m) {
    return { id: m.id, full: nameForms(m), half: halfForms(m) };
  });
  function find(n) {
    var full = [], half = [];
    info.forEach(function (x) {
      if (x.full.indexOf(n) >= 0) full.push(x.id);
      else if (x.half.indexOf(n) >= 0) half.push(x.id);
    });
    return { full: full, half: half };
  }

  var results = inputs.map(function (raw) {
    var n = normalizeName(raw);
    if (!n) return { input: raw, status: 'empty', id: null };
    // まずそのまま比べ、だめなら敬称を外して比べる
    var hit = find(n);
    if (!hit.full.length && !hit.half.length) {
      var s = stripHonorific(n);
      if (s !== n) hit = find(s);
    }
    return { input: raw, status: 'pending', id: null, _n: n, _hit: hit };
  });

  var credits = {};
  // 1) フルネーム(1人分)を先に決める
  results.forEach(function (r) {
    if (r.status !== 'pending' || !r._hit.full.length) return;
    var free = r._hit.full.filter(function (id) { return credits[id] !== 1; });
    if (free.length) { credits[free[0]] = 1; r.status = 'full'; r.id = free[0]; }
    else { r.status = 'duplicate'; r.id = r._hit.full[0]; }
  });
  // 2) 名前だけ・名字だけ・あだ名(0.5人分)。何人かに当てはまるときは、まだ数えていない人の1人分
  results.forEach(function (r) {
    if (r.status !== 'pending' || !r._hit.half.length) return;
    var free = r._hit.half.filter(function (id) { return !credits[id]; });
    if (free.length) { credits[free[0]] = 0.5; r.status = 'half'; r.id = free[0]; }
    else { r.status = 'duplicate'; r.id = r._hit.half[0]; }
  });
  // 3) 残りは、近い人を探す(もう1人分になっている人は候補にしない)
  var nearMisses = [];
  var unknowns = [];
  results.forEach(function (r) {
    if (r.status !== 'pending') return;
    var best = null;
    info.forEach(function (x) {
      if (credits[x.id] === 1) return;
      var s = nearNameScore(r._n, x.full.concat(x.half));
      if (s !== null && (best === null || s < best.score)) best = { id: x.id, score: s };
    });
    if (best) {
      r.status = 'near';
      r.id = best.id;
      nearMisses.push({ input: r.input, candidateId: best.id });
    } else {
      r.status = 'unknown';
      unknowns.push(r.input);
    }
  });

  results.forEach(function (r) { delete r._n; delete r._hit; });
  var sum = summarizeCredits(credits, members.map(function (m) { return m.id; }));
  return {
    credits: credits,
    fullIds: sum.fullIds,
    halfIds: sum.halfIds,
    nearMisses: nearMisses,
    unknowns: unknowns,
    results: results,
    writtenCount: results.filter(function (r) { return r.status !== 'empty'; }).length,
    total: members.length,
    rate: sum.rate
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NAME_VARIANTS: NAME_VARIANTS,
    NAME_HONORIFICS: NAME_HONORIFICS,
    NICKNAME_MAX_COUNT: NICKNAME_MAX_COUNT,
    katakanaToHiragana: katakanaToHiragana,
    normalizeName: normalizeName,
    nameForms: nameForms,
    halfForms: halfForms,
    stripHonorific: stripHonorific,
    parseNicknames: parseNicknames,
    isSplitName: isSplitName,
    editDistance: editDistance,
    nearNameScore: nearNameScore,
    nameQuizRate: nameQuizRate,
    summarizeCredits: summarizeCredits,
    judgeNames: judgeNames
  };
}
