/**
 * シートの読み書き・キャッシュ・ロック・エラーの共通処理(GAS専用)
 * sports-day の store.js と同じ考え方。ただし、スプレッドシートが複数(管理ファイル・グループごとのファイル・名簿)ある
 *
 * - 読み:シートの値を「1行目の見出し → 値」のオブジェクトにして、CacheService に10秒置く
 * - 書き:LockService で1つずつ順番に。書く前にシートを読み直し(キャッシュを使わない)、書いたらキャッシュを消す
 * - 列は見出しの名前で探す(列番号を決め打ちしない)
 * - 文字は先頭に ' をつけて書く(「2026-12-15」「19:00」が日付・時刻に勝手に変わらないように)
 */

var CACHE_SEC = 10;
var TZ = 'Asia/Tokyo';

// ---- エラー ----
function appError_(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

/** google.script.run から呼ばれる関数の外側。{ ok, data } か { ok:false, error } */
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

// ---- 設定 ----
function prop_(key, required) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v && required) throw appError_('SETUP', 'スクリプト プロパティ ' + key + ' がありません');
  return v || '';
}

// ---- スプレッドシートを開く(1回の実行の中では使い回す) ----
var ssMemo_ = {};
function ss_(id) {
  if (!id) throw appError_('SETUP', 'スプレッドシートのIDがありません');
  if (!ssMemo_[id]) {
    try { ssMemo_[id] = SpreadsheetApp.openById(id); }
    catch (e) { throw appError_('SETUP', 'スプレッドシートを開けません(' + id + ')'); }
  }
  return ssMemo_[id];
}

// ---- キャッシュ ----
function cacheGetJson_(key) {
  var v = CacheService.getScriptCache().get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function cachePutJson_(key, obj, sec) {
  try { CacheService.getScriptCache().put(key, JSON.stringify(obj), sec || CACHE_SEC); } catch (e) { /* 大きすぎるときはキャッシュしない */ }
}
function cacheRemove_(keys) { CacheService.getScriptCache().removeAll(keys); }

// ---- 値の変換 ----
function toStr_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    // 1899-12-30 は時刻だけのセル(19:00 など)
    if (v.getFullYear() < 1900) return Utilities.formatDate(v, TZ, 'HH:mm');
    var hm = Utilities.formatDate(v, TZ, 'HH:mm');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd') + (hm === '00:00' ? '' : ' ' + hm);
  }
  return String(v).trim();
}
function toNum_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function cellOut_(v) {
  if (typeof v === 'string' && v !== '') return "'" + v;
  return v === undefined || v === null ? '' : v;
}
function todayYmd_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

// ---- 表の読み書き ----

/** シートを取る。無ければ見出しつきで作る */
function sheet_(ssId, name, headers) {
  var ss = ss_(ssId);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    if (!headers) throw appError_('SETUP', 'シート「' + name + '」がありません');
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 表を読む → { headers, rows: [{ 見出し: 値, _row: 行番号 }] }。fresh=true ならキャッシュを使わない */
function readTable_(ssId, name, fresh) {
  var key = 'tbl:' + ssId + ':' + name;
  if (!fresh) {
    var c = cacheGetJson_(key);
    if (c) return c;
  }
  var sh = ss_(ssId).getSheetByName(name);
  var out = { headers: [], rows: [] };
  if (sh) {
    var last = sh.getLastRow(), cols = sh.getLastColumn();
    if (last >= 1 && cols >= 1) {
      var values = sh.getRange(1, 1, last, cols).getValues();
      out.headers = values[0].map(toStr_);
      for (var r = 1; r < values.length; r++) {
        if (!values[r].some(function (v) { return v !== '' && v !== null; })) continue;
        var o = { _row: r + 1 };
        out.headers.forEach(function (h, i) { if (h) o[h] = values[r][i] instanceof Date ? toStr_(values[r][i]) : values[r][i]; });
        out.rows.push(o);
      }
    }
  }
  cachePutJson_(key, out);
  return out;
}

function invalidateTables_(ssId, names) {
  cacheRemove_(names.map(function (n) { return 'tbl:' + ssId + ':' + n; }));
}

/** 行を足す(見出しの名前で列を合わせる) */
function appendRows_(ssId, name, headers, objs) {
  if (!objs.length) return;
  var sh = sheet_(ssId, name, headers);
  var hs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(toStr_);
  var values = objs.map(function (o) { return hs.map(function (h) { return cellOut_(o[h]); }); });
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, values.length, hs.length).setValues(values);
  invalidateTables_(ssId, [name]);
}

/** 見出しに足りない列があれば、右の端に足す(あとから列を増やしたとき、前に作ったファイルにも足すため) */
function ensureColumns_(ssId, name, headers) {
  var sh = sheet_(ssId, name, headers);
  var cols = Math.max(1, sh.getLastColumn());
  var hs = sh.getRange(1, 1, 1, cols).getValues()[0].map(toStr_);
  var missing = headers.filter(function (h) { return hs.indexOf(h) < 0; });
  if (!missing.length) return;
  sh.getRange(1, hs.filter(function (h) { return h; }).length + 1, 1, missing.length).setValues([missing]);
  invalidateTables_(ssId, [name]);
}

/** 1行の一部の列だけ書き換える */
function updateRow_(ssId, name, row, patch) {
  var sh = sheet_(ssId, name);
  var hs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(toStr_);
  Object.keys(patch).forEach(function (h) {
    var c = hs.indexOf(h);
    if (c >= 0) sh.getRange(row, c + 1).setValue(cellOut_(patch[h]));
  });
  invalidateTables_(ssId, [name]);
}

/** 行を消す(下から順に) */
function deleteRows_(ssId, name, rowNums) {
  var sh = sheet_(ssId, name);
  rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  invalidateTables_(ssId, [name]);
}

/** 推測されにくい合言葉(英数字20文字) */
function randomToken_() {
  var s = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', out = '';
  for (var i = 0; i < 20; i++) out += chars.charAt(parseInt(s.substr(i * 2, 2), 16) % chars.length);
  return out;
}
