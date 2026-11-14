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

/**
 * 結果(総合と内訳)。参加者の結果公開と、運営の順位タブ・読み上げ原稿で同じものを使う
 * teams[i].breakdown = 種目ごとの順位、バレーの点数と勝ちボーナス、名前・出身地クイズの点数、予想の的中率
 * crowns = 全員フルネーム・全員コンプリートの人の名前
 */
function resultsView_(scores) {
  var sp = scores.detail.sports;
  var rates = scores.detail.predictionRates || {};
  var pc = function (x) { return x === null || x === undefined ? null : round1(x * 100); };
  // 総当たり(バスケ・ドッジ)の順位は、全試合が確定してから
  var leagueRank = function (st, team) {
    if (!st || !st.complete) return null;
    var hit = st.standings.filter(function (s) { return s.team === team; })[0];
    return hit ? hit.rank : null;
  };
  return {
    teams: scores.teams.map(function (t) {
      var q = scores.detail.quiz[t.team] || {};
      var scored = sp.volleyball.scored[t.team] || 0;
      return Object.assign({}, t, {
        quizNameRate: pc(q.nameAvg),     // チームの名前の平均正答率(%)。ボーナス込みで100を超えることがある
        quizOriginRate: pc(q.originRate),
        breakdown: {
          basketballRank: leagueRank(sp.basketball, t.team),
          badmintonRank: sp.badminton.ranks[t.team] || null,
          dodgeballRank: leagueRank(sp.dodgeball, t.team),
          volleyScored: scored,                                // バレーで取った点数
          volleyWins: sp.volleyball.wins[t.team] || 0,
          volleyBonus: round1(t.volleyball - scored),          // 勝ちボーナスの合計
          quizNamePoints: q.namePoints || 0,
          quizOriginPoints: q.originPoints || 0,
          predictionRate: pc(rates[t.team])                    // 予想の的中率(%)。予想なしは null
        }
      });
    }),
    crowns: crownsView_(scores.detail.crowns)
  };
}

/**
 * 👑 の人に名前を付ける。結果公開のあとは全員が4秒ごとに読むので、名簿ファイルを開き直さないように、
 * 名前の組をキャッシュに6時間置く(👑 の人が変わったときだけ名簿を読む)
 */
function crownsView_(crowns) {
  crowns = crowns || { allFull: [], complete: [] };
  var ids = crowns.allFull.concat(crowns.complete).map(function (x) { return x.id; });
  if (!ids.length) return { allFull: [], complete: [] };
  var key = ids.join(',');
  var cached = cacheGetJson_('crownNames:v1');
  var names = cached && cached.key === key ? cached.names : null;
  if (!names) {
    var people = readPeople_();
    names = {};
    ids.forEach(function (id) { names[id] = displayName_(people, id); });
    cachePutJson_('crownNames:v1', { key: key, names: names }, NEAR_CACHE_SEC);
  }
  var view = function (list) {
    return list.map(function (x) { return { name: names[x.id] || x.id, team: x.team }; })
      .sort(function (a, b) { return a.team < b.team ? -1 : (a.team > b.team ? 1 : 0); });
  };
  return { allFull: view(crowns.allFull), complete: view(crowns.complete) };
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
  return {
    id: id, name: pp.name || id, kana: pp.kana || '', team: p.team, introDone: !!(intro && intro.comment),
    surveyDone: surveyDone_(id) // アンケートを送ったか(端末ではなく参加者ごとに持つ)
  };
}

// ============ 自己紹介 ============

function getIntro(participantId) {
  return api_(function () {
    var p = requireParticipant_(participantId);
    var intro = readIntros_()[p.id];
    return {
      intro: intro ? { sport: intro.sport, comment: intro.comment, nickname: intro.nickname, snsConsent: intro.snsConsent, updatedAt: intro.updatedAt } : null,
      options: {
        sports: INTRO_SPORTS, snsConsent: INTRO_SNS, commentMax: INTRO_COMMENT_MAX,
        nicknameMax: INTRO_NICKNAME_MAX, nicknameCount: NICKNAME_MAX_COUNT
      }
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
    // あだ名は「、」「,」「/」で区切って3つまで(本番前の変更 4)。「、」でつないで保存する
    var nicks = parseNicknames(intro.nickname);
    if (nicks.length > NICKNAME_MAX_COUNT) throw appError_('INVALID', 'あだ名は' + NICKNAME_MAX_COUNT + 'つまでです');
    var nickname = nicks.join('、');
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
  var allOrigins = parts.map(function (p) { return people[p.id] ? people[p.id].origin : ''; });
  return {
    participantId: pid,
    nameTargets: targets.map(function (p) { return p.id; }),
    // 出身地クイズ3問(B「〇〇さんの出身は?」と C「〇〇県出身はだれ?」)。対象は名前と同じチームメイト
    originQuestions: makeOriginQuiz(targets.map(function (p) {
      return { id: p.id, origin: people[p.id] ? people[p.id].origin : '' };
    }), allOrigins)
  };
}

function questionRow_(q) {
  // 出身地の問題(対象者・選択肢・正解)はシートに書かず、キャッシュにだけ置く。
  // 作り直しで残す行(originQuestions を読んでいない)は、キャッシュをそのままにする
  if (q.originQuestions) cachePutJson_('origin:' + q.participantId, { questions: q.originQuestions }, NEAR_CACHE_SEC);
  return {
    '参加者ID': q.participantId, '名前の対象者ID': q.nameTargets.join(','), '出身地の対象者ID': '',
    '選択肢1': '', '選択肢2': '', '選択肢3': '', '選択肢4': '',
    '正解': ''
  };
}

/** 画面に返す出身地クイズの問題(正解は入れない)。問題がなければ null */
function originQuestionsView_(questions, people) {
  if (!questions || !questions.length) return null;
  return {
    questions: questions.map(function (x) {
      if (x.type === 'C') {
        return {
          type: 'C', pref: x.pref, count: x.answerIds.length,
          choices: x.choices.map(function (id) { return { id: id, name: displayName_(people, id) }; })
        };
      }
      return { type: 'B', targetName: displayName_(people, x.targetId), choices: x.choices };
    })
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
    // 答え合わせはここでは返さない(アンケートを送ってから getQuizResult で受け取る)
    if (answered) return { alreadyAnswered: true, surveyDone: surveyDone_(pid) };

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
    loadOrigin_(q);
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
      origin: originQuestionsView_(q.originQuestions, people)
    };
  });
}

var SLOT_BLOCK = 100;      // 予想:1試合あたりの行数(参加者は99人まで)
var NEAR_PER_PERSON = 10;  // 惜しい答え:1人あたりの行数(それ以上はロックを取って下に足す)

// だれにも近くない答え(候補が出せないもの)も、運営の判断の一覧に出すか。
// true = 出す(未登録のあだ名を運営が拾える。判断しなければ×のまま)。false = 自動で×にして一覧に出さない
var NEAR_INCLUDE_UNKNOWN = true;

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
 * @param {{names: string[], origin: Array}} answers origin は出身地クイズの答え(問題と同じ順番)。
 *   B は選んだ都道府県名、C は選んだ人の参加者IDの配列。選んでいない問題は '' か []
 * @return {{accepted:true, surveyDone:boolean}} 答え合わせは返さない。アンケートを送ってから getQuizResult で受け取る
 */
function submitQuiz(participantId, answers) {
  return api_(function () {
    var pid = toStr_(participantId);
    answers = answers || {};
    var names = (Array.isArray(answers.names) ? answers.names : []).slice(0, 60).map(function (s) {
      return toStr_(s).slice(0, 40);
    });
    var originAns = Array.isArray(answers.origin) ? answers.origin.slice(0, 10) : [answers.origin];
    // 締め切りで全員が同時に送るので、ロックは取らない。
    // 回答は自分専用の行に書く(読むときは同じ人の最初の行を使う)
    var st = readState_(true);
    if (st.mode === '結果公開') throw appError_('QUIZ_CLOSED', 'クイズの受付は終わりました');
    // 送った目印。クイズの開始時刻ごとに分ける(開始し直したら、目印も新しくなる)
    var doneKey = 'quizDone:' + (st.quizStartedAt || '') + ':' + pid;
    var me = requireParticipant_(pid);
    var accepted = function () { return { accepted: true, surveyDone: surveyDone_(pid) }; };
    // 再送:最初の回答のまま。送った目印はキャッシュに置く(30人同時でもシートを読み直さない)
    if (cache_().get(doneKey) || findBy_(readQuizAnswers_(), pid)) return accepted();
    var q = findBy_(readQuizQuestions_(), pid) || findBy_(readQuizQuestions_(true), pid);
    if (!q) throw appError_('NO_QUIZ', 'クイズの問題がありません。クイズを始めてから送ってください');
    loadOrigin_(q);
    if (q.originExpired) throw appError_('NO_QUIZ', '出身地問題が失効しました。運営に再開始を依頼してください');
    var people = readPeople_();
    var intros = readIntros_();
    var members = q.nameTargets.map(function (id) {
      var p = people[id] || {};
      return { id: id, name: p.name || '', kana: p.kana || '', nickname: intros[id] ? intros[id].nickname : '' };
    });
    var j = judgeNames(names, members);
    // 出身地:1問1点。選択肢にある答えだけ採点し、選んだ答えはキャッシュにだけ置く(シートには正解数と問題数だけ)
    var os = scoreOriginAnswers(q.originQuestions, originAns);
    cachePutJson_('originResponse:' + pid, { answers: os.results.map(function (r) { return r.answer; }) }, NEAR_CACHE_SEC);
    writeSlotRow_(sheet_(SH_QUIZ_A), slotRow_(me), { '参加者ID': pid }, {
      '参加者ID': pid, '書いた人数': j.writtenCount, '正解と判定した人のID': j.fullIds.join(','),
      '名前の正答率': j.rate === null ? '' : j.rate, '出身地の回答': '', '出身地の正誤': os.total ? os.correct : '',
      '送信時刻': new Date(),
      '0.5人分と判定した人のID': j.halfIds.join(','), '自動判定(控え)': formatCredits_(j.credits),
      '出身地の問題数': os.total ? os.total : ''
    });
    cache_().put(doneKey, '1', NEAR_CACHE_SEC);
    // 運営が判断する答え:近い候補があるもの → 候補が出せないもの(NEAR_INCLUDE_UNKNOWN のとき)の順。
    // 番号は参加者IDから決める(P07 なら 701, 702 …)。行は1人10行ずつの自分専用の行。
    // 送り直しで同じ番号が二重になっても、読むときに1つにまとめる(readNearMisses_)
    var pending = j.nearMisses.concat(NEAR_INCLUDE_UNKNOWN
      ? j.unknowns.map(function (input) { return { input: input, candidateId: '' }; }) : []);
    var base = nearMissBase_(pid);
    var nearSh = pending.length ? sheet_(SH_NEAR) : null;
    pending.forEach(function (nm, k) {
      var no = base + k + 1;
      // 入力そのものはシートに書かず、キャッシュにだけ置く(6時間。公開後に判断を直せるように、判断しても消さない)
      cache_().put('near:' + no, JSON.stringify({ input: nm.input }), NEAR_CACHE_SEC);
      writeSlotRow_(nearSh, k < NEAR_PER_PERSON ? slotRow_(me, 0, 0, { per: NEAR_PER_PERSON, offset: k }) : -1,
        { '番号': no }, { '番号': no, '参加者ID': pid, '近い候補(参加者ID)': nm.candidateId, '判定': JUDGE_PENDING });
    });
    invalidate_([SH_QUIZ_A, SH_NEAR]);
    return accepted();
  });
}

/** 本人にだけ見せる答え合わせ(答えていなければ null) */
function quizResult_(pid, fresh) {
  var a = findBy_(readQuizAnswers_(fresh), pid);
  var q = findBy_(readQuizQuestions_(fresh), pid);
  if (!a || !q) return null;
  // 出身地クイズの問題と、選んだ答えは、この人の分だけキャッシュから読む
  loadOrigin_(q);
  a.originAnswers = (cacheGetJson_('originResponse:' + pid) || {}).answers || null;
  var pending = readNearMisses_(fresh).filter(function (n) {
    return n.participantId === pid && n.judgement === JUDGE_PENDING;
  });
  return buildQuizResult_(q, a, pending, readPeople_(), readState_(fresh).mode === '結果公開');
}

/**
 * 答え合わせの中身を作る(チームの点数や順位は入れない)
 * @param q 問題 / a クイズ回答(correctIds=1人分, halfIds=0.5人分)/ pending 運営の判断待ちの惜しい答え
 * @param published 結果公開のあとか(公開した時点で判断していないものは×なので「確認中」を出さない)
 */
function buildQuizResult_(q, a, pending, people, published) {
  // 名簿と自己紹介はクイズ中に変わらないので、キャッシュを使う(名簿ファイルを開き直さない)
  var intros = readIntros_();
  var pendingIds = published ? [] : pending.map(function (n) { return n.candidateId; }).filter(function (x) { return x; });
  var members = q.nameTargets.map(function (id) {
    var p = people[id] || {};
    var it = intros[id];
    var credit = a.correctIds.indexOf(id) >= 0 ? 1 : ((a.halfIds || []).indexOf(id) >= 0 ? 0.5 : 0);
    return {
      name: p.name || id,
      kana: p.kana || '',
      nickname: it ? it.nickname : '',
      written: credit > 0,
      credit: credit,
      pending: credit < 1 && pendingIds.indexOf(id) >= 0
    };
  });
  members.sort(function (x, y) {
    if (x.written !== y.written) return x.written ? 1 : -1; // 書けなかった人を先に
    return (x.kana || x.name).localeCompare(y.kana || y.name, 'ja');
  });
  return {
    total: q.nameTargets.length,
    correctCount: members.filter(function (m) { return m.written; }).length,
    fullCount: members.filter(function (m) { return m.credit === 1; }).length,
    pendingCount: members.filter(function (m) { return m.pending && !m.written; }).length,
    // だれの答えか分からなくて、運営が確認中の答えの数
    pendingOther: published ? 0 : pending.filter(function (n) { return !n.candidateId; }).length,
    published: !!published,
    members: members,
    origin: originResultView_(q.originQuestions, a, people)
  };
}

/** 出身地クイズの答え合わせ(問題がない・問題のキャッシュが消えたときは null) */
function originResultView_(questions, a, people) {
  if (!questions || !questions.length) return null;
  var mine = a.originAnswers || [];
  var sc = scoreOriginAnswers(questions, mine);
  var names = function (ids) { return ids.map(function (id) { return displayName_(people, id); }); };
  return {
    // 正解数は、送ったときに採点してシートに書いた数(選んだ答えのキャッシュが消えていても変わらない)
    correct: typeof a.originCorrect === 'number' ? a.originCorrect : sc.correct,
    total: questions.length,
    questions: questions.map(function (x, i) {
      var r = sc.results[i];
      if (x.type === 'C') {
        return { type: 'C', pref: x.pref, answerNames: names(x.answerIds), yourNames: names(r.answer), correct: r.correct };
      }
      return { type: 'B', targetName: displayName_(people, x.targetId), answer: x.answer, yourAnswer: r.answer, correct: r.correct };
    })
  };
}

/**
 * 答え合わせを受け取る(アンケートを送ったあと・画面を開き直したとき・運営が判断を直したあと)
 * 返すのは、クイズに答えて、アンケートを送っていて、名前クイズの全員の締め切り(nameEndsAt)を過ぎているときだけ
 * (早く終わった人が、ほかの人が書いている間に答えを見られないようにする)
 */
function getQuizResult(participantId) {
  return api_(function () {
    var pid = toStr_(participantId);
    requireParticipant_(pid);
    var st = readState_();
    var answered = !!findBy_(readQuizAnswers_(), pid);
    var sd = surveyDone_(pid);
    var now = Date.now();
    var nameEndsAt = st.mode === 'クイズ' && st.quizStartedAt ? quizTiming_(st, readSettings_()).nameEndsAt : null;
    var waiting = nameEndsAt !== null && now < nameEndsAt;
    return {
      answered: answered,
      surveyDone: sd,
      availableAt: waiting ? nameEndsAt : null, // この時刻まで答え合わせを出さない(null = もう出せる)
      serverNow: now,
      result: answered && sd && !waiting ? quizResult_(pid, false) : null
    };
  });
}

// ============ アンケート ============

/**
 * アンケート。回答は運営だけが見る(2026-11-11 決定:匿名にはしない。名前は保存せず、参加者IDだけ)
 * 30人が同時に送っても待たせないように、その人専用の行に書く(送り直したら上書き)
 * @param {{fun:number, talked:number, learned:string, best:string, next?:string[], nextOther?:string,
 *          help:string, comment?:string, snsOk?:boolean}} survey
 *   fun・talked は 1〜5、learned は SURVEY_LEARNED、best は SURVEY_BEST、help は SURVEY_HELP のどれか(ここまで必須)。
 *   next は SURVEY_NEXT からいくつでも(0個でもよい)。nextOther は「その他」の中身(50字まで)。
 *   comment はひとこと感想(任意)。snsOk は「SNSで紹介してもいい(名前は出しません)」のチェック
 * @param {string} [participantId] 名前を選んでいない端末からは来ない。そのときはロックを取って下に足す
 */
function submitSurvey(survey, participantId) {
  return api_(function () {
    survey = survey || {};
    var fun = toNumOrNull_(survey.fun);
    var talked = toNumOrNull_(survey.talked);
    [fun, talked].forEach(function (v) {
      if (v === null || v < 1 || v > 5 || Math.floor(v) !== v) throw appError_('INVALID', '1と2は、1〜5で選んでください');
    });
    var learned = toStr_(survey.learned);
    if (SURVEY_LEARNED.indexOf(learned) < 0) throw appError_('INVALID', '「新しく名前を覚えた人数」を選んでください');
    var best = toStr_(survey.best);
    if (SURVEY_BEST.indexOf(best) < 0) throw appError_('INVALID', '「一番楽しかった種目・企画」を選んでください');
    var help = toStr_(survey.help);
    if (SURVEY_HELP.indexOf(help) < 0) throw appError_('INVALID', '「準備の手伝い」を選んでください');
    var picked = (Array.isArray(survey.next) ? survey.next : []).map(toStr_);
    var next = SURVEY_NEXT.filter(function (x) { return picked.indexOf(x) >= 0; }); // 選択肢の順に並べ、重複と知らない値を除く
    var nextOther = next.indexOf('その他') >= 0 ? Array.from(toStr_(survey.nextOther)).slice(0, SURVEY_NEXT_OTHER_MAX).join('') : '';
    var comment = toStr_(survey.comment).slice(0, 1000);
    var row = {
      '送信時刻': new Date(), '楽しかったか(1〜5)': fun, '普段話さない人と話せたか(1〜5)': talked,
      'また参加したいか': '', '自由記述': comment,
      '新しく名前を覚えた人数': learned, '一番楽しかった種目・企画': best,
      '次にやってほしいイベント': next.join('、'), '次にやってほしいイベント(その他)': nextOther,
      '準備の手伝い': help, '感想をSNSで紹介してよい': comment && toBool_(survey.snsOk) ? '○' : ''
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
    if (me) cache_().put('surveyDone:' + pid, '1', NEAR_CACHE_SEC);
    return { saved: true };
  });
}
