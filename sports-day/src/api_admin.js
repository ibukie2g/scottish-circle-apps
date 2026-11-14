/**
 * 運営の画面から google.script.run で呼ぶ関数。すべてトークン(adminLogin で受け取る)が必要
 * 戻り値はすべて { ok: true, data } か { ok: false, error: { code, message } }(docs/API.md)
 */

var ADMIN_TOKEN_SEC = 21600; // 6時間(CacheService の上限)

// 予想を締め切る前に、運営画面にも人数の内訳を出すか。
// false = 出さない(「締め切るまで、予想の中身はだれにも見えない」。運営も参加者なので)。true にすると運営画面だけ内訳が見える
var PREDICTION_ADMIN_SEES_COUNTS = false;

// ============ ログイン ============

/** パスワードを確かめてトークンを返す */
function adminLogin(password) {
  return api_(function () {
    var pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
    if (!pw) throw appError_('SETUP', 'スクリプト プロパティ ADMIN_PASSWORD が設定されていません');
    if (toStr_(password) !== pw) {
      Utilities.sleep(800); // 総当たりを少し遅くする
      throw appError_('AUTH', 'パスワードが違います');
    }
    var token = Utilities.getUuid();
    cache_().put('admin:' + token, '1', ADMIN_TOKEN_SEC);
    return { token: token, expiresInSec: ADMIN_TOKEN_SEC };
  });
}

function requireAdmin_(token) {
  var t = toStr_(token);
  if (!t || !cache_().get('admin:' + t)) throw appError_('AUTH', 'ログインし直してください');
  cache_().put('admin:' + t, '1', ADMIN_TOKEN_SEC); // 使うたびに延長
}

/** 運営用の関数の外側(トークン確認つき) */
function adminApi_(token, fn) {
  return api_(function () {
    requireAdmin_(token);
    return fn();
  });
}

// ============ 一覧 ============

/** 運営画面に必要なものをまとめて返す */
function adminGetOverview(token) {
  return adminApi_(token, function () {
    var st = readState_(true);
    var settings = readSettings_(true);
    var people = readPeople_();
    var intros = readIntros_();
    var answers = readQuizAnswers_(true).map(function (a) { return a.participantId; });
    var participants = readParticipants_(true).map(function (p) {
      var pp = people[p.id] || {};
      var it = intros[p.id];
      return {
        id: p.id, name: pp.name || '', kana: pp.kana || '', team: p.team,
        arrivedAt: p.arrivedAt, walkIn: p.walkIn, quizInclude: p.quizInclude,
        introDone: !!(it && it.comment), quizAnswered: answers.indexOf(p.id) >= 0
      };
    });
    participants.sort(function (a, b) {
      if (a.team !== b.team) return a.team < b.team ? -1 : 1;
      return (a.kana || a.name).localeCompare(b.kana || b.name, 'ja');
    });
    return {
      state: stateForAdmin_(st, settings),
      participants: participants,
      matches: readMatches_(true).map(matchView_),
      settings: settingsRows_(),
      pendingNearMisses: readNearMisses_(true).filter(function (n) { return n.judgement === JUDGE_PENDING; }).length,
      odaiCount: readOdai_(true).filter(function (o) { return o.number >= 1 && o.number <= 3; }).length, // お題カードの入力済みの数(3枚×4チーム=12)
      unsplitNames: countUnsplitNames_(), // 名簿の名前が「名字 名前」と空白で分かれていない人数
      serverNow: Date.now()
    };
  });
}

function stateForAdmin_(st, settings) {
  return {
    mode: st.mode, currentEvent: st.currentEvent, nextEvent: st.nextEvent,
    predictionMatchId: st.predictionMatchId, predictionOpenedAt: st.predictionOpenedAt,
    quizStartedAt: st.quizStartedAt, updatedAt: st.updatedAt,
    quiz: st.quizStartedAt ? quizTiming_(st, settings) : null,
    modes: MODES
  };
}

// ============ 状態 ============

/**
 * 状態を切り替える。渡した項目だけ変える
 * @param {{mode?:string, currentEvent?:string, nextEvent?:string, predictionMatchId?:string}} patch
 */
function adminSetState(token, patch) {
  return adminApi_(token, function () {
    patch = patch || {};
    return withLock_(function () {
      var cur = readState_(true);
      var values = {};
      if ('mode' in patch) {
        var mode = toStr_(patch.mode);
        if (MODES.indexOf(mode) < 0) throw appError_('INVALID', 'モードは ' + MODES.join('/') + ' のどれかです');
        if (mode === 'クイズ' && cur.mode !== 'クイズ') {
          startQuizInternal_(false);
        } else {
          values['モード'] = mode;
        }
      }
      if ('currentEvent' in patch) values['今の種目'] = toStr_(patch.currentEvent);
      if ('nextEvent' in patch) values['次の種目'] = toStr_(patch.nextEvent);
      if ('predictionMatchId' in patch) {
        var mid = toStr_(patch.predictionMatchId);
        if (mid && !findMatchById_(readMatches_(true), mid)) throw appError_('INVALID', '試合ID ' + mid + ' がありません');
        values['予想の試合ID'] = mid;
      }
      if (Object.keys(values).length) writeState_(values);
      return stateForAdmin_(readState_(true), readSettings_(true));
    });
  });
}

/** 結果を全員のスマホに公開する(モードを「結果公開」に) */
function adminPublishResults(token) {
  return adminApi_(token, function () {
    return withLock_(function () {
      refreshSummary_();
      writeState_({ 'モード': '結果公開' });
      return stateForAdmin_(readState_(true), readSettings_(true));
    });
  });
}

// ============ 試合 ============

function adminGetMatches(token) {
  return adminApi_(token, function () {
    return { matches: readMatches_(true).map(matchView_) };
  });
}

/**
 * 試合の点数を入れて確定する(確定済みの修正も同じ関数)
 * 準決勝の確定で決勝・3位決定戦・ドッジの組み合わせを自動で埋める
 */
function adminSaveMatch(token, matchId, score1, score2) {
  return adminApi_(token, function () {
    var s1 = toNumOrNull_(score1);
    var s2 = toNumOrNull_(score2);
    if (s1 === null || s2 === null || s1 < 0 || s2 < 0) throw appError_('INVALID', '点数は0以上の数で入れてください');
    return withLock_(function () {
      var matches = readMatches_(true);
      var m = findMatchById_(matches, toStr_(matchId));
      if (!m) throw appError_('NOT_FOUND', '試合ID ' + matchId + ' がありません');
      if (!m.team1 || !m.team2) throw appError_('INVALID', 'まだ対戦チームが決まっていません');
      if ((m.sport === SPORT_BADMINTON || m.sport === SPORT_VOLLEY) && s1 === s2) {
        throw appError_('INVALID', 'トーナメントの試合は引き分けにできません');
      }
      var values = { '点数1': s1, '点数2': s2, '状態': MATCH_CONFIRMED };
      // 予想を締め切る前に点数を確定したら、自動で締め切る(本番前の変更 2)
      var autoClosed = m.predictionStatus === '受付中';
      if (autoClosed) { values['予想の状態'] = '公開'; m.predictionStatus = '公開'; }
      updateRow_(SH_MATCHES, m._row, values);
      m.score1 = s1; m.score2 = s2; m.status = MATCH_CONFIRMED;
      var changes = applyDerived_(matches);
      invalidate_([SH_MATCHES]);
      var scores = refreshSummary_();
      return { match: matchView_(m), changes: changes, teams: scores.teams, predictionClosed: autoClosed };
    });
  });
}

/** 組み合わせの自動補完をシートに書く(ロックの中で使う) */
function applyDerived_(matches) {
  var r = fillDerivedMatches(matches);
  r.changes.forEach(function (c) {
    var m = findMatchById_(matches, c.id);
    updateRow_(SH_MATCHES, m._row, { 'チーム1': c.team1, 'チーム2': c.team2, '点数1': '', '点数2': '', '状態': MATCH_PLANNED, '予想の状態': m.sport === SPORT_VOLLEY ? '受付前' : 'なし' });
    clearMatchPredictions_(c.id);
  });
  if (r.changes.length) invalidate_([SH_MATCHES, SH_PREDICTIONS]);
  return r.changes;
}

/** 確定を取り消す(状態を「予定」に戻す。点数は残す) */
function adminUnconfirmMatch(token, matchId) {
  return adminApi_(token, function () {
    return withLock_(function () {
      var m = findMatchById_(readMatches_(true), toStr_(matchId));
      if (!m) throw appError_('NOT_FOUND', '試合ID ' + matchId + ' がありません');
      updateRow_(SH_MATCHES, m._row, { '状態': MATCH_PLANNED });
      invalidate_([SH_MATCHES]);
      var scores = refreshSummary_();
      m.status = MATCH_PLANNED;
      return { match: matchView_(m), teams: scores.teams };
    });
  });
}

/** 対戦チームを手で直す(自動補完がうまくいかないとき) */
function adminSetMatchTeams(token, matchId, team1, team2) {
  return adminApi_(token, function () {
    var t1 = normTeam_(team1);
    var t2 = normTeam_(team2);
    if (!t1 || !t2 || t1 === t2) throw appError_('INVALID', 'チームは A〜D の違う2チームです');
    return withLock_(function () {
      var m = findMatchById_(readMatches_(true), toStr_(matchId));
      if (!m) throw appError_('NOT_FOUND', '試合ID ' + matchId + ' がありません');
      updateRow_(SH_MATCHES, m._row, { 'チーム1': t1, 'チーム2': t2 });
      invalidate_([SH_MATCHES]);
      refreshSummary_();
      m.team1 = t1; m.team2 = t2;
      return { match: matchView_(m) };
    });
  });
}

// ============ 予想 ============

/**
 * 予想の状態を変える
 * - '受付中':受付開始。あわせて状態のモードを「予想」、予想の試合IDをこの試合にする
 * - '公開':締め切り(予想した2チームに人数の集計を見せ、変更できなくする)
 * - '受付前' / 'なし':元に戻す
 */
function adminSetPredictionStatus(token, matchId, status) {
  return adminApi_(token, function () {
    var s = toStr_(status);
    if (PREDICTION_STATUSES.indexOf(s) < 0) throw appError_('INVALID', '予想の状態は ' + PREDICTION_STATUSES.join('/') + ' のどれかです');
    return withLock_(function () {
      var m = findMatchById_(readMatches_(true), toStr_(matchId));
      if (!m) throw appError_('NOT_FOUND', '試合ID ' + matchId + ' がありません');
      if (s === '受付中' && (!m.team1 || !m.team2)) throw appError_('INVALID', 'まだ対戦チームが決まっていません');
      var wasOpen = m.predictionStatus === '受付中' || m.predictionStatus === '公開';
      updateRow_(SH_MATCHES, m._row, { '予想の状態': s });
      invalidate_([SH_MATCHES]);
      if (s === '受付中') {
        var cur = readState_(true);
        var st = { 'モード': '予想', '予想の試合ID': m.id };
        // 受付を始めた時刻(運営画面の経過時間に使う)。「受付中に戻す」では変えない
        if (!(wasOpen && cur.predictionMatchId === m.id && cur.predictionOpenedAt)) st['予想の受付開始時刻'] = new Date();
        writeState_(st);
      }
      refreshSummary_();
      return predictionSummary_(m.id, true);
    });
  });
}

/** 予想の集まり具合(チームごとの来場人数・予想人数・内訳) */
function adminGetPredictionSummary(token, matchId) {
  return adminApi_(token, function () {
    var mid = toStr_(matchId) || readState_(true).predictionMatchId;
    return predictionSummary_(mid, true);
  });
}

function predictionSummary_(mid, fresh) {
  var m = findMatchById_(readMatches_(fresh), mid);
  if (!m) throw appError_('NOT_FOUND', '試合ID ' + mid + ' がありません');
  var parts = readParticipants_(fresh);
  var preds = readPredictions_(fresh).filter(function (p) { return p.matchId === m.id; });
  var closed = predictionClosed_(m);
  var showCounts = closed || PREDICTION_ADMIN_SEES_COUNTS;
  var st = readState_(fresh);
  var teams = TEAMS.filter(function (t) { return t !== m.team1 && t !== m.team2; }).map(function (t) {
    var tp = preds.filter(function (p) { return p.team === t; });
    var arrived = arrivedMembers_(parts, t);
    var ids = tp.map(function (p) { return p.participantId; });
    return {
      team: t,
      arrived: arrived.length,
      predicted: tp.length,
      complete: arrived.length > 0 && arrived.every(function (p) { return ids.indexOf(p.id) >= 0; }),
      counts: showCounts ? predictionCounts_(m, tp) : null
    };
  });
  return {
    match: matchView_(m),
    closed: closed,
    openedAt: st.predictionMatchId === m.id ? st.predictionOpenedAt : null,
    teams: teams,
    hit: closed ? predictionHitView_(m, preds) : null
  };
}

// ============ クイズ ============

/**
 * クイズ開始:モードを「クイズ」、クイズ開始時刻を今にして、全員分の問題を作る
 * @param {{regenerate?: boolean}} [options] regenerate=true なら、まだ答えていない人の問題を作り直す
 */
function adminStartQuiz(token, options) {
  return adminApi_(token, function () {
    var regen = !!(options && options.regenerate);
    return withLock_(function () {
      var r = startQuizInternal_(regen);
      r.state = stateForAdmin_(readState_(true), readSettings_(true));
      return r;
    });
  });
}

/** ロックの中で使う */
function startQuizInternal_(regenerate) {
  var parts = readParticipants_(true);
  var people = readPeople_(true);
  var answered = readQuizAnswers_(true).map(function (a) { return a.participantId; });
  var existing = readQuizQuestions_(true);
  var keep = existing.filter(function (q) { return !regenerate || answered.indexOf(q.participantId) >= 0; });
  var keepIds = keep.map(function (q) { return q.participantId; });
  var made = parts.filter(function (p) { return keepIds.indexOf(p.id) < 0; }).map(function (p) {
    return generateQuestion_(p.id, parts, people);
  });
  if (regenerate) {
    var sh = sheet_(SH_QUIZ_Q);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    appendRows_(SH_QUIZ_Q, keep.map(questionRow_).concat(made.map(questionRow_)));
  } else {
    appendRows_(SH_QUIZ_Q, made.map(questionRow_));
  }
  writeState_({ 'モード': 'クイズ', 'クイズ開始時刻': new Date() });
  invalidate_([SH_QUIZ_Q]);
  // 名前の控えのシートを、全員が一斉に送る前に作っておく(なくても送信は止めない)
  try { rosterNearSheet_(true); } catch (e) { console.warn('名簿ファイルに「' + ROSTER_NEAR_SHEET + '」を作れませんでした: ' + e); }
  return { generated: made.length, kept: keep.length };
}

/** チームごとのクイズの回答状況 */
function adminGetQuizStatus(token) {
  return adminApi_(token, function () {
    var parts = readParticipants_(true);
    var answered = readQuizAnswers_(true).map(function (a) { return a.participantId; });
    var scores = buildScores_(true);
    return {
      teams: TEAMS.map(function (t) {
        var mem = parts.filter(function (p) { return p.team === t; });
        var q = scores.detail.quiz[t];
        return {
          team: t,
          members: mem.length,
          arrived: mem.filter(function (p) { return p.arrivedAt !== null; }).length,
          answered: mem.filter(function (p) { return answered.indexOf(p.id) >= 0; }).length,
          nameRate: q.nameAvg === null ? null : round1(q.nameAvg * 100),
          originRate: q.originRate === null ? null : round1(q.originRate * 100),
          points: q.points
        };
      })
    };
  });
}

/**
 * 運営が判断する答えの一覧。同じチームの同じ答えは1件にまとめる。
 * 入力はキャッシュ(6時間)から読む。キャッシュが消えていたら名簿ファイルの控え(「惜しい答え(入力)」)から読む。
 * どちらにもなければ input は null(まとめずに1件ずつ出す)
 * @param {boolean} [includeJudged] true なら判断済みも返す(公開後に直すとき)
 */
function adminListNearMisses(token, includeJudged) {
  return adminApi_(token, function () {
    var people = readPeople_();
    var parts = readParticipants_(true);
    var all = readNearMisses_(true);
    var rows = all.filter(function (n) { return includeJudged || n.judgement === JUDGE_PENDING; });
    var cached = rows.length ? cache_().getAll(rows.map(function (n) { return 'near:' + n.number; })) : {};
    // キャッシュが消えていた分だけ、名簿ファイルの控えから読む
    var missing = rows.filter(function (n) { return !cached['near:' + n.number]; }).map(function (n) { return n.number; });
    var saved = readNearInputs_(missing);
    var groups = {};
    var items = [];
    rows.forEach(function (n) {
      var c = cached['near:' + n.number];
      var input = null;
      if (c) { try { input = JSON.parse(c).input; } catch (e) { input = null; } }
      if (input === null && saved[String(n.number)] !== undefined) input = saved[String(n.number)];
      var who = findParticipant_(parts, n.participantId);
      var team = who ? who.team : '';
      var key = [team, input === null ? '#' + n.number : normalizeName(input), n.judgement, n.candidateId].join('|');
      var g = groups[key];
      if (!g) {
        var cand = people[n.candidateId] || {};
        g = groups[key] = {
          number: n.number,
          numbers: [],
          count: 0,
          team: team,
          input: input,
          candidateId: n.candidateId,
          candidateName: n.candidateId ? (cand.name || n.candidateId) : '',
          candidateKana: cand.kana || '',
          judgement: n.judgement
        };
        items.push(g);
      }
      g.numbers.push(n.number);
      g.count++;
    });
    // 未判断を先に、その中では候補があるものを先に
    items.sort(function (a, b) {
      var pa = a.judgement === JUDGE_PENDING ? 0 : 1, pb = b.judgement === JUDGE_PENDING ? 0 : 1;
      if (pa !== pb) return pa - pb;
      var ca = a.candidateId ? 0 : 1, cb = b.candidateId ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return a.number - b.number;
    });
    return {
      items: items,
      pendingCount: all.filter(function (n) { return n.judgement === JUDGE_PENDING; }).length,
      decisions: [JUDGE_FULL, JUDGE_HALF, JUDGE_NG]
    };
  });
}

/**
 * 運営の判断。その人のクイズの点数(と総合点)を計算し直す。結果を公開したあとでも直せる
 * @param {number|number[]} numbers 番号(同じ答えをまとめて判断するときは配列)
 * @param {string} decision '1人分' / '0.5人分' / '×'(「未」に戻すこともできる。古い 'OK'・'NG' も可)
 * @param {string} [candidateId] だれの答えとして数えるか。省くとアプリが推測した候補のまま
 */
function adminJudgeNearMiss(token, numbers, decision, candidateId) {
  return adminApi_(token, function () {
    var d = toStr_(decision) === JUDGE_PENDING ? JUDGE_PENDING : normJudgement_(decision);
    if (d === JUDGE_PENDING && toStr_(decision) !== JUDGE_PENDING) {
      throw appError_('INVALID', '判断は ' + [JUDGE_FULL, JUDGE_HALF, JUDGE_NG].join(' / ') + ' のどれかです');
    }
    var nos = (Array.isArray(numbers) ? numbers : [numbers]).map(toNumOrNull_).filter(function (x) { return x !== null; });
    var cand = toStr_(candidateId);
    return withLock_(function () {
      var targets = readNearMisses_(true).filter(function (x) { return nos.indexOf(x.number) >= 0; });
      if (!targets.length) throw appError_('NOT_FOUND', '判断する答え(' + nos.join(',') + ')がありません');
      var questions = readQuizQuestions_(true);
      // 先に全部確かめてから書く(途中まで書いて止まらないように)
      if (d === JUDGE_FULL || d === JUDGE_HALF) {
        targets.forEach(function (n) {
          var c = cand || n.candidateId;
          if (!c) throw appError_('INVALID', 'だれの答えか選んでください');
          var q = findBy_(questions, n.participantId);
          if (q && q.nameTargets.indexOf(c) < 0) throw appError_('INVALID', 'その人は、この答えを書いた人のクイズの対象ではありません');
        });
      }
      var touched = [];
      targets.forEach(function (n) {
        var values = { '判定': d };
        if (cand && cand !== n.candidateId) values['近い候補(参加者ID)'] = cand;
        updateRow_(SH_NEAR, n._row, values);
        if (touched.indexOf(n.participantId) < 0) touched.push(n.participantId);
      });
      invalidate_([SH_NEAR]);
      touched.forEach(recomputeNameScore_);
      invalidate_([SH_NEAR, SH_QUIZ_A]);
      refreshSummary_();
      return { numbers: targets.map(function (n) { return n.number; }), judgement: d, updated: targets.length };
    });
  });
}

// ============ お題カード ============

/** お題カードの入力済みの行と、チームごとの「答えた人数」の初期値(来場人数) */
function adminGetOdai(token) {
  return adminApi_(token, function () {
    var parts = readParticipants_(true);
    var defaults = {};
    TEAMS.forEach(function (t) { defaults[t] = arrivedMembers_(parts, t).length; });
    return {
      rows: readOdai_(true).map(function (o) {
        return { number: o.number, theme: o.theme, team: o.team, matched: o.matched, answered: o.answered };
      }),
      defaultAnswered: defaults
    };
  });
}

/**
 * お題カードを入れる(お題番号+チームが同じ行があれば上書き)
 * @param {{number:number, theme?:string, team:string, matched:number, answered:number}} input
 */
function adminSaveOdai(token, input) {
  return adminApi_(token, function () {
    input = input || {};
    var no = toNumOrNull_(input.number);
    var team = normTeam_(input.team);
    var matched = toNumOrNull_(input.matched);
    var answered = toNumOrNull_(input.answered);
    if (no === null || no < 1 || no > 3 || Math.floor(no) !== no) throw appError_('INVALID', 'お題番号を入れてください');
    if (!team) throw appError_('INVALID', 'チームは A〜D です');
    if (matched === null || answered === null || matched < 0 || answered < 0) throw appError_('INVALID', '人数は0以上の数です');
    if (matched > answered) throw appError_('INVALID', 'そろった人数が答えた人数より多いです');
    return withLock_(function () {
      var row = readOdai_(true).filter(function (o) { return o.number === no && o.team === team; })[0];
      var values = { 'お題番号': no, 'チーム': team, 'そろった人数': matched, '答えた人数': answered };
      if ('theme' in input) values['お題'] = toStr_(input.theme);
      if (row) updateRow_(SH_ODAI, row._row, values);
      else appendRows_(SH_ODAI, [values]);
      invalidate_([SH_ODAI]);
      var scores = refreshSummary_();
      return { saved: true, teams: scores.teams };
    });
  });
}

// ============ 名簿・参加者 ============

/** 名簿を読み込む(チームが入っている人にIDを採番して参加者シートへ) */
function adminImportRoster(token, options) {
  return adminApi_(token, function () {
    var r = importRoster_(!!(options && options.overwriteTeams));
    r.unsplitNames = countUnsplitNames_(); // 名前が空白で分かれていない人数(名前だけ・名字だけの判定が使えない人)
    return r;
  });
}

/** 当日追加 {name, kana, team, origin} */
function adminAddWalkIn(token, input) {
  return adminApi_(token, function () {
    return addWalkIn_(input);
  });
}

function updateParticipant_(pid, values) {
  return withLock_(function () {
    var p = requireParticipant_(pid, true);
    updateRow_(SH_PARTICIPANTS, p._row, values);
    invalidate_([SH_PARTICIPANTS]);
    refreshSummary_();
    return { id: p.id, updated: Object.keys(values) };
  });
}

/** チームを変える(アプリ用の参加者シートだけ。名簿のチーム列は変えない) */
function adminChangeTeam(token, participantId, team) {
  return adminApi_(token, function () {
    var t = normTeam_(team);
    if (!t) throw appError_('INVALID', 'チームは A〜D です');
    return updateParticipant_(toStr_(participantId), { 'チーム': t });
  });
}

/** クイズの計算に含めるかどうか */
function adminSetQuizInclude(token, participantId, include) {
  return adminApi_(token, function () {
    return updateParticipant_(toStr_(participantId), { 'クイズに含める': !!include });
  });
}

/** 来場の記録をつける/消す(スマホを持っていない人など) */
function adminSetArrived(token, participantId, arrived) {
  return adminApi_(token, function () {
    cache_().remove('arrived:' + toStr_(participantId)); // 参加者側の「記録済み」の目印も消す
    return updateParticipant_(toStr_(participantId), { '来場時刻': arrived ? new Date() : '' });
  });
}

// ============ 集計・設定 ============

/** 集計(運動だけの順位と、仲良し込みの順位、内訳)。集計シートも書き直す */
function adminGetScores(token) {
  return adminApi_(token, function () {
    // 順位タブは開くたびに呼ばれるので、ロックを取らず、キャッシュ(10秒)から計算する。
    // 運営の書き込み(試合の確定など)のたびにキャッシュは消え、集計シートもそのとき書き直している
    var r = buildScores_(false);
    writeSummary_(r); // 集計シートも最新にする(運営の端末からだけ呼ばれるので、ロックなしで書く)
    var bySports = r.teams.slice().sort(function (a, b) { return a.sportsRank - b.sportsRank || (a.team < b.team ? -1 : 1); });
    var byTotal = r.teams.slice().sort(function (a, b) { return a.totalRank - b.totalRank || (a.team < b.team ? -1 : 1); });
    var view = resultsView_(r);
    return {
      teams: view.teams,   // breakdown(内訳)付き。参加者の結果公開と同じもの
      crowns: view.crowns, // 👑👑 全員フルネーム、👑 全員コンプリートの人の名前(読み上げ原稿に使う)
      sportsRanking: bySports.map(function (t) { return { team: t.team, rank: t.sportsRank, points: t.sportsTotal }; }),
      totalRanking: byTotal.map(function (t) { return { team: t.team, rank: t.totalRank, points: t.total }; }),
      standings: {
        basketball: r.detail.sports.basketball,
        dodgeball: r.detail.sports.dodgeball,
        badminton: r.detail.sports.badminton,
        volleyball: r.detail.sports.volleyball
      }
    };
  });
}

function settingsRows_() {
  return readTable_(SH_SETTINGS, true).rows.map(function (r) {
    return { key: toStr_(r['キー']), value: r['値'], description: toStr_(r['説明']) };
  }).filter(function (r) { return r.key; });
}

function adminGetSettings(token) {
  return adminApi_(token, function () {
    return { rows: settingsRows_(), parsed: readSettings_(true) };
  });
}

/**
 * 設定を変える
 * @param {Object<string, (string|number)>} values 設定シートのキー → 値(例:{'バレー勝ちボーナス': 5})
 */
function adminSaveSettings(token, values) {
  return adminApi_(token, function () {
    values = values || {};
    var keys = Object.keys(values);
    keys.forEach(function (k) {
      if (!(k in SETTING_KEYS)) throw appError_('INVALID', '設定のキー「' + k + '」はありません');
    });
    return withLock_(function () {
      var w = {};
      keys.forEach(function (k) { w[k] = String(values[k]); });
      writeKeyValues_(SH_SETTINGS, w);
      invalidate_([SH_SETTINGS]);
      refreshSummary_();
      return { rows: settingsRows_(), parsed: readSettings_(true) };
    });
  });
}
