// 集計・トーナメントのテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/core_score.js');

const settings = S.parseSettings({});

function base() {
  return S.INITIAL_MATCHES.map(m => Object.assign({ score1: '', score2: '', status: '予定' }, m));
}
function setScore(ms, id, s1, s2) {
  const m = ms.find(x => x.id === id);
  m.score1 = s1; m.score2 = s2; m.status = '確定';
  return ms;
}
function pts(result, key) {
  const o = {};
  for (const r of result.teams) o[r.team] = r[key];
  return o;
}

test('初期の試合は18試合(バスケ6・バド4・ドッジ4・バレー4)', () => {
  assert.equal(S.INITIAL_MATCHES.length, 18);
  const count = s => S.INITIAL_MATCHES.filter(m => m.sport === s).length;
  assert.equal(count('バスケ'), 6);
  assert.equal(count('バド'), 4);
  assert.equal(count('ドッジ'), 4);
  assert.equal(count('バレー'), 4);
});

test('parseSettings: 既定値と上書き', () => {
  assert.deepEqual(settings.rankPoints, [10, 7, 4, 2]);
  const s = S.parseSettings({ '順位点': '12, 8, 5, 3', 'バレー勝ちボーナス': '５', 'クイズ:名前の満点': 'abc' });
  assert.deepEqual(s.rankPoints, [12, 8, 5, 3]);
  assert.equal(s.volleyWinBonus, 5);
  assert.equal(s.quizNameMax, 7);
});

test('round1', () => {
  assert.equal(S.round1(1.25), 1.3);
  assert.equal(S.round1(0.15), 0.2);
  assert.equal(S.round1(2 / 3), 0.7);
});

test('トーナメント: 準決勝の確定で決勝・3位決定戦、ドッジの組み合わせを埋める', () => {
  const ms = base();
  setScore(ms, 'D-SF1', 21, 15); // A勝ち C負け
  let r = S.fillDerivedMatches(ms);
  assert.equal(r.matches.find(m => m.id === 'D-F').team1, ''); // 片方だけでは埋めない
  setScore(ms, 'D-SF2', 10, 21); // D勝ち B負け
  r = S.fillDerivedMatches(ms);
  const get = id => r.matches.find(m => m.id === id);
  assert.deepEqual([get('D-F').team1, get('D-F').team2], ['A', 'D']);
  assert.deepEqual([get('D-3RD').team1, get('D-3RD').team2], ['C', 'B']);
  // ドッジ: バドに出ていない2チーム
  assert.deepEqual([get('G-3').team1, get('G-3').team2], ['A', 'D']); // D-3RD(C,B)の残り
  assert.deepEqual([get('G-4').team1, get('G-4').team2], ['B', 'C']); // D-F(A,D)の残り
  assert.deepEqual([get('G-1').team1, get('G-1').team2], ['B', 'D']);
  assert.ok(r.changes.some(c => c.id === 'D-F'));
  // 元の配列は変えない
  assert.equal(ms.find(m => m.id === 'D-F').team1, '');
});

test('トーナメント: 準決勝の修正で組み合わせが変わる。変化がなければ changes は空', () => {
  const ms = base();
  setScore(ms, 'V-SF1', 25, 20); // A
  setScore(ms, 'V-SF2', 25, 20); // C
  const r1 = S.fillDerivedMatches(ms);
  const f1 = r1.matches.find(m => m.id === 'V-F');
  assert.deepEqual([f1.team1, f1.team2], ['A', 'C']);
  assert.deepEqual(S.fillDerivedMatches(r1.matches).changes, []);
  setScore(r1.matches, 'V-SF1', 18, 25); // 修正: B勝ち
  const r2 = S.fillDerivedMatches(r1.matches);
  const f = r2.matches.find(m => m.id === 'V-F');
  const t = r2.matches.find(m => m.id === 'V-3RD');
  assert.deepEqual([f.team1, f.team2], ['B', 'C']);
  assert.deepEqual([t.team1, t.team2], ['A', 'D']);
});

test('バスケ: 勝ち数→得失点差。全試合確定まで順位点0', () => {
  const ms = base();
  setScore(ms, 'B-R1-1', 10, 5); // A>B
  setScore(ms, 'B-R1-2', 8, 6);  // C>D
  let r = S.leagueStandings(ms, 'バスケ', true, settings.rankPoints);
  assert.equal(r.complete, false);
  assert.deepEqual(r.points, { A: 0, B: 0, C: 0, D: 0 });
  setScore(ms, 'B-R2-1', 10, 4); // A>C
  setScore(ms, 'B-R2-2', 9, 7);  // B>D
  setScore(ms, 'B-R3-1', 3, 12); // D>A
  setScore(ms, 'B-R3-2', 5, 7);  // C>B
  // A:2勝 +5+6-9=+2 / B:1勝 -5+2-2=-5 / C:2勝 +2-6+2=-2 / D:1勝 -2-2+9=+5
  r = S.leagueStandings(ms, 'バスケ', true, settings.rankPoints);
  assert.equal(r.complete, true);
  assert.deepEqual(r.standings.map(s => [s.team, s.rank]), [['A', 1], ['C', 2], ['D', 3], ['B', 4]]);
  assert.deepEqual(r.points, { A: 10, C: 7, D: 4, B: 2 });
});

test('バスケ: 勝ち数も得失点差も同じなら同順位・同点', () => {
  const ms = base();
  ['B-R1-1', 'B-R1-2', 'B-R2-1', 'B-R2-2', 'B-R3-1', 'B-R3-2'].forEach(id => setScore(ms, id, 5, 5));
  const r = S.leagueStandings(ms, 'バスケ', true, settings.rankPoints);
  assert.deepEqual(r.points, { A: 10, B: 10, C: 10, D: 10 });
});

test('バスケ: 勝ち数が同じで得失点差が違えば別順位、同じなら同順位', () => {
  const ms = base();
  setScore(ms, 'B-R1-1', 10, 5); // A>B +5
  setScore(ms, 'B-R1-2', 10, 5); // C>D +5
  setScore(ms, 'B-R2-1', 5, 5);  // A=C
  setScore(ms, 'B-R2-2', 5, 5);  // B=D
  setScore(ms, 'B-R3-1', 5, 6);  // D>A
  setScore(ms, 'B-R3-2', 6, 5);  // B>C
  // A:1.5勝 +4 / C:1.5勝 +4 / B:1.5勝 -4 / D:1.5勝 -4
  const r = S.leagueStandings(ms, 'バスケ', true, settings.rankPoints);
  assert.deepEqual(r.points, { A: 10, C: 10, B: 4, D: 4 });
});

test('ドッジ: 勝ち数が同じなら同順位、その順位の点を両方に', () => {
  let ms = base();
  setScore(ms, 'D-SF1', 21, 10); // A
  setScore(ms, 'D-SF2', 21, 10); // B
  ms = S.fillDerivedMatches(ms).matches; // G-3: A,B  G-4: C,D
  setScore(ms, 'G-1', 3, 1); // B>D
  setScore(ms, 'G-2', 3, 1); // A>C
  setScore(ms, 'G-3', 2, 1); // A>B
  setScore(ms, 'G-4', 2, 1); // C>D
  // A:2勝, B:1勝, C:1勝, D:0勝
  const r = S.leagueStandings(ms, 'ドッジ', false, settings.rankPoints);
  assert.deepEqual(r.points, { A: 10, B: 7, C: 7, D: 2 });
});

test('バド: 決勝・3位決定戦の結果から順位点(わかったところから)', () => {
  let ms = base();
  setScore(ms, 'D-SF1', 21, 10); // A
  setScore(ms, 'D-SF2', 10, 21); // D
  ms = S.fillDerivedMatches(ms).matches;
  setScore(ms, 'D-3RD', 21, 19); // C>B
  let r = S.tournamentRankPoints(ms, 'D', settings.rankPoints);
  assert.equal(r.complete, false);
  assert.deepEqual(r.points, { A: 0, B: 2, C: 4, D: 0 });
  setScore(ms, 'D-F', 15, 21); // D優勝
  r = S.tournamentRankPoints(ms, 'D', settings.rankPoints);
  assert.equal(r.complete, true);
  assert.deepEqual(r.points, { A: 7, B: 2, C: 4, D: 10 });
});

test('バレー: 取った点数の合計+1勝ごとにボーナス', () => {
  let ms = base();
  setScore(ms, 'V-SF1', 25, 20); // A
  setScore(ms, 'V-SF2', 18, 25); // D
  ms = S.fillDerivedMatches(ms).matches; // F: A-D, 3RD: B-C
  setScore(ms, 'V-F', 25, 23);   // A
  setScore(ms, 'V-3RD', 25, 22); // B
  const r = S.volleyballPoints(ms, S.DEFAULT_SETTINGS.volleyWinBonus);
  assert.equal(S.DEFAULT_SETTINGS.volleyWinBonus, 4); // 2026-11-14 決定:勝ちボーナスは +4
  assert.equal(r.complete, true);
  assert.deepEqual(r.points, { A: 25 + 25 + 8, B: 20 + 25 + 4, C: 18 + 22, D: 25 + 23 + 4 });
  // 25点マッチでも20点マッチでも、取った点数をそのまま足す
  assert.equal(S.computeSports(ms, S.DEFAULT_SETTINGS).teams.find(t => t.team === 'A').volleyball, 58);
});

test('クイズ: 名前7点×平均正答率+出身地3点×正答率。含めない人は除外、回答者なしは0点', () => {
  const answers = [
    { team: 'A', include: true, nameRate: 1, originCorrect: true },
    { team: 'A', include: true, nameRate: 0.5, originCorrect: false },
    { team: 'A', include: false, nameRate: 0, originCorrect: false }, // 含めない
    { team: 'B', include: true, nameRate: 3 / 7, originCorrect: null }, // 出身地の問題なし
    { team: 'C', include: false, nameRate: 1, originCorrect: true }
  ];
  const q = S.computeQuizPoints(answers, settings);
  assert.equal(q.A.points, 6.8); // 7*0.75 + 3*0.5
  assert.equal(q.B.points, 3);   // 7*3/7、出身地は0点
  assert.equal(q.B.originRate, null);
  assert.equal(q.C.points, 0);   // 含める人がいない
  assert.equal(q.D.points, 0);   // 回答者なし
  assert.equal(q.D.nameAvg, null);
  assert.ok(Number.isFinite(q.D.points));
});

test('クイズ: 回答なしの配列でも0点(0除算にならない)', () => {
  const q = S.computeQuizPoints([], settings);
  for (const t of S.TEAMS) assert.equal(q[t].points, 0);
});

test('お題カード: 全員一致2点、それ以外1.5×そろった÷答えた、答えた0人は0点', () => {
  const o = S.computeOdaiPoints([
    { number: 1, team: 'A', matched: 8, answered: 8 },
    { number: 2, team: 'A', matched: 6, answered: 8 },
    { number: 1, team: 'B', matched: 0, answered: 0 },
    { number: 2, team: 'B', matched: 3, answered: 0 },
    { number: 1, team: 'C', matched: 0, answered: 7 },
    { number: 1, team: 'X', matched: 1, answered: 1 }
  ], settings);
  assert.equal(o.A, S.round1(2 + 1.5 * 6 / 8)); // 3.1
  assert.equal(o.B, 0);
  assert.equal(o.C, 0);
  assert.equal(o.D, 0);
});

test('予想: 1試合2点×そのチームの正答率。予想者なし・引き分け・未確定は0点', () => {
  const ms = base();
  setScore(ms, 'V-SF1', 25, 20); // A勝ち、予想するのは C・D
  const preds = [
    { matchId: 'V-SF1', team: 'C', choice: 'A' },
    { matchId: 'V-SF1', team: 'C', choice: 'A' },
    { matchId: 'V-SF1', team: 'C', choice: 'B' },
    { matchId: 'V-SF1', team: 'A', choice: 'A' }, // 出場チームの予想は数えない
    { matchId: 'V-SF2', team: 'A', choice: 'C' }  // 未確定
  ];
  const p = S.computePredictionPoints(ms, preds, settings);
  assert.deepEqual(p, { A: 0, B: 0, C: S.round1(2 * 2 / 3), D: 0 }); // D は予想者なし
  setScore(ms, 'V-SF2', 20, 20); // 引き分け
  assert.equal(S.computePredictionPoints(ms, preds, settings).A, 0);
  assert.deepEqual(S.computePredictionPoints(ms, [], settings), { A: 0, B: 0, C: 0, D: 0 });
});

test('computeAll: 合計・運動だけの順位・総合順位', () => {
  const ms = base();
  // バスケ: A3勝, B2勝, C1勝, D0勝
  setScore(ms, 'B-R1-1', 10, 5); setScore(ms, 'B-R1-2', 8, 6);
  setScore(ms, 'B-R2-1', 10, 4); setScore(ms, 'B-R2-2', 9, 7);
  setScore(ms, 'B-R3-1', 12, 3); setScore(ms, 'B-R3-2', 7, 5);
  const r = S.computeAll({
    matches: ms, settings,
    quizAnswers: [{ team: 'D', include: true, nameRate: 1, originCorrect: true }],
    odai: [{ number: 1, team: 'D', matched: 5, answered: 5 }],
    predictions: []
  });
  assert.deepEqual(pts(r, 'sportsTotal'), { A: 10, B: 7, C: 4, D: 2 });
  assert.deepEqual(pts(r, 'sportsRank'), { A: 1, B: 2, C: 3, D: 4 });
  const d = r.teams.find(t => t.team === 'D');
  assert.equal(d.nakayoshiTotal, 12);
  assert.equal(d.total, 14);
  assert.deepEqual(pts(r, 'totalRank'), { A: 2, B: 3, C: 4, D: 1 });
});

test('computeAll: 何も確定していなければ全員0点・同順位1位', () => {
  const r = S.computeAll({ matches: base(), settings });
  assert.deepEqual(pts(r, 'total'), { A: 0, B: 0, C: 0, D: 0 });
  assert.deepEqual(pts(r, 'totalRank'), { A: 1, B: 1, C: 1, D: 1 });
});
