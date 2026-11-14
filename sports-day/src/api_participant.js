/**
 * 参加者の画面から google.script.run で呼ぶ関数
 * 戻り値はすべて { ok: true, data } か { ok: false, error: { code, message } }(docs/API.md)
 */

// ============ 状態 ============

/** 状態(4秒ごとに呼ばれる想定。10秒キャッシュ) */
function getState() {
  return api_(function () {
    var s = stateData_();
    s.serverNow = Date.now();
    return s;
  });
}

function stateData_() {
  // シート読み取りだけを10秒キャッシュする。
  var st = readState_();
  var settings = readSettings_();
  var scores = buildScores_();
  var matches = readMatches_();
  // バレーの準決勝が2試合とも確定したら、運動の点数・順位を返さない(画面で隠すだけにしない)
  var hidden = sportsScoresHidden(matches);
  var out = {
    mode: st.mode,
    currentEvent: st.currentEvent,
    nextEvent: st.nextEvent,
    updatedAt: st.updatedAt,
    sportsHidden: hidden,
    sports: hidden ? null : scores.teams.map(function (t) {
      return {
        team: t.team, basketball: t.basketball, badminton: t.badminton, dodgeball: t.dodgeball,
        volleyball: t.volleyball, sportsTotal: t.sportsTotal, sportsRank: t.sportsRank
      };
    }),
    prediction: null,
    quiz: null,
    results: null
  };
  if (st.mode === '予想') {
    var m = findMatchById_(matches, st.predictionMatchId);
    out.prediction = m ? publicMatchView_(m) : null;
  }
  if (st.mode === 'クイズ' && st.quizStartedAt) out.quiz = quizTiming_(st, settings);
  if (st.mode === '結果公開') out.results = resultsView_(scores);

  return out;
}

function quizTiming_(st, settings) {
  var start = st.quizStartedAt;
  var nameEnds = start + settings.quizNameSeconds * 1000;
  return {
    startedAt: start,
    nameEndsAt: nameEnds,
    originEndsAt: nameEnds + settings.quizOriginSeconds * 1000,
    nameSeconds: settings.quizNameSeconds,
    originSeconds: settings.quizOriginSeconds
  };
}

/** 結果(総合と内訳) */
function resultsView_(scores) {
  return {
    teams: scores.teams.map(function (t) {
      var q = scores.detail.quiz[t.team] || {};
      return Object.assign({}, t, {
        quizNameRate: q.nameAvg === null || q.nameAvg === undefined ? null : round1(q.nameAvg * 100),
        quizOriginRate: q.originRate === null || q.originRate === undefined ? null : round1(q.originRate * 100)
      });
    })
  };
}

// ============ 名前を選ぶ ============

/** チームのメンバー一覧(名前を選ぶ画面用)。クイズ中は返さない */
function listTeamMembers(team) {
  return api_(function () {
    var t = normTeam_(team);
    if (!t) throw appError_('INVALID', 'チームは A〜D です');
    if (readState_().mode === 'クイズ') throw appError_('QUIZ_MODE', 'クイズ中は名前の一覧を開けません');
    var people = readPeople_();
    var members = readParticipants_().filter(function (p) { return p.team === t; }).map(function (p) {
      var pp = people[p.id] || {};
      return { id: p.id, name: pp.name || p.id, kana: pp.kana || '' };
    });
    members.sort(function (a, b) { return (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'); });
    return { team: t, members: members };
  });
}

/** 自分を選ぶ(初めてなら来場時刻を記録) */
function selectSelf(participantId) {
  return api_(function () {
    var p = requireParticipant_(participantId);
    if (p.arrivedAt === null) markArrived_(p);
    return meView_(p.id);
  });
}

/**
 * 来場時刻を記録する(ロックなし。30人が同時に名前を選んでも待たせない)
 * 参加者シートの行は下に足すだけで動かないので、その人の行の1マスだけを書く。
 * キャッシュの目印で、同じ人が続けて押しても1回だけ書く(運営が来場を消したら目印も消す)
 */
function markArrived_(p) {
  var key = 'arrived:' + p.id;
  if (cache_().get(key)) return;
  cache_().put(key, '1', NEAR_CACHE_SEC);
  updateRow_(SH_PARTICIPANTS, p._row, { '来場時刻': new Date() });
  invalidate_([SH_PARTICIPANTS]);
}

function meView_(id) {
  var p = requireParticipant_(id);
  var pp = readPeople_()[id] || {};
  var intro = readIntros_()[id];
  return { id: id, name: pp.name || id, kana: pp.kana || '', team: p.team, introDone: !!(intro && intro.comment) };
}

// ============ 自己紹介 ============

function getIntro(participantId) {
  return api_(function () {
    var p = requireParticipant_(participantId);
    var intro = readIntros_()[p.id];
    return {
      intro: intro ? { sport: intro.sport, comment: intro.comment, nickname: intro.nickname, snsConsent: intro.snsConsent, updatedAt: intro.updatedAt } : null,
      options: { sports: INTRO_SPORTS, snsConsent: INTRO_SNS, commentMax: INTRO_COMMENT_MAX, nicknameMax: INTRO_NICKNAME_MAX }
    };
  });
}

/**
 * 自己紹介の保存(上書き)
 * @param {string} participantId
 * @param {{sport:string, comment:string, nickname?:string, snsConsent:string}} intro
 */
function saveIntro(participantId, intro) {
  return api_(function () {
    var p = requireParticipant_(participantId);
    intro = intro || {};
    // やっていたスポーツは複数選択可(2026-11-11 決定)。配列 sports か、旧形式の文字列 sport を受け付ける
    var picked = Array.isArray(intro.sports) ? intro.sports.map(toStr_) : [toStr_(intro.sport)];
    picked = INTRO_SPORTS.filter(function (s) { return picked.indexOf(s) >= 0; }); // 選択肢の順に並べ、重複と不正な値を除く
    if (picked.length === 0) throw appError_('INVALID', 'やっていたスポーツを選んでください');
    if (picked.indexOf('特になし') >= 0 && picked.length > 1) throw appError_('INVALID', '「特になし」はほかのスポーツと一緒に選べません');
    var sport = picked.join('・');
    var comment = toStr_(intro.comment);
    var nickname = toStr_(intro.nickname);
    var sns = toStr_(intro.snsConsent);
    if (!comment) throw appError_('INVALID', 'ひとことを入れてください');
    if (Array.from(comment).length > INTRO_COMMENT_MAX) throw appError_('INVALID', 'ひとことは' + INTRO_COMMENT_MAX + '字までです');
    if (Array.from(nickname).length > INTRO_NICKNAME_MAX) throw appError_('INVALID', 'あだ名は' + INTRO_NICKNAME_MAX + '字までです');
    if (INTRO_SNS.indexOf(sns) < 0) throw appError_('INVALID', '写真のSNS掲載について選んでください');
    // ロックなしで行を足す(読むときは同じ人の下の行=最新を使う)
    writeIntro_(p.id, { sport: sport, comment: comment, nickname: nickname, snsConsent: sns });
    return { saved: true };
  });
}

// ============ 勝敗予想 ============

/**
 * 予想の画面の情報
 * @param {string} participantId
 * @param {string} [matchId] 省略すると状態の「予想の試合ID」
 */
function getPrediction(participantId, matchId) {
  return api_(function () {
    return predictionView_(participantId, matchId, false);
  });
}

function predictionView_(participantId, matchId, fresh) {
  // fresh は「予想」だけに使う(30人が同時に送るので、読み直すシートを少なくする)。
  // 参加者・状態・試合は、運営が書くたびにキャッシュが消えるので、キャッシュで十分
  var parts = readParticipants_();
  var me = findParticipant_(parts, toStr_(participantId));
  if (!me) throw appError_('NOT_FOUND', '参加者が見つかりません。名前を選び直してください');
  var mid = toStr_(matchId) || readState_().predictionMatchId;
  var m = mid ? findMatchById_(readMatches_(), mid) : null;
  var view = {
    match: m ? publicMatchView_(m) : null,
    myTeam: me.team,
    canPredict: false,
    reason: null,
    myChoice: null,
    revealed: false,
    counts: null,
    teams: null,
    hit: null,
    progress: null
  };
  if (!m) { view.reason = 'NO_MATCH'; return view; }
  var preds = readPredictions_(fresh).filter(function (p) { return p.matchId === m.id; });
  var mine = preds.filter(function (p) { return p.participantId === me.id; })[0];
  view.myChoice = mine ? mine.choice : null;

  var arrived = arrivedMembers_(parts, me.team);
  var predictedIds = preds.map(function (p) { return p.participantId; });
  var done = arrived.filter(function (p) { return predictedIds.indexOf(p.id) >= 0; }).length;
  view.progress = { predicted: done, arrived: arrived.length };

  var playing = me.team === m.team1 || me.team === m.team2;
  var closed = predictionClosed_(m);
  // 締め切るまで、予想の中身(人数の内訳)はだれにも返さない。全員がそろっても自動では公開しない(2026-11-13)
  view.revealed = closed && !playing && !!(m.team1 && m.team2);
  if (view.revealed) {
    // 予想した2チームの人数だけの集計(名前は出さない)。自分のチームを先に
    var teams = TEAMS.filter(function (t) { return t !== m.team1 && t !== m.team2; });
    teams.sort(function (a, b) { return (a === me.team ? 0 : 1) - (b === me.team ? 0 : 1); });
    view.teams = teams.map(function (t) {
      return { team: t, counts: predictionCounts_(m, preds.filter(function (p) { return p.team === t; })) };
    });
    view.counts = view.teams[0] && view.teams[0].team === me.team ? view.teams[0].counts : null;
    // 試合が確定したら的中率(全体とチームごと)。どちらが勝ったかは返さない
    view.hit = predictionHitView_(m, preds);
  }

  if (!m.team1 || !m.team2) view.reason = 'TEAMS_UNKNOWN';
  else if (playing) view.reason = 'PLAYING';
  else if (closed) view.reason = 'CLOSED';
  else if (m.predictionStatus !== '受付中') view.reason = 'NOT_OPEN';
  else view.canPredict = true;
  return view;
}

/**
 * 予想を送る(締め切るまでは何度でも上書き可)
 * @param {number} [seq] 端末で押した順番(押した時刻のミリ秒)。古い送信があとから届いても、新しい予想を上書きしない
 */
function submitPrediction(participantId, matchId, winnerTeam, seq) {
  return api_(function () {
    var winner = normTeam_(winnerTeam);
    // ロックなし:自分専用の行に書くだけ(30人同時でも待たせない)
    var view = predictionView_(participantId, matchId, true);
    if (!view.canPredict) {
      var msg = {
        NO_MATCH: '予想する試合がありません', TEAMS_UNKNOWN: 'まだ対戦チームが決まっていません',
        PLAYING: '自分のチームの試合は予想できません', CLOSED: '予想は締め切られました',
        NOT_OPEN: '予想の受付はまだです'
      }[view.reason] || '予想できません';
      throw appError_('PREDICTION_' + view.reason, msg);
    }
    var m = view.match;
    if (winner !== m.team1 && winner !== m.team2) throw appError_('INVALID', '勝つチームは ' + m.team1 + ' か ' + m.team2 + ' です');
    var pid = toStr_(participantId);
    var me = requireParticipant_(pid);
    // 素早く変えたとき:古い送信が遅れて届いたら、書かずに今の状態を返す(最後に押したものを残す)
    var n = toNumOrNull_(seq);
    var seqKey = 'predSeq:' + m.id + ':' + pid;
    if (n !== null) {
      var last = toNumOrNull_(cache_().get(seqKey));
      if (last !== null && last > n) return predictionView_(pid, m.id, true);
      cache_().put(seqKey, String(n), NEAR_CACHE_SEC);
    }
    // 自分専用の行:予想のある試合ごとに100行の区画、その中の自分の行
    var block = readMatches_().filter(function (x) { return x.predictionStatus !== 'なし'; })
      .map(function (x) { return x.id; }).indexOf(m.id);
    writeSlotRow_(sheet_(SH_PREDICTIONS), block >= 0 ? slotRow_(me, block, SLOT_BLOCK) : -1, { '試合ID': m.id, '参加者ID': pid },
      { '試合ID': m.id, '参加者ID': pid, 'チーム': view.myTeam, '予想(勝つチーム)': winner, '更新時刻': new Date() });
    invalidate_([SH_PREDICTIONS]);
    // 予想した人は来ている
    if (me.arrivedAt === null) markArrived_(me);
    return predictionView_(pid, m.id, true);
  });
}

// ============ クイズ ============

/** 1人分の問題を作る(純粋関数を組み合わせるだけ) */
function generateQuestion_(pid, parts, people) {
  var me = findParticipant_(parts, pid);
  var mates = parts.filter(function (p) { return p.team === me.team && p.id !== pid; });
  var arrived = mates.filter(function (p) { return p.arrivedAt !== null; });
  // だれも来場記録がない(来場の記録を使っていない)ときは、チーム全員を対象にする
  var targets = arrived.length ? arrived : mates;
  var withOrigin = targets.filter(function (p) { return people[p.id] && normalizePrefecture(people[p.id].origin); });
  var q = { participantId: pid, nameTargets: targets.map(function (p) { return p.id; }), originTarget: '', choices: [], answer: '' };
  if (withOrigin.length) {
    var target = withOrigin[Math.floor(Math.random() * withOrigin.length)];
    var allOrigins = parts.map(function (p) { return people[p.id] ? people[p.id].origin : ''; });
    var oc = makeOriginChoices(people[target.id].origin, allOrigins);
    if (oc) {
      q.originTarget = target.id;
      q.choices = oc.choices;
      q.answer = oc.answer;
    }
  }
  return q;
}

function questionRow_(q) {
  if (!q.originExpired) cachePutJson_('origin:' + q.participantId, {originTarget:q.originTarget, choices:q.choices, answer:q.answer}, NEAR_CACHE_SEC);
  return {
    '参加者ID': q.participantId, '名前の対象者ID': q.nameTargets.join(','), '出身地の対象者ID': '',
    '選択肢1': '', '選択肢2': '', '選択肢3': '', '選択肢4': '',
    '正解': ''
  };
}

function shuffleCopy_(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/** クイズを始める:自分用の問題をまとめて返す */
function startQuiz(participantId) {
  return api_(function () {
    var st = readState_();
    if (st.mode !== 'クイズ') throw appError_('NOT_QUIZ_MODE', 'いまはクイズの時間ではありません');
    var pid = toStr_(participantId);
    requireParticipant_(pid);
    var answered = findBy_(readQuizAnswers_(), pid);
    if (answered) return { alreadyAnswered: true, result: quizResult_(pid, false) };

    var q = findBy_(readQuizQuestions_(), pid);
    if (!q) {
      // クイズ開始のあとに来た人など:その場で作る
      q = withLock_(function () {
        var again = findBy_(readQuizQuestions_(true), pid);
        if (again) return again;
        var made = generateQuestion_(pid, readParticipants_(true), readPeople_());
        appendRows_(SH_QUIZ_Q, [questionRow_(made)]);
        invalidate_([SH_QUIZ_Q]);
        return made;
      });
    }
    if (q.originExpired) throw appError_('NO_QUIZ', '出身地問題が失効しました。運営に再開始を依頼してください');
    var people = readPeople_();
    var intros = readIntros_();
    var hints = shuffleCopy_(q.nameTargets).map(function (id) {
      var it = intros[id];
      return it && it.comment ? { sport: it.sport, comment: it.comment } : null;
    });
    var settings = readSettings_();
    return {
      alreadyAnswered: false,
      timing: st.quizStartedAt ? quizTiming_(st, settings) : null,
      serverNow: Date.now(),
      names: { count: q.nameTargets.length, hints: hints },
      origin: q.originTarget ? {
        targetName: displayName_(people, q.originTarget),
        choices: q.choices
      } : null
    };
  });
}

var SLOT_BLOCK = 100;      // 予想:1試合あたりの行数(参加者は99人まで)
var NEAR_PER_PERSON = 10;  // 惜しい答え:1人あたりの行数(それ以上はロックを取って下に足す)

/** 惜しい答えの番号の土台。P07 → 700(1人あたり99件まで) */
function nearMissBase_(pid) {
  var m = String(pid).match(/\d+/);
  if (!m) throw appError_('INVALID', '参加者IDの形がちがいます(' + pid + ')');
  return Number(m[0]) * 100;
}

function findBy_(rows, pid) {
  for (var i = 0; i < rows.length; i++) if (rows[i].participantId === pid) return rows[i];
  return null;
}

/**
 * クイズの回答(最後に1回まとめて)
 * @param {string} participantId
 * @param {{names: string[], origin: string}} answers origin は選んだ都道府県名(時間切れなら '')
 */
function submitQuiz(participantId, answers) {
  return api_(function () {
    var pid = toStr_(participantId);
    answers = answers || {};
    var names = (Array.isArray(answers.names) ? answers.names : []).slice(0, 60).map(function (s) {
      return toStr_(s).slice(0, 40);
    });
    var originAns = toStr_(answers.origin);
    // 締め切りで全員が同時に送るので、ロックは「惜しい答え」の番号を振るところだけにする。
    // 回答は行を足すだけ(読むときは同じ人の最初の行を使う)
    var st = readState_(true);
    if (st.mode === '結果公開') throw appError_('QUIZ_CLOSED', 'クイズの受付は終わりました');
    // 送った目印。クイズの開始時刻ごとに分ける(開始し直したら、目印も新しくなる)
    var doneKey = 'quizDone:' + (st.quizStartedAt || '') + ':' + pid;
    return (function () {
      var me = requireParticipant_(pid);
      // 再送:最初の回答のまま。送った目印はキャッシュに置く(30人同時でもシートを読み直さない)
      if (cache_().get(doneKey) || findBy_(readQuizAnswers_(), pid)) return quizResult_(pid, true);
      var q = findBy_(readQuizQuestions_(), pid) || findBy_(readQuizQuestions_(true), pid);
      if (!q) throw appError_('NO_QUIZ', 'クイズの問題がありません。クイズを始めてから送ってください');
      if (q.originExpired) throw appError_('NO_QUIZ', '出身地問題が失効しました。運営に再開始を依頼してください');
      var people = readPeople_();
      var members = q.nameTargets.map(function (id) {
        var p = people[id] || {};
        return { id: id, name: p.name || '', kana: p.kana || '' };
      });
      var j = judgeNames(names, members);
      var originCorrect = '';
      if (q.originTarget) originCorrect = q.choices.indexOf(originAns) >= 0 && originAns === q.answer;
      cachePutJson_('originResponse:' + pid, {answer: q.choices.indexOf(originAns) >= 0 ? originAns : ''}, NEAR_CACHE_SEC);
      writeSlotRow_(sheet_(SH_QUIZ_A), slotRow_(me), { '参加者ID': pid }, {
        '参加者ID': pid, '書いた人数': j.writtenCount, '正解と判定した人のID': j.correctIds.join(','),
        '名前の正答率': j.rate === null ? '' : j.rate, '出身地の回答': '', '出身地の正誤': originCorrect,
        '送信時刻': new Date()
      });
      cache_().put(doneKey, '1', NEAR_CACHE_SEC);
      // 惜しい答え:番号は参加者IDから決める(P07 なら 701, 702 …)。行は1人10行ずつの自分専用の行。
      // 送り直しで同じ番号が二重になっても、読むときに1つにまとめる(readNearMisses_)
      var base = nearMissBase_(pid);
      var nearSh = j.nearMisses.length ? sheet_(SH_NEAR) : null;
      j.nearMisses.forEach(function (nm, k) {
        var no = base + k + 1;
        // 入力そのものはシートに書かず、キャッシュにだけ置く
        cache_().put('near:' + no, JSON.stringify({ input: nm.input }), NEAR_CACHE_SEC);
        writeSlotRow_(nearSh, k < NEAR_PER_PERSON ? slotRow_(me, 0, 0, { per: NEAR_PER_PERSON, offset: k }) : -1,
          { '番号': no }, { '番号': no, '参加者ID': pid, '近い候補(参加者ID)': nm.candidateId, '判定': JUDGE_PENDING });
      });
      invalidate_([SH_QUIZ_A, SH_NEAR]);
      // 答え合わせは、いま計算した結果から作る(書いたばかりのシートを読み直さない)
      return buildQuizResult_(q, {
        correctIds: j.correctIds,
        originAnswer: q.choices.indexOf(originAns) >= 0 ? originAns : '',
        originCorrect: originCorrect === true
      }, j.nearMisses.map(function (nm) { return nm.candidateId; }), people);
    })();
  });
}

/** 本人にだけ見せる答え合わせ */
function quizResult_(pid, fresh) {
  var a = findBy_(readQuizAnswers_(fresh), pid);
  var q = findBy_(readQuizQuestions_(fresh), pid);
  if (!a || !q) return null;
  var pending = readNearMisses_(fresh).filter(function (n) {
    return n.participantId === pid && n.judgement === JUDGE_PENDING;
  }).map(function (n) { return n.candidateId; });
  return buildQuizResult_(q, a, pending, readPeople_());
}

/**
 * 答え合わせの中身を作る
 * @param q 問題 / a {correctIds, originAnswer, originCorrect} / pending 運営の判定待ちの候補ID
 */
function buildQuizResult_(q, a, pending, people) {
  // 名簿と自己紹介はクイズ中に変わらないので、キャッシュを使う(名簿ファイルを開き直さない)
  var intros = readIntros_();
  var members = q.nameTargets.map(function (id) {
    var p = people[id] || {};
    var it = intros[id];
    return {
      name: p.name || id,
      kana: p.kana || '',
      nickname: it ? it.nickname : '',
      written: a.correctIds.indexOf(id) >= 0,
      pending: a.correctIds.indexOf(id) < 0 && pending.indexOf(id) >= 0
    };
  });
  members.sort(function (x, y) {
    if (x.written !== y.written) return x.written ? 1 : -1; // 書けなかった人を先に
    return (x.kana || x.name).localeCompare(y.kana || y.name, 'ja');
  });
  var correctCount = q.nameTargets.filter(function (id) { return a.correctIds.indexOf(id) >= 0; }).length;
  return {
    total: q.nameTargets.length,
    correctCount: correctCount,
    pendingCount: members.filter(function (m) { return m.pending; }).length,
    members: members,
    origin: q.originTarget ? {
      targetName: displayName_(people, q.originTarget),
      answer: q.answer,
      yourAnswer: a.originAnswer,
      correct: a.originCorrect === true
    } : null
  };
}

/** 答え合わせを取り直す(画面を開き直したとき) */
function getQuizResult(participantId) {
  return api_(function () {
    var pid = toStr_(participantId);
    requireParticipant_(pid);
    var r = quizResult_(pid, false);
    return { answered: !!r, result: r };
  });
}

// ============ アンケート ============

/**
 * アンケート。回答は運営だけが見る(2026-11-11 決定:匿名にはしない。名前は保存せず、参加者IDだけ)
 * 30人が同時に送っても待たせないように、その人専用の行に書く(送り直したら上書き)
 * @param {{fun:number, talked:number, again:string, comment?:string}} survey again は 'はい' か 'いいえ'
 * @param {string} [participantId] 名前を選んでいない端末からは来ない。そのときはロックを取って下に足す
 */
function submitSurvey(survey, participantId) {
  return api_(function () {
    survey = survey || {};
    var fun = toNumOrNull_(survey.fun);
    var talked = toNumOrNull_(survey.talked);
    var again = toStr_(survey.again);
    var comment = toStr_(survey.comment).slice(0, 1000);
    [fun, talked].forEach(function (v) {
      if (v === null || v < 1 || v > 5 || Math.floor(v) !== v) throw appError_('INVALID', '1〜5で選んでください');
    });
    if (['はい', 'いいえ'].indexOf(again) < 0) throw appError_('INVALID', '「また参加したいか」を選んでください');
    var row = {
      '送信時刻': new Date(), '楽しかったか(1〜5)': fun, '普段話さない人と話せたか(1〜5)': talked,
      'また参加したいか': again, '自由記述': comment
    };
    var pid = toStr_(participantId);
    var me = pid ? findParticipant_(readParticipants_(), pid) : null;
    if (me) {
      row['参加者ID'] = pid;
      writeSlotRow_(sheet_(SH_SURVEY), slotRow_(me), { '参加者ID': pid }, row);
    } else {
      withLock_(function () { appendRows_(SH_SURVEY, [row]); });
    }
    invalidate_([SH_SURVEY]);
    return { saved: true };
  });
}
