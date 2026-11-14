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

// 名前クイズの全員の締め切りを過ぎたことにする(クイズ開始時刻を10分前にする)
function endNamePhase(env) {
  const sh = env.app.getSheetByName('状態');
  sh.data.find(r => r[0] === 'クイズ開始時刻')[1] = new Date(Date.now() - 600000);
  env.ctx.cache_().remove('tbl:状態');
}

// アンケートの答え(必須の項目がそろった形)
const SURVEY = { fun:5, talked:4, learned:'1〜2人', best:'バレー', next:['ご飯'], help:'いいよ' };

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
  assert.equal(app.getSheetByName('状態').getLastRow(), 8);
  // Webアプリから(持ち主以外が)呼ぶと拒否
  ctx.__activeUser = '';
  assert.throws(() => ctx.setup());
});

test('通しの流れ: 名簿 → 名前を選ぶ → 自己紹介 → 予想 → 試合 → クイズ → 惜しい答え → 結果', () => {
  const env = setupWorld();
  const { ctx: g, app, roster, cache } = env;
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
  // あだ名は「、」「,」「/」で区切って3つまで
  assert.equal(g.saveIntro('P03', { sports: ['その他'], comment: '散歩が好き', nickname: 'けんけん、たかっち/ケンさん,よっつめ', snsConsent: '載せない' }).error.code, 'INVALID');
  ok(g.saveIntro('P03', { sports: ['その他'], comment: '散歩が好き', nickname: 'けんけん,たかっち／ケンさん', snsConsent: '載せない' }));
  assert.equal(ok(g.getIntro('P03')).intro.nickname, 'けんけん、たかっち、ケンさん');
  assert.equal(g.saveIntro('P02', { sports: ['特になし', 'バスケ'], comment: '犬', snsConsent: '載せない' }).error.code, 'INVALID');
  assert.equal(g.saveIntro('P02', { sports: [], comment: '犬', snsConsent: '載せない' }).error.code, 'INVALID');
  assert.equal(roster.getSheetByName('自己紹介').getLastRow(), 4); // 自分専用の行に上書き(P01=2行目、P02=3行目、P03=4行目)
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
  pv = ok(g.submitPrediction('P07', 'V-SF1', 'A')); // C の全員(2人)がそろっても、公開しない・変更できる
  assert.equal(pv.revealed, false);
  assert.equal(pv.counts, null);
  assert.equal(pv.teams, null);
  assert.deepEqual(pv.progress, { predicted: 2, arrived: 2 });
  assert.equal(ok(g.submitPrediction('P07', 'V-SF1', 'B')).myChoice, 'B');
  assert.equal(ok(g.submitPrediction('P07', 'V-SF1', 'A')).myChoice, 'A');
  ok(g.submitPrediction('P08', 'V-SF1', 'A'));
  // 締め切るまで、内訳は運営にも返さない
  let sum = ok(g.adminGetPredictionSummary(token, 'V-SF1'));
  assert.equal(sum.closed, false);
  assert.equal(typeof sum.openedAt, 'number');
  assert.deepEqual(sum.teams.map(t => [t.team, t.predicted, t.counts]), [['C', 2, null], ['D', 1, null]]);
  sum = ok(g.adminSetPredictionStatus(token, 'V-SF1', '公開'));
  assert.deepEqual(sum.teams[0].counts, [{ team: 'A', count: 1 }, { team: 'B', count: 1 }]);
  // 締め切ったら、予想した2チームに人数だけの集計(自分のチームが先)
  pv = ok(g.getPrediction('P08'));
  assert.equal(pv.revealed, true);
  assert.equal(pv.reason, 'CLOSED');
  assert.deepEqual(pv.teams, [
    { team: 'D', counts: [{ team: 'A', count: 1 }, { team: 'B', count: 0 }] },
    { team: 'C', counts: [{ team: 'A', count: 1 }, { team: 'B', count: 1 }] }
  ]);
  assert.equal(pv.hit, null); // 的中率は試合が確定してから
  assert.equal(ok(g.getPrediction('P01')).teams, null); // 試合に出ているチームには出さない
  assert.equal(g.submitPrediction('P09', 'V-SF1', 'A').error.code, 'PREDICTION_CLOSED');

  // 試合
  assert.equal(g.adminSaveMatch(token, 'V-SF1', 20, 20).error.code, 'INVALID'); // トーナメントは引き分け不可
  ok(g.adminSaveMatch(token, 'V-SF1', 25, 20)); // A勝ち
  // 確定したら的中率(全体 2/3、C 1/2、D 1/1)
  assert.deepEqual(ok(g.getPrediction('P06')).hit, {
    overall: 66.7, teams: [{ team: 'C', rate: 50, predicted: 2 }, { team: 'D', rate: 100, predicted: 1 }]
  });
  st = ok(g.getState());
  assert.equal(st.sportsHidden, false);
  assert.equal(st.sports.find(t => t.team === 'A').volleyball, 29); // 25点 + 勝ちボーナス4
  assert.ok(!('quiz' in st.sports[0])); // 仲良しポイントは出さない
  const r2 = ok(g.adminSaveMatch(token, 'V-SF2', 25, 18)); // C勝ち
  assert.deepEqual(r2.changes.map(c => c.id).sort(), ['V-3RD', 'V-F']);
  const ms = ok(g.adminGetMatches(token)).matches;
  assert.deepEqual([ms.find(m => m.id === 'V-F').team1, ms.find(m => m.id === 'V-F').team2], ['A', 'C']);
  // 準決勝が2試合とも確定したら、運動の点数は参加者に返さない
  st = ok(g.getState());
  assert.equal(st.sportsHidden, true);
  assert.equal(st.sports, null);
  assert.equal(st.results, null);

  // クイズ
  ok(g.adminStartQuiz(token));
  st = ok(g.getState());
  assert.equal(st.mode, 'クイズ');
  assert.equal(st.quiz.nameEndsAt - st.quiz.startedAt, 120000);
  assert.equal(st.quiz.originEndsAt - st.quiz.nameEndsAt, 60000); // 出身地は3問で60秒
  assert.equal(g.listTeamMembers('A').error.code, 'QUIZ_MODE');
  const q1 = ok(g.startQuiz('P01'));
  assert.equal(q1.names.count, 2);
  assert.equal(q1.names.hints.filter(h => h).length, 2); // P02・P03 の自己紹介
  assert.ok(!JSON.stringify(q1).includes('けんけん')); // あだ名はヒントに出さない
  // 出身地クイズ:チームメイトが2人なので B「〇〇さんの出身は?」が2問(C は4人そろわないので出ない)
  assert.equal(q1.origin.questions.length, 2);
  for (const oq of q1.origin.questions) {
    assert.equal(oq.type, 'B');
    assert.equal(oq.choices.length, 4);
    assert.ok(!('answer' in oq)); // 正解は画面に返さない
  }
  assert.deepEqual(q1.origin.questions.map(x => x.targetName).sort(), ['渡辺 太郎', '高橋 健'].sort());
  const qRow = app.getSheetByName('クイズ問題').data.find(r => r[0] === 'P01');
  const answer = g.cacheGetJson_('origin:P01').questions.map(x => x.answer); // 2問とも正解を送る
  assert.equal(qRow[7], ''); // 正解はシートに保存しない
  // 送っても、答え合わせは返さない(アンケートを送ってから)
  const sent = ok(g.submitQuiz('P01', { names: ['ワタナベタロウ', 'たかはしけ', 'なぞのひと'], origin: answer }));
  assert.deepEqual(sent, { accepted: true, surveyDone: false });
  let qr = ok(g.getQuizResult('P01'));
  assert.deepEqual([qr.answered, qr.surveyDone, qr.result], [true, false, null]);
  assert.equal(ok(g.startQuiz('P01')).alreadyAnswered, true);
  assert.ok(!('result' in ok(g.startQuiz('P01'))));
  // アンケートを送っても、名前クイズの全員の締め切りまでは返さない(早く終わった人が答えを見られないように)
  ok(g.submitSurvey(Object.assign({}, SURVEY, {fun:5,talked:4}), 'P01'));
  qr = ok(g.getQuizResult('P01'));
  assert.deepEqual([qr.surveyDone, qr.result, qr.availableAt], [true, null, st.quiz.nameEndsAt]);
  endNamePhase(env);
  qr = ok(g.getQuizResult('P01'));
  assert.equal(qr.availableAt, null);
  let res = qr.result;
  assert.equal(res.total, 2);
  assert.equal(res.correctCount, 1);
  assert.equal(res.pendingCount, 1);  // 「たかはしけ」→ 高橋 健 を確認中
  assert.equal(res.pendingOther, 1);  // 「なぞのひと」はだれの答えか分からない
  assert.deepEqual([res.origin.correct, res.origin.total], [2, 2]);
  assert.deepEqual(res.origin.questions.map(x => [x.correct, x.yourAnswer === x.answer]), [[true, true], [true, true]]);
  const missed = res.members.find(m => !m.written);
  assert.deepEqual([missed.name, missed.pending, missed.nickname], ['高橋 健', true, 'けんけん、たかっち、ケンさん']);
  assert.ok(!JSON.stringify(res).includes('quiz') && !JSON.stringify(res).includes('Rank')); // チームの点数・順位は入れない
  // 再送しても最初の回答のまま
  ok(g.submitQuiz('P01', { names: ['渡辺太郎', '高橋健'], origin: '' }));
  assert.equal(ok(g.getQuizResult('P01')).result.correctCount, 1);
  // 入力そのものはアプリ用ファイルに書かない
  const appDump = JSON.stringify(app.getSheets().map(s => s.data));
  assert.ok(!appDump.includes('たかはしけ'));
  assert.ok(!appDump.includes('ワタナベタロウ'));
  assert.ok(!appDump.includes('なぞのひと'));
  // P02:フルネーム1人 + あだ名(敬称を外した「ケン」)で0.5人分 → 全員コンプリート (1.5/2) + 10%
  ok(g.submitQuiz('P02', { names: ['斎藤花子', 'ケン先輩'], origin: '' }));
  const aRow = app.getSheetByName('クイズ回答').data.find(r => r[0] === 'P02');
  const aHead = app.getSheetByName('クイズ回答').data[0];
  assert.equal(aRow[aHead.indexOf('正解と判定した人のID')], 'P01');
  assert.equal(aRow[aHead.indexOf('0.5人分と判定した人のID')], 'P03');
  assert.equal(aRow[aHead.indexOf('自動判定(控え)')], 'P01:1,P03:0.5');
  assert.ok(Math.abs(aRow[aHead.indexOf('名前の正答率')] - 0.85) < 1e-9);
  assert.deepEqual([aRow[aHead.indexOf('出身地の正誤')], aRow[aHead.indexOf('出身地の問題数')]], [0, 2]); // 正解数と問題数
  const aRow1 = app.getSheetByName('クイズ回答').data.find(r => r[0] === 'P01');
  assert.deepEqual([aRow1[aHead.indexOf('出身地の正誤')], aRow1[aHead.indexOf('出身地の問題数')]], [2, 2]);

  // 運営の判断:候補あり(たかはしけ → P03)が先、候補なし(なぞのひと)が後
  let near = ok(g.adminListNearMisses(token));
  assert.equal(near.pendingCount, 2);
  assert.deepEqual(near.items.map(x => [x.input, x.candidateId, x.count]), [['たかはしけ', 'P03', 1], ['なぞのひと', '', 1]]);
  assert.equal(ok(g.adminGetOverview(token)).pendingNearMisses, 2);
  const rateOf = pid => g.readQuizAnswers_(true).find(a => a.participantId === pid).nameRate;
  ok(g.adminJudgeNearMiss(token, near.items[0].numbers, '1人分'));
  assert.ok(Math.abs(rateOf('P01') - 1.2) < 1e-9);          // 2人ともフルネーム扱い → +20%
  assert.equal(ok(g.getQuizResult('P01')).result.correctCount, 2);
  ok(g.adminJudgeNearMiss(token, near.items[0].numbers, '0.5人分')); // 判断は直せる
  assert.ok(Math.abs(rateOf('P01') - 0.85) < 1e-9);
  ok(g.adminJudgeNearMiss(token, near.items[0].numbers, '1人分'));
  // 候補なしは、だれの答えか選ばないと点にできない。クイズの対象でない人も選べない
  assert.equal(g.adminJudgeNearMiss(token, near.items[1].numbers, '0.5人分').error.code, 'INVALID');
  assert.equal(g.adminJudgeNearMiss(token, near.items[1].numbers, '0.5人分', 'P09').error.code, 'INVALID');
  assert.equal(g.adminJudgeNearMiss(token, near.items[1].numbers, 'へん').error.code, 'INVALID');
  ok(g.adminJudgeNearMiss(token, near.items[1].numbers, '×'));
  assert.ok(Math.abs(rateOf('P01') - 1.2) < 1e-9);
  assert.equal(ok(g.adminListNearMisses(token)).items.length, 0);
  // 判断したあとも入力は(6時間)残る。公開後に直せるように
  assert.deepEqual(ok(g.adminListNearMisses(token, true)).items.map(x => [x.input, x.judgement]), [['たかはしけ', '1人分'], ['なぞのひと', '×']]);

  // キャッシュが消えても(入力が null でも)判断・集計はできる
  ok(g.submitQuiz('P03', { names: ['さいとうはなご'], origin: '' }));
  cache.store.clear();
  const token2 = ok(g.adminLogin('pw')).token;
  near = ok(g.adminListNearMisses(token2)).items;
  assert.equal(near.length, 1);
  assert.equal(near[0].input, null);
  assert.equal(near[0].candidateId, 'P01');
  const p03near = near[0].numbers;
  ok(g.adminJudgeNearMiss(token2, p03near, 'NG')); // 古い呼び方(OK/NG)も受け付ける
  assert.equal(ok(g.adminListNearMisses(token2, true)).items.find(x => x.numbers[0] === p03near[0]).judgement, '×');

  // お題カード
  const od = ok(g.adminGetOdai(token2));
  assert.equal(od.defaultAnswered.A, 3);
  ok(g.adminSaveOdai(token2, { number: 1, theme: '好きな果物', team: 'A', matched: 3, answered: 3 }));
  ok(g.adminSaveOdai(token2, { number: 1, team: 'A', matched: 2, answered: 3 })); // 上書き
  assert.equal(app.getSheetByName('お題カード').getLastRow(), 2);

  // 集計
  const sc = ok(g.adminGetScores(token2));
  const A = sc.teams.find(t => t.team === 'A');
  // 名前: P01=1.2, P02=0.85, P03=0 → 平均 0.683 × 7 = 4.78。出身地: P01 2問正解、P02・P03 0問(各2問)→ 2/6 × 3 = 1
  assert.equal(A.quiz, 5.8);
  assert.equal(A.odai, 1);
  const C = sc.teams.find(t => t.team === 'C');
  assert.equal(C.prediction, 1); // C: A 1人・B 1人 → 2 × 1/2
  const D = sc.teams.find(t => t.team === 'D');
  assert.equal(D.prediction, 2);
  assert.equal(sc.teams.find(t => t.team === 'B').quiz, 0); // 回答者なし
  const sumSheet = app.getSheetByName('集計');
  assert.equal(sumSheet.data[1][0], 'A');
  assert.equal(sumSheet.data[1][6], 5.8);

  // 結果公開
  ok(g.adminPublishResults(token2));
  st = ok(g.getState());
  assert.equal(st.mode, '結果公開');
  assert.equal(st.results.teams.find(t => t.team === 'A').quiz, 5.8);
  assert.equal(g.submitQuiz('P04', { names: [] }).error.code, 'QUIZ_CLOSED');
  // 公開後:判断していないものは×の扱いなので「確認中」は出さない。判断は公開後でも直せて、総合点も本人の結果も変わる
  res = ok(g.getQuizResult('P01')).result;
  assert.deepEqual([res.published, res.pendingCount, res.pendingOther], [true, 0, 0]);
  assert.equal(ok(g.getQuizResult('P03')).result, null); // アンケートを送っていない人には返さない
  ok(g.submitSurvey(Object.assign({}, SURVEY, {fun:4,talked:4}), 'P03'));
  assert.equal(ok(g.getQuizResult('P03')).result.correctCount, 0);
  ok(g.adminJudgeNearMiss(token2, p03near, '0.5人分')); // 不服の申し立てで直した
  assert.equal(ok(g.getQuizResult('P03')).result.correctCount, 1);
  // 名前: (1.2 + 0.85 + 0.25) ÷ 3 × 7 = 5.37、出身地 1 → 6.4
  assert.equal(ok(g.getState()).results.teams.find(t => t.team === 'A').quiz, 6.4);
  ok(g.adminJudgeNearMiss(token2, p03near, '×'));
  assert.equal(ok(g.getState()).results.teams.find(t => t.team === 'A').quiz, 5.8);

  // アンケート(名前を選んでいない端末)
  assert.equal(g.submitSurvey(Object.assign({}, SURVEY, {fun:6,talked:3})).error.code, 'INVALID');
  ok(g.submitSurvey(Object.assign({}, SURVEY, {fun:5,talked:4,comment:'たのしかった'})));
  assert.equal(app.getSheetByName('アンケート').getLastRow(), 5); // P01(2行目)・P03(4行目)・名前なし(5行目)

  // 運営の操作
  ok(g.adminChangeTeam(token2, 'P10', 'C'));
  ok(g.adminSetQuizInclude(token2, 'P03', false));
  const ov = ok(g.adminGetOverview(token2));
  assert.equal(ov.participants.find(p => p.id === 'P10').team, 'C');
  assert.equal(ov.participants.find(p => p.id === 'P03').quizInclude, false);
  assert.equal(ok(g.adminGetScores(token2)).teams.find(t => t.team === 'A').quiz, 8.7); // P01,P02 だけ: 7×1.025 + 3×0.5 = 8.675
  assert.equal(ov.unsplitNames, 0);
  assert.equal(g.adminSaveSettings(token2, { 'ないキー': 1 }).error.code, 'INVALID');
  ok(g.adminSaveSettings(token2, { 'バレー勝ちボーナス': 5 }));
  assert.equal(ok(g.adminGetScores(token2)).teams.find(t => t.team === 'A').volleyball, 30);
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
