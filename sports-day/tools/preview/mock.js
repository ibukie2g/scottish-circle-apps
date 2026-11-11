/* google.script.run の偽物(ローカル確認用。名前はすべて架空) */
(function () {
  'use strict';
  var CFG_KEY = 'mock.cfg';
  var def = {
    mode: '待ち', currentEvent: 'バド+ドッジ', nextEvent: 'バレー', predStatus: '受付中', match: 'C-D',
    fail: false, latency: 400, quizStartedAt: 0, results: false
  };
  var cfg;
  try { cfg = Object.assign({}, def, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) { cfg = Object.assign({}, def); }
  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* */ } }

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
    P10: { sport: '特になし', comment: '猫を2匹飼ってます', nickname: 'ちーちゃん', snsConsent: '載せない' }
  };
  var preds = {};
  var quizAns = {};
  var MATCHES = { 'C-D': ['C', 'D'], 'A-B': ['A', 'B'] };

  function me(pid) { return people.filter(function (p) { return p.id === pid; })[0]; }
  function err(code, message) { return { ok: false, error: { code: code, message: message } }; }

  var API = {
    getState: function () {
      var sports = [
        { team: 'A', basketball: 10, badminton: 7, dodgeball: 4, volleyball: 28, sportsTotal: 49, sportsRank: 1 },
        { team: 'B', basketball: 7, badminton: 10, dodgeball: 2, volleyball: 18.5, sportsTotal: 37.5, sportsRank: 2 },
        { team: 'C', basketball: 4, badminton: 4, dodgeball: 10, volleyball: 14, sportsTotal: 32, sportsRank: 3 },
        { team: 'D', basketball: 2, badminton: 2, dodgeball: 7, volleyball: 14, sportsTotal: 25, sportsRank: 4 }
      ];
      var m = MATCHES[cfg.match];
      var d = {
        mode: cfg.mode, currentEvent: cfg.currentEvent, nextEvent: cfg.nextEvent, updatedAt: Date.now(), serverNow: Date.now() + 3000,
        sports: sports, prediction: null, quiz: null, results: null
      };
      if (cfg.mode === '予想') d.prediction = { id: 'V-' + cfg.match, sport: 'バレー', round: '準決勝①', team1: m[0], team2: m[1], score1: null, score2: null, status: '予定', predictionStatus: cfg.predStatus, related: '' };
      if (cfg.mode === 'クイズ') {
        if (!cfg.quizStartedAt) { cfg.quizStartedAt = Date.now(); saveCfg(); }
        var s = cfg.quizStartedAt;
        d.quiz = { startedAt: s, nameEndsAt: s + 120000, originEndsAt: s + 135000, nameSeconds: 120, originSeconds: 15 };
      }
      if (cfg.mode === '結果公開') {
        d.results = { teams: [
          { team: 'A', sportsTotal: 49, sportsRank: 1, quiz: 5.7, odai: 3.1, prediction: 1.3, nakayoshiTotal: 10.1, total: 59.1, totalRank: 2 },
          { team: 'B', sportsTotal: 37.5, sportsRank: 2, quiz: 8.2, odai: 4.5, prediction: 3, nakayoshiTotal: 15.7, total: 53.2, totalRank: 3 },
          { team: 'C', sportsTotal: 32, sportsRank: 3, quiz: 9.1, odai: 6, prediction: 4, nakayoshiTotal: 19.1, total: 61.1, totalRank: 1 },
          { team: 'D', sportsTotal: 25, sportsRank: 4, quiz: 6, odai: 2, prediction: 2, nakayoshiTotal: 10, total: 35, totalRank: 4 }
        ] };
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
      return { ok: true, data: { id: p.id, name: p.name, kana: p.kana, team: p.team, introDone: !!intros[pid] } };
    },
    getIntro: function (pid) {
      return { ok: true, data: { intro: intros[pid] || null, options: { sports: ['バスケ', 'バレー', 'バドミントン', 'その他', '特になし'], snsConsent: ['顔OK', '顔を隠せばOK', '載せない'], commentMax: 20, nicknameMax: 20 } } };
    },
    saveIntro: function (pid, it) {
      if (!it.comment) return err('INVALID', 'ひとことを入れてください');
      intros[pid] = { sport: it.sports.join('・'), comment: it.comment, nickname: it.nickname, snsConsent: it.snsConsent };
      return { ok: true, data: { saved: true } };
    },
    getPrediction: function (pid) {
      var p = me(pid), m = MATCHES[cfg.match], mid = 'V-' + cfg.match;
      var mine = preds[pid + mid] || null;
      var arrived = 7, predicted = 5 + (mine ? 1 : 0);
      var revealed = cfg.predStatus === '公開' || predicted >= arrived;
      var reason = null;
      if (p.team === m[0] || p.team === m[1]) reason = 'PLAYING';
      else if (cfg.predStatus === '公開') reason = 'CLOSED';
      else if (cfg.predStatus !== '受付中') reason = 'NOT_OPEN';
      else if (revealed && mine) reason = 'REVEALED';
      return { ok: true, data: {
        match: { id: mid, sport: 'バレー', round: '準決勝①', team1: m[0], team2: m[1], status: '予定', predictionStatus: cfg.predStatus },
        myTeam: p.team, canPredict: !reason, reason: reason, myChoice: mine, revealed: revealed,
        counts: revealed ? [{ team: m[0], count: 4 }, { team: m[1], count: 3 }] : null,
        progress: { predicted: predicted, arrived: arrived }
      } };
    },
    submitPrediction: function (pid, mid, team) {
      preds[pid + mid] = team;
      return API.getPrediction(pid);
    },
    startQuiz: function (pid) {
      if (cfg.mode !== 'クイズ') return err('NOT_QUIZ_MODE', 'いまはクイズの時間ではありません');
      if (quizAns[pid]) return { ok: true, data: { alreadyAnswered: true, result: quizAns[pid] } };
      var s = cfg.quizStartedAt;
      return { ok: true, data: {
        alreadyAnswered: false,
        timing: { startedAt: s, nameEndsAt: s + 120000, originEndsAt: s + 135000, nameSeconds: 120, originSeconds: 15 },
        serverNow: Date.now() + 3000,
        names: { count: 6, hints: [
          { sport: 'バスケ・バレー', comment: 'ラーメンが好き' }, null, { sport: 'バドミントン', comment: '最近サウナにハマってる' },
          { sport: '特になし', comment: '猫を2匹飼ってます' }, { sport: 'その他', comment: '朝が弱い' }, null
        ] },
        origin: { targetName: '石井 蓮', choices: ['宮城県', '山形県', '福島県', '岩手県'] }
      } };
    },
    submitQuiz: function (pid, answers) {
      var r = {
        total: 6, correctCount: Math.min(6, answers.names.length), pendingCount: 1,
        members: [
          { name: '工藤 ひなた', kana: 'くどう ひなた', nickname: 'ひなっち', written: false, pending: true },
          { name: '中西 葵', kana: 'なかにし あおい', nickname: '', written: false, pending: false },
          { name: '石井 蓮', kana: 'いしい れん', nickname: 'れんれん', written: true, pending: false }
        ],
        origin: { targetName: '石井 蓮', answer: '宮城県', yourAnswer: answers.origin, correct: answers.origin === '宮城県' }
      };
      quizAns[pid] = r;
      return { ok: true, data: r };
    },
    getQuizResult: function (pid) {
      return { ok: true, data: { answered: !!quizAns[pid], result: quizAns[pid] || null } };
    },
    submitSurvey: function () { return { ok: true, data: { saved: true } }; }
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

  // 右下の切り替えパネル
  window.addEventListener('DOMContentLoaded', function () {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:99;font:12px sans-serif;background:#222;color:#fff;border-radius:8px;padding:6px;opacity:.85;max-width:220px';
    function sel(key, opts) {
      return '<label style="display:block;margin:2px 0">' + key + ' <select data-k="' + key + '">' + opts.map(function (o) {
        return '<option' + (String(cfg[key]) === String(o) ? ' selected' : '') + '>' + o + '</option>';
      }).join('') + '</select></label>';
    }
    box.innerHTML = '<b data-t style="cursor:pointer">⚙ mock</b><div data-p style="display:none">' +
      sel('mode', ['待ち', '予想', 'クイズ', '結果待ち', '結果公開']) +
      sel('predStatus', ['受付前', '受付中', '公開']) + sel('match', ['C-D', 'A-B']) +
      sel('fail', ['false', 'true']) +
      '<button data-reset>クイズ開始時刻を今に</button> <button data-clear>端末の記憶を消す</button></div>';
    document.body.appendChild(box);
    box.querySelector('[data-t]').onclick = function () { var p = box.querySelector('[data-p]'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; };
    box.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-k');
      cfg[k] = k === 'fail' ? e.target.value === 'true' : e.target.value;
      if (k === 'mode' && cfg.mode !== 'クイズ') cfg.quizStartedAt = cfg.quizStartedAt || 0;
      saveCfg();
    });
    box.querySelector('[data-reset]').onclick = function () { cfg.quizStartedAt = Date.now(); saveCfg(); };
    box.querySelector('[data-clear]').onclick = function () {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('sd26.') === 0) localStorage.removeItem(k); });
      location.reload();
    };
  });
  // 確認用: コンソールや自動テストから設定を変える
  window.__mock = { cfg: cfg, set: function (o) { Object.assign(cfg, o); saveCfg(); }, people: people };
})();
