/**
 * 日程調整の計算(GASに依存しない純粋な関数)
 * - Node.js でテストできる(tests/core_schedule.test.js)
 * - Bに作り直すときもこのままの考え方で使う
 *
 * 用語:答え = '○' | '△' | '×'(未回答は '')
 *       候補日 = { id: 'C01', date: '2026-12-15', time: '19:00', memo: '' }
 *       メンバー = { memberId: 'M001', name: '大野 美咲', kana?, grade?, gender?, active: true }
 *       回答の行 = { memberId, answers: 'C01:○,C02:△', comment, updatedAt }
 */

var MARKS = ['○', '△', '×'];
var WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
var NAME_MAX = 20;
var ARCHIVE_DAYS = 30;

/** 'C01:○,C02:△' → { C01: '○', C02: '△' }(知らない記号は捨てる) */
function parseAnswers(str) {
  var out = {};
  String(str || '').split(',').forEach(function (part) {
    var i = part.indexOf(':');
    if (i < 1) return;
    var id = part.slice(0, i).trim(), mark = part.slice(i + 1).trim();
    if (id && MARKS.indexOf(mark) >= 0) out[id] = mark;
  });
  return out;
}

/** { C01: '○' } → 'C01:○,…'(candidateIds の順。答えのないものは書かない) */
function formatAnswers(obj, candidateIds) {
  var ids = candidateIds || Object.keys(obj || {});
  return ids.filter(function (id) { return obj && MARKS.indexOf(obj[id]) >= 0; })
    .map(function (id) { return id + ':' + obj[id]; }).join(',');
}

/** 表示名を整える(前後の空白・改行・続く空白)。長さは Array.from で数える(絵文字も1字) */
function normalizeName(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function nameLength(v) { return Array.from(String(v || '')).length; }

/** '2026-12-15' → '12/15(火)' */
function formatDateJa(ymd) {
  var d = parseYmd_(ymd);
  if (!d) return String(ymd || '');
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + WEEKDAYS_JA[d.getUTCDay()] + ')';
}

/** 'YYYY-MM-DD' を UTC の Date に(タイムゾーンに左右されないように) */
function parseYmd_(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function ymd_(d) {
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

/**
 * 候補日の一括作成。「12/1から、火曜と金曜を4週分、19:00」など
 * opts = { from: '2026-12-01', weekdays: [2, 5], weeks: 4, time: '19:00' }
 * → [{ date, time }](日付順。from の週から weeks 週分)
 */
function expandDates(opts) {
  var start = parseYmd_(opts && opts.from);
  var weeks = Math.max(1, Math.min(12, Number(opts && opts.weeks) || 1));
  var wds = ((opts && opts.weekdays) || []).filter(function (w) { return w >= 0 && w <= 6; });
  if (!start || !wds.length) return [];
  var out = [];
  for (var i = 0; i < weeks * 7; i++) {
    var d = new Date(start.getTime() + i * 86400000);
    if (wds.indexOf(d.getUTCDay()) >= 0) out.push({ date: ymd_(d), time: (opts.time || '') });
  }
  return out;
}

/** 候補日を日付・時刻の順に並べる(元の配列は変えない) */
function sortCandidates(candidates) {
  return (candidates || []).slice().sort(function (a, b) {
    return (a.date + ' ' + (a.time || '99:99')) < (b.date + ' ' + (b.time || '99:99')) ? -1 : 1;
  });
}

/** 学年・男女で絞り込む(サークルのとき)。条件が空ならそのまま */
function filterMembers(members, filter) {
  var f = filter || {};
  return (members || []).filter(function (m) {
    if (m.active === false) return false;
    if (f.grade && m.grade !== f.grade) return false;
    if (f.gender && m.gender !== f.gender) return false;
    return true;
  });
}

/** 回答の行を memberId → 行 にまとめる(同じ人が複数行あれば、新しいもの) */
function latestRows_(rows) {
  var by = {};
  (rows || []).forEach(function (r) {
    if (!r || !r.memberId) return;
    var cur = by[r.memberId];
    if (!cur || (Number(r.updatedAt) || 0) >= (Number(cur.updatedAt) || 0)) by[r.memberId] = r;
  });
  return by;
}

/** 答えていない人(メンバーの順のまま)。1つでも候補日に答えていれば「答えた」とする */
function unanswered(members, answerRows) {
  var by = latestRows_(answerRows);
  return (members || []).filter(function (m) {
    if (m.active === false) return false;
    var r = by[m.memberId];
    return !r || !Object.keys(parseAnswers(r.answers)).length;
  });
}

/**
 * 日ごとの集計
 * opts = { wanted: ['M001'], withNames: true }
 * 戻り値:byDate(○の多い順 → △の多い順 → 日付の早い順)と、答えた人数
 *   byDate[i] = { candidateId, date, time, memo, o, t, x, names: { o:[], t:[], x:[] } | null,
 *                 wanted: { ok:[], maybe:[], ng:[], none:[] } | null, best: true/false }
 */
function summarize(candidates, answerRows, members, opts) {
  var o = opts || {};
  var active = (members || []).filter(function (m) { return m.active !== false; });
  var nameOf = {};
  active.forEach(function (m) { nameOf[m.memberId] = m.name; });
  var by = latestRows_(answerRows);
  var parsed = {};
  var answeredCount = 0;
  active.forEach(function (m) {
    var r = by[m.memberId];
    var a = r ? parseAnswers(r.answers) : {};
    parsed[m.memberId] = a;
    if (Object.keys(a).length) answeredCount++;
  });
  var wanted = (o.wanted || []).filter(function (id) { return nameOf[id] !== undefined; });
  var list = sortCandidates(candidates).map(function (c, order) {
    var item = { candidateId: c.id, date: c.date, time: c.time || '', memo: c.memo || '', o: 0, t: 0, x: 0, order: order };
    var names = { o: [], t: [], x: [] };
    active.forEach(function (m) {
      var mark = parsed[m.memberId][c.id];
      if (mark === '○') { item.o++; names.o.push(m.name); }
      else if (mark === '△') { item.t++; names.t.push(m.name); }
      else if (mark === '×') { item.x++; names.x.push(m.name); }
    });
    item.names = o.withNames === false ? null : names;
    if (wanted.length) {
      var w = { ok: [], maybe: [], ng: [], none: [] };
      wanted.forEach(function (id) {
        var mark = parsed[id] && parsed[id][c.id];
        (mark === '○' ? w.ok : mark === '△' ? w.maybe : mark === '×' ? w.ng : w.none).push(nameOf[id]);
      });
      item.wanted = w;
    } else item.wanted = null;
    return item;
  });
  list.sort(function (a, b) { return (b.o - a.o) || (b.t - a.t) || (a.order - b.order); });
  list.forEach(function (it, i) { it.best = i === 0 && it.o > 0; delete it.order; });
  return { byDate: list, answeredCount: answeredCount, memberCount: active.length };
}

/** 出欠の集計 rows = [{ memberId, status, comment, arriveAt }] */
function summarizeAttendance(rows, members, withNames) {
  var nameOf = {};
  (members || []).forEach(function (m) { if (m.active !== false) nameOf[m.memberId] = m.name; });
  var by = latestRows_(rows);
  var out = { go: 0, partial: 0, no: 0, names: withNames === false ? null : { go: [], partial: [], no: [] } };
  Object.keys(by).forEach(function (id) {
    if (nameOf[id] === undefined) return;
    var s = by[id].status, k = s === '行く' ? 'go' : s === '途中から' ? 'partial' : s === '行かない' ? 'no' : null;
    if (!k) return;
    out[k]++;
    if (out.names) out.names[k].push(nameOf[id] + (k === 'partial' && by[id].arriveAt ? '(' + by[id].arriveAt + '〜)' : ''));
  });
  return out;
}

/** 日にちを決めたときの出欠の仮入れ:○→行く、×→行かない、それ以外は空 */
function presetAttendance(answers, decidedId) {
  var mark = (answers || {})[decidedId];
  return mark === '○' ? '行く' : mark === '×' ? '行かない' : '';
}

/** LINEに貼る催促文 */
function remindText(event, names, link) {
  var lines = ['【' + event.name + '】まだの人お願いします🙏'];
  if (names && names.length) lines.push(names.map(function (n) { return n + 'さん'; }).join('、'));
  if (event.deadline) lines.push('締め切り ' + formatDateJa(event.deadline));
  if (link) lines.push(link);
  return lines.join('\n');
}

/**
 * LINEに流す文(名指しはしない。11/27 伊吹:行かない人はそもそも答えないので、名前を挙げて促す必要はない)
 * decided = { date, time } があれば「決まりました」の文、なければ「日程を教えて」の文
 */
function shareText(event, decided, link) {
  var lines = [];
  if (decided) {
    lines.push('【' + event.name + '】' + formatDateJa(decided.date) + (decided.time ? ' ' + decided.time : '') + ' に決まりました!');
    lines.push('行けるかどうか、ここから教えてください🙌');
  } else {
    lines.push('【' + event.name + '】来られる日を教えてください🙌');
    if (event.deadline) lines.push('締め切り ' + formatDateJa(event.deadline));
  }
  if (event.place) lines.push('📍 ' + event.place);
  if (link) lines.push(link);
  return lines.join('\n');
}

/** 締め切りを過ぎたか(締め切りの日の 23:59 まではOK)。nowYmd は 'YYYY-MM-DD'(日本時間) */
function isClosed(event, nowYmd) {
  if (!event) return true;
  if (event.status === '終了') return true;
  return !!(event.deadline && nowYmd > event.deadline);
}

/** 一覧で「終わったもの」に折りたたむか:決まった日(なければ最後の候補日)から ARCHIVE_DAYS 日たった */
function isArchived(event, candidates, nowYmd) {
  if (!event) return false;
  var base = '';
  if (event.decidedId) {
    var c = (candidates || []).filter(function (x) { return x.id === event.decidedId; })[0];
    base = c ? c.date : '';
  }
  if (!base) (candidates || []).forEach(function (c) { if (c.date > base) base = c.date; });
  if (!base) return event.status === '終了';
  var d = parseYmd_(base);
  var limit = ymd_(new Date(d.getTime() + ARCHIVE_DAYS * 86400000));
  return nowYmd > limit;
}

/** 次の番号のID(prefix + 桁数)。ids に 'C01','C02' → 'C03' */
function nextId(prefix, ids, digits) {
  var n = 0;
  (ids || []).forEach(function (id) {
    var m = new RegExp('^' + prefix + '(\\d+)$').exec(String(id));
    if (m) n = Math.max(n, +m[1]);
  });
  return prefix + ('000000' + (n + 1)).slice(-(digits || 2));
}

/**
 * カレンダーに追加するためのデータ
 * - googleUrl:Googleカレンダーの予定作成画面のURL
 * - ics:iPhone などのカレンダー用のファイルの中身(日本時間。時刻がなければ終日)
 * opts = { title, date, time, place, url, hours }(hours は長さ。既定2時間)
 */
function calendarData(opts) {
  var d = parseYmd_(opts.date);
  if (!d) return null;
  var title = opts.title || '予定';
  var details = opts.url ? opts.url : '';
  var startStr, endStr, icsStart, icsEnd;
  var m = /^(\d{1,2}):(\d{2})$/.exec(opts.time || '');
  if (m) {
    // 日本時間(UTC+9) → UTC
    var start = new Date(d.getTime() + ((+m[1]) * 60 + (+m[2]) - 9 * 60) * 60000);
    var end = new Date(start.getTime() + (opts.hours || 2) * 3600000);
    startStr = utcStamp_(start); endStr = utcStamp_(end);
    icsStart = 'DTSTART:' + startStr; icsEnd = 'DTEND:' + endStr;
  } else {
    var next = new Date(d.getTime() + 86400000);
    startStr = ymd_(d).replace(/-/g, ''); endStr = ymd_(next).replace(/-/g, '');
    icsStart = 'DTSTART;VALUE=DATE:' + startStr; icsEnd = 'DTEND;VALUE=DATE:' + endStr;
  }
  var googleUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(title) + '&dates=' + startStr + '/' + endStr +
    (opts.place ? '&location=' + encodeURIComponent(opts.place) : '') +
    (details ? '&details=' + encodeURIComponent(details) : '');
  var esc = function (s) { return String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n'); };
  var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//scottish-circle//schedule//JA', 'BEGIN:VEVENT',
    'UID:' + startStr + '-' + encodeURIComponent(title).slice(0, 40) + '@schedule',
    icsStart, icsEnd, 'SUMMARY:' + esc(title)]
    .concat(opts.place ? ['LOCATION:' + esc(opts.place)] : [])
    .concat(details ? ['DESCRIPTION:' + esc(details)] : [])
    .concat(['END:VEVENT', 'END:VCALENDAR']).join('\r\n');
  return { googleUrl: googleUrl, ics: ics };
}
function utcStamp_(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MARKS: MARKS, NAME_MAX: NAME_MAX, ARCHIVE_DAYS: ARCHIVE_DAYS,
    parseAnswers: parseAnswers, formatAnswers: formatAnswers, normalizeName: normalizeName, nameLength: nameLength,
    formatDateJa: formatDateJa, expandDates: expandDates, sortCandidates: sortCandidates, filterMembers: filterMembers,
    unanswered: unanswered, summarize: summarize, summarizeAttendance: summarizeAttendance, presetAttendance: presetAttendance,
    remindText: remindText, shareText: shareText, isClosed: isClosed, isArchived: isArchived, nextId: nextId, calendarData: calendarData
  };
}
