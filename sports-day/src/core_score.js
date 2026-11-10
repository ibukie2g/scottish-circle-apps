/**
 * 試合・トーナメント・集計(純粋関数。GASにもNode.jsにも依存しない)
 *
 * 試合オブジェクトの形(シート「試合」の1行に対応):
 *   { id, sport, round, team1, team2, score1, score2, status('予定'|'確定'), predictionStatus, related }
 */

var TEAMS = ['A', 'B', 'C', 'D'];

var SPORT_BASKET = 'バスケ';
var SPORT_BADMINTON = 'バド';
var SPORT_DODGE = 'ドッジ';
var SPORT_VOLLEY = 'バレー';

var MATCH_PLANNED = '予定';
var MATCH_CONFIRMED = '確定';

// 最初から入れておく18試合(バスケ6+バド4+ドッジ4+バレー4)
var INITIAL_MATCHES = [
  { id: 'B-R1-1', sport: 'バスケ', round: '1ラウンド', team1: 'A', team2: 'B', related: '' },
  { id: 'B-R1-2', sport: 'バスケ', round: '1ラウンド', team1: 'C', team2: 'D', related: '' },
  { id: 'B-R2-1', sport: 'バスケ', round: '2ラウンド', team1: 'A', team2: 'C', related: '' },
  { id: 'B-R2-2', sport: 'バスケ', round: '2ラウンド', team1: 'B', team2: 'D', related: '' },
  { id: 'B-R3-1', sport: 'バスケ', round: '3ラウンド', team1: 'A', team2: 'D', related: '' },
  { id: 'B-R3-2', sport: 'バスケ', round: '3ラウンド', team1: 'B', team2: 'C', related: '' },
  { id: 'D-SF1', sport: 'バド', round: '準決勝①', team1: 'A', team2: 'C', related: '' },
  { id: 'D-SF2', sport: 'バド', round: '準決勝②', team1: 'B', team2: 'D', related: '' },
  { id: 'D-3RD', sport: 'バド', round: '3位決定戦', team1: '', team2: '', related: '' },
  { id: 'D-F', sport: 'バド', round: '決勝', team1: '', team2: '', related: '' },
  { id: 'G-1', sport: 'ドッジ', round: '1試合目', team1: 'B', team2: 'D', related: 'D-SF1' },
  { id: 'G-2', sport: 'ドッジ', round: '2試合目', team1: 'A', team2: 'C', related: 'D-SF2' },
  { id: 'G-3', sport: 'ドッジ', round: '3試合目', team1: '', team2: '', related: 'D-3RD' },
  { id: 'G-4', sport: 'ドッジ', round: '4試合目', team1: '', team2: '', related: 'D-F' },
  { id: 'V-SF1', sport: 'バレー', round: '準決勝①', team1: 'A', team2: 'B', related: '' },
  { id: 'V-SF2', sport: 'バレー', round: '準決勝②', team1: 'C', team2: 'D', related: '' },
  { id: 'V-3RD', sport: 'バレー', round: '3位決定戦', team1: '', team2: '', related: '' },
  { id: 'V-F', sport: 'バレー', round: '決勝', team1: '', team2: '', related: '' }
];

// 設定の既定値(設定シートに値がないとき)
var DEFAULT_SETTINGS = {
  rankPoints: [10, 7, 4, 2],
  volleyWinBonus: 3,
  quizNameMax: 7,
  quizOriginMax: 3,
  odaiAllMatch: 2,
  odaiFactor: 1.5,
  predictionMax: 2,
  quizNameSeconds: 120,
  quizOriginSeconds: 15
};

// 設定シートのキー → 設定オブジェクトのキー
var SETTING_KEYS = {
  '順位点': 'rankPoints',
  'バレー勝ちボーナス': 'volleyWinBonus',
  'クイズ:名前の満点': 'quizNameMax',
  'クイズ:出身地の満点': 'quizOriginMax',
  'お題カード:全員一致の点': 'odaiAllMatch',
  'お題カード:それ以外の係数': 'odaiFactor',
  '予想:1試合の満点': 'predictionMax',
  'クイズ:名前の制限時間(秒)': 'quizNameSeconds',
  'クイズ:出身地の制限時間(秒)': 'quizOriginSeconds'
};

/** 小数第1位に丸める */
function round1(x) {
  return Math.round((Number(x) || 0) * 10 + 1e-9) / 10;
}

function toNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(String(v).normalize('NFKC').trim());
  return isFinite(n) ? n : null;
}

/**
 * 設定シートの {キー: 値} を設定オブジェクトにする(読めない値は既定値)
 */
function parseSettings(kv) {
  kv = kv || {};
  var s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  Object.keys(SETTING_KEYS).forEach(function (jp) {
    if (!(jp in kv)) return;
    var key = SETTING_KEYS[jp];
    var raw = kv[jp];
    if (key === 'rankPoints') {
      var arr = String(raw).normalize('NFKC').split(/[,、\s\/]+/).map(toNum_).filter(function (x) { return x !== null; });
      if (arr.length >= 4) s.rankPoints = arr.slice(0, 4);
    } else {
      var n = toNum_(raw);
      if (n !== null) s[key] = n;
    }
  });
  return s;
}

/** 試合の勝ち負け。確定していなければ null。引き分けは draw:true */
function matchResult(m) {
  if (!m || m.status !== MATCH_CONFIRMED || !m.team1 || !m.team2) return null;
  var s1 = toNum_(m.score1);
  var s2 = toNum_(m.score2);
  if (s1 === null || s2 === null) return null;
  if (s1 === s2) return { draw: true, winner: null, loser: null, s1: s1, s2: s2 };
  return s1 > s2
    ? { draw: false, winner: m.team1, loser: m.team2, s1: s1, s2: s2 }
    : { draw: false, winner: m.team2, loser: m.team1, s1: s1, s2: s2 };
}

function findMatch_(matches, id) {
  for (var i = 0; i < matches.length; i++) if (matches[i].id === id) return matches[i];
  return null;
}

/**
 * トーナメントとドッジの組み合わせを自動で埋める
 * - バド(D-)・バレー(V-):準決勝2試合が確定したら、決勝=勝者どうし、3位決定戦=敗者どうし
 * - ドッジ:関連試合(同時に行うバドの試合)に出ていない2チーム
 * 準決勝を修正して勝者が変わったときも、組み合わせを入れ直す。
 * @return {{matches: object[], changes: {id:string, team1:string, team2:string}[]}}
 */
function fillDerivedMatches(matches) {
  var ms = matches.map(function (m) { return Object.assign({}, m); });
  var changes = [];
  function set(m, t1, t2) {
    if (!m) return;
    if (m.team1 !== t1 || m.team2 !== t2) {
      m.team1 = t1; m.team2 = t2;
      changes.push({ id: m.id, team1: t1, team2: t2 });
    }
  }
  ['D', 'V'].forEach(function (p) {
    var r1 = matchResult(findMatch_(ms, p + '-SF1'));
    var r2 = matchResult(findMatch_(ms, p + '-SF2'));
    if (r1 && r2 && !r1.draw && !r2.draw) {
      set(findMatch_(ms, p + '-F'), r1.winner, r2.winner);
      set(findMatch_(ms, p + '-3RD'), r1.loser, r2.loser);
    }
  });
  ms.forEach(function (m) {
    if (m.sport !== SPORT_DODGE || !m.related) return;
    var rel = findMatch_(ms, m.related);
    if (!rel || !rel.team1 || !rel.team2) return;
    var rest = TEAMS.filter(function (t) { return t !== rel.team1 && t !== rel.team2; });
    if (rest.length === 2) set(m, rest[0], rest[1]);
  });
  return { matches: ms, changes: changes };
}

/**
 * 同点は同順位(1,1,3,4 のような付け方)
 * @param {{team:string}[]} sorted よい順に並べたもの
 * @param {function(a,b):boolean} same 同じ成績か
 * @return {Object<string, number>} チーム → 順位
 */
function competitionRanks_(sorted, same) {
  var ranks = {};
  for (var i = 0; i < sorted.length; i++) {
    if (i > 0 && same(sorted[i - 1], sorted[i])) ranks[sorted[i].team] = ranks[sorted[i - 1].team];
    else ranks[sorted[i].team] = i + 1;
  }
  return ranks;
}

function rankPoint_(rank, rankPoints) {
  if (!rank) return 0;
  return Number(rankPoints[rank - 1]) || 0;
}

function emptyTeamMap_(v) {
  var o = {};
  TEAMS.forEach(function (t) { o[t] = typeof v === 'function' ? v() : v; });
  return o;
}

/**
 * 総当たり(バスケ・ドッジ)の順位
 * 勝ち=1、引き分け=0.5勝。useDiff なら勝ち数が同じとき得失点差で比べる。
 * 全試合が確定するまで順位点は0(complete=false)。
 */
function leagueStandings(matches, sport, useDiff, rankPoints) {
  var list = matches.filter(function (m) { return m.sport === sport; });
  var stats = emptyTeamMap_(function () { return { wins: 0, diff: 0, played: 0 }; });
  var confirmed = 0;
  list.forEach(function (m) {
    var r = matchResult(m);
    if (!r) return;
    confirmed++;
    if (!stats[m.team1] || !stats[m.team2]) return;
    stats[m.team1].played++; stats[m.team2].played++;
    stats[m.team1].diff += r.s1 - r.s2;
    stats[m.team2].diff += r.s2 - r.s1;
    if (r.draw) { stats[m.team1].wins += 0.5; stats[m.team2].wins += 0.5; }
    else stats[r.winner].wins += 1;
  });
  var complete = list.length > 0 && confirmed === list.length;
  var sorted = TEAMS.map(function (t) {
    return { team: t, wins: stats[t].wins, diff: stats[t].diff, played: stats[t].played };
  }).sort(function (a, b) {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (useDiff && b.diff !== a.diff) return b.diff - a.diff;
    return a.team < b.team ? -1 : 1;
  });
  var ranks = competitionRanks_(sorted, function (a, b) {
    return a.wins === b.wins && (!useDiff || a.diff === b.diff);
  });
  var points = emptyTeamMap_(0);
  if (complete) TEAMS.forEach(function (t) { points[t] = rankPoint_(ranks[t], rankPoints); });
  return {
    complete: complete,
    standings: sorted.map(function (s) {
      return { team: s.team, wins: s.wins, diff: s.diff, played: s.played, rank: ranks[s.team] };
    }),
    points: points
  };
}

/** バドのトーナメント:決勝・3位決定戦が確定したところから順位点を与える */
function tournamentRankPoints(matches, prefix, rankPoints) {
  var ranks = emptyTeamMap_(null);
  var f = matchResult(findMatch_(matches, prefix + '-F'));
  var third = matchResult(findMatch_(matches, prefix + '-3RD'));
  if (f && !f.draw) { ranks[f.winner] = 1; ranks[f.loser] = 2; }
  if (third && !third.draw) { ranks[third.winner] = 3; ranks[third.loser] = 4; }
  var points = emptyTeamMap_(0);
  TEAMS.forEach(function (t) { points[t] = rankPoint_(ranks[t], rankPoints); });
  return { complete: !!(f && third), ranks: ranks, points: points };
}

/** バレー:取った点数の合計 + 1勝ごとにボーナス(確定した試合だけ) */
function volleyballPoints(matches, winBonus) {
  var scored = emptyTeamMap_(0);
  var wins = emptyTeamMap_(0);
  var list = matches.filter(function (m) { return m.sport === SPORT_VOLLEY; });
  var confirmed = 0;
  list.forEach(function (m) {
    var r = matchResult(m);
    if (!r) return;
    confirmed++;
    if (m.team1 in scored) scored[m.team1] += r.s1;
    if (m.team2 in scored) scored[m.team2] += r.s2;
    if (!r.draw && r.winner in wins) wins[r.winner] += 1;
  });
  var points = emptyTeamMap_(0);
  TEAMS.forEach(function (t) { points[t] = scored[t] + wins[t] * winBonus; });
  return { complete: list.length > 0 && confirmed === list.length, scored: scored, wins: wins, points: points };
}

/**
 * 運動の点数(仲良しポイントなし)
 */
function computeSports(matches, settings) {
  var rp = settings.rankPoints;
  var basket = leagueStandings(matches, SPORT_BASKET, true, rp);
  var dodge = leagueStandings(matches, SPORT_DODGE, false, rp);
  var bad = tournamentRankPoints(matches, 'D', rp);
  var volley = volleyballPoints(matches, settings.volleyWinBonus);
  var teams = TEAMS.map(function (t) {
    var row = {
      team: t,
      basketball: round1(basket.points[t]),
      badminton: round1(bad.points[t]),
      dodgeball: round1(dodge.points[t]),
      volleyball: round1(volley.points[t])
    };
    row.sportsTotal = round1(row.basketball + row.badminton + row.dodgeball + row.volleyball);
    return row;
  });
  var ranks = rankBy_(teams, 'sportsTotal');
  teams.forEach(function (r) { r.sportsRank = ranks[r.team]; });
  return {
    teams: teams,
    detail: { basketball: basket, dodgeball: dodge, badminton: bad, volleyball: volley }
  };
}

function rankBy_(rows, key) {
  var sorted = rows.slice().sort(function (a, b) { return b[key] - a[key]; });
  return competitionRanks_(sorted, function (a, b) { return a[key] === b[key]; });
}

/**
 * クイズの点数
 * @param {{team:string, include:boolean, nameRate:(number|null), originCorrect:(boolean|null)}[]} answers
 *   回答した人ごと。include=false の人と nameRate=null の人は名前の平均に入れない。
 *   originCorrect=null(出身地の問題がなかった人)は出身地の計算に入れない。
 * @return {Object<string, {points:number, nameAvg:(number|null), originRate:(number|null), respondents:number}>}
 *   回答した人がいない項目は0点
 */
function computeQuizPoints(answers, settings) {
  var out = {};
  TEAMS.forEach(function (t) {
    var mine = (answers || []).filter(function (a) { return a.team === t && a.include !== false; });
    var rates = mine.filter(function (a) { return typeof a.nameRate === 'number' && isFinite(a.nameRate); })
      .map(function (a) { return a.nameRate; });
    var origins = mine.filter(function (a) { return a.originCorrect === true || a.originCorrect === false; });
    var nameAvg = rates.length ? rates.reduce(function (x, y) { return x + y; }, 0) / rates.length : null;
    var originRate = origins.length
      ? origins.filter(function (a) { return a.originCorrect; }).length / origins.length
      : null;
    var pts = (nameAvg === null ? 0 : settings.quizNameMax * nameAvg) +
      (originRate === null ? 0 : settings.quizOriginMax * originRate);
    out[t] = { points: round1(pts), nameAvg: nameAvg, originRate: originRate, respondents: mine.length };
  });
  return out;
}

/**
 * お題カードの点数。1枚ごとに:全員一致なら odaiAllMatch 点、それ以外は odaiFactor × そろった人数 ÷ 答えた人数
 * 答えた人数が0のカードは0点。
 * @param {{team:string, matched:number, answered:number}[]} rows
 */
function computeOdaiPoints(rows, settings) {
  var out = emptyTeamMap_(0);
  (rows || []).forEach(function (r) {
    if (!(r.team in out)) return;
    var answered = toNum_(r.answered) || 0;
    var matched = toNum_(r.matched) || 0;
    if (answered <= 0) return;
    if (matched > answered) matched = answered;
    out[r.team] += matched === answered ? settings.odaiAllMatch : settings.odaiFactor * matched / answered;
  });
  TEAMS.forEach(function (t) { out[t] = round1(out[t]); });
  return out;
}

/**
 * 勝敗予想の点数。確定した試合ごとに、予想したチーム(試合に出ていないチーム)の正答率 × 1試合の満点
 * 予想した人がいないチームはその試合0点。引き分けの試合は0点。
 * @param {object[]} matches
 * @param {{matchId:string, team:string, choice:string}[]} predictions
 */
function computePredictionPoints(matches, predictions, settings) {
  var out = emptyTeamMap_(0);
  var byMatch = {};
  (predictions || []).forEach(function (p) {
    (byMatch[p.matchId] = byMatch[p.matchId] || []).push(p);
  });
  Object.keys(byMatch).forEach(function (mid) {
    var m = findMatch_(matches, mid);
    var r = matchResult(m);
    if (!r || r.draw) return;
    TEAMS.forEach(function (t) {
      if (t === m.team1 || t === m.team2) return;
      var mine = byMatch[mid].filter(function (p) { return p.team === t; });
      if (!mine.length) return;
      var ok = mine.filter(function (p) { return p.choice === r.winner; }).length;
      out[t] += settings.predictionMax * ok / mine.length;
    });
  });
  TEAMS.forEach(function (t) { out[t] = round1(out[t]); });
  return out;
}

/**
 * 全部の集計
 * @param {{matches:object[], settings:object, quizAnswers:object[], odai:object[], predictions:object[]}} input
 * @return {{teams: object[], detail: object}}
 *   teams[i] = { team, basketball, badminton, dodgeball, volleyball, sportsTotal, sportsRank,
 *                quiz, odai, prediction, nakayoshiTotal, total, totalRank }
 */
function computeAll(input) {
  var settings = input.settings || DEFAULT_SETTINGS;
  var sports = computeSports(input.matches || [], settings);
  var quiz = computeQuizPoints(input.quizAnswers || [], settings);
  var odai = computeOdaiPoints(input.odai || [], settings);
  var pred = computePredictionPoints(input.matches || [], input.predictions || [], settings);
  var teams = sports.teams.map(function (r) {
    var row = Object.assign({}, r);
    row.quiz = quiz[r.team].points;
    row.odai = odai[r.team];
    row.prediction = pred[r.team];
    row.nakayoshiTotal = round1(row.quiz + row.odai + row.prediction);
    row.total = round1(row.sportsTotal + row.nakayoshiTotal);
    return row;
  });
  var ranks = rankBy_(teams, 'total');
  teams.forEach(function (r) { r.totalRank = ranks[r.team]; });
  return { teams: teams, detail: { sports: sports.detail, quiz: quiz } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TEAMS: TEAMS,
    INITIAL_MATCHES: INITIAL_MATCHES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    SETTING_KEYS: SETTING_KEYS,
    round1: round1,
    parseSettings: parseSettings,
    matchResult: matchResult,
    fillDerivedMatches: fillDerivedMatches,
    leagueStandings: leagueStandings,
    tournamentRankPoints: tournamentRankPoints,
    volleyballPoints: volleyballPoints,
    computeSports: computeSports,
    computeQuizPoints: computeQuizPoints,
    computeOdaiPoints: computeOdaiPoints,
    computePredictionPoints: computePredictionPoints,
    computeAll: computeAll
  };
}
