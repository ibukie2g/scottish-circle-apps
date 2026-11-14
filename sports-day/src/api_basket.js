/** クイズバスケの運営用記録。氏名や問題文は保存しない。 */
function basketballMatches_(round) {
  var n = Number(round);
  if (n < 1 || n > 3 || Math.floor(n) !== n) throw appError_('INVALID', 'ラウンドは1〜3です');
  var matches = readMatches_(true);
  return [1, 2].map(function (court) {
    var m = findMatchById_(matches, 'B-R' + n + '-' + court);
    if (!m) throw appError_('NOT_FOUND', 'バスケの試合が見つかりません');
    return m;
  });
}

function basketballRoundView_(round) {
  var matches = basketballMatches_(round);
  var rows = readTable_(SH_BASKET, true).rows;
  var row = rows.filter(function (r) { return Number(r['ラウンド']) === Number(round); })[0];
  var input = { firstHalf: {}, questions: [] };
  if (row) {
    TEAMS.forEach(function (t) { input.firstHalf[t] = row['前半' + t]; });
    try { input.questions = JSON.parse(row['後半の問題(JSON)'] || '[]'); }
    catch (e) { throw appError_('INVALID', 'バスケ内訳の問題の記録を確認してください'); }
  }
  var courts = matches.map(function (m) { return [m.team1, m.team2]; });
  var score;
  try { score = basketballRoundScores(input, courts); }
  catch (e) { throw appError_('INVALID', e.message); }
  return { round: Number(round), revision: row ? Number(row['版']) || 0 : 0, input: score.input,
    courts: courts, totals: score.totals, quizPoints: score.quizPoints, matches: matches.map(matchView_) };
}

function adminGetBasketballRound(token, round) {
  return adminApi_(token, function () { return basketballRoundView_(round); });
}

/** confirm=false は内訳の途中保存だけ。true は2試合をまとめて確定する。 */
function adminSaveBasketballRound(token, round, input, revision, confirm) {
  return adminApi_(token, function () {
    return withLock_(function () {
      var view = basketballRoundView_(round);
      if (Number(revision) !== view.revision) throw appError_('CONFLICT', 'ほかの端末で内訳が保存されています。保存済みを読み直してから直してください');
      var score;
      try { score = basketballRoundScores(input, view.courts); }
      catch (e) { throw appError_('INVALID', e.message); }
      if (confirm && !score.ready) throw appError_('INVALID', '前半の点数を4チームとも入れてください(0点も入力してください)');
      var values = { 'ラウンド': view.round, '後半の問題(JSON)': JSON.stringify(score.input.questions), '版': view.revision + 1, '更新時刻': new Date() };
      TEAMS.forEach(function (t) { values['前半' + t] = score.input.firstHalf[t] === null ? '' : score.input.firstHalf[t]; });
      var row = readTable_(SH_BASKET, true).rows.filter(function (r) { return Number(r['ラウンド']) === view.round; })[0];
      if (row) updateRow_(SH_BASKET, row._row, values);
      else appendRows_(SH_BASKET, [values]);
      if (confirm) {
        var matches = basketballMatches_(round);
        matches.forEach(function (m) {
          updateRow_(SH_MATCHES, m._row, { '点数1': score.totals[m.team1], '点数2': score.totals[m.team2], '状態': MATCH_CONFIRMED });
        });
        invalidate_([SH_MATCHES]);
        refreshSummary_();
      }
      invalidate_([SH_BASKET]);
      return basketballRoundView_(round);
    });
  });
}
