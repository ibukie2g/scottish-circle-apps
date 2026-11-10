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

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw appError_('BUSY', '混み合っています。少し待ってからもう一度押してください');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ---- キャッシュ ----

function cache_() {
  return CacheService.getScriptCache();
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
