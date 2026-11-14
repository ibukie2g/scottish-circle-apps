/**
 * シートの構成(docs/データ設計.md と同じ)と setup()
 * setup() は何度実行しても壊れない:あるシートは作り直さず、足りない見出しだけ右に足す。
 */

var MODES = ['待ち', '予想', 'クイズ', '結果待ち', '結果公開'];
var PREDICTION_STATUSES = ['なし', '受付前', '受付中', '公開'];
// 惜しい答えの判定(本番前の変更 3)。古い「OK」「NG」も読める(normJudgement_)
var JUDGE_PENDING = '未';
var JUDGE_FULL = '1人分';
var JUDGE_HALF = '0.5人分';
var JUDGE_NG = '×';

/** アプリ用スプレッドシートのシートと見出し(ほかのファイルの定数を使うので関数にしている) */
function appSheets_() {
  return [
  [SH_STATE, ['キー', '値']],
  [SH_PARTICIPANTS, ['参加者ID', 'チーム', '来場時刻', '当日追加', 'クイズに含める']],
  [SH_MATCHES, ['試合ID', '種目', '回', 'チーム1', 'チーム2', '点数1', '点数2', '状態', '予想の状態', '関連試合']],
  ['予想公開', ['試合ID', 'チーム']],
  [SH_PREDICTIONS, ['試合ID', '参加者ID', 'チーム', '予想(勝つチーム)', '更新時刻']],
  [SH_QUIZ_Q, ['参加者ID', '名前の対象者ID', '出身地の対象者ID', '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解']],
  [SH_QUIZ_A, ['参加者ID', '書いた人数', '正解と判定した人のID', '名前の正答率', '出身地の回答', '出身地の正誤', '送信時刻',
    '0.5人分と判定した人のID', '自動判定(控え)', '出身地の問題数']],
  [SH_NEAR, ['番号', '参加者ID', '近い候補(参加者ID)', '判定']],
  [SH_ODAI, ['お題番号', 'お題', 'チーム', 'そろった人数', '答えた人数']],
  [SH_SURVEY, ['送信時刻', '楽しかったか(1〜5)', '普段話さない人と話せたか(1〜5)', 'また参加したいか', '自由記述', '参加者ID']],
  [SH_SETTINGS, ['キー', '値', '説明']],
  [SH_SUMMARY, ['チーム', 'バスケ順位点', 'バド順位点', 'ドッジ順位点', 'バレー点(点数+ボーナス)', '運動の合計',
    'クイズ', 'お題カード', '予想', '仲良しの合計', '総合', '運動だけの順位', '総合順位']]
  ];
}

// 名簿ファイルに作るシート
var ROSTER_INTRO_SHEET = '自己紹介';
var ROSTER_WALKIN_SHEET = '当日追加';
var ROSTER_SHEETS = [
  [ROSTER_INTRO_SHEET, ['参加者ID', 'やっていたスポーツ', 'ひとこと(20字)', 'あだ名(任意)', '写真のSNS掲載', '更新時刻']],
  [ROSTER_WALKIN_SHEET, ['参加者ID', 'フルネーム(漢字)', 'フルネーム(ひらがな)', 'チーム', '出身地(都道府県)', '追加時刻']]
];

var INITIAL_STATE = [
  ['モード', '待ち'],
  ['今の種目', ''],
  ['次の種目', ''],
  ['予想の試合ID', ''],
  ['クイズ開始時刻', ''],
  ['予想の受付開始時刻', ''],
  ['更新時刻', '']
];

var INITIAL_SETTINGS = [
  ['順位点', '10,7,4,2', '1位,2位,3位,4位 の点(バスケ・バド・ドッジ)'],
  ['バレー勝ちボーナス', 4, 'バレーで1勝するごとに足す点'],
  ['クイズ:名前の満点', 7, '× チームの平均正答率'],
  ['クイズ:出身地の満点', 3, '× チームの出身地の正答率(3問。1問1点)'],
  ['お題カード:全員一致の点', 2, '1枚で全員そろったとき'],
  ['お題カード:それ以外の係数', 1.5, '× そろった人数 ÷ 答えた人数'],
  ['予想:1試合の満点', 2, '× そのチームの予想の正答率'],
  ['クイズ:名前の制限時間(秒)', 120, 'クイズ開始時刻から'],
  ['クイズ:出身地の制限時間(秒)', 60, '名前の制限時間が終わってから(3問で60秒)']
];

/** 実行しているのがスクリプトの持ち主か(Webアプリから匿名で呼ばれたら false) */
function requireEditor_() {
  var active = '';
  try { active = Session.getActiveUser().getEmail(); } catch (e) { active = ''; }
  var owner = Session.getEffectiveUser().getEmail();
  if (!active || active !== owner) throw appError_('FORBIDDEN', 'この関数は Apps Script のエディタから実行してください');
}

/** シートを用意する。あれば見出しの不足だけ足す。作ったら true */
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  var created = false;
  if (!sh) {
    sh = ss.insertSheet(name);
    created = true;
  }
  var lastCol = sh.getLastColumn();
  var current = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(toStr_) : [];
  var missing = headers.filter(function (h) { return current.indexOf(h) < 0; });
  if (missing.length) {
    var start = current.filter(function (h) { return h; }).length === 0 ? 1 : lastCol + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
  }
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
  sh.setFrozenRows(1);
  return created;
}

/**
 * 最初に1回実行する(何度実行してもよい)。Apps Script のエディタから実行する
 */
function setup() {
  requireEditor_();
  var log = [];
  withLock_(function () {
    var ss = appSs_();
    ss.setSpreadsheetTimeZone(TZ);
    appSheets_().forEach(function (def) {
      if (ensureSheet_(ss, def[0], def[1])) log.push('作成: ' + def[0]);
    });

    // 状態・設定:無いキーだけ足す
    var stateKv = readKeyValues_(SH_STATE, true);
    var addState = INITIAL_STATE.filter(function (r) { return !(r[0] in stateKv); })
      .map(function (r) { return { 'キー': r[0], '値': r[1] }; });
    appendRows_(SH_STATE, addState);
    var setKv = readKeyValues_(SH_SETTINGS, true);
    var addSet = INITIAL_SETTINGS.filter(function (r) { return !(r[0] in setKv); })
      .map(function (r) { return { 'キー': r[0], '値': r[1], '説明': r[2] }; });
    appendRows_(SH_SETTINGS, addSet);
    // 「10,7,4,2」が数値や日付にならないように文字列の書式にする
    sheet_(SH_SETTINGS).getRange('B:B').setNumberFormat('@');
    if (addState.length) log.push('状態のキーを追加: ' + addState.length);
    if (addSet.length) log.push('設定のキーを追加: ' + addSet.length);

    // 試合:データが無いときだけ18試合を入れる
    if (readTable_(SH_MATCHES, true).rows.length === 0) {
      appendRows_(SH_MATCHES, initialMatchRows_());
      log.push('試合を18試合入れました');
    }

    // 集計:チームの行
    var sum = readTable_(SH_SUMMARY, true);
    if (sum.rows.length === 0) appendRows_(SH_SUMMARY, TEAMS.map(function (t) { return { 'チーム': t }; }));

    // 空の「シート1」を消す
    ['シート1', 'Sheet1'].forEach(function (n) {
      var s = ss.getSheetByName(n);
      if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
    });

    // 名簿ファイル
    var rosterId = PropertiesService.getScriptProperties().getProperty('ROSTER_SPREADSHEET_ID');
    if (!rosterId) {
      log.push('注意: スクリプト プロパティ ROSTER_SPREADSHEET_ID が未設定のため、名簿ファイルのシートは作っていません');
    } else {
      var rss = SpreadsheetApp.openById(rosterId);
      ROSTER_SHEETS.forEach(function (def) {
        if (ensureSheet_(rss, def[0], def[1])) log.push('名簿ファイルに作成: ' + def[0]);
      });
    }
    if (!PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD')) {
      log.push('注意: スクリプト プロパティ ADMIN_PASSWORD が未設定です(運営画面に入れません)');
    }
    invalidate_(appSheets_().map(function (d) { return d[0]; }));
    invalidateRoster_();
  });
  log.push('setup 完了');
  console.log(log.join('\n'));
  return log;
}

/** 18試合の最初の行 */
function initialMatchRows_() {
  return INITIAL_MATCHES.map(function (m) {
    return {
      '試合ID': m.id, '種目': m.sport, '回': m.round, 'チーム1': m.team1, 'チーム2': m.team2,
      '点数1': '', '点数2': '', '状態': MATCH_PLANNED,
      '予想の状態': m.sport === SPORT_VOLLEY ? '受付前' : 'なし', '関連試合': m.related
    };
  });
}

/** シートの見出し以外を空にする */
function clearBody_(sh) {
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, Math.max(1, sh.getLastColumn())).clearContent();
}

/**
 * 当日のデータを消して、始まる前の状態に戻す(テストのあと・本番の前に使う)。Apps Script のエディタから実行する。
 *
 * 消すもの:予想・予想公開・クイズ問題・クイズ回答・惜しい答え・お題カード・アンケート、
 *          参加者の来場時刻、名簿ファイルの「自己紹介」、キャッシュの目印(来場済み・公開済み・送信済みなど)
 * 最初に戻すもの:試合(18試合・点数なし)、状態(モード=待ち)、集計
 * 残すもの:参加者とチーム分け、設定、名簿ファイルのフォームの回答と「当日追加」
 */
function resetEventData() {
  requireEditor_();
  var log = [];
  withLock_(function () {
    [SH_PREDICTIONS, '予想公開', SH_QUIZ_Q, SH_QUIZ_A, SH_NEAR, SH_ODAI, SH_SURVEY].forEach(function (name) {
      clearBody_(sheet_(name));
    });
    log.push('予想・クイズ・惜しい答え・お題カード・アンケートを消しました');

    clearBody_(sheet_(SH_MATCHES));
    appendRows_(SH_MATCHES, initialMatchRows_());
    clearBody_(sheet_(SH_STATE));
    appendRows_(SH_STATE, INITIAL_STATE.map(function (r) { return { 'キー': r[0], '値': r[1] }; }));
    log.push('試合と状態を最初に戻しました(モード=待ち)');

    var parts = readTable_(SH_PARTICIPANTS, true);
    var col = headerIndex_(parts.headers, '来場時刻') + 1;
    var psh = sheet_(SH_PARTICIPANTS);
    if (psh.getLastRow() > 1) psh.getRange(2, col, psh.getLastRow() - 1, 1).clearContent();
    log.push('来場時刻を消しました(参加者 ' + parts.rows.length + '人とチーム分けは残しています)');

    clearBody_(rosterSheet_(rosterSs_(), ROSTER_INTRO_SHEET));
    log.push('名簿ファイルの「自己紹介」を消しました');

    invalidate_(appSheets_().map(function (d) { return d[0]; }));
    invalidateRoster_();
    refreshSummary_();
  });
  // キャッシュの世代を進めて、目印をまとめて無効にする
  PropertiesService.getScriptProperties().setProperty('CACHE_EPOCH', String(Date.now()));
  cacheEpochMemo_ = null;
  log.push('キャッシュの目印を無効にしました');
  log.push('リセット完了');
  console.log(log.join('\n'));
  return log;
}

/** エディタから名簿を読み込む(運営画面の「名簿を読み込む」と同じ) */
function importRosterFromEditor() {
  requireEditor_();
  var r = importRoster_(false);
  console.log(JSON.stringify(r, null, 2));
  return r;
}
