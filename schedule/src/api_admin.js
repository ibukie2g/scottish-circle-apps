/**
 * 運営(伊吹)の画面から呼ぶ関数(docs/API.md の「2. 運営」)。すべて adminLogin でもらうトークンが必要
 */

var ADMIN_TTL_SEC = 6 * 3600;

function adminLogin(password) {
  return api_(function () {
    var pw = prop_('ADMIN_PASSWORD', true);
    if (String(password || '') !== pw) throw appError_('AUTH', 'パスワードが違います');
    var t = randomToken_() + randomToken_();
    CacheService.getScriptCache().put('admin:' + t, '1', ADMIN_TTL_SEC);
    return { token: t };
  });
}
function requireAdmin_(token) {
  if (!token || !CacheService.getScriptCache().get('admin:' + token)) throw appError_('AUTH', 'もう一度ログインしてください');
}

function baseUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}
function groupLink_(g) { return baseUrl_() + '?g=' + g.token; }
function eventLink_(g, ev) { return baseUrl_() + '?g=' + g.token + (g.kind === KIND_ONCE ? '' : '&e=' + encodeURIComponent(ev.id)); }

/** グループとイベントの一覧 */
function adminListGroups(token) {
  return api_(function () {
    requireAdmin_(token);
    var today = todayYmd_();
    return {
      groups: readGroups_().filter(function (g) { return g.active; }).map(function (g) {
        var members = readMembers_(g).filter(function (m) { return m.active; });
        return {
          id: g.id, name: g.name, kind: g.kind, mascot: g.mascot, link: groupLink_(g), memberCount: members.length,
          events: readEvents_(g).map(function (ev) {
            var cands = readCandidates_(g, ev.id);
            var answered = ev.status === EV_RSVP
              ? readAttendance_(g, ev.id).filter(function (r) { return r.status; }).length
              : readAnswers_(g, ev.id).filter(function (r) { return Object.keys(parseAnswers(r.answers)).length; }).length;
            return { id: ev.id, name: ev.name, status: ev.status, deadline: ev.deadline, answered: answered,
              archived: isArchived(ev, cands, today), link: eventLink_(g, ev) };
          })
        };
      })
    };
  });
}

/** グループを作る(グループのファイルを自動で作る)。input = { name, kind, mascot } */
function adminCreateGroup(token, input) {
  return api_(function () {
    requireAdmin_(token);
    var g = createGroup_(input || {});
    return { groupId: g.id, link: groupLink_(g) };
  });
}

function createGroup_(inp) {
  var name = normalizeName(inp.name);
  if (!name) throw appError_('INVALID', 'グループの名前を入れてください');
  var kind = [KIND_CIRCLE, KIND_GROUP, KIND_ONCE].indexOf(inp.kind) >= 0 ? inp.kind : KIND_GROUP;
  return withLock_(function () {
    var groups = readGroups_(true);
    var id = nextId('G', groups.map(function (g) { return g.id; }), 3);
    var fileId = createGroupFile_(id + ' ' + name);
    var g = { id: id, name: name, kind: kind, token: randomToken_(), fileId: fileId, mascot: inp.mascot !== false, active: true };
    appendRows_(indexId_(), IDX_GROUPS, IDX_GROUPS_H, [{ 'グループID': id, '名前': name, '種類': kind, '合言葉': g.token,
      'ファイルID': fileId, 'キャラクター': g.mascot ? '出す' : '出さない', '状態': '使う', '作成日': todayYmd_() }]);
    if (kind === KIND_CIRCLE) syncRosterMembers_(g);
    return g;
  });
}

/** グループのファイルを作り、出欠アプリのフォルダに入れ、シートを用意する */
function createGroupFile_(title) {
  var ss = SpreadsheetApp.create('出欠アプリ ' + title);
  var id = ss.getId();
  var folderId = prop_('FOLDER_ID', false);
  if (folderId) {
    try { DriveApp.getFileById(id).moveTo(DriveApp.getFolderById(folderId)); } catch (e) { /* フォルダに入れられなくてもファイルは使える */ }
  }
  var first = ss.getSheets()[0];
  GROUP_SHEETS.forEach(function (pair, i) {
    var sh = i === 0 && first ? first : ss.insertSheet(pair[0]);
    if (i === 0 && first) sh.setName(pair[0]);
    sh.getRange(1, 1, 1, pair[1].length).setValues([pair[1]]);
    sh.setFrozenRows(1);
  });
  ssMemo_[id] = ss;
  return id;
}

/** サークル:名簿にいてメンバーにいない人を足す */
function syncRosterMembers_(g) {
  var roster = readRoster_(true);
  var raw = readMembersRaw_(g, true);
  var have = {};
  raw.forEach(function (m) { have[m.rosterId] = true; });
  var ids = raw.map(function (m) { return m.memberId; });
  var adds = [];
  Object.keys(roster).sort().forEach(function (pid) {
    if (have[pid]) return;
    var mid = nextId('M', ids, 3);
    ids.push(mid);
    adds.push({ 'メンバーID': mid, '名簿の参加者ID': pid, '表示名': '', '状態': 'いる', '登録日': todayYmd_() });
  });
  appendRows_(g.fileId, G_MEMBERS, G_MEMBERS_H, adds);
  return adds.length;
}

function adminSyncRoster(token, groupId) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    if (g.kind !== KIND_CIRCLE) throw appError_('INVALID', 'サークルのグループだけです');
    return withLock_(function () { return { added: syncRosterMembers_(g) }; });
  });
}

/** グループの中身(メンバーとイベント)。来てほしい人を選ぶときなど */
function adminGetGroup(token, groupId) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    var members = readMembers_(g).filter(function (m) { return m.active; });
    if (g.kind === KIND_CIRCLE) members.sort(function (a, b) { return (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'); });
    return {
      group: { id: g.id, name: g.name, kind: g.kind, mascot: g.mascot, link: groupLink_(g) },
      members: members.map(function (m) { return { memberId: m.memberId, name: m.name, grade: m.grade || '', gender: m.gender || '' }; }),
      events: readEvents_(g).map(function (ev) { return eventForAdmin_(g, ev); })
    };
  });
}

function eventForAdmin_(g, ev) {
  return { id: ev.id, name: ev.name, description: ev.description, place: ev.place, cost: ev.cost, url: ev.url,
    status: ev.status, visibility: ev.visibility, deadline: ev.deadline, decidedId: ev.decidedId, link: eventLink_(g, ev),
    candidates: sortCandidates(readCandidates_(g, ev.id)).map(function (c) { return { id: c.id, date: c.date, time: c.time, memo: c.memo }; }) };
}

/** 入力を整える(イベントの名前・説明など) */
function eventFields_(inp, forCreate) {
  var o = {};
  if (forCreate || 'name' in inp) {
    o['名前'] = normalizeName(inp.name);
    if (!o['名前']) throw appError_('INVALID', 'イベントの名前を入れてください');
  }
  if ('description' in inp) o['説明'] = String(inp.description || '').trim().slice(0, 300);
  if ('place' in inp) o['場所'] = normalizeName(inp.place).slice(0, 60);
  if ('cost' in inp) o['お金の目安'] = normalizeName(inp.cost).slice(0, 40);
  if ('url' in inp) {
    var u = String(inp.url || '').trim();
    if (u && !/^https?:\/\//.test(u)) throw appError_('INVALID', 'リンクは http から始まるものを入れてください');
    o['リンク'] = u;
  }
  if ('deadline' in inp) {
    var d = String(inp.deadline || '').trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw appError_('INVALID', '締め切りの日付がおかしいです');
    o['締め切り'] = d;
  }
  if ('visibility' in inp) o['結果の見せ方'] = VIS.indexOf(inp.visibility) >= 0 ? inp.visibility : '名前';
  return o;
}

function cleanCandidates_(list) {
  return (list || []).map(function (c) {
    var date = String(c.date || '').trim(), time = String(c.time || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw appError_('INVALID', '候補日の日付がおかしいです');
    if (time && !/^\d{1,2}:\d{2}$/.test(time)) throw appError_('INVALID', '時刻は 19:00 の形で入れてください');
    return { date: date, time: time, memo: normalizeName(c.memo).slice(0, 40) };
  });
}

/**
 * イベントを作る。groupId が空で input.once が true なら、1回きりのグループごと作る
 * input = { name, description, place, cost, url, visibility, deadline, candidates: [{ date, time, memo }] }
 */
function adminCreateEvent(token, groupId, input) {
  return api_(function () {
    requireAdmin_(token);
    var inp = input || {};
    var fields = eventFields_(inp, true);
    var cands = cleanCandidates_(inp.candidates);
    if (!cands.length) throw appError_('INVALID', '候補日を1つ以上選んでください');
    var g = groupId ? groupById_(groupId) : createGroup_({ name: fields['名前'], kind: KIND_ONCE, mascot: inp.mascot });
    return withLock_(function () {
      var evs = readEvents_(g, true);
      var id = nextId(g.id + '-E', evs.map(function (e) { return e.id; }), 2);
      var row = Object.assign({ 'イベントID': id, '状態': EV_POLL, '結果の見せ方': '名前', '作成日': todayYmd_() }, fields);
      appendRows_(g.fileId, G_EVENTS, G_EVENTS_H, [row]);
      addCandidates_(g, id, cands);
      var ev = eventById_(g, id, true);
      syncEventIndex_(g, ev, 0);
      return { groupId: g.id, eventId: id, link: eventLink_(g, ev) };
    });
  });
}

function addCandidates_(g, eventId, cands) {
  var have = readCandidates_(g, eventId, true);
  var ids = have.map(function (c) { return c.id; });
  var key = {};
  have.forEach(function (c) { key[c.date + ' ' + c.time] = true; });
  var adds = [];
  cands.forEach(function (c) {
    if (key[c.date + ' ' + c.time]) return; // 同じ日時は足さない
    key[c.date + ' ' + c.time] = true;
    var id = nextId('C', ids, 2);
    ids.push(id);
    adds.push({ '候補日ID': id, 'イベントID': eventId, '日付': c.date, '時刻': c.time, 'メモ': c.memo });
  });
  appendRows_(g.fileId, G_CANDS, G_CANDS_H, adds);
}

function adminAddCandidates(token, groupId, eventId, candidates) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    var cands = cleanCandidates_(candidates);
    return withLock_(function () {
      eventById_(g, eventId, true);
      addCandidates_(g, eventId, cands);
      return eventForAdmin_(g, eventById_(g, eventId, true));
    });
  });
}

/** 候補日を消す(その候補日への答えは、次に保存されたときに消える。集計には出なくなる) */
function adminRemoveCandidate(token, groupId, eventId, candidateId) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    return withLock_(function () {
      var ev = eventById_(g, eventId, true);
      if (ev.decidedId === candidateId) throw appError_('INVALID', '決まった日は消せません。先に「決めた日を取り消す」をしてください');
      var rows = readCandidates_(g, eventId, true).filter(function (c) { return c.id === candidateId; }).map(function (c) { return c._row; });
      deleteRows_(g.fileId, G_CANDS, rows);
      return eventForAdmin_(g, eventById_(g, eventId, true));
    });
  });
}

function adminUpdateEvent(token, groupId, eventId, patch) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    var fields = eventFields_(patch || {}, false);
    return withLock_(function () {
      var ev = eventById_(g, eventId, true);
      updateRow_(g.fileId, G_EVENTS, ev._row, fields);
      ev = eventById_(g, eventId, true);
      syncEventIndex_(g, ev);
      return eventForAdmin_(g, ev);
    });
  });
}

/** 結果を全部見る。filter = { grade, gender }(サークルだけ) */
function adminGetResults(token, groupId, eventId, filter) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    var ev = eventById_(g, eventId);
    var all = readMembers_(g);
    var members = g.kind === KIND_CIRCLE ? filterMembers(all, filter || {}) : all.filter(function (m) { return m.active; });
    var cands = readCandidates_(g, ev.id);
    var answers = readAnswers_(g, ev.id);
    var wanted = readWanted_(g, ev.id).map(function (w) { return w.memberId; });
    var s = summarize(cands, answers, members, { wanted: wanted, withNames: true });
    var un = unanswered(members, answers);
    var byMember = {};
    answers.forEach(function (r) { byMember[r.memberId] = r; });
    var att = null;
    if (ev.status === EV_RSVP || ev.status === EV_DONE) {
      var rows = readAttendance_(g, ev.id);
      var rmap = {};
      rows.forEach(function (r) { rmap[r.memberId] = r; });
      att = {
        totals: summarizeAttendance(rows, members, true),
        rows: members.filter(function (m) { return m.active; }).map(function (m) {
          var r = rmap[m.memberId] || {};
          return { memberId: m.memberId, name: m.name, status: r.status || '', arriveAt: r.arriveAt || '', comment: r.comment || '' };
        }),
        unanswered: members.filter(function (m) { return m.active && !(rmap[m.memberId] && rmap[m.memberId].status); }).map(function (m) { return m.name; })
      };
    }
    return {
      event: eventForAdmin_(g, ev),
      answeredCount: s.answeredCount, memberCount: members.filter(function (m) { return m.active; }).length,
      byDate: s.byDate,
      comments: members.filter(function (m) { return byMember[m.memberId] && byMember[m.memberId].comment; })
        .map(function (m) { return { name: m.name, comment: byMember[m.memberId].comment }; }),
      unanswered: un.map(function (m) { return { memberId: m.memberId, name: m.name }; }),
      wanted: wanted,
      shareText: shareText(ev, (function () { var c = cands.filter(function (x) { return x.id === ev.decidedId; })[0]; return ev.status === EV_RSVP && c ? { date: c.date, time: c.time } : null; })(), eventLink_(g, ev)),
      attendance: att,
      // 運営が代わりに入れるとき用:メンバーごとの答え
      answersByMember: members.filter(function (m) { return m.active; }).map(function (m) {
        return { memberId: m.memberId, name: m.name, answers: byMember[m.memberId] ? parseAnswers(byMember[m.memberId].answers) : {} };
      })
    };
  });
}

function adminSetWanted(token, groupId, eventId, memberIds) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    return withLock_(function () {
      eventById_(g, eventId, true);
      deleteRows_(g.fileId, G_WANTED, readWanted_(g, eventId, true).map(function (w) { return w._row; }));
      var ids = (memberIds || []).map(toStr_).filter(Boolean);
      appendRows_(g.fileId, G_WANTED, G_WANTED_H, ids.map(function (id) { return { 'イベントID': eventId, 'メンバーID': id }; }));
      return { wanted: ids };
    });
  });
}

/** 日にちを決めて「出欠確認中」にする。○→行く、×→行かない を仮に入れる(すでに出欠がある人はそのまま) */
function adminDecide(token, groupId, eventId, candidateId) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    return withLock_(function () {
      var ev = eventById_(g, eventId, true);
      var c = readCandidates_(g, eventId, true).filter(function (x) { return x.id === candidateId; })[0];
      if (!c) throw appError_('NOT_FOUND', '候補日が見つかりません');
      updateRow_(g.fileId, G_EVENTS, ev._row, { '状態': EV_RSVP, '決まった候補日ID': c.id });
      var have = {};
      readAttendance_(g, eventId, true).forEach(function (r) { have[r.memberId] = true; });
      var adds = [];
      readAnswers_(g, eventId, true).forEach(function (r) {
        if (have[r.memberId]) return;
        var st = presetAttendance(parseAnswers(r.answers), c.id);
        if (st) adds.push({ 'イベントID': eventId, 'メンバーID': r.memberId, '出欠': st, 'ひとこと': '', '更新時刻': Date.now(), '来られる時間': '' });
      });
      appendRows_(g.fileId, G_ATTEND, G_ATTEND_H, adds);
      ev = eventById_(g, eventId, true);
      syncEventIndex_(g, ev);
      return eventForAdmin_(g, ev);
    });
  });
}

/** 決めた日を取り消して、日程調整に戻す(出欠の答えは残す) */
function adminUndecide(token, groupId, eventId) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    return withLock_(function () {
      var ev = eventById_(g, eventId, true);
      updateRow_(g.fileId, G_EVENTS, ev._row, { '状態': EV_POLL, '決まった候補日ID': '' });
      ev = eventById_(g, eventId, true);
      syncEventIndex_(g, ev);
      return eventForAdmin_(g, ev);
    });
  });
}

/** 運営が代わりに入れる(LINEで答えが来た人など。締め切り後も入れられる) */
function adminSetAnswer(token, groupId, eventId, memberId, answers, comment) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    return withLock_(function () {
      saveAnswers_(g, eventById_(g, eventId, true), toStr_(memberId), answers, comment);
      return { savedAt: Date.now() };
    });
  });
}
function adminSetAttendance(token, groupId, eventId, memberId, input) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    var inp = input || {};
    if (['行く', '行かない', '途中から'].indexOf(inp.status) < 0) throw appError_('INVALID', '行く・行かない・途中から のどれかを選んでください');
    return withLock_(function () {
      saveAttendance_(g, eventById_(g, eventId, true), toStr_(memberId), inp);
      return { savedAt: Date.now() };
    });
  });
}

function adminCloseEvent(token, groupId, eventId) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    return withLock_(function () {
      var ev = eventById_(g, eventId, true);
      updateRow_(g.fileId, G_EVENTS, ev._row, { '状態': EV_DONE });
      ev = eventById_(g, eventId, true);
      syncEventIndex_(g, ev);
      return eventForAdmin_(g, ev);
    });
  });
}

/** 一覧からしまう(ファイルは残す) */
function adminArchiveGroup(token, groupId) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    return withLock_(function () {
      updateRow_(indexId_(), IDX_GROUPS, g._row, { '状態': 'しまう' });
      return { ok: true };
    });
  });
}

/** グループの設定(名前・キャラクター) */
function adminUpdateGroup(token, groupId, patch) {
  return api_(function () {
    requireAdmin_(token);
    var g = groupById_(groupId);
    var p = patch || {}, o = {};
    if ('name' in p) { o['名前'] = normalizeName(p.name); if (!o['名前']) throw appError_('INVALID', '名前を入れてください'); }
    if ('mascot' in p) o['キャラクター'] = p.mascot ? '出す' : '出さない';
    return withLock_(function () {
      updateRow_(indexId_(), IDX_GROUPS, g._row, o);
      return { ok: true };
    });
  });
}
