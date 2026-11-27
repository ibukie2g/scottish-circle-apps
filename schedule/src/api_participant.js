/**
 * 参加者の画面から呼ぶ関数(docs/API.md の「1. 参加者」)
 * 参加者はリンクの合言葉(token)と、端末が覚えている自分のメンバーID(memberId)で呼ぶ
 */

/** リンクを開いたとき。グループの情報と、自分(覚えていれば)と、イベントの一覧 */
function openGroup(token, memberId) {
  return api_(function () {
    var g = groupByToken_(token);
    if (!g.active) throw appError_('NOT_FOUND', 'このグループはしまわれています');
    var members = readMembers_(g);
    var me = members.filter(function (m) { return m.memberId === toStr_(memberId) && m.active; })[0] || null;
    var today = todayYmd_();
    var events = readEvents_(g).map(function (ev) {
      var cands = readCandidates_(g, ev.id);
      var decided = ev.decidedId ? cands.filter(function (c) { return c.id === ev.decidedId; })[0] : null;
      var answered = false;
      if (me) {
        if (ev.status === EV_RSVP) answered = readAttendance_(g, ev.id).some(function (r) { return r.memberId === me.memberId && r.status; });
        else {
          var ids = stageCandidates_(ev, cands).map(function (c) { return c.id; });
          answered = readAnswers_(g, ev.id).some(function (r) { return r.memberId === me.memberId && ids.some(function (id) { return parseAnswers(r.answers)[id]; }); });
        }
      }
      return { id: ev.id, name: ev.name, status: ev.status, deadline: ev.deadline, closed: (ev.status === EV_RSVP || ev.status === EV_TIME) ? false : isClosed(ev, today),
        archived: isArchived(ev, cands, today), decided: decided ? { date: decided.date, time: ev.status === EV_TIME ? '' : decided.time } : null, myAnswered: answered };
    });
    // 答えていない・終わっていないものを先に
    events.sort(function (a, b) {
      var ka = (a.archived ? 2 : 0) + (a.myAnswered ? 1 : 0), kb = (b.archived ? 2 : 0) + (b.myAnswered ? 1 : 0);
      return ka - kb;
    });
    return {
      group: { id: g.id, name: g.name, kind: g.kind, mascot: g.mascot },
      me: me ? { memberId: me.memberId, name: me.name } : null,
      events: events
    };
  });
}

/** 「自分を選ぶ」画面用のメンバー一覧(サークルはふりがな順・学年つき) */
function listMembers(token) {
  return api_(function () {
    var g = groupByToken_(token);
    var ms = readMembers_(g).filter(function (m) { return m.active; });
    if (g.kind === KIND_CIRCLE) {
      ms.sort(function (a, b) { return (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'); });
      return { members: ms.map(function (m) { return { memberId: m.memberId, name: m.name, kana: m.kana, grade: m.grade }; }) };
    }
    return { members: ms.map(function (m) { return { memberId: m.memberId, name: m.name }; }) };
  });
}

/** 一覧にいないとき、自分で加わる */
function joinGroup(token, input) {
  return api_(function () {
    var g = groupByToken_(token);
    var inp = input || {};
    var name = normalizeName(inp.name);
    if (!name || nameLength(name) > NAME_MAX) throw appError_('INVALID', '名前は1〜' + NAME_MAX + '文字で入れてください');
    return withLock_(function () {
      var members = readMembers_(g, true);
      // 空白のあるなしだけちがう名前も同じとみなす(二重登録を防ぐ)
      var same = members.filter(function (m) { return m.active && nameKey(m.name) === nameKey(name); })[0];
      if (same) throw appError_('INVALID', '同じ名前の人がいます。一覧から選ぶか、名前を少し変えてください');
      var memberId = nextId('M', members.map(function (m) { return m.memberId; }), 3);
      var row = { 'メンバーID': memberId, '名簿の参加者ID': '', '表示名': '', '状態': 'いる', '登録日': todayYmd_() };
      if (g.kind === KIND_CIRCLE) {
        var rid = prop_('ROSTER_SPREADSHEET_ID', true);
        var kana = normalizeName(inp.kana);
        var grade = ['1年', '2年', '3年', '4年', 'その他'].indexOf(inp.grade) >= 0 ? inp.grade : '';
        var gender = ['男性', '女性', '答えない'].indexOf(inp.gender) >= 0 ? inp.gender : '';
        if (!kana || !grade) throw appError_('INVALID', 'ふりがなと学年も入れてください');
        var selfIds = ss_(rid).getSheetByName(R_SELF) ? readTable_(rid, R_SELF, true).rows.map(function (r) { return toStr_(r['参加者ID']); }) : [];
        var pid = nextId('S', selfIds, 2);
        appendRows_(rid, R_SELF, R_SELF_H, [{ '参加者ID': pid, 'フルネーム': name, 'ふりがな': kana, '学年': grade, '男女': gender, '登録日': todayYmd_() }]);
        invalidateRoster_();
        row['名簿の参加者ID'] = pid;
      } else {
        row['表示名'] = name;
      }
      appendRows_(g.fileId, G_MEMBERS, G_MEMBERS_H, [row]);
      return { memberId: memberId, name: name };
    });
  });
}

/** イベントの中身・自分の答え・結果(見せ方の設定どおり) */
function getEvent(token, eventId, memberId) {
  return api_(function () {
    var g = groupByToken_(token);
    var ev = eventById_(g, eventId);
    return eventView_(g, ev, toStr_(memberId), false);
  });
}

/**
 * いまの段階で答える候補:時間調整中は時間の候補、それ以外は日程の候補(11/27)
 * 時間の候補は、決まった日のものだけ
 */
function stageCandidates_(ev, cands) {
  if (ev.status === EV_TIME) return (cands || []).filter(function (c) { return c.stage === 'time'; });
  return (cands || []).filter(function (c) { return c.stage !== 'time'; });
}

/** 画面に返すイベントの形(参加者用。運営は adminGetResults) */
function eventView_(g, ev, memberId, fresh) {
  var all = sortCandidates(readCandidates_(g, ev.id, fresh));
  var cands = stageCandidates_(ev, all);
  var dateCands = all.filter(function (c) { return c.stage !== 'time'; });
  var members = readMembers_(g, fresh);
  var answers = readAnswers_(g, ev.id, fresh);
  var att = readAttendance_(g, ev.id, fresh);
  var mineA = answers.filter(function (r) { return r.memberId === memberId; }).pop();
  var mineT = att.filter(function (r) { return r.memberId === memberId; }).pop();
  var today = todayYmd_();
  var results = null;
  var pack = function (list) {
    var ids = list.map(function (c) { return c.id; });
    var s = summarize(list, rowsForCandidates(answers, ids), members, { withNames: ev.visibility === '名前' });
    return { answeredCount: s.answeredCount, memberCount: g.kind === KIND_CIRCLE ? s.memberCount : null,
      byDate: s.byDate.map(function (d) { return { candidateId: d.candidateId, date: d.date, time: d.time, o: d.o, t: d.t, x: d.x, names: d.names, best: d.best }; }) };
  };
  if (ev.visibility !== '伊吹だけ') {
    var withNames = ev.visibility === '名前';
    results = pack(cands);
    results.attendance = ev.status === EV_RSVP ? summarizeAttendance(att, members, withNames) : null;
    // 出欠確認中・時間調整中は、前の段階(日程)の結果も「日程調整のときの回答」として見られるように
    if (ev.status !== EV_POLL) results.dateStage = pack(dateCands);
  }
  var decided = ev.decidedId ? all.filter(function (c) { return c.id === ev.decidedId; })[0] : null;
  return {
    event: { id: ev.id, name: ev.name, description: ev.description, place: ev.place, cost: ev.cost, url: ev.url,
      // 締め切りは日程調整のためのもの。出欠確認中は「終了」になるまで答えられる
      // 時間調整中も、締め切り(日程のためのもの)に関係なく答えられる
      status: ev.status, deadline: ev.deadline, closed: (ev.status === EV_RSVP || ev.status === EV_TIME) ? false : isClosed(ev, today), visibility: ev.visibility,
      decided: decided ? { candidateId: decided.id, date: decided.date, time: ev.status === EV_TIME ? '' : decided.time } : null,
      // 決まった日をカレンダーに追加する用(Googleカレンダーのリンクと、iPhoneなどの .ics の中身)
      calendar: decided && ev.status !== EV_TIME ? calendarData({ title: ev.name, date: decided.date, time: decided.time, place: ev.place, url: ev.url }) : null },
    candidates: cands.map(function (c) { return { id: c.id, date: c.date, time: c.time, memo: c.memo, stage: c.stage }; }),
    dateCandidates: dateCands.map(function (c) { return { id: c.id, date: c.date, time: c.time, memo: c.memo }; }),
    mine: {
      // いまの段階の答えだけ(時間調整中なら、時間の答え)
      answers: mineA ? parseAnswers(rowsForCandidates([mineA], cands.map(function (c) { return c.id; }))[0].answers) : {},
      comment: mineA ? mineA.comment : '',
      attendance: mineT ? { status: mineT.status, comment: mineT.comment, arriveAt: mineT.arriveAt } : null
    },
    results: results
  };
}

/** 日程調整の ○△× を送る(送り直したら上書き) */
function submitAnswers(token, eventId, memberId, answers, comment) {
  return api_(function () {
    var g = groupByToken_(token);
    return withLock_(function () {
      var ev = eventById_(g, eventId, true);
      if (ev.status === EV_POLL && isClosed(ev, todayYmd_())) throw appError_('CLOSED', '締め切りを過ぎたので変えられません');
      if (ev.status !== EV_POLL && ev.status !== EV_TIME) throw appError_('CLOSED', '日にちが決まったので、出欠のほうに答えてください');
      saveAnswers_(g, ev, toStr_(memberId), answers, comment);
      return { savedAt: Date.now() };
    });
  });
}

/** 答えを保存する(参加者・運営の共通)。ロックの中で呼ぶ */
function saveAnswers_(g, ev, memberId, answers, comment) {
  var member = readMembersRaw_(g, true).filter(function (m) { return m.memberId === memberId && m.active; })[0];
  if (!member) throw appError_('NOT_FOUND', '自分の名前が見つかりません。もう一度選んでください');
  var all = sortCandidates(readCandidates_(g, ev.id, true));
  var ids = all.map(function (c) { return c.id; });
  // いまの段階の候補だけを書きかえ、ほかの段階の答え(日程の答えなど)は残す
  var stageIds = stageCandidates_(ev, all).map(function (c) { return c.id; });
  var cur = readAnswers_(g, ev.id, true).filter(function (r) { return r.memberId === memberId; });
  var merged = cur.length ? parseAnswers(cur[cur.length - 1].answers) : {};
  stageIds.forEach(function (id) { delete merged[id]; });
  var inp = answers || {};
  stageIds.forEach(function (id) { if (inp[id]) merged[id] = inp[id]; });
  var str = formatAnswers(merged, ids);
  var text = comment == null && cur.length ? cur[cur.length - 1].comment : normalizeName(comment).slice(0, 100);
  var obj = { 'イベントID': ev.id, 'メンバーID': memberId, '答え': str, 'ひとこと': text, '更新時刻': Date.now() };
  if (cur.length) updateRow_(g.fileId, G_ANSWERS, cur[cur.length - 1]._row, obj);
  else appendRows_(g.fileId, G_ANSWERS, G_ANSWERS_H, [obj]);
  var count = readAnswers_(g, ev.id, true).filter(function (r) { return Object.keys(parseAnswers(r.answers)).length; }).length;
  try { syncEventIndex_(g, ev, count); } catch (e) { /* 控えの更新に失敗しても答えは保存済み */ }
}

/** 出欠確認中のイベントで、行く/行かない/途中から */
function submitAttendance(token, eventId, memberId, input) {
  return api_(function () {
    var g = groupByToken_(token);
    var inp = input || {};
    if (['行く', '行かない', '途中から'].indexOf(inp.status) < 0) throw appError_('INVALID', '行く・行かない・途中から のどれかを選んでください');
    return withLock_(function () {
      var ev = eventById_(g, eventId, true);
      if (ev.status === EV_DONE) throw appError_('CLOSED', 'このイベントは終わりました');
      if (ev.status !== EV_RSVP) throw appError_('CLOSED', 'まだ日にちが決まっていません');
      saveAttendance_(g, ev, toStr_(memberId), inp);
      return { savedAt: Date.now() };
    });
  });
}

function saveAttendance_(g, ev, memberId, inp) {
  var member = readMembersRaw_(g, true).filter(function (m) { return m.memberId === memberId && m.active; })[0];
  if (!member) throw appError_('NOT_FOUND', '自分の名前が見つかりません。もう一度選んでください');
  var arrive = inp.status === '途中から' ? (/^\d{1,2}:\d{2}$/.test(String(inp.arriveAt || '')) ? String(inp.arriveAt) : '') : '';
  var obj = { 'イベントID': ev.id, 'メンバーID': memberId, '出欠': inp.status, 'ひとこと': normalizeName(inp.comment).slice(0, 100),
    '更新時刻': Date.now(), '来られる時間': arrive };
  var cur = readAttendance_(g, ev.id, true).filter(function (r) { return r.memberId === memberId; });
  if (cur.length) updateRow_(g.fileId, G_ATTEND, cur[cur.length - 1]._row, obj);
  else appendRows_(g.fileId, G_ATTEND, G_ATTEND_H, [obj]);
}
