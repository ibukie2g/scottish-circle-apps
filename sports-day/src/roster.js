/**
 * 名簿ファイル(Googleフォームの回答スプレッドシート)の読み書き(GAS専用)
 *
 * 個人情報(名前・出身地・自己紹介・当日追加の人)は名簿ファイルにだけ置く。
 * アプリ用スプレッドシートには参加者IDとチームだけを書く。
 * フォームの回答シートは読むだけ(例外:「参加者ID」列の採番だけ書く)。
 */

var ROSTER_FORM_SHEET = 'フォームの回答 1';
var RH_NAME = 'フルネーム(漢字)';
var RH_KANA = 'フルネーム(ひらがな)';
var RH_ORIGIN = '出身地(都道府県)';
var RH_TEAM = 'チーム';
var RH_ID = '参加者ID';

var INTRO_SPORTS = ['バスケ', 'バレー', 'バドミントン', 'その他', '特になし'];
var INTRO_SNS = ['顔OK', '顔を隠せばOK', '載せない'];
var INTRO_COMMENT_MAX = 20;
var INTRO_NICKNAME_MAX = 20;

/** 見出しの比較用(全角半角・空白の違いを無視) */
function normHeader_(s) {
  return toStr_(s).normalize('NFKC').replace(/\s/g, '');
}

function findCol_(headers, name) {
  var target = normHeader_(name);
  for (var i = 0; i < headers.length; i++) if (normHeader_(headers[i]) === target) return i;
  return -1;
}

function rosterSs_() {
  var id = PropertiesService.getScriptProperties().getProperty('ROSTER_SPREADSHEET_ID');
  if (!id) throw appError_('SETUP', 'スクリプト プロパティ ROSTER_SPREADSHEET_ID が設定されていません');
  return SpreadsheetApp.openById(id);
}

function rosterFormSheet_(ss) {
  var sh = ss.getSheetByName(ROSTER_FORM_SHEET);
  if (sh) return sh;
  var target = normHeader_(ROSTER_FORM_SHEET);
  var found = ss.getSheets().filter(function (s) { return normHeader_(s.getName()) === target; });
  if (found.length) return found[0];
  throw appError_('SETUP', '名簿ファイルにシート「' + ROSTER_FORM_SHEET + '」がありません');
}

function rosterSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw appError_('SETUP', '名簿ファイルにシート「' + name + '」がありません。setup を実行してください');
  return sh;
}

function invalidateRoster_() {
  cache_().removeAll(['roster:v1', 'intros:v1']);
}

/**
 * 名簿の人(参加者IDがある人だけ)を読む。10秒キャッシュ
 * @return {Object<string, {id, name, kana, origin, team, walkIn}>} team は名簿上のチーム(参考)
 */
function readPeople_(fresh) {
  if (!fresh) {
    var c = cacheGetJson_('roster:v1');
    if (c) return c;
  }
  var ss = rosterSs_();
  var people = {};
  var values = rosterFormSheet_(ss).getDataRange().getValues();
  var h = values[0] || [];
  var ci = {
    id: findCol_(h, RH_ID), name: findCol_(h, RH_NAME), kana: findCol_(h, RH_KANA),
    origin: findCol_(h, RH_ORIGIN), team: findCol_(h, RH_TEAM)
  };
  if (ci.id >= 0) {
    for (var i = 1; i < values.length; i++) {
      var id = toStr_(values[i][ci.id]);
      if (!id) continue;
      people[id] = {
        id: id,
        name: ci.name >= 0 ? toStr_(values[i][ci.name]) : '',
        kana: ci.kana >= 0 ? toStr_(values[i][ci.kana]) : '',
        origin: ci.origin >= 0 ? toStr_(values[i][ci.origin]) : '',
        team: ci.team >= 0 ? normTeam_(values[i][ci.team]) : '',
        walkIn: false
      };
    }
  }
  var wsh = ss.getSheetByName(ROSTER_WALKIN_SHEET);
  if (wsh) {
    var wv = wsh.getDataRange().getValues();
    var wh = wv[0] || [];
    var wi = {
      id: findCol_(wh, RH_ID), name: findCol_(wh, RH_NAME), kana: findCol_(wh, RH_KANA),
      origin: findCol_(wh, RH_ORIGIN), team: findCol_(wh, RH_TEAM)
    };
    for (var j = 1; j < wv.length; j++) {
      var wid = wi.id >= 0 ? toStr_(wv[j][wi.id]) : '';
      if (!wid) continue;
      people[wid] = {
        id: wid,
        name: wi.name >= 0 ? toStr_(wv[j][wi.name]) : '',
        kana: wi.kana >= 0 ? toStr_(wv[j][wi.kana]) : '',
        origin: wi.origin >= 0 ? toStr_(wv[j][wi.origin]) : '',
        team: wi.team >= 0 ? normTeam_(wv[j][wi.team]) : '',
        walkIn: true
      };
    }
  }
  cachePutJson_('roster:v1', people);
  return people;
}

/** 自己紹介を読む。{ 参加者ID: {sport, comment, nickname, snsConsent, updatedAt} } */
function readIntros_(fresh) {
  if (!fresh) {
    var c = cacheGetJson_('intros:v1');
    if (c) return c;
  }
  var sh = rosterSs_().getSheetByName(ROSTER_INTRO_SHEET);
  var out = {};
  if (sh) {
    var v = sh.getDataRange().getValues();
    var h = v[0] || [];
    var c2 = {
      id: findCol_(h, '参加者ID'), sport: findCol_(h, 'やっていたスポーツ'), comment: findCol_(h, 'ひとこと(20字)'),
      nick: findCol_(h, 'あだ名(任意)'), sns: findCol_(h, '写真のSNS掲載'), at: findCol_(h, '更新時刻')
    };
    for (var i = 1; i < v.length; i++) {
      var id = c2.id >= 0 ? toStr_(v[i][c2.id]) : '';
      if (!id) continue;
      out[id] = {
        sport: c2.sport >= 0 ? toStr_(v[i][c2.sport]) : '',
        comment: c2.comment >= 0 ? toStr_(v[i][c2.comment]) : '',
        nickname: c2.nick >= 0 ? toStr_(v[i][c2.nick]) : '',
        snsConsent: c2.sns >= 0 ? toStr_(v[i][c2.sns]) : '',
        updatedAt: c2.at >= 0 ? fmtTime_(toMs_(v[i][c2.at])) : '',
        _row: i + 1
      };
    }
  }
  cachePutJson_('intros:v1', out);
  return out;
}

/**
 * 自己紹介を保存する(上書き)。ロックなしで、その人専用の行(参加者シートと同じ行番号)に書く。
 * 30人が同時に保存しても行がぶつからない(writeSlotRow_)
 */
function writeIntro_(id, intro) {
  var sh = rosterSheet_(rosterSs_(), ROSTER_INTRO_SHEET);
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (findCol_(h, '参加者ID') < 0) throw appError_('SETUP', '名簿ファイルの「自己紹介」シートに「参加者ID」列がありません');
  var put = {
    '参加者ID': id,
    'やっていたスポーツ': intro.sport,
    'ひとこと(20字)': intro.comment,
    'あだ名(任意)': intro.nickname,
    '写真のSNS掲載': intro.snsConsent,
    '更新時刻': new Date()
  };
  var obj = {};
  h.forEach(function (name) {
    Object.keys(put).forEach(function (k) { if (normHeader_(name) === normHeader_(k)) obj[toStr_(name)] = put[k]; });
  });
  var keys = {};
  keys[toStr_(h[findCol_(h, '参加者ID')])] = id; // その行の持ち主
  writeSlotRow_(sh, slotRow_(requireParticipant_(id)), keys, obj);
  cache_().remove('intros:v1');
}

/** 次の参加者ID(P01, P02, ...)の番号 */
function nextIdNumber_(ids) {
  var max = 0;
  ids.forEach(function (id) {
    var m = String(id).match(/^P(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max + 1;
}

function formatId_(n) {
  return 'P' + (n < 10 ? '0' + n : String(n));
}

/**
 * 名簿を読み込む(ロックをとる)
 * - 名簿の「チーム」列が A〜D の人に参加者IDを採番(名簿の「参加者ID」列。無ければ右端に足す)
 * - アプリ用「参加者」シートに ID・チームを追加
 * - すでに参加者シートにいる人のチームは、overwriteTeams=true のときだけ名簿の値で上書き(当日の変更を消さないため)
 */
function importRoster_(overwriteTeams) {
  return withLock_(function () {
    var ss = rosterSs_();
    var sh = rosterFormSheet_(ss);
    var values = sh.getDataRange().getValues();
    var h = values[0] || [];
    var teamCol = findCol_(h, RH_TEAM);
    if (teamCol < 0) throw appError_('SETUP', '名簿に「チーム」列がありません。右端に「チーム」列を足して A〜D を書いてください');
    var idCol = findCol_(h, RH_ID);
    if (idCol < 0) {
      idCol = sh.getLastColumn();
      sh.getRange(1, idCol + 1).setValue(RH_ID);
      values.forEach(function (row) { row.push(''); });
    }

    var parts = readTable_(SH_PARTICIPANTS, true);
    var existingIds = values.slice(1).map(function (r) { return toStr_(r[idCol]); });
    var walkIns = readPeople_(true);
    var allIds = existingIds.concat(Object.keys(walkIns)).concat(parts.rows.map(function (r) { return toStr_(r['参加者ID']); }));
    var next = nextIdNumber_(allIds);

    var assigned = 0;
    var idValues = [];
    var roster = [];
    for (var i = 1; i < values.length; i++) {
      var id = toStr_(values[i][idCol]);
      var team = normTeam_(values[i][teamCol]);
      if (team && !id) {
        id = formatId_(next++);
        assigned++;
      }
      idValues.push([id]);
      if (team && id) roster.push({ id: id, team: team });
    }
    if (assigned && idValues.length) sh.getRange(2, idCol + 1, idValues.length, 1).setValues(idValues);

    var byId = {};
    parts.rows.forEach(function (r) { byId[toStr_(r['参加者ID'])] = r; });
    var adds = [];
    var teamDiffs = [];
    var updated = 0;
    roster.forEach(function (p) {
      var cur = byId[p.id];
      if (!cur) {
        adds.push({ '参加者ID': p.id, 'チーム': p.team, '来場時刻': '', '当日追加': false, 'クイズに含める': true });
      } else if (normTeam_(cur['チーム']) !== p.team) {
        if (overwriteTeams) {
          updateRow_(SH_PARTICIPANTS, cur._row, { 'チーム': p.team });
          updated++;
        } else {
          teamDiffs.push({ id: p.id, appTeam: normTeam_(cur['チーム']), rosterTeam: p.team });
        }
      }
    });
    appendRows_(SH_PARTICIPANTS, adds);
    invalidate_([SH_PARTICIPANTS]);
    invalidateRoster_();
    return {
      assignedIds: assigned,
      added: adds.length,
      teamUpdated: updated,
      teamDiffs: teamDiffs,
      totalWithTeam: roster.length
    };
  });
}

/** 当日追加(ロックをとる)。名簿ファイルの「当日追加」に名前などを書き、参加者シートに ID・チームを足す */
function addWalkIn_(input) {
  var name = toStr_(input && input.name);
  var kana = toStr_(input && input.kana);
  var team = normTeam_(input && input.team);
  var origin = toStr_(input && input.origin);
  if (!name || !kana) throw appError_('INVALID', '名前(漢字)とひらがなを入れてください');
  if (!team) throw appError_('INVALID', 'チームは A〜D で入れてください');
  if (origin && !normalizePrefecture(origin)) throw appError_('INVALID', '出身地は都道府県名で入れてください(空欄も可)');
  return withLock_(function () {
    var ss = rosterSs_();
    var wsh = rosterSheet_(ss, ROSTER_WALKIN_SHEET);
    var people = readPeople_(true);
    var parts = readTable_(SH_PARTICIPANTS, true);
    var formIds = [];
    var fv = rosterFormSheet_(ss).getDataRange().getValues();
    var fIdCol = findCol_(fv[0] || [], RH_ID);
    if (fIdCol >= 0) for (var i = 1; i < fv.length; i++) formIds.push(toStr_(fv[i][fIdCol]));
    var id = formatId_(nextIdNumber_(Object.keys(people).concat(formIds)
      .concat(parts.rows.map(function (r) { return toStr_(r['参加者ID']); }))));
    var h = wsh.getRange(1, 1, 1, wsh.getLastColumn()).getValues()[0];
    var row = h.map(function (x) {
      var n = normHeader_(x);
      if (n === normHeader_(RH_ID)) return id;
      if (n === normHeader_(RH_NAME)) return name;
      if (n === normHeader_(RH_KANA)) return kana;
      if (n === normHeader_(RH_TEAM)) return team;
      if (n === normHeader_(RH_ORIGIN)) return origin ? normalizePrefecture(origin) : '';
      if (n === normHeader_('追加時刻')) return new Date();
      return '';
    });
    wsh.getRange(wsh.getLastRow() + 1, 1, 1, row.length).setValues([row.map(cellSafe_)]);
    appendRows_(SH_PARTICIPANTS, [{
      '参加者ID': id, 'チーム': team, '来場時刻': new Date(), '当日追加': true, 'クイズに含める': true
    }]);
    invalidate_([SH_PARTICIPANTS]);
    invalidateRoster_();
    return { id: id, team: team };
  });
}
