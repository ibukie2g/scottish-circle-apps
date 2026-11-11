// GAS 側の通しの流れ(偽の SpreadsheetApp などで src/*.js をそのまま動かす)
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./helpers/fake_gas.js');

const FORM_HEADERS = ['タイムスタンプ', 'フルネーム(漢字)', 'フルネーム(ひらがな)', '性別', '大学', '学年', '所属',
  '出身地(都道府県)', '学籍番号(任意)', '11/24(火)の運動会に参加できますか？', '名簿としての保存について',
  '何時ごろから参加できそうですか？(途中から参加の人)', 'チーム'];

function person(name, kana, origin, team) {
  return ['2026/11/12', name, kana, '', '', '', '', origin, '', '参加', '同意', '', team];
}

function setupWorld() {
  const env = loadGas({ props: { ROSTER_SPREADSHEET_ID: 'roster', ADMIN_PASSWORD: 'pw' } });
  const form = env.roster.insertSheet('フォームの回答 1');
  form.data = [FORM_HEADERS,
    person('斎藤 花子', 'さいとう はなこ', '福島県', 'A'),
    person('渡辺 太郎', 'わたなべ たろう', '宮城県', 'A'),
    person('高橋 健', 'たかはし けん', '東京都', 'A'),
    person('佐藤 一郎', 'さとう いちろう', '北海道', 'B'),
    person('鈴木 次郎', 'すずき じろう', '新潟県', 'B'),
    person('田中 三郎', 'たなか さぶろう', '大阪府', 'C'),
    person('伊藤 四郎', 'いとう しろう', '福岡県', 'C'),
    person('山本 五郎', 'やまもと ごろう', '沖縄県', 'D'),
    person('中村 六郎', 'なかむら ろくろう', '長野県', 'D'),
    person('未定 さん', 'みてい さん', '山形県', '')
  ];
  const g = env.ctx;
  g.setup();
  g.setup(); // 2回目でも壊れない
  return env;
}

// google.script.run と同じように JSON にして受け取る(Date などは渡せない)
function ok(res) {
  assert.equal(res.ok, true, JSON.stringify(res));
  return JSON.parse(JSON.stringify(res.data));
}

test('setup: シートと初期データ', () => {
  const { app, roster, ctx } = setupWorld();
  const names = app.getSheets().map(s => s.getName());
  for (const n of ['状態', '参加者', '試合', '予想', 'クイズ問題', 'クイズ回答', '惜しい答え', 'お題カード', 'アンケート', '設定', '集計']) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(app.getSheetByName('試合').getLastRow(), 19); // 見出し+18試合
  assert.deepEqual(app.getSheetByName('惜しい答え').data[0], ['番号', '参加者ID', '近い候補(参加者ID)', '判定']);
  assert.ok(roster.getSheetByName('自己紹介'));
  assert.ok(roster.getSheetByName('当日追加'));
  // 状態のキーは重複しない
  assert.equal(app.getSheetByName('状態').getLastRow(), 7);
  // Webアプリから(持ち主以外が)呼ぶと拒否
  ctx.__activeUser = '';
  assert.throws(() => ctx.setup());
});

test('通しの流れ: 名簿 → 名前を選ぶ → 自己紹介 → 予想 → 試合 → クイズ → 惜しい答え → 結果', () => {
  const { ctx: g, app, roster, cache } = setupWorld();
  const token = ok(g.adminLogin('pw')).token;
  assert.equal(g.adminLogin('ng').error.code, 'AUTH');
  assert.equal(g.adminGetOverview('bad').error.code, 'AUTH');

  // 名簿の読み込み
  const imp = ok(g.adminImportRoster(token));
  assert.equal(imp.assignedIds, 9);
  assert.equal(imp.added, 9);
  const form = roster.getSheetByName('フォームの回答 1');
  assert.equal(form.data[0][13], '参加者ID');
  assert.equal(form.data[1][13], 'P01');
  assert.equal(form.data[10][13] || '', ''); // チームなしの人は採番しない
  // アプリ用ファイルには名前を書かない
  const partSheet = app.getSheetByName('参加者');
  assert.ok(!JSON.stringify(partSheet.data).includes('斎藤'));
  assert.equal(ok(g.adminImportRoster(token)).added, 0); // 2回目は増えない

  // 当日追加
  const w = ok(g.adminAddWalkIn(token, { name: '小林 七子', kana: 'こばやし ななこ', team: 'b', origin: '群馬' }));
  assert.equal(w.id, 'P10');
  assert.equal(roster.getSheetByName('当日追加').data[1][4], '群馬県');

  // 名前を選ぶ
  const list = ok(g.listTeamMembers('A'));
  assert.deepEqual(list.members.map(m => m.id).sort(), ['P01', 'P02', 'P03']);
  ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09'].forEach(id => ok(g.selectSelf(id)));
  assert.equal(g.selectSelf('P99').error.code, 'NOT_FOUND');

  // 自己紹介
  assert.equal(g.saveIntro('P01', { sport: 'バスケ', comment: '', snsConsent: '顔OK' }).error.code, 'INVALID');
  assert.equal(g.saveIntro('P01', { sport: 'バスケ', comment: 'あ'.repeat(21), snsConsent: '顔OK' }).error.code, 'INVALID');
  ok(g.saveIntro('P01', { sport: 'バスケ', comment: '=ラーメンが好き', nickname: 'はな', snsConsent: '顔OK' }));
  ok(g.saveIntro('P01', { sport: 'バレー', comment: 'ラーメンが好き', nickname: 'はな', snsConsent: '顔を隠せばOK' }));
  ok(g.saveIntro('P02', { sport: 'その他', comment: '犬を飼ってる', snsConsent: '載せない' }));
  ok(g.saveIntro('P02', { sports: ['バレー', 'バスケ', 'バスケ'], comment: '犬を飼ってる', snsConsent: '載せない' }));
  assert.equal(g.saveIntro('P02', { sports: ['特になし', 'バスケ'], comment: '犬', snsConsent: '載せない' }).error.code, 'INVALID');
  assert.equal(g.saveIntro('P02', { sports: [], comment: '犬', snsConsent: '載せない' }).error.code, 'INVALID');
  assert.equal(roster.getSheetByName('自己紹介').getLastRow(), 3); // 自分専用の行に上書き(P01=2行目、P02=3行目)
  assert.equal(ok(g.getIntro('P02')).intro.sport, 'バスケ・バレー');
  assert.equal(ok(g.getIntro('P01')).intro.sport, 'バレー');

  // 予想(V-SF1 は A-B。予想するのは C・D)
  ok(g.adminSetPredictionStatus(token, 'V-SF1', '受付中'));
  let st = ok(g.getState());
  assert.equal(st.mode, '予想');
  assert.equal(st.prediction.id, 'V-SF1');
  assert.equal(ok(g.getPrediction('P01')).reason, 'PLAYING');
  assert.equal(g.submitPrediction('P01', 'V-SF1', 'A').error.code, 'PREDICTION_PLAYING');
  let pv = ok(g.submitPrediction('P06', 'V-SF1', 'A'));
  assert.equal(pv.myChoice, 'A');
  assert.equal(pv.revealed, false);
  pv = ok(g.submitPrediction('P06', 'V-SF1', 'B')); // 公開前は上書き可
  assert.equal(pv.myChoice, 'B');
  pv = ok(g.submitPrediction('P07', 'V-SF1', 'A')); // C の全員(2人)がそろった
  assert.equal(pv.revealed, true);
  assert.deepEqual(pv.counts, [{ team: 'A', count: 1 }, { team: 'B', count: 1 }]);
  assert.equal(g.submitPrediction('P07', 'V-SF1', 'B').error.code, 'PREDICTION_REVEALED');
  ok(g.submitPrediction('P08', 'V-SF1', 'A'));
  assert.equal(ok(g.getPrediction('P08')).revealed, false); // D はまだ1人
  ok(g.adminSetPredictionStatus(token, 'V-SF1', '公開'));
  assert.equal(ok(g.getPrediction('P08')).revealed, true);
  assert.equal(g.submitPrediction('P09', 'V-SF1', 'A').error.code, 'PREDICTION_CLOSED');

  // 試合
  assert.equal(g.adminSaveMatch(token, 'V-SF1', 20, 20).error.code, 'INVALID'); // トーナメントは引き分け不可
  ok(g.adminSaveMatch(token, 'V-SF1', 25, 20)); // A勝ち
  const r2 = ok(g.adminSaveMatch(token, 'V-SF2', 25, 18)); // C勝ち
  assert.deepEqual(r2.changes.map(c => c.id).sort(), ['V-3RD', 'V-F']);
  const ms = ok(g.adminGetMatches(token)).matches;
  assert.deepEqual([ms.find(m => m.id === 'V-F').team1, ms.find(m => m.id === 'V-F').team2], ['A', 'C']);
  st = ok(g.getState());
  const a = st.sports.find(t => t.team === 'A');
  assert.equal(a.volleyball, 28);
  assert.equal(st.results, null);
  assert.ok(!('quiz' in st.sports[0])); // 仲良しポイントは出さない

  // クイズ
  ok(g.adminStartQuiz(token));
  st = ok(g.getState());
  assert.equal(st.mode, 'クイズ');
  assert.equal(st.quiz.nameEndsAt - st.quiz.startedAt, 120000);
  assert.equal(st.quiz.originEndsAt - st.quiz.nameEndsAt, 15000);
  assert.equal(g.listTeamMembers('A').error.code, 'QUIZ_MODE');
  const q1 = ok(g.startQuiz('P01'));
  assert.equal(q1.names.count, 2);
  assert.equal(q1.names.hints.filter(h => h).length, 1); // P02 だけ自己紹介あり
  assert.equal(q1.origin.choices.length, 4);
  assert.ok(['渡辺 太郎', '高橋 健'].includes(q1.origin.targetName));
  const qRow = app.getSheetByName('クイズ問題').data.find(r => r[0] === 'P01');
  const answer = g.cacheGetJson_('origin:P01').answer;
  assert.equal(qRow[7], ''); // 正解はシートに保存しない
  const res = ok(g.submitQuiz('P01', { names: ['ワタナベタロウ', 'たかはしけ'], origin: answer }));
  assert.equal(res.total, 2);
  assert.equal(res.correctCount, 1);
  assert.equal(res.pendingCount, 1);
  assert.equal(res.origin.correct, true);
  const missed = res.members.find(m => !m.written);
  assert.equal(missed.name, '高橋 健');
  // 再送しても最初の回答のまま
  assert.equal(ok(g.submitQuiz('P01', { names: ['渡辺太郎', '高橋健'], origin: '' })).correctCount, 1);
  // 入力そのものはアプリ用ファイルに書かない
  const appDump = JSON.stringify(app.getSheets().map(s => s.data));
  assert.ok(!appDump.includes('たかはしけ'));
  assert.ok(!appDump.includes('ワタナベタロウ'));
  ok(g.submitQuiz('P02', { names: ['斎藤花子', '高橋健'], origin: '' }));

  // 惜しい答え
  let near = ok(g.adminListNearMisses(token)).items;
  assert.equal(near.length, 1);
  assert.equal(near[0].input, 'たかはしけ');
  assert.equal(near[0].candidateId, 'P03');
  ok(g.adminJudgeNearMiss(token, near[0].number, 'OK'));
  assert.equal(ok(g.getQuizResult('P01')).result.correctCount, 2);
  assert.equal(ok(g.adminListNearMisses(token)).items.length, 0);
  assert.equal(ok(g.adminListNearMisses(token, true)).items[0].input, null); // 判定後は入力を消す

  // キャッシュが消えても(入力が null でも)判定・集計はできる
  ok(g.submitQuiz('P03', { names: ['さいとうはなご'], origin: '' }));
  cache.store.clear();
  const token2 = ok(g.adminLogin('pw')).token;
  near = ok(g.adminListNearMisses(token2)).items;
  assert.equal(near.length, 1);
  assert.equal(near[0].input, null);
  ok(g.adminJudgeNearMiss(token2, near[0].number, 'NG'));

  // お題カード
  const od = ok(g.adminGetOdai(token2));
  assert.equal(od.defaultAnswered.A, 3);
  ok(g.adminSaveOdai(token2, { number: 1, theme: '好きな果物', team: 'A', matched: 3, answered: 3 }));
  ok(g.adminSaveOdai(token2, { number: 1, team: 'A', matched: 2, answered: 3 })); // 上書き
  assert.equal(app.getSheetByName('お題カード').getLastRow(), 2);

  // 集計
  const sc = ok(g.adminGetScores(token2));
  const A = sc.teams.find(t => t.team === 'A');
  // クイズ: P01=1, P02=1, P03=0 → 平均 2/3 × 7 = 4.67。出身地: P01 正解、P02・P03 不正解 → 1/3 × 3 = 1
  assert.equal(A.quiz, 5.7);
  assert.equal(A.odai, 1);
  const C = sc.teams.find(t => t.team === 'C');
  assert.equal(C.prediction, 1); // C: A 1人・B 1人 → 2 × 1/2
  const D = sc.teams.find(t => t.team === 'D');
  assert.equal(D.prediction, 2);
  assert.equal(sc.teams.find(t => t.team === 'B').quiz, 0); // 回答者なし
  const sumSheet = app.getSheetByName('集計');
  assert.equal(sumSheet.data[1][0], 'A');
  assert.equal(sumSheet.data[1][6], 5.7);

  // 結果公開
  ok(g.adminPublishResults(token2));
  st = ok(g.getState());
  assert.equal(st.mode, '結果公開');
  assert.equal(st.results.teams.find(t => t.team === 'A').quiz, 5.7);
  assert.equal(g.submitQuiz('P04', { names: [] }).error.code, 'QUIZ_CLOSED');

  // アンケート(匿名)
  assert.equal(g.submitSurvey({ fun: 6, talked: 3, again: 'はい' }).error.code, 'INVALID');
  ok(g.submitSurvey({ fun: 5, talked: 4, again: 'はい', comment: 'たのしかった' }));
  assert.equal(app.getSheetByName('アンケート').getLastRow(), 2);

  // 運営の操作
  ok(g.adminChangeTeam(token2, 'P10', 'C'));
  ok(g.adminSetQuizInclude(token2, 'P03', false));
  const ov = ok(g.adminGetOverview(token2));
  assert.equal(ov.participants.find(p => p.id === 'P10').team, 'C');
  assert.equal(ov.participants.find(p => p.id === 'P03').quizInclude, false);
  assert.equal(ok(g.adminGetScores(token2)).teams.find(t => t.team === 'A').quiz, 8.5); // P01,P02 だけ: 7×1 + 3×0.5
  assert.equal(g.adminSaveSettings(token2, { 'ないキー': 1 }).error.code, 'INVALID');
  ok(g.adminSaveSettings(token2, { 'バレー勝ちボーナス': 5 }));
  assert.equal(ok(g.getState()).sports.find(t => t.team === 'A').volleyball, 30);
});

test('シートを直接書き換えても動く(Claude が操作する想定)', () => {
  const { ctx: g, app, cache } = setupWorld();
  const token = g.adminLogin('pw').data.token;
  ok(g.adminImportRoster(token));
  // 状態シートを直接「待ち」→「結果待ち」にする
  const stSheet = app.getSheetByName('状態');
  const row = stSheet.data.findIndex(r => r[0] === 'モード');
  stSheet.data[row][1] = '結果待ち';
  // 試合シートに直接点数を書く(全角数字・文字の確定)
  const mSheet = app.getSheetByName('試合');
  const h = mSheet.data[0];
  const r = mSheet.data.findIndex(x => x[0] === 'B-R1-1');
  mSheet.data[r][h.indexOf('点数1')] = '１２';
  mSheet.data[r][h.indexOf('点数2')] = 8;
  mSheet.data[r][h.indexOf('状態')] = '確定';
  cache.store.clear(); // 10秒たった
  const st = ok(g.getState());
  assert.equal(st.mode, '結果待ち');
  const sc = ok(g.adminGetScores(g.adminLogin('pw').data.token));
  assert.equal(sc.standings.basketball.standings.find(s => s.team === 'A').wins, 1);
  // 変な値でも落ちない
  stSheet.data[row][1] = 'へんなモード';
  cache.store.clear();
  assert.equal(ok(g.getState()).mode, '待ち');
});
