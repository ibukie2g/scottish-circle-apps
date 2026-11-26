/**
 * データの形(docs/データ設計.md)と、管理ファイル・グループのファイル・名簿の読み書き
 */

// ---- シートと見出し(列の順番を変えない) ----
var IDX_GROUPS = 'グループ';
var IDX_GROUPS_H = ['グループID', '名前', '種類', '合言葉', 'ファイルID', 'キャラクター', '状態', '作成日'];
var IDX_EVENTS = 'イベントの控え';
var IDX_EVENTS_H = ['イベントID', 'グループID', '名前', '状態', '締め切り', '決まった日', '回答数', '更新時刻'];

var G_MEMBERS = 'メンバー';
var G_MEMBERS_H = ['メンバーID', '名簿の参加者ID', '表示名', '状態', '登録日'];
var G_EVENTS = 'イベント';
var G_EVENTS_H = ['イベントID', '名前', '説明', '状態', '結果の見せ方', '締め切り', '決まった候補日ID', 'コース', '作成日', '場所', 'お金の目安', 'リンク'];
var G_CANDS = '候補日';
var G_CANDS_H = ['候補日ID', 'イベントID', '日付', '時刻', 'メモ'];
var G_ANSWERS = '回答';
var G_ANSWERS_H = ['イベントID', 'メンバーID', '答え', 'ひとこと', '更新時刻'];
var G_ATTEND = '出欠';
var G_ATTEND_H = ['イベントID', 'メンバーID', '出欠', 'コース', 'ひとこと', '会費', '更新時刻', '来られる時間'];
var G_WANTED = '来てほしい人';
var G_WANTED_H = ['イベントID', 'メンバーID'];
var GROUP_SHEETS = [[G_MEMBERS, G_MEMBERS_H], [G_EVENTS, G_EVENTS_H], [G_CANDS, G_CANDS_H], [G_ANSWERS, G_ANSWERS_H],
  [G_ATTEND, G_ATTEND_H], [G_WANTED, G_WANTED_H]];

var R_FORM = 'フォームの回答 1';
var R_SELF = '出欠アプリ登録';
var R_SELF_H = ['参加者ID', 'フルネーム', 'ふりがな', '学年', '男女', '登録日'];

var KIND_CIRCLE = 'サークル';
var KIND_GROUP = 'グループ';
var KIND_ONCE = '1回きり';
var EV_POLL = '日程調整中';
var EV_RSVP = '出欠確認中';
var EV_DONE = '終了';
var VIS = ['名前', '人数', '伊吹だけ'];

function indexId_() { return prop_('INDEX_SPREADSHEET_ID', true); }

// ---- 管理ファイル ----

function readGroups_(fresh) {
  return readTable_(indexId_(), IDX_GROUPS, fresh).rows.map(function (r) {
    return { id: toStr_(r['グループID']), name: toStr_(r['名前']), kind: toStr_(r['種類']), token: toStr_(r['合言葉']),
      fileId: toStr_(r['ファイルID']), mascot: toStr_(r['キャラクター']) !== '出さない', active: toStr_(r['状態']) !== 'しまう',
      createdAt: toStr_(r['作成日']), _row: r._row };
  });
}
function groupByToken_(token) {
  var t = toStr_(token);
  var g = t ? readGroups_().filter(function (x) { return x.token === t; })[0] : null;
  if (!g) throw appError_('NOT_FOUND', 'リンクが正しくないか、終わったグループです');
  return g;
}
function groupById_(id) {
  var g = readGroups_().filter(function (x) { return x.id === id; })[0];
  if (!g) throw appError_('NOT_FOUND', 'グループが見つかりません');
  return g;
}

/** イベントの控えを書き直す(なければ足す) */
function syncEventIndex_(group, ev, answeredCount) {
  var t = readTable_(indexId_(), IDX_EVENTS, true);
  var row = t.rows.filter(function (r) { return toStr_(r['イベントID']) === ev.id; })[0];
  var decided = '';
  if (ev.decidedId) {
    var c = readCandidates_(group, ev.id).filter(function (x) { return x.id === ev.decidedId; })[0];
    if (c) decided = c.date + (c.time ? ' ' + c.time : '');
  }
  var obj = { 'イベントID': ev.id, 'グループID': group.id, '名前': ev.name, '状態': ev.status, '締め切り': ev.deadline,
    '決まった日': decided, '更新時刻': Date.now() };
  if (answeredCount !== undefined) obj['回答数'] = answeredCount;
  if (row) updateRow_(indexId_(), IDX_EVENTS, row._row, obj);
  else appendRows_(indexId_(), IDX_EVENTS, IDX_EVENTS_H, [obj]);
}

// ---- グループのファイル ----

function readMembersRaw_(group, fresh) {
  return readTable_(group.fileId, G_MEMBERS, fresh).rows.map(function (r) {
    return { memberId: toStr_(r['メンバーID']), rosterId: toStr_(r['名簿の参加者ID']), displayName: toStr_(r['表示名']),
      active: toStr_(r['状態']) !== '抜けた', _row: r._row };
  });
}

/** メンバー(名前つき)。サークルは名簿から名前・ふりがな・学年・男女を引く */
function readMembers_(group, fresh) {
  var raw = readMembersRaw_(group, fresh);
  if (group.kind !== KIND_CIRCLE) {
    return raw.map(function (m) { return { memberId: m.memberId, name: m.displayName, active: m.active }; });
  }
  var roster = readRoster_(fresh);
  return raw.map(function (m) {
    var p = roster[m.rosterId] || {};
    return { memberId: m.memberId, rosterId: m.rosterId, name: p.name || m.rosterId, kana: p.kana || '', grade: p.grade || '',
      gender: p.gender || '', active: m.active && !!roster[m.rosterId] };
  });
}

function readEvents_(group, fresh) {
  return readTable_(group.fileId, G_EVENTS, fresh).rows.map(function (r) {
    return { id: toStr_(r['イベントID']), name: toStr_(r['名前']), description: toStr_(r['説明']), status: toStr_(r['状態']) || EV_POLL,
      visibility: VIS.indexOf(toStr_(r['結果の見せ方'])) >= 0 ? toStr_(r['結果の見せ方']) : '名前',
      deadline: toStr_(r['締め切り']).slice(0, 10), decidedId: toStr_(r['決まった候補日ID']), createdAt: toStr_(r['作成日']),
      place: toStr_(r['場所']), cost: toStr_(r['お金の目安']), url: toStr_(r['リンク']), _row: r._row };
  });
}
function eventById_(group, eventId, fresh) {
  var ev = readEvents_(group, fresh).filter(function (e) { return e.id === toStr_(eventId); })[0];
  if (!ev) throw appError_('NOT_FOUND', 'イベントが見つかりません');
  return ev;
}
function readCandidates_(group, eventId, fresh) {
  return readTable_(group.fileId, G_CANDS, fresh).rows
    .filter(function (r) { return toStr_(r['イベントID']) === eventId; })
    .map(function (r) {
      return { id: toStr_(r['候補日ID']), date: toStr_(r['日付']).slice(0, 10), time: toStr_(r['時刻']), memo: toStr_(r['メモ']), _row: r._row };
    });
}
function readAnswers_(group, eventId, fresh) {
  return readTable_(group.fileId, G_ANSWERS, fresh).rows
    .filter(function (r) { return toStr_(r['イベントID']) === eventId; })
    .map(function (r) {
      return { memberId: toStr_(r['メンバーID']), answers: toStr_(r['答え']), comment: toStr_(r['ひとこと']), updatedAt: toNum_(r['更新時刻']), _row: r._row };
    });
}
function readAttendance_(group, eventId, fresh) {
  return readTable_(group.fileId, G_ATTEND, fresh).rows
    .filter(function (r) { return toStr_(r['イベントID']) === eventId; })
    .map(function (r) {
      return { memberId: toStr_(r['メンバーID']), status: toStr_(r['出欠']), comment: toStr_(r['ひとこと']),
        arriveAt: toStr_(r['来られる時間']), updatedAt: toNum_(r['更新時刻']), _row: r._row };
    });
}
function readWanted_(group, eventId, fresh) {
  return readTable_(group.fileId, G_WANTED, fresh).rows
    .filter(function (r) { return toStr_(r['イベントID']) === eventId; })
    .map(function (r) { return { memberId: toStr_(r['メンバーID']), _row: r._row }; });
}

// ---- 名簿(サークルだけ) ----

/** 参加者ID → { name, kana, grade, gender }。10分キャッシュ */
function readRoster_(fresh) {
  var id = prop_('ROSTER_SPREADSHEET_ID', false);
  if (!id) return {};
  var key = 'roster:v1:' + id;
  if (!fresh) {
    var c = cacheGetJson_(key);
    if (c) return c;
  }
  var out = {};
  var form = readTable_(id, R_FORM, true);
  var col = function (r, names) { for (var i = 0; i < names.length; i++) if (r[names[i]] !== undefined) return toStr_(r[names[i]]); return ''; };
  form.rows.forEach(function (r) {
    var pid = col(r, ['参加者ID']);
    if (!pid) return;
    out[pid] = { name: col(r, ['フルネーム(漢字)', 'フルネーム']), kana: col(r, ['フルネーム(ひらがな)', 'ふりがな']),
      grade: col(r, ['学年']), gender: col(r, ['性別']) };
  });
  var self = ss_(id).getSheetByName(R_SELF) ? readTable_(id, R_SELF, true).rows : [];
  self.forEach(function (r) {
    var pid = toStr_(r['参加者ID']);
    if (pid) out[pid] = { name: toStr_(r['フルネーム']), kana: toStr_(r['ふりがな']), grade: toStr_(r['学年']), gender: toStr_(r['男女']) };
  });
  cachePutJson_(key, out, 600);
  return out;
}
function invalidateRoster_() {
  var id = prop_('ROSTER_SPREADSHEET_ID', false);
  if (id) cacheRemove_(['roster:v1:' + id]);
}
