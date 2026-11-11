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

function readPredictions_(fresh) {
  return readTable_(SH_PREDICTIONS, fresh).rows.map(function (r) {
    return {
      matchId: toStr_(r['試合ID']),
      participantId: toStr_(r['参加者ID']),
      team: normTeam_(r['チーム']),
      choice: normTeam_(r['予想(勝つチーム)']),
      _row: r._row
    };
  }).filter(function (p) { return p.matchId && p.participantId && p.choice; });
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

function readQuizAnswers_(fresh) {
  return readTable_(SH_QUIZ_A, fresh).rows.map(function (r) {
    var oc = toStr_(r['出身地の正誤']);
    return {
      participantId: toStr_(r['参加者ID']),
      writtenCount: toNumOrNull_(r['書いた人数']) || 0,
      correctIds: splitIds_(r['正解と判定した人のID']),
      nameRate: toNumOrNull_(r['名前の正答率']),
      originAnswer: (cacheGetJson_('originResponse:' + r['参加者ID']) || {}).answer || '',
      originCorrect: oc === '' ? null : toBool_(r['出身地の正誤']),
      submittedAt: toMs_(r['送信時刻']),
      _row: r._row
    };
  }).filter(function (a) { return a.participantId; });
}

function readNearMisses_(fresh) {
  return readTable_(SH_NEAR, fresh).rows.map(function (r) {
    var j = toStr_(r['判定']).toUpperCase();
    return {
      number: toNumOrNull_(r['番号']),
      participantId: toStr_(r['参加者ID']),
      candidateId: toStr_(r['近い候補(参加者ID)']),
      judgement: j === 'OK' || j === 'NG' ? j : JUDGE_PENDING,
      _row: r._row
    };
  }).filter(function (n) { return n.number !== null && n.participantId; });
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

function clearMatchPredictions_(mid) {
  [SH_PREDICTIONS, '予想公開'].forEach(function (name) {
    var t = readTable_(name, true);
    var keep = t.rows.filter(function (r) { return toStr_(r['試合ID']) !== mid; });
    if (keep.length === t.rows.length) return;
    var sh = sheet_(name);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, t.headers.length).clearContent();
    appendRows_(name, keep);
    invalidate_([name]);
  });
}
function predictionPublished_(mid, team, fresh) {
  return readTable_('予想公開', fresh).rows.some(function (r) { return r['試合ID'] === mid && r['チーム'] === team; });
}
function publishPrediction_(mid, team) {
  if (!predictionPublished_(mid, team, true)) {
    appendRows_('予想公開', [{'試合ID': mid, 'チーム': team}]);
    invalidate_(['予想公開']);
  }
}
