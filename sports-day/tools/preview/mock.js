/* google.script.run の偽物(ローカル確認用。名前はすべて架空)
 * 右下の「⚙ mock」で、モード・点数を隠す・予想の状態・通信の失敗 を切り替えられる。
 * 予想・クイズの送信・アンケートは localStorage(mock.db)に覚えておく(画面を開き直しても続きから確かめられる) */
(function () {
  'use strict';
  var CFG_KEY = 'mock.cfg', DB_KEY = 'mock.db';
  var def = {
    mode: '待ち', currentEvent: 'バド+ドッジ', nextEvent: 'バレー', sportsHidden: false,
    predStatus: '受付中', match: 'C-D',
    fail: false, latency: 400, quizStartedAt: 0, results: false, teamNameLocked: false
  };
  var cfg;
  try { cfg = Object.assign({}, def, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) { cfg = Object.assign({}, def); }
  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* */ } }

  /* サーバーに保存されたことにするデータ:preds 予想 / predSeq 予想の番号 / quiz クイズの答え / survey アンケート */
  var db;
  try { db = JSON.parse(localStorage.getItem(DB_KEY) || '{}'); } catch (e) { db = {}; }
  db = Object.assign({ preds: {}, predSeq: {}, quiz: {}, survey: {}, teamNames: { A: '', B: '', C: '', D: '' } }, db);
  function saveDb() { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* */ } }

  var OFFSET = 3000; /* サーバーの時計は端末より3秒進んでいることにする */
  function serverNow() { return Date.now() + OFFSET; }
  var NAME_SEC = 120, ORIGIN_SEC = 60;

  var FAM = ['青木', '石井', '上田', '江口', '大野', '加藤', '木村', '工藤', '小池', '坂本', '島田', '杉山', '田村', '辻', '中西', '西川', '野口', '原', '平井', '松尾', '森', '矢野', '山口', '吉岡', '若林', '渡部', '長谷川', '岡'];
  var FAMK = ['あおき', 'いしい', 'うえだ', 'えぐち', 'おおの', 'かとう', 'きむら', 'くどう', 'こいけ', 'さかもと', 'しまだ', 'すぎやま', 'たむら', 'つじ', 'なかにし', 'にしかわ', 'のぐち', 'はら', 'ひらい', 'まつお', 'もり', 'やの', 'やまぐち', 'よしおか', 'わかばやし', 'わたべ', 'はせがわ', 'おか'];
  var GIV = ['ひなた', '蓮', '結衣', '颯太', '美咲', '大和', '葵', '悠真', '千尋', '湊', '彩花', '陽斗', '真央', '拓海'];
  var GIVK = ['ひなた', 'れん', 'ゆい', 'そうた', 'みさき', 'やまと', 'あおい', 'ゆうま', 'ちひろ', 'みなと', 'あやか', 'はると', 'まお', 'たくみ'];
  var people = [];
  for (var i = 0; i < 28; i++) {
    people.push({ id: 'P' + (i < 9 ? '0' : '') + (i + 1), name: FAM[i] + ' ' + GIV[i % 14], kana: FAMK[i] + ' ' + GIVK[i % 14], team: 'ABCD'[i % 4] });
  }
  var intros = {
    P02: { sport: 'バスケ・バレー', comment: 'ラーメンが好き', nickname: 'れんれん', snsConsent: '顔OK' },
    P06: { sport: 'バドミントン', comment: '最近サウナにハマってる', nickname: '', snsConsent: '顔を隠せばOK' },
    P10: { sport: '特になし', comment: '猫を2匹飼ってます', nickname: 'ちーちゃん、ちひろん', snsConsent: '載せない' }
  };
  var MATCHES = { 'C-D': ['C', 'D'], 'A-B': ['A', 'B'] };
  var TEAMS = ['A', 'B', 'C', 'D'];

  function me(pid) { return people.filter(function (p) { return p.id === pid; })[0]; }
  function nameOf(pid) { var p = me(pid); return p ? p.name : pid; }
  function err(code, message) { return { ok: false, error: { code: code, message: message } }; }

  /* ---- 予想 ---- */
  /* predStatus:受付前 / 受付中 / 公開(締め切り後)/ 確定(締め切って、試合も確定 = 的中率が出る) */
  function predClosed() { return cfg.predStatus === '公開' || cfg.predStatus === '確定'; }
  function matchView() {
    var m = MATCHES[cfg.match];
    return {
      id: 'V-' + cfg.match, sport: 'バレー', round: '準決勝①', team1: m[0], team2: m[1],
      status: cfg.predStatus === '確定' ? '確定' : '予定', predictionStatus: cfg.predStatus === '確定' ? '公開' : cfg.predStatus, related: ''
    };
  }
  function predictionView(pid) {
    var p = me(pid), m = MATCHES[cfg.match], mid = 'V-' + cfg.match;
    var mine = db.preds[pid + mid] || null;
    var playing = p.team === m[0] || p.team === m[1];
    var closed = predClosed();
    var reason = null;
    if (playing) reason = 'PLAYING';
    else if (closed) reason = 'CLOSED';
    else if (cfg.predStatus !== '受付中') reason = 'NOT_OPEN';
    var view = {
      match: matchView(), myTeam: p.team, canPredict: !reason, reason: reason, myChoice: mine,
      revealed: closed && !playing, counts: null, teams: null, hit: null,
      progress: { predicted: 5 + (mine ? 1 : 0), arrived: 7 }
    };
    if (view.revealed) {
      /* 締め切り後:予想した2チームの人数だけの集計(自分のチームが先)。全員そろっても、締め切るまでは出さない */
      var others = TEAMS.filter(function (t) { return t !== m[0] && t !== m[1]; });
      others.sort(function (a, b) { return (a === p.team ? 0 : 1) - (b === p.team ? 0 : 1); });
      view.teams = others.map(function (t, k) {
        return { team: t, counts: k === 0 ? [{ team: m[0], count: 4 }, { team: m[1], count: 3 }] : [{ team: m[0], count: 2 }, { team: m[1], count: 5 }] };
      });
      view.counts = view.teams[0].counts;
      /* 試合が確定したら的中率(m[0] が勝ったことにする。どちらが勝ったかは返さない) */
      if (cfg.predStatus === '確定') {
        view.hit = { overall: 42.9, teams: [{ team: others[0], rate: 57.1, predicted: 7 }, { team: others[1], rate: 28.6, predicted: 7 }] };
      }
    }
    return view;
  }

  /* ---- クイズ ---- */
  function timing() {
    var s = cfg.quizStartedAt;
    return { startedAt: s, nameEndsAt: s + NAME_SEC * 1000, originEndsAt: s + (NAME_SEC + ORIGIN_SEC) * 1000, nameSeconds: NAME_SEC, originSeconds: ORIGIN_SEC };
  }
  /* 出身地クイズ3問(B・C・B)。正解つき(画面には正解を返さない) */
  var ORIGIN = [
    { type: 'B', targetId: 'P02', choices: ['宮城県', '山形県', '福島県', '岩手県'], answer: '宮城県' },
    { type: 'C', pref: '東京都', choices: ['P06', 'P10', 'P14', 'P18'], answerIds: ['P06', 'P14'] },
    { type: 'B', targetId: 'P22', choices: ['新潟県', '富山県', '長野県', '群馬県'], answer: '新潟県' }
  ];
  function originView() {
    return { questions: ORIGIN.map(function (q) {
      if (q.type === 'C') return { type: 'C', pref: q.pref, count: q.answerIds.length, choices: q.choices.map(function (id) { return { id: id, name: nameOf(id) }; }) };
      return { type: 'B', targetName: nameOf(q.targetId), choices: q.choices };
    }) };
  }
  function originResult(answers) {
    var list = Array.isArray(answers) ? answers : [answers];
    var qs = ORIGIN.map(function (q, i) {
      var a = list[i];
      if (q.type === 'C') {
        var ids = (Array.isArray(a) ? a : []).filter(function (id) { return q.choices.indexOf(id) >= 0; }).slice(0, q.answerIds.length);
        var ok = ids.length === q.answerIds.length && q.answerIds.every(function (id) { return ids.indexOf(id) >= 0; });
        return { type: 'C', pref: q.pref, answerNames: q.answerIds.map(nameOf), yourNames: ids.map(nameOf), correct: ok };
      }
      var s = typeof a === 'string' && q.choices.indexOf(a) >= 0 ? a : '';
      return { type: 'B', targetName: nameOf(q.targetId), answer: q.answer, yourAnswer: s, correct: s === q.answer };
    });
    return { correct: qs.filter(function (x) { return x.correct; }).length, total: qs.length, questions: qs };
  }
  /* 自分の答え合わせ。members には、書けなかった人(確認中あり)・0.5人分の人・1人分の人を入れる */
  function quizResult(pid) {
    var sent = db.quiz[pid];
    var published = cfg.mode === '結果公開';
    var written = Math.max(0, Math.min(4, (sent.names || []).length)); /* 書いた数に合わせて、書けた人数を変える(最大4人) */
    var list = [
      { id: 'P08', credit: 0, pending: true },   /* 「惜しい」答えを運営が確認中 */
      { id: 'P16', credit: 0, pending: false },
      { id: 'P10', credit: written >= 1 ? 0.5 : 0, pending: false }, /* あだ名で書けた(0.5人分) */
      { id: 'P02', credit: written >= 2 ? 1 : 0, pending: false },
      { id: 'P06', credit: written >= 3 ? 1 : 0, pending: false },
      { id: 'P14', credit: written >= 4 ? 1 : 0, pending: false }
    ];
    var members = list.map(function (x) {
      var p = me(x.id);
      return {
        name: p.name, kana: p.kana, nickname: intros[x.id] ? intros[x.id].nickname : '',
        written: x.credit > 0, credit: x.credit, pending: !published && x.pending
      };
    });
    members.sort(function (a, b) { return (a.written ? 1 : 0) - (b.written ? 1 : 0); });
    return {
      total: members.length,
      correctCount: members.filter(function (m) { return m.written; }).length,
      fullCount: members.filter(function (m) { return m.credit === 1; }).length,
      pendingCount: members.filter(function (m) { return m.pending && !m.written; }).length,
      pendingOther: published ? 0 : 1,
      published: published,
      members: members,
      origin: originResult(sent.origin)
    };
  }

  var API = {
    getState: function () {
      var sports = [
        { team: 'A', basketball: 10, badminton: 7, dodgeball: 4, volleyball: 29, sportsTotal: 50, sportsRank: 1 },
        { team: 'B', basketball: 7, badminton: 10, dodgeball: 2, volleyball: 18.5, sportsTotal: 37.5, sportsRank: 2 },
        { team: 'C', basketball: 4, badminton: 4, dodgeball: 10, volleyball: 14, sportsTotal: 32, sportsRank: 3 },
        { team: 'D', basketball: 2, badminton: 2, dodgeball: 7, volleyball: 14, sportsTotal: 25, sportsRank: 4 }
      ];
      var d = {
        mode: cfg.mode, currentEvent: cfg.currentEvent, nextEvent: cfg.nextEvent, updatedAt: Date.now(), serverNow: serverNow(),
        /* 点数を隠す:バレーの準決勝が2試合とも確定したあと。sports は返さない */
        sportsHidden: !!cfg.sportsHidden, sports: cfg.sportsHidden ? null : sports,
        teamNames: Object.assign({}, db.teamNames), teamNameLocked: !!cfg.teamNameLocked,
        prediction: null, quiz: null, results: null
      };
      if (cfg.mode === '予想') d.prediction = matchView();
      if (cfg.mode === 'クイズ') {
        if (!cfg.quizStartedAt) { cfg.quizStartedAt = serverNow(); saveCfg(); }
        d.quiz = timing();
      }
      if (cfg.mode === '結果公開') {
        /* 内訳(breakdown)と 👑 の名前つき。数字は見本 */
        var bd = function (b, d2, g, vs, vw, qn, qo, pr) {
          return { basketballRank: b, badmintonRank: d2, dodgeballRank: g, volleyScored: vs, volleyWins: vw, volleyBonus: vw * 4,
            quizNamePoints: qn, quizOriginPoints: qo, predictionRate: pr };
        };
        d.results = { teams: [
          { team: 'A', basketball: 10, badminton: 7, dodgeball: 4, volleyball: 58, sportsTotal: 79, sportsRank: 1, quiz: 5.7, odai: 3.1, prediction: 1.3, nakayoshiTotal: 10.1, total: 89.1, totalRank: 2,
            quizNameRate: 62.4, quizOriginRate: 44.4, breakdown: bd(1, 2, 3, 50, 2, 4.4, 1.3, 33.3) },
          { team: 'B', basketball: 7, badminton: 10, dodgeball: 2, volleyball: 49, sportsTotal: 68, sportsRank: 2, quiz: 8.2, odai: 4.5, prediction: 3, nakayoshiTotal: 15.7, total: 83.7, totalRank: 3,
            quizNameRate: 88.6, quizOriginRate: 66.7, breakdown: bd(2, 1, 4, 45, 1, 6.2, 2, 75) },
          { team: 'C', basketball: 4, badminton: 4, dodgeball: 10, volleyball: 56, sportsTotal: 74, sportsRank: 3, quiz: 9.1, odai: 6, prediction: 4, nakayoshiTotal: 19.1, total: 93.1, totalRank: 1,
            quizNameRate: 104.3, quizOriginRate: 60, breakdown: bd(3, 3, 1, 52, 1, 7.3, 1.8, 100) },
          { team: 'D', basketball: 2, badminton: 2, dodgeball: 7, volleyball: 40, sportsTotal: 51, sportsRank: 4, quiz: 6, odai: 2, prediction: 2, nakayoshiTotal: 10, total: 61, totalRank: 4,
            quizNameRate: 64.3, quizOriginRate: 50, breakdown: bd(4, 4, 2, 40, 0, 4.5, 1.5, 50) }
        ], crowns: {
          allFull: [{ name: people[2].name, team: people[2].team }],
          complete: [{ name: people[5].name, team: people[5].team }, { name: people[8].name, team: people[8].team }]
        } };
      }
      return { ok: true, data: d };
    },
    listTeamMembers: function (team) {
      if (cfg.mode === 'クイズ') return err('QUIZ_MODE', 'クイズ中は名前の一覧を開けません');
      return { ok: true, data: { team: team, members: people.filter(function (p) { return p.team === team; }) } };
    },
    selectSelf: function (pid) {
      var p = me(pid);
      if (!p) return err('NOT_FOUND', '参加者が見つかりません');
      return { ok: true, data: { id: p.id, name: p.name, kana: p.kana, team: p.team, introDone: !!intros[pid], surveyDone: !!db.survey[pid] } };
    },
    setTeamName: function (pid, name) {
      var p = me(pid);
      if (!p) return err('NOT_FOUND', '参加者が見つかりません');
      if (cfg.teamNameLocked) return err('TEAM_NAME_LOCKED', 'チーム名はもう締め切られました');
      var n = String(name || '').replace(/\s+/g, ' ').trim();
      if (Array.from(n).length > 10) return err('INVALID', 'チーム名は10字までです');
      db.teamNames[p.team] = n; saveDb();
      return { ok: true, data: { team: p.team, name: n, teamNames: Object.assign({}, db.teamNames) } };
    },
    getIntro: function (pid) {
      return { ok: true, data: { intro: intros[pid] || null, options: {
        sports: ['バスケ', 'バレー', 'バドミントン', 'その他', '特になし'], snsConsent: ['顔OK', '顔を隠せばOK', '載せない'],
        commentMax: 20, nicknameMax: 30, nicknameCount: 3
      } } };
    },
    saveIntro: function (pid, it) {
      if (!it.comment) return err('INVALID', 'ひとことを入れてください');
      var nicks = String(it.nickname || '').split(/[、,，\/／]/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
      if (nicks.length > 3) return err('INVALID', 'あだ名は3つまでです');
      var other = it.sports.indexOf('その他') >= 0 ? String(it.sportOther || '').trim() : '';
      if (it.sports.indexOf('その他') >= 0 && !other) return err('INVALID', 'その他のスポーツ名を入れてください');
      if (Array.from(other).length > 20) return err('INVALID', 'スポーツ名は20字までです');
      intros[pid] = { sport: it.sports.map(function (s) { return s === 'その他' ? 'その他（' + other + '）' : s; }).join('・'), sports: it.sports.slice(), sportOther: other, comment: it.comment, nickname: nicks.join('、'), snsConsent: it.snsConsent };
      return { ok: true, data: { saved: true } };
    },
    getPrediction: function (pid) {
      if (!me(pid)) return err('NOT_FOUND', '参加者が見つかりません');
      return { ok: true, data: predictionView(pid) };
    },
    submitPrediction: function (pid, mid, team, seq) {
      var v = predictionView(pid);
      if (!v.canPredict) return err('PREDICTION_' + v.reason, v.reason === 'CLOSED' ? '予想は締め切られました' : '予想できません');
      /* 押した時刻の番号が古い送信は捨てる(最後に押したものが残る) */
      var key = pid + mid, n = Number(seq);
      if (seq !== undefined && !isNaN(n)) {
        if (db.predSeq[key] && db.predSeq[key] > n) return { ok: true, data: predictionView(pid) };
        db.predSeq[key] = n;
      }
      db.preds[key] = team;
      saveDb();
      return { ok: true, data: predictionView(pid) };
    },
    startQuiz: function (pid) {
      if (cfg.mode !== 'クイズ') return err('NOT_QUIZ_MODE', 'いまはクイズの時間ではありません');
      /* すでに送っていたら、答え合わせは返さない(アンケートのあと getQuizResult で受け取る) */
      if (db.quiz[pid]) return { ok: true, data: { alreadyAnswered: true, surveyDone: !!db.survey[pid] } };
      if (!cfg.quizStartedAt) { cfg.quizStartedAt = serverNow(); saveCfg(); }
      return { ok: true, data: {
        alreadyAnswered: false,
        timing: timing(),
        serverNow: serverNow(),
        names: { count: 6, hints: [
          { sport: 'バスケ・バレー', comment: 'ラーメンが好き' }, null, { sport: 'バドミントン', comment: '最近サウナにハマってる' },
          { sport: '特になし', comment: '猫を2匹飼ってます' }, { sport: 'その他', comment: '朝が弱い' }, null
        ] },
        origin: originView()
      } };
    },
    submitQuiz: function (pid, answers) {
      if (cfg.mode === '結果公開') return err('QUIZ_CLOSED', 'クイズの受付は終わりました');
      /* 再送しても最初の答えのまま。答え合わせは返さない */
      if (!db.quiz[pid]) {
        answers = answers || {};
        db.quiz[pid] = { names: answers.names || [], origin: Array.isArray(answers.origin) ? answers.origin : [answers.origin] };
        saveDb();
      }
      return { ok: true, data: { accepted: true, surveyDone: !!db.survey[pid] } };
    },
    getQuizResult: function (pid) {
      if (!me(pid)) return err('NOT_FOUND', '参加者が見つかりません');
      var answered = !!db.quiz[pid], sd = !!db.survey[pid], now = serverNow();
      /* 名前クイズの全員の締め切りまでは、答え合わせを出さない */
      var nameEndsAt = cfg.mode === 'クイズ' && cfg.quizStartedAt ? timing().nameEndsAt : null;
      var waiting = nameEndsAt !== null && now < nameEndsAt;
      return { ok: true, data: {
        answered: answered, surveyDone: sd, availableAt: waiting ? nameEndsAt : null, serverNow: now,
        result: answered && sd && !waiting ? quizResult(pid) : null
      } };
    },
    submitSurvey: function (survey, pid) {
      survey = survey || {};
      var ok15 = function (v) { return v === 1 || v === 2 || v === 3 || v === 4 || v === 5; };
      if (!ok15(survey.fun) || !ok15(survey.talked)) return err('INVALID', '1と2は、1〜5で選んでください');
      if (['0人', '1〜2人', '3〜5人', '6人以上'].indexOf(survey.learned) < 0) return err('INVALID', '「新しく名前を覚えた人数」を選んでください');
      if (['バスケ', 'バド', 'ドッジ', 'バレー', 'クイズ', 'お題カード', '予想'].indexOf(survey.best) < 0) return err('INVALID', '「一番楽しかった種目・企画」を選んでください');
      if (['いいよ', '内容による', '今回はパス'].indexOf(survey.help) < 0) return err('INVALID', '「準備の手伝い」を選んでください');
      if (pid) { db.survey[pid] = true; saveDb(); }
      return { ok: true, data: { saved: true } };
    }
  };

  function runner(ok, ng) {
    var r = {
      withSuccessHandler: function (f) { return runner(f, ng); },
      withFailureHandler: function (f) { return runner(ok, f); }
    };
    Object.keys(API).forEach(function (name) {
      r[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        setTimeout(function () {
          if (cfg.fail) { if (ng) ng(new Error('NetworkError')); return; }
          var res = API[name].apply(null, args);
          if (ok) ok(JSON.parse(JSON.stringify(res)));
        }, cfg.latency);
      };
    });
    return r;
  }
  window.google = { script: { run: runner(null, null) } };

  /* 右下の切り替えパネル */
  window.addEventListener('DOMContentLoaded', function () {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:99;font:12px sans-serif;background:#222;color:#fff;border-radius:8px;padding:6px;opacity:.85;max-width:230px';
    var BOOLS = { fail: true, sportsHidden: true, teamNameLocked: true };
    function sel(key, label, opts) {
      return '<label style="display:block;margin:2px 0">' + label + ' <select data-k="' + key + '">' + opts.map(function (o) {
        var v = typeof o === 'string' ? o : o[0], t = typeof o === 'string' ? o : o[1];
        return '<option value="' + v + '"' + (String(cfg[key]) === String(v) ? ' selected' : '') + '>' + t + '</option>';
      }).join('') + '</select></label>';
    }
    box.innerHTML = '<b data-t style="cursor:pointer">⚙ mock</b><div data-p style="display:none">' +
      sel('mode', 'モード', ['待ち', '予想', 'クイズ', '結果待ち', '結果公開']) +
      sel('sportsHidden', '点数', [['false', '見せる'], ['true', '隠す(準決勝のあと)']]) +
      sel('predStatus', '予想', ['受付前', '受付中', ['公開', '締め切り後(公開)'], ['確定', '試合確定後(的中率)']]) +
      sel('match', '予想の試合', ['C-D', 'A-B']) +
      sel('teamNameLocked', 'チーム名', [['false', '受付中'], ['true', '締め切り']]) +
      sel('fail', '通信', [['false', 'つながる'], ['true', '失敗する']]) +
      '<button data-reset>クイズをやり直す</button> <button data-endnames>名前クイズを終わらせる</button> ' +
      '<button data-clear>端末とサーバーの記憶を消す</button></div>';
    document.body.appendChild(box);
    box.querySelector('[data-t]').onclick = function () { var p = box.querySelector('[data-p]'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; };
    box.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-k');
      if (!k) return;
      var before = cfg.mode;
      cfg[k] = BOOLS[k] ? e.target.value === 'true' : e.target.value;
      /* クイズに切り替えたら、そこからクイズ開始(前に送った答えは残る。やり直すときは「クイズをやり直す」) */
      if (k === 'mode' && cfg.mode === 'クイズ' && before !== 'クイズ') cfg.quizStartedAt = serverNow();
      saveCfg();
    });
    /* クイズ開始時刻を今にして、送ったクイズの答えとアンケートを消す(もう一度最初から確かめられる) */
    box.querySelector('[data-reset]').onclick = function () {
      cfg.quizStartedAt = serverNow(); saveCfg();
      db.quiz = {}; db.survey = {}; saveDb();
    };
    /* 名前クイズの全員の締め切り(nameEndsAt)を過ぎたことにする(答え合わせが出る条件を確かめる) */
    box.querySelector('[data-endnames]').onclick = function () { cfg.quizStartedAt = serverNow() - (NAME_SEC + 1) * 1000; saveCfg(); };
    box.querySelector('[data-clear]').onclick = function () {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('sd26.') === 0) localStorage.removeItem(k); });
      localStorage.removeItem(DB_KEY);
      location.reload();
    };
  });
  /* 確認用: コンソールや自動テストから設定を変える */
  window.__mock = { cfg: cfg, db: db, set: function (o) { Object.assign(cfg, o); saveCfg(); }, people: people };
})();
