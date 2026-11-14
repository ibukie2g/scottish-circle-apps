/** 前半とクイズバスケの合計。同じ関数を運営画面にも埋め込む(外部依存なし)。 */
function basketballRoundScores(input, courts) {
  input = input || {};
  var points = { 'かんたん': [2, 1], 'ふつう': [3, 2], 'むずかしい': [5, 3] };
  var firstHalf = {}, quizPoints = {}, totals = {};
  var teams = [].concat.apply([], courts || []);
  if (teams.length !== 4 || new Set(teams).size !== 4 || teams.some(function (t) { return ['A', 'B', 'C', 'D'].indexOf(t) < 0; })) throw new Error('対戦チームが正しくありません');
  teams.forEach(function (t) {
    var raw = (input.firstHalf || {})[t];
    var n = raw === '' || raw === null || raw === undefined ? null : Number(raw);
    if (n !== null && (!isFinite(n) || n < 0 || Math.floor(n) !== n)) throw new Error('前半の点数は0以上の整数で入れてください');
    firstHalf[t] = n; quizPoints[t] = 0;
  });
  if (input.questions !== undefined && !Array.isArray(input.questions)) throw new Error('問題の記録が正しくありません');
  if ((input.questions || []).length > 30) throw new Error('1ラウンドの問題は30問までです');
  var questions = (input.questions || []).map(function (q) {
    if (!q || !Object.prototype.hasOwnProperty.call(points, q.difficulty)) throw new Error('問題の難しさを選んでください');
    if (!Array.isArray(q.orders) || q.orders.length !== 2) throw new Error('2コート分の正解順を入れてください');
    var orders = q.orders.map(function (order, i) {
      if (!Array.isArray(order) || order.length > 2 || new Set(order).size !== order.length || order.some(function (t) { return courts[i].indexOf(t) < 0; })) throw new Error('同じコートのチームを正解した順に選んでください');
      order.forEach(function (t, rank) { quizPoints[t] += points[q.difficulty][rank]; });
      return order.slice();
    });
    return { difficulty: q.difficulty, orders: orders };
  });
  teams.forEach(function (t) { totals[t] = (firstHalf[t] || 0) + quizPoints[t]; });
  return { input: { firstHalf: firstHalf, questions: questions }, quizPoints: quizPoints, totals: totals,
    ready: teams.every(function (t) { return firstHalf[t] !== null; }) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { basketballRoundScores: basketballRoundScores };
