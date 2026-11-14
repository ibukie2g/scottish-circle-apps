/**
 * シートの読み書き・キャッシュ・ロック・エラーの共通処理(GAS専用)
 *
 * - 読み:シートの値を「1行目の見出し → 値」のオブジェクトにして、CacheService に10秒置く
 *   (シートを手で直しても10秒以内に反映される)
 * - 書き:LockService で1つずつ順番に。書く前にシートを読み直し(キャッシュを使わない)、書いたらキャッシュを消す
 * - 列は見出しの名前で探す(列番号を決め打ちしない)
 */

var CACHE_SEC = 10;
var TZ = 'Asia/Tokyo';

// アプリ用スプレッドシートのシート名
var SH_STATE = '状態';
var SH_PARTICIPANTS = '参加者';
var SH_MATCHES = '試合';
var SH_PREDICTIONS = '予想';
var SH_QUIZ_Q = 'クイズ問題';
var SH_QUIZ_A = 'クイズ回答';
var SH_NEAR = '惜しい答え';
var SH_ODAI = 'お題カード';
var SH_SURVEY = 'アンケート';
var SH_SETTINGS = '設定';
var SH_SUMMARY = '集計';
var SH_TIPS = 'ひとこと';

// ---- エラー ----

/** 画面に返すエラー(code は API.md の一覧) */
function appError_(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

/**
 * google.script.run から呼ばれる関数の外側。
 * 成功:{ ok: true, data: ... } 失敗:{ ok: false, error: { code, message } }
 */
function api_(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    if (e && e.code) return { ok: false, error: { code: e.code, message: e.message } };
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: { code: 'INTERNAL', message: 'サーバーでエラーが起きました(' + (e && e.message) + ')' } };
  }
}

// ---- ロック ----

// 同じ実行内の読み取り整合処理は、呼び出し元が取得済みのロックを共有する。
var lockDepth_ = 0;
function withLock_(fn) {
  if (lockDepth_) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw appError_('BUSY', '混み合っています。少し待ってからもう一度押してください');
  try {
    lockDepth_++;
    return fn();
  } finally {
    lockDepth_--;
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

// ---- キャッシュ ----

/**
 * キャッシュ。キーの頭に「世代番号」(スクリプト プロパティ CACHE_EPOCH)を付ける。
 * resetEventData() で世代を進めると、来場済み・公開済み・送信済みなどの目印が全部まとめて無効になる
 */
function cache_() {
  var c = CacheService.getScriptCache();
  var p = cacheEpoch_() + '|';
  return {
    get: function (k) { return c.get(p + k); },
    put: function (k, v, sec) { return c.put(p + k, v, sec); },
    remove: function (k) { return c.remove(p + k); },
    removeAll: function (ks) { return c.removeAll(ks.map(function (k) { return p + k; })); },
    getAll: function (ks) {
      var got = c.getAll(ks.map(function (k) { return p + k; })), out = {};
      Object.keys(got).forEach(function (k) { out[k.slice(p.length)] = got[k]; });
      return out;
    }
  };
}

var cacheEpochMemo_ = null;
function cacheEpoch_() {
  if (cacheEpochMemo_ === null) cacheEpochMemo_ = PropertiesService.getScriptProperties().getProperty('CACHE_EPOCH') || '0';
  return cacheEpochMemo_;
}

function cacheGetJson_(key) {
  var v = cache_().get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

function cachePutJson_(key, obj, sec) {
  try { cache_().put(key, JSON.stringify(obj), sec || CACHE_SEC); } catch (e) { /* 大きすぎるときはキャッシュしない */ }
}

/** シートのキャッシュと、それをもとに計算したもの(状態)を消す */
function invalidate_(sheetNames) {
  var keys = ['state:v1', 'scores:v1'];
  (sheetNames || []).forEach(function (n) { keys.push('tbl:' + n); });
  cache_().removeAll(keys);
}

// ---- 値の変換 ----

function cellToJson_(v) {
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** 書き込む値:「=」などで始まる文字列が数式として動かないようにする */
function cellSafe_(v) {
  if (typeof v === 'string' && /^[=+@]/.test(v) && !/^[+]?\d/.test(v)) return "'" + v;
  return v;
}

function toStr_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function toBool_(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  return /^(true|はい|yes|1|○|◯)$/i.test(String(v).normalize('NFKC').trim());
}

function toNumOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(String(v).normalize('NFKC').trim());
  return isFinite(n) ? n : null;
}

/** Date・ISO文字列・「2026-11-24 21:30:00」などをミリ秒にする。読めなければ null */
function toMs_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  var s = String(v).trim().normalize('NFKC');
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    var pad = function (x) { return ('0' + x).slice(-2); };
    s = m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) + 'T' + pad(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + '+09:00';
  }
  var t = Date.parse(s);
  return isNaN(t) ? null : t;
}

/** チーム名を A〜D にする(「a」「Ａ」「Aチーム」も可)。読めなければ '' */
function normTeam_(v) {
  var s = String(v === null || v === undefined ? '' : v).normalize('NFKC').trim().toUpperCase();
  var m = s.match(/^([A-D])(?![A-Z])/);
  return m ? m[1] : '';
}

/** 「P01,P03」「P01、P03」を配列に */
function splitIds_(v) {
  return toStr_(v).normalize('NFKC').split(/[,、\s]+/).filter(function (x) { return x; });
}

function fmtTime_(ms) {
  if (ms === null || ms === undefined) return '';
  return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd HH:mm:ss');
}

// ---- シートの読み書き ----

function appSs_() {
  return SpreadsheetApp.getActive();
}

function sheet_(name) {
  var sh = appSs_().getSheetByName(name);
  if (!sh) throw appError_('SETUP', 'シート「' + name + '」がありません。setup を実行してください');
  return sh;
}

/**
 * シートを読む。{ headers: string[], rows: object[] }
 * rows[i] は { _row: シートの行番号, 見出し: 値, ... }。日時は ISO 文字列になる
 * @param {boolean} fresh true ならキャッシュを使わない(書く前に使う)
 */
function readTable_(name, fresh) {
  var key = 'tbl:' + name;
  if (!fresh) {
    var c = cacheGetJson_(key);
    if (c) return c;
  }
  var values = sheet_(name).getDataRange().getValues();
  var headers = (values[0] || []).map(function (h) { return toStr_(h); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var empty = row.every(function (v) { return v === '' || v === null; });
    if (empty) continue;
    var obj = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) obj[headers[j]] = cellToJson_(row[j]);
    }
    rows.push(obj);
  }
  var t = { headers: headers, rows: rows };
  cachePutJson_(key, t);
  return t;
}

function headerIndex_(headers, name) {
  var i = headers.indexOf(name);
  if (i < 0) throw appError_('SETUP', 'シートの見出し「' + name + '」が見つかりません');
  return i;
}

/** 1行の一部の列を書きかえる(ロックの中で使う) */
function updateRow_(name, rowNumber, values) {
  var sh = sheet_(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(toStr_);
  Object.keys(values).forEach(function (k) {
    sh.getRange(rowNumber, headerIndex_(headers, k) + 1).setValue(cellSafe_(values[k]));
  });
}

/** 行を下に足す(ロックの中で使う) */
function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(toStr_);
  var data = objs.map(function (o) {
    return headers.map(function (h) { return (h in o) ? cellSafe_(o[h]) : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, data.length, headers.length).setValues(data);
}

/**
 * 「自分専用の行」に書く(ロックなし)。30人が同時に送る場面で使う。
 *
 * 同時に「いちばん下に足す」と行が上書きし合う(appendRow でも起きた。2026-11-11 の負荷テストで確認)。
 * 別々の行に書くのは同時でも安全なので、人ごと(と試合ごと)に決まった行に書く。
 * 行番号は参加者シートの行の順番から決める(slotRow_)。
 *
 * 安全のため、その行に別の人(keys が違う)のデータがあったり、シートの行数が足りなかったりしたら、
 * ロックを取って下に足す(参加者シートを並べ替えたときなど)。
 * @param sh シート / row 書く行 / keys {見出し: 値}(その行の持ち主を表す列)/ obj 書く値
 */
function writeSlotRow_(sh, row, keys, obj) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(toStr_);
  var line = headers.map(function (h) { return (h in obj) ? cellSafe_(obj[h]) : ''; });
  if (row >= 2 && row <= sh.getMaxRows()) {
    var cur = sh.getRange(row, 1, 1, headers.length).getValues()[0];
    // 使ってよいのは、行がまるごと空か、持ち主の列がすべて自分と同じとき
    var blank = cur.every(function (v) { return toStr_(v) === ''; });
    var mine = blank || Object.keys(keys).every(function (k) {
      var c = headers.indexOf(k);
      return c >= 0 && toStr_(cur[c]) === toStr_(keys[k]);
    });
    if (mine) {
      sh.getRange(row, 1, 1, headers.length).setValues([line]);
      return;
    }
  }
  withLock_(function () { sh.appendRow(line); });
}

/**
 * 自分専用の行の番号。参加者シートで k 番目(1から)の人 → block 番目の区画の k 番目の行
 * @param p 参加者(readParticipants_ の1件) / block 区画の番号(0から) / size 1区画の行数 / sub 区画の中のずれ
 */
function slotRow_(p, block, size, sub) {
  var k = p._row - 1; // 参加者シートの2行目の人が1
  return 1 + (block || 0) * (size || 0) + (k - 1) * (sub ? sub.per : 1) + (sub ? sub.offset : 0) + 1;
}

/** キーと値のシート(状態・設定)を { キー: 値 } で読む */
function readKeyValues_(name, fresh) {
  var t = readTable_(name, fresh);
  var kv = {};
  t.rows.forEach(function (r) {
    var k = toStr_(r['キー']);
    if (k) kv[k] = r['値'];
  });
  return kv;
}

/** キーと値のシートに書く。無いキーは下に足す(ロックの中で使う) */
function writeKeyValues_(name, values) {
  var t = readTable_(name, true);
  var adds = [];
  Object.keys(values).forEach(function (k) {
    var row = null;
    t.rows.forEach(function (r) { if (toStr_(r['キー']) === k) row = r; });
    if (row) updateRow_(name, row._row, { '値': values[k] });
    else adds.push({ 'キー': k, '値': values[k] });
  });
  appendRows_(name, adds);
}
