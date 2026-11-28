/**
 * B案(schedule-web)への引っ越し(11/28 伊吹)
 * 1. adminSetMove(token, 'moving')  … 引っ越し中:参加者は答えを送れない(「少し待ってね」)
 * 2. adminExportForB(token)          … 全部を1つのデータにして書き出す(運営の画面からファイルとして保存)
 *    → 伊吹のパソコンで schedule-web/scripts/import-from-a.mjs を実行して B に入れる
 * 3. adminSetMove(token, 'moved', links) … 引っ越しました:グループごとの新しいリンクを出す
 * もとに戻すときは adminSetMove(token, '')
 *
 * スクリプト プロパティ MOVE_MODE('' | 'moving' | 'moved')と MOVE_LINKS({ グループID: 新しいリンク } の JSON)に置く
 */

var MOVE_MODES = ['', 'moving', 'moved'];

function moveState_() {
  var mode = prop_('MOVE_MODE', false);
  var links = {};
  try { links = JSON.parse(prop_('MOVE_LINKS', false) || '{}'); } catch (e) { links = {}; }
  return { mode: MOVE_MODES.indexOf(mode) >= 0 ? mode : '', links: links };
}

/** 参加者が書きこむ前に呼ぶ。引っ越し中・引っ越したあとは止める */
function requireNotMoved_(g) {
  var s = moveState_();
  if (s.mode === 'moving') throw appError_('MOVING', 'いま新しいアプリに引っ越し中です。少し待ってから、もう一度開いてね');
  if (s.mode === 'moved') {
    throw appError_('MOVED', '新しいアプリに引っ越しました。新しいリンクから答えてね' + (g && s.links[g.id] ? ':' + s.links[g.id] : ''));
  }
}

/** 参加者の画面に出す引っ越しの案内(なければ null) */
function moveInfo_(g) {
  var s = moveState_();
  if (!s.mode) return null;
  return { mode: s.mode, link: (g && s.links[g.id]) || '' };
}

function adminGetMove(token) {
  return api_(function () {
    requireAdmin_(token);
    return moveState_();
  });
}

/** links = { グループID: 'https://…/g/…' }(moved のときだけ使う) */
function adminSetMove(token, mode, links) {
  return api_(function () {
    requireAdmin_(token);
    if (MOVE_MODES.indexOf(mode) < 0) throw appError_('INVALID', '引っ越しの状態が正しくありません');
    var clean = {};
    Object.keys(links || {}).forEach(function (k) {
      var v = toStr_(links[k]);
      if (/^https:\/\/\S+$/.test(v)) clean[toStr_(k)] = v;
    });
    if (mode === 'moved' && !Object.keys(clean).length) throw appError_('INVALID', '新しいリンクを入れてください');
    var p = PropertiesService.getScriptProperties();
    p.setProperty('MOVE_MODE', mode);
    p.setProperty('MOVE_LINKS', JSON.stringify(mode === 'moved' ? clean : {}));
    return moveState_();
  });
}

/**
 * B案に入れるためのデータを全部書き出す(しまっていないグループだけ)
 * 名前・ふりがな・学年・男女を含む(B の members 表に入れる分だけ。出身地・学籍番号は入れない)
 */
function adminExportForB(token) {
  return api_(function () {
    requireAdmin_(token);
    var roster = readRoster_(true);
    var groups = readGroups_(true).filter(function (g) { return g.active; }).map(function (g) {
      var members = readMembersRaw_(g, true).map(function (m) {
        if (g.kind !== KIND_CIRCLE) return { memberId: m.memberId, rosterId: '', name: m.displayName, kana: '', grade: '', gender: '', active: m.active };
        var p = roster[m.rosterId] || null;
        return { memberId: m.memberId, rosterId: m.rosterId, name: p ? p.name : m.rosterId, kana: p ? p.kana : '', grade: p ? p.grade : '',
          gender: p ? p.gender : '', active: m.active && !!p };
      });
      var events = readEvents_(g, true).map(function (ev) {
        return {
          id: ev.id, name: ev.name, description: ev.description, status: ev.status, visibility: ev.visibility, deadline: ev.deadline,
          decidedId: ev.decidedId, place: ev.place, cost: ev.cost, url: ev.url, createdAt: ev.createdAt,
          candidates: readCandidates_(g, ev.id, true).map(function (c) { return { id: c.id, date: c.date, time: c.time, memo: c.memo, stage: c.stage }; }),
          answers: readAnswers_(g, ev.id, true).map(function (r) { return { memberId: r.memberId, answers: r.answers, comment: r.comment, updatedAt: r.updatedAt }; }),
          attendance: readAttendance_(g, ev.id, true).map(function (r) { return { memberId: r.memberId, status: r.status, comment: r.comment, arriveAt: r.arriveAt, updatedAt: r.updatedAt }; }),
          wanted: readWanted_(g, ev.id, true).map(function (r) { return r.memberId; })
        };
      });
      return { id: g.id, name: g.name, kind: g.kind, mascot: g.mascot, members: members, events: events };
    });
    return { format: 'schedule-a-export-v1', exportedAt: new Date().toISOString(), moveMode: moveState_().mode, groups: groups };
  });
}
