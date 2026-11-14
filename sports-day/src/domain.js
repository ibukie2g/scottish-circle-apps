/**
 * アプリ用シートの読み取り(オブジェクトに変換)と、集計の組み立て(GAS専用)
 * 計算そのものは core_*.js の純粋関数で行う。
 */

var NEAR_CACHE_SEC = 21600; // 惜しい答えの入力は CacheService に6時間だけ置く(シートには書かない)

function readState_(fresh) {
  var kv = readKeyValues_(SH_STATE, fresh);
  var mode = toStr_(kv['モード']);
  if (MODES.indexOf(mode) < 0) mode = '待ち';
  return {
    mode: mode,
    currentEvent: toStr_(kv['今の種目']),
    nextEvent: toStr_(kv['次の種目']),
    predictionMatchId: toStr_(kv['予想の試合ID']),
    quizStartedAt: toMs_(kv['クイズ開始時刻']),
    predictionOpenedAt: toMs_(kv['予想の受付開始時刻']),
    updatedAt: toMs_(kv['更新時刻'])
  };
}

function writeState_(values) {
  values['更新時刻'] = new Date();
  writeKeyValues_(SH_STATE, values);
  invalidate_([SH_STATE]);
}

function readSettings_(fresh) {
  return parseSettings(readKeyValues_(SH_SETTINGS, fresh));
}

/** 参加者シート → [{id, team, arrivedAt, walkIn, quizInclude, _row}] */
function readParticipants_(fresh) {
  return readTable_(SH_PARTICIPANTS, fresh).rows.map(function (r) {
    return {
      id: toStr_(r['参加者ID']),
      team: normTeam_(r['チーム']),
      arrivedAt: toMs_(r['来場時刻']),
      walkIn: toBool_(r['当日追加']),
      // 空欄は「含める」とみなす
      quizInclude: toStr_(r['クイズに含める']) === '' ? true : toBool_(r['クイズに含める']),
      _row: r._row
    };
  }).filter(function (p) { return p.id; });
}

function findParticipant_(parts, id) {
  for (var i = 0; i < parts.length; i++) if (parts[i].id === id) return parts[i];
  return null;
}

function requireParticipant_(id, fresh) {
  var pid = toStr_(id);
  var p = findParticipant_(readParticipants_(fresh), pid);
  if (!p) throw appError_('NOT_FOUND', '参加者が見つかりません(' + pid + ')。名前を選び直してください');
  return p;
}

/** 試合シート → core_score.js の試合オブジェクト */
function readMatches_(fresh) {
  // 30人が数秒ごとに読むので、ふだんはロックを取らずに読む。
  // 決勝・3位決定戦・ドッジの補完が必要なときだけ、ロックを取って書き直す。
  var matches = parseMatches_(fresh);
  if (!fillDerivedMatches(matches).changes.length) return matches;
  return withLock_(function () {
    var latest = parseMatches_(true);
    if (applyDerived_(latest).length) return parseMatches_(true);
    return latest;
  });
}

function parseMatches_(fresh) {
  return (function () {
    var matches = readTable_(SH_MATCHES, fresh).rows.map(function (r) {
      return {
        id: toStr_(r['試合ID']),
        sport: toStr_(r['種目']),
        round: toStr_(r['回']),
        team1: normTeam_(r['チーム1']),
        team2: normTeam_(r['チーム2']),
        score1: toNumOrNull_(r['点数1']),
        score2: toNumOrNull_(r['点数2']),
        status: toStr_(r['状態']) === MATCH_CONFIRMED ? MATCH_CONFIRMED : MATCH_PLANNED,
        predictionStatus: PREDICTION_STATUSES.indexOf(toStr_(r['予想の状態'])) >= 0 ? toStr_(r['予想の状態']) : 'なし',
        related: toStr_(r['関連試合']),
        _row: r._row
      };
    }).filter(function (m) { return m.id; });
    return matches;
  })();
}

function findMatchById_(matches, id) {
  for (var i = 0; i < matches.length; i++) if (matches[i].id === id) return matches[i];
  return null;
}

/** 画面に返す試合の形 */
function matchView_(m) {
  return {
    id: m.id, sport: m.sport, round: m.round, team1: m.team1, team2: m.team2,
    score1: m.score1, score2: m.score2, status: m.status, predictionStatus: m.predictionStatus, related: m.related
  };
}

/** 参加者の画面に返す試合の形。点数は入れない(決勝の間、点数を隠すため。本番前の変更 1) */
function publicMatchView_(m) {
  return {
    id: m.id, sport: m.sport, round: m.round, team1: m.team1, team2: m.team2,
    status: m.status, predictionStatus: m.predictionStatus, related: m.related
  };
}

function readPredictions_(fresh) {
  return readTable_(SH_PREDICTIONS, fresh).rows.map(function (r) {
    return {
      matchId: toStr_(r['試合ID']),
      participantId: toStr_(r['参加者ID']),
      team: normTeam_(r['チーム']),
      choice: normTeam_(r['予想(勝つチーム)']),
      _row: r._row
    };
  }).filter(function (p) { return p.matchId && p.participantId && p.choice; }).filter(function (p, i, all) {
    // 予想はロックなしで行を足していくので、同じ人・同じ試合は下の行(最新)だけを使う
    for (var k = i + 1; k < all.length; k++) if (all[k].matchId === p.matchId && all[k].participantId === p.participantId) return false;
    return true;
  });
}

function readQuizQuestions_(fresh) {
  return readTable_(SH_QUIZ_Q, fresh).rows.map(function (r) {
    var origin = cacheGetJson_('origin:' + r['参加者ID']);
    return {
      participantId: toStr_(r['参加者ID']),
      nameTargets: splitIds_(r['名前の対象者ID']),
      originTarget: (origin || {}).originTarget || '',
      choices: (origin || {}).choices || [],
      answer: (origin || {}).answer || '',
      originExpired: !origin,
      _row: r._row
    };
  }).filter(function (q) { return q.participantId; });
}

/** 「P02:1,P03:0.5」→ {P02: 1, P03: 0.5}(自動判定の控え) */
function parseCredits_(v) {
  var out = {};
  splitIds_(v).forEach(function (x) {
    var m = x.match(/^(.+):(1|0\.5)$/);
    if (m) out[m[1]] = Number(m[2]);
  });
  return out;
}

function formatCredits_(credits) {
  return Object.keys(credits).map(function (id) { return id + ':' + credits[id]; }).join(',');
}

function readQuizAnswers_(fresh) {
  return readTable_(SH_QUIZ_A, fresh).rows.map(function (r) {
    var oc = toStr_(r['出身地の正誤']);
    var fullIds = splitIds_(r['正解と判定した人のID']);
    var auto = parseCredits_(r['自動判定(控え)']);
    // 控えの列ができる前の行は、正解の列をそのまま自動判定とみなす
    if (toStr_(r['自動判定(控え)']) === '') fullIds.forEach(function (id) { auto[id] = 1; });
    return {
      participantId: toStr_(r['参加者ID']),
      writtenCount: toNumOrNull_(r['書いた人数']) || 0,
      correctIds: fullIds,                                    // 1人分(運営の判断を足したあと)
      halfIds: splitIds_(r['0.5人分と判定した人のID']),        // 0.5人分(運営の判断を足したあと)
      auto: auto,                                             // アプリが自動で決めた分 {参加者ID: 1 | 0.5}
      nameRate: toNumOrNull_(r['名前の正答率']),
      originAnswer: (cacheGetJson_('originResponse:' + r['参加者ID']) || {}).answer || '',
      originCorrect: oc === '' ? null : toBool_(r['出身地の正誤']),
      submittedAt: toMs_(r['送信時刻']),
      _row: r._row
    };
  }).filter(function (a) { return a.participantId; }).filter(function (a, i, all) {
    // 回答はロックなしで行を足すので、同じ人が2回送れても最初の行だけを使う
    for (var k = 0; k < i; k++) if (all[k].participantId === a.participantId) return false;
    return true;
  });
}

function readNearMisses_(fresh) {
  return readTable_(SH_NEAR, fresh).rows.map(function (r) {
    return {
      number: toNumOrNull_(r['番号']),
      participantId: toStr_(r['参加者ID']),
      candidateId: toStr_(r['近い候補(参加者ID)']),
      judgement: normJudgement_(r['判定']),
      _row: r._row
    };
  }).filter(function (n) { return n.number !== null && n.participantId; }).filter(function (n, i, all) {
    // ロックなしで行を足すので、送り直しで同じ番号が二重になったら最初の行だけを使う
    for (var k = 0; k < i; k++) if (all[k].number === n.number) return false;
    return true;
  });
}

/** 判定の列の値をそろえる。古い「OK」は1人分、「NG」は×として読む。読めない値は「未」 */
function normJudgement_(v) {
  var s = toStr_(v).normalize('NFKC').toUpperCase();
  if (s === 'OK' || s === '1人分' || s === '1') return JUDGE_FULL;
  if (s === '0.5人分' || s === '0.5') return JUDGE_HALF;
  if (s === 'NG' || s === '×' || s === 'X' || s === '✕' || s === '✗') return JUDGE_NG;
  return JUDGE_PENDING;
}

/**
 * 1人分の名前クイズの点数を計算し直してクイズ回答に書く(ロックの中で使う)
 * 自動判定(控え)に、運営の判断(惜しい答えの 1人分/0.5人分)を重ねる。同じ人は高いほうだけ数える。
 * 運営が判断を × や 未 に戻したら、自動判定の点に戻る
 */
function recomputeNameScore_(pid) {
  var a = findBy_(readQuizAnswers_(true), pid);
  var q = findBy_(readQuizQuestions_(true), pid);
  if (!a || !q) return;
  var credits = {};
  Object.keys(a.auto).forEach(function (id) { credits[id] = a.auto[id]; });
  readNearMisses_(true).forEach(function (n) {
    if (n.participantId !== pid || !n.candidateId) return;
    var v = n.judgement === JUDGE_FULL ? 1 : (n.judgement === JUDGE_HALF ? 0.5 : 0);
    if (v > (credits[n.candidateId] || 0)) credits[n.candidateId] = v;
  });
  var s = summarizeCredits(credits, q.nameTargets);
  updateRow_(SH_QUIZ_A, a._row, {
    '正解と判定した人のID': s.fullIds.join(','), '0.5人分と判定した人のID': s.halfIds.join(','),
    '名前の正答率': s.rate === null ? '' : s.rate
  });
}

/** アンケートを送ったか(参加者ごと)。送った目印はキャッシュにも置く */
function surveyDone_(pid) {
  if (!pid) return false;
  if (cache_().get('surveyDone:' + pid)) return true;
  return readTable_(SH_SURVEY).rows.some(function (r) { return toStr_(r['参加者ID']) === pid; });
}

/** 名簿の名前が「名字 名前」と空白で分かれていない人の数(名前は返さない) */
function countUnsplitNames_() {
  var people = readPeople_();
  return readParticipants_().filter(function (p) {
    var pp = people[p.id];
    return !pp || !isSplitName(pp);
  }).length;
}

function readOdai_(fresh) {
  return readTable_(SH_ODAI, fresh).rows.map(function (r) {
    return {
      number: toNumOrNull_(r['お題番号']),
      theme: toStr_(r['お題']),
      team: normTeam_(r['チーム']),
      matched: toNumOrNull_(r['そろった人数']),
      answered: toNumOrNull_(r['答えた人数']),
      _row: r._row
    };
  }).filter(function (o) { return o.number !== null && o.team; });
}

/** 全部の集計(元シートだけ10秒キャッシュ) */
function buildScores_(fresh) {
  // 派生値はキャッシュしない。
  var parts = readParticipants_(fresh);
  var byId = {};
  parts.forEach(function (p) { byId[p.id] = p; });
  var quizAnswers = readQuizAnswers_(fresh).filter(function (a) { return byId[a.participantId]; }).map(function (a) {
    var p = byId[a.participantId];
    return { team: p.team, include: p.quizInclude, nameRate: a.nameRate, originCorrect: a.originCorrect };
  });
  var result = computeAll({
    matches: readMatches_(fresh),
    settings: readSettings_(fresh),
    quizAnswers: quizAnswers,
    odai: readOdai_(fresh),
    predictions: readPredictions_(fresh)
  });

  return result;
}

/** 集計シートに書き込む(ロックの中で使う) */
function writeSummary_(result) {
  var sh = sheet_(SH_SUMMARY);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(toStr_);
  var map = {
    'チーム': 'team', 'バスケ順位点': 'basketball', 'バド順位点': 'badminton', 'ドッジ順位点': 'dodgeball',
    'バレー点(点数+ボーナス)': 'volleyball', '運動の合計': 'sportsTotal', 'クイズ': 'quiz', 'お題カード': 'odai',
    '予想': 'prediction', '仲良しの合計': 'nakayoshiTotal', '総合': 'total', '運動だけの順位': 'sportsRank', '総合順位': 'totalRank'
  };
  var data = result.teams.map(function (t) {
    return headers.map(function (h) { return map[h] ? t[map[h]] : ''; });
  });
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  sh.getRange(2, 1, data.length, headers.length).setValues(data);
}

/** 集計を計算し直して集計シートに書く(ロックの中で使う) */
function refreshSummary_() {
  invalidate_([]);
  var r = buildScores_(true);
  writeSummary_(r);
  return r;
}

/** チームの、来場している人(来場時刻あり) */
function arrivedMembers_(parts, team) {
  return parts.filter(function (p) { return p.team === team && p.arrivedAt !== null; });
}

/** 表示名(名簿の漢字名。無ければID) */
function displayName_(people, id) {
  var p = people[id];
  return p && p.name ? p.name : id;
}

/**
 * 予想を締め切ったか(本番前の変更 2)。運営が締め切った(予想の状態=公開)か、受付中のまま試合が確定した
 * (シートを直接確定にしたときも、締め切ったものとして扱う)
 */
function predictionClosed_(m) {
  return m.predictionStatus === '公開' || (m.predictionStatus === '受付中' && m.status === MATCH_CONFIRMED);
}

/** 人数の集計 [{team: 勝つと予想したチーム, count}] */
function predictionCounts_(m, preds) {
  return [m.team1, m.team2].filter(function (x) { return x; }).map(function (x) {
    return { team: x, count: preds.filter(function (p) { return p.choice === x; }).length };
  });
}

/** 的中率を画面用(%・小数第1位)にする。試合が確定していなければ null */
function predictionHitView_(m, preds) {
  var h = predictionHitRates(m, preds);
  if (!h) return null;
  var pc = function (x) { return x === null ? null : round1(x * 100); };
  return { overall: pc(h.overall), teams: h.teams.map(function (t) { return { team: t.team, rate: pc(t.rate), predicted: t.predicted }; }) };
}

/** その試合の予想を消す(ロックの中で使う)。
 *  予想は「自分専用の行」に書くので、行を詰めずにその試合の行だけを空にする。
 *  「予想公開」シートは 2026-11-13 から使っていないが、古い行が残っていれば一緒に消す */
function clearMatchPredictions_(mid) {
  [SH_PREDICTIONS, '予想公開'].forEach(function (name) {
    var t = readTable_(name, true);
    var hit = t.rows.filter(function (r) { return toStr_(r['試合ID']) === mid; });
    if (!hit.length) return;
    var sh = sheet_(name);
    hit.forEach(function (r) { sh.getRange(r._row, 1, 1, t.headers.length).clearContent(); });
    invalidate_([name]);
  });
}
