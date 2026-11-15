const test = require('node:test');
const assert = require('node:assert/strict');
const {loadGas} = require('./helpers/fake_gas');
function world() {
 const e=loadGas({props:{ROSTER_SPREADSHEET_ID:'r',ADMIN_PASSWORD:'pw'}}), g=e.ctx;
 e.roster.insertSheet('フォームの回答 1').data=[['フルネーム(漢字)','フルネーム(ひらがな)','出身地(都道府県)','チーム'], ...['一','二','三'].map((x,i)=>['架空 '+x,'かくう '+x,['福島県','宮城県','山形県'][i],'C'])];
 g.setup(); e.token=g.adminLogin('pw').data.token; g.adminImportRoster(e.token); return e;
}
const SURVEY={fun:5,talked:4,learned:'1〜2人',best:'バレー',next:['ご飯'],help:'いいよ'}; // アンケートの答え(必須の項目がそろった形)
const J=x=>JSON.parse(JSON.stringify(x)); // vm の中で作ったオブジェクトを、比べられる形にする

test('その他のスポーツ:20字まで必須、再編集とクイズヒントで詳細を保持し名簿だけに保存',()=>{
 const e=world(),g=e.ctx;
 const intro={sports:['バスケ','その他'],sportOther:' サッカー・卓球（部活） ',comment:'よろしく',snsConsent:'載せない'};
 assert.equal(g.saveIntro('P01',intro).ok,true);
 let saved=g.getIntro('P01').data;
 assert.deepEqual(J(saved.intro.sports),intro.sports);
 assert.equal(saved.intro.sportOther,'サッカー・卓球（部活）');
 assert.equal(saved.intro.sport,'バスケ・その他（サッカー・卓球（部活））');
 assert.equal(saved.options.sportOtherMax,20);
 g.adminStartQuiz(e.token);
 assert.ok(g.startQuiz('P02').data.names.hints.some(h=>h&&h.sport===saved.intro.sport));
 assert.ok(!JSON.stringify(e.app.getSheets().map(s=>s.data)).includes('サッカー'));
 for(const text of ['', '   ', 'あ'.repeat(21)]) assert.equal(g.saveIntro('P01',Object.assign({},intro,{sportOther:text})).error.code,'INVALID');
 assert.equal(g.saveIntro('P01',Object.assign({},intro,{sportOther:'🏓'.repeat(20)})).ok,true);
 assert.equal(g.getIntro('P01').data.intro.sportOther,'🏓'.repeat(20));
 assert.equal(g.saveIntro('P01',Object.assign({},intro,{sports:['バレー'],sportOther:'残さない'})).ok,true);
 saved=g.getIntro('P01').data.intro;
 assert.equal(saved.sportOther,'');assert.equal(saved.sport,'バレー');
 // 旧形式の「その他」も取得できる。再保存時には詳細を入力してもらう。
 assert.deepEqual(J(g.parseIntroSports('バスケ・その他')),{sports:['バスケ','その他'],sportOther:''});
});
function match(e,id) { return e.ctx.adminGetMatches(e.token).data.matches.find(m=>m.id===id); }
// 名前クイズの全員の締め切りを過ぎたことにする(クイズ開始時刻を10分前にする)
function endNamePhase(e) { e.app.getSheetByName('状態').data.find(r=>r[0]==='クイズ開始時刻')[1]=new Date(Date.now()-600000); e.ctx.cache_().remove('tbl:状態'); }
// アンケートを送って、自分の答え合わせを受け取る
function myResult(e,pid) { const g=e.ctx; g.submitSurvey(Object.assign({}, SURVEY, {fun:5,talked:5}),pid); endNamePhase(e); return g.getQuizResult(pid).data.result; }
test('出身地と任意入力をシートに残さない・6時間で問題失効',()=>{
 const e=world(),g=e.ctx; g.adminStartQuiz(e.token);g.startQuiz('P01');
 assert.equal(g.submitQuiz('P01',{names:[],origin:'秘密の文字列'}).ok,true);
 const dump=JSON.stringify(e.app.getSheets().map(s=>s.data));
 for(const word of ['秘密の文字列','福島県','宮城県','山形県'])assert.ok(!dump.includes(word));
 e.clock.advance(21600001);assert.equal(g.startQuiz('P02').ok,false);
});
test('準決勝修正・取消で後続の得点と予想を破棄',()=>{
 const e=world(),g=e.ctx,t=e.token;g.adminSaveMatch(t,'V-SF1',25,10);g.adminSaveMatch(t,'V-SF2',25,10);g.adminSaveMatch(t,'V-F',25,10);
 g.adminSaveMatch(t,'V-SF1',10,25);assert.equal(match(e,'V-F').status,'予定');assert.equal(match(e,'V-F').score1,null);
 g.adminUnconfirmMatch(t,'V-SF2');assert.equal(match(e,'V-F').team1,'');
});
test('予想は全員そろっても公開しない。締め切ったあとは、来場者が増えても変更できない',()=>{
 const e=world(),g=e.ctx;g.selectSelf('P01');g.selectSelf('P02');g.adminSetPredictionStatus(e.token,'V-SF1','受付中');
 g.submitPrediction('P01','V-SF1','A');g.submitPrediction('P02','V-SF1','A');
 assert.equal(g.getPrediction('P01').data.revealed,false);assert.equal(g.submitPrediction('P01','V-SF1','B').ok,true);
 g.adminSetPredictionStatus(e.token,'V-SF1','公開');g.selectSelf('P03');
 assert.equal(g.getPrediction('P01').data.revealed,true);assert.equal(g.submitPrediction('P01','V-SF1','A').error.code,'PREDICTION_CLOSED');
 assert.equal(g.getPrediction('P03').data.revealed,true);
});
test('シート直接確定を状態取得時に自動補完',()=>{
 const e=world();for(const id of ['V-SF1','V-SF2']){const r=e.app.getSheetByName('試合').data.find(r=>r[0]===id);r[5]=25;r[6]=10;r[7]='確定';}
 e.ctx.getState();assert.equal(match(e,'V-F').team1,'A');
});
test('二層キャッシュで古い状態を延命しない',()=>{
 const e=world(),g=e.ctx;g.readState_();e.clock.advance(1000);e.app.getSheetByName('状態').data.find(r=>r[0]==='モード')[1]='結果待ち';
 e.clock.advance(8000);g.getState();e.clock.advance(2000);assert.equal(g.getState().data.mode,'結果待ち');
});
test('結果公開のあとはクイズを受け付けない(キャッシュではなくシートで確かめる)',()=>{
 const e=world(),g=e.ctx;g.adminStartQuiz(e.token);g.getState();g.adminPublishResults(e.token);
 e.ctx.CacheService.getScriptCache().remove('tbl:状態'); // 古い状態がキャッシュに残っていても
 assert.equal(g.submitQuiz('P01',{names:[],origin:''}).error.code,'QUIZ_CLOSED');
});
test('30人が同時に書く操作は、ほかの人がロックを持っていても待たずに通る',()=>{
 const e=world(),g=e.ctx;g.adminSetPredictionStatus(e.token,'V-SF1','受付中');g.adminStartQuiz(e.token);
 e.lock.held=true; // 運営などがロックを持っている状態
 assert.equal(g.selectSelf('P01').ok,true);
 assert.equal(g.saveIntro('P01',{sports:['バスケ'],comment:'よろしく',snsConsent:'載せない'}).ok,true);
 assert.equal(g.startQuiz('P01').ok,true);
 assert.equal(g.submitQuiz('P01',{names:[],origin:''}).ok,true);
 e.lock.held=false; // アンケートは匿名で自分専用の行がないので、短いロックを取る(ここでは確かめない)
});
test('予想を送り直したら最新の1件だけ数える・クイズの二重送信は最初の1件だけ',()=>{
 const e=world(),g=e.ctx;
 // 予想する側(試合に出ないチーム)を作る:V-SF1 の対戦チーム以外のC
 g.adminSetPredictionStatus(e.token,'V-SF1','受付中');
 const m=match(e,'V-SF1');const pick=[m.team1,m.team2];
 g.selectSelf('P01');g.selectSelf('P02');
 assert.equal(g.submitPrediction('P01','V-SF1',pick[0]).ok,true);
 assert.equal(g.submitPrediction('P01','V-SF1',pick[1]).ok,true);
 const mine=g.readPredictions_(true).filter(p=>p.participantId==='P01'&&p.matchId==='V-SF1');
 assert.equal(mine.length,1);assert.equal(mine[0].choice,pick[1]);
 g.adminStartQuiz(e.token);g.startQuiz('P03');
 assert.equal(g.submitQuiz('P03',{names:['架空 一'],origin:''}).ok,true);
 // 送り直しの行が(ロックを取って)下に足されても、読むときは最初の行
 e.app.getSheetByName('クイズ回答').appendRow(['P03',0,'',0]);
 g.CacheService.getScriptCache().remove('tbl:クイズ回答');
 const a=g.readQuizAnswers_(true).filter(x=>x.participantId==='P03');
 assert.equal(a.length,1);assert.equal(a[0].writtenCount,1);
});
test('お題は1〜3の整数のみ・集計は範囲外と重複を除外',()=>{
 const e=world(),g=e.ctx;for(const n of [4,1.5])assert.equal(g.adminSaveOdai(e.token,{number:n,team:'C',matched:3,answered:3}).ok,false);
 const s=g.computeOdaiPoints([{number:1,team:'C',matched:3,answered:3},{number:1,team:'C',matched:3,answered:3},{number:4,team:'C',matched:3,answered:3}],g.DEFAULT_SETTINGS);assert.equal(s.C,2);
});

test('予想:受付中に戻すとまた変えられる・点数を確定したら自動で締め切る・経過時間の基準は受付開始',()=>{
 const e=world(),g=e.ctx,t=e.token;g.selectSelf('P01');
 g.adminSetPredictionStatus(t,'V-SF1','受付中');const opened=g.adminGetOverview(t).data.state.predictionOpenedAt;
 assert.equal(typeof opened,'number');
 g.adminSetPredictionStatus(t,'V-SF1','公開');assert.equal(g.submitPrediction('P01','V-SF1','A').error.code,'PREDICTION_CLOSED');
 e.clock.advance(1000);g.adminSetPredictionStatus(t,'V-SF1','受付中');
 assert.equal(g.adminGetOverview(t).data.state.predictionOpenedAt,opened); // 「受付中に戻す」では開始時刻を変えない
 assert.equal(g.submitPrediction('P01','V-SF1','A').ok,true);
 const r=g.adminSaveMatch(t,'V-SF1',25,10).data;
 assert.equal(r.predictionClosed,true);assert.equal(r.match.predictionStatus,'公開');
 assert.equal(g.submitPrediction('P01','V-SF1','B').error.code,'PREDICTION_CLOSED');
 assert.equal(g.getPrediction('P01').data.hit.overall,100);
 assert.equal(e.app.getSheetByName('予想公開').getLastRow(),1); // 予想公開シートはもう使わない
});
test('予想:素早く変えたとき、古い送信があとから届いても最後に押したものが残る',()=>{
 const e=world(),g=e.ctx;g.selectSelf('P01');g.adminSetPredictionStatus(e.token,'V-SF1','受付中');
 assert.equal(g.submitPrediction('P01','V-SF1','A',1000).data.myChoice,'A');
 assert.equal(g.submitPrediction('P01','V-SF1','B',3000).data.myChoice,'B');
 assert.equal(g.submitPrediction('P01','V-SF1','A',2000).data.myChoice,'B'); // 2番目に押したものが遅れて届いた
 assert.equal(g.readPredictions_(true).filter(p=>p.participantId==='P01')[0].choice,'B');
 assert.equal(g.submitPrediction('P01','V-SF1','A',4000).data.myChoice,'A');
 assert.equal(g.submitPrediction('P01','V-SF1','B').data.myChoice,'B'); // 番号なし(古い画面)は今までどおり上書き
});
test('後続バレーの予想・公開履歴を削除し、バド関連ドッジも取消',()=>{
 const e=world(),g=e.ctx,t=e.token;
 g.adminSaveMatch(t,'V-SF1',25,10);g.adminSaveMatch(t,'V-SF2',25,10);
 // Cは決勝に出るので、架空参加者をDへ移して予想する。
 g.adminChangeTeam(t,'P01','D');g.selectSelf('P01');g.adminSetPredictionStatus(t,'V-F','受付中');
 assert.equal(g.submitPrediction('P01','V-F','A').ok,true);
 g.adminSaveMatch(t,'V-SF1',10,25);
 assert.equal(e.app.getSheetByName('予想').getLastRow(),1);
 assert.equal(e.app.getSheetByName('予想公開').getLastRow(),1);
 assert.equal(match(e,'V-F').predictionStatus,'受付前');
 g.adminSaveMatch(t,'D-SF1',21,10);g.adminSaveMatch(t,'D-SF2',21,10);
 g.adminSaveMatch(t,'G-3',3,1);g.adminSaveMatch(t,'G-4',3,1);g.adminSaveMatch(t,'D-F',21,10);
 g.adminUnconfirmMatch(t,'D-SF1');
 for(const id of ['D-F','D-3RD','G-3','G-4']){const m=match(e,id);assert.equal(m.team1,'');assert.equal(m.score1,null);assert.equal(m.status,'予定');}
});
test('直接修正の10秒反映・予想リセット・集計読み取りからの補完',()=>{
 const e=world(),g=e.ctx,t=e.token;g.adminSaveMatch(t,'V-SF1',25,10);g.adminSaveMatch(t,'V-SF2',25,10);g.adminSaveMatch(t,'V-F',25,10);g.getState();
 const r=e.app.getSheetByName('試合').data.find(r=>r[0]==='V-SF1');r[5]=10;r[6]=25;
 e.clock.advance(10001);g.getState();assert.equal(match(e,'V-F').team1,'B');assert.equal(match(e,'V-F').score1,null);
});
test('正しい出身地だけ採点し、キャッシュ消失後も再送は名前の結果を保持',()=>{
 const e=world(),g=e.ctx;g.adminStartQuiz(e.token);const q=g.cacheGetJson_('origin:P01').questions;
 assert.equal(q.length,2); // チームメイト2人 → B が2問
 assert.equal(g.submitQuiz('P01',{names:[],origin:[q[0].answer,'選択肢にない文字列']}).ok,true);
 const o=myResult(e,'P01').origin;assert.equal(o.correct,1);assert.equal(o.total,2);
 assert.equal(o.questions[0].correct,true);assert.equal(o.questions[1].yourAnswer,''); // 選択肢にない答えは残さない
 e.cache.store.clear();const result=g.getQuizResult('P01');assert.equal(result.ok,true);assert.equal(result.data.result.origin,null);
 assert.equal(g.submitQuiz('P01',{names:['偽入力'],origin:'別の入力'}).data.accepted,true);
 assert.equal(g.getQuizResult('P01').data.result.correctCount,0);
 // 点数はシートに残っているので、問題のキャッシュが消えても集計は変わらない
 const a=g.readQuizAnswers_(true).find(x=>x.participantId==='P01');assert.equal(a.originCorrect,1);assert.equal(a.originTotal,2);
});
test('ふだんの状態取得と予想の取得ではロックを取らない(30人同時の負荷対策)',()=>{
 const e=world(),g=e.ctx;g.selectSelf('P01');g.adminSetPredictionStatus(e.token,'V-SF1','受付中');
 g.getState();g.getPrediction('P01','V-SF1'); // 1回目で補完・公開判定を済ませる
 let n=0;const orig=e.lock.tryLock;e.lock.tryLock=function(){n++;return orig.apply(this,arguments);};
 for(let i=0;i<5;i++){g.getState();g.getPrediction('P01','V-SF1');}
 e.lock.tryLock=orig;assert.equal(n,0);
});
test('HTMLの<script>の行に // コメントを書かない(GASが行末まで消して </script> も消え、画面が動かなくなる)',()=>{
 const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..','src');
 const bad=fs.readdirSync(dir).filter(f=>f.endsWith('.html')).flatMap(f=>fs.readFileSync(path.join(dir,f),'utf8').split(/\r?\n/).map((l,i)=>({f,i:i+1,l}))).filter(x=>/\/\/.*<\/script>/.test(x.l));
 assert.deepEqual(bad.map(x=>x.f+':'+x.i),[]);
});
test('同時に送る書き込みは、その人専用の行に書く(いちばん下に足すと同時に上書きし合うため)',()=>{
 const e=world(),g=e.ctx; // 参加者 P01〜P03 は参加者シートの2〜4行目
 g.adminSetPredictionStatus(e.token,'V-SF1','受付中');
 ['P03','P01'].forEach(id=>g.selectSelf(id));
 assert.equal(g.saveIntro('P03',{sports:['バスケ'],comment:'三',snsConsent:'載せない'}).ok,true);
 assert.equal(e.roster.getSheetByName('自己紹介').data[3][0],'P03'); // 4行目
 assert.equal(g.submitPrediction('P03','V-SF1','A').ok,true);
 const pr=e.app.getSheetByName('予想').data;
 const block=g.readMatches_().filter(x=>x.predictionStatus!=='なし').map(x=>x.id).indexOf('V-SF1');
 assert.equal(pr[block*100+3][1],'P03'); // 区画 + 4行目
 g.adminStartQuiz(e.token);g.startQuiz('P01');
 assert.equal(g.submitQuiz('P01',{names:[],origin:''}).ok,true);
 assert.equal(e.app.getSheetByName('クイズ回答').data[1][0],'P01'); // 2行目
});
test('自分専用の行にほかの人のデータがあれば、上書きせずに下に足す',()=>{
 const e=world(),g=e.ctx;
 const sh=e.roster.getSheetByName('自己紹介');sh.set(2,1,'P99');sh.set(2,3,'ほかの人'); // P01 の行に別の人
 assert.equal(g.saveIntro('P01',{sports:['バレー'],comment:'一',snsConsent:'載せない'}).ok,true);
 assert.equal(sh.data[1][2],'ほかの人');
 assert.equal(g.getIntro('P01').data.intro.comment,'一');
});
test('アンケートは自分専用の行に書き、名前を選んでいない端末の回答は上書きしない',()=>{
 const e=world(),g=e.ctx,sh=e.app.getSheetByName('アンケート');
 assert.equal(g.submitSurvey(Object.assign({}, SURVEY, {fun:5,talked:4}),'P02').ok,true);
 const h=sh.data[0];assert.equal(sh.data[2][h.indexOf('参加者ID')],'P02'); // P02 は3行目
 assert.equal(g.submitSurvey(Object.assign({}, SURVEY, {fun:3,talked:3}),'').ok,true); // 名前なし → 下に足す(4行目)
 assert.equal(g.submitSurvey(Object.assign({}, SURVEY, {fun:4,talked:4}),'P03').ok,true); // P03 の行(4行目)は使われているので下に足す
 assert.equal(sh.data[3][h.indexOf('楽しかったか(1〜5)')],3); // 名前なしの回答が残っている
 assert.equal(sh.data[3][h.indexOf('また参加したいか')],''); // 「また参加したいか」はやめた(列は残す)
 assert.equal(sh.getLastRow(),5);
});
test('resetEventData:当日のデータとキャッシュの目印を消し、参加者とチーム分けは残す',()=>{
 const e=world(),g=e.ctx;
 g.adminSetPredictionStatus(e.token,'V-SF1','受付中');
 g.selectSelf('P01');g.saveIntro('P01',{sports:['バスケ'],comment:'よろしく',snsConsent:'載せない'});
 g.adminStartQuiz(e.token);g.startQuiz('P01');g.submitQuiz('P01',{names:[],origin:''});
 g.submitSurvey(Object.assign({}, SURVEY, {fun:5,talked:5}),'P01');
 g.resetEventData();
 for(const n of ['予想','予想公開','クイズ問題','クイズ回答','惜しい答え','お題カード','アンケート'])assert.equal(e.app.getSheetByName(n).getLastRow(),1,n);
 assert.equal(e.roster.getSheetByName('自己紹介').getLastRow(),1);
 assert.equal(g.readState_(true).mode,'待ち');
 assert.equal(match(Object.assign(e,{token:g.adminLogin('pw').data.token}),'V-SF1').predictionStatus,'受付前');
 const ps=g.readParticipants_(true);assert.equal(ps.length,3);assert.ok(ps.every(p=>p.arrivedAt===null&&p.team==='C'));
 // 来場済みの目印も消えているので、もう一度選ぶと来場時刻が入る
 g.selectSelf('P01');assert.notEqual(g.readParticipants_(true)[0].arrivedAt,null);
});

// ---- 本番前の変更(2026-11-13)----
test('点数を隠す:バレーの準決勝が2試合とも確定したら、参加者向けの通信に点数・順位を入れない',()=>{
 const e=world(),g=e.ctx,t=e.token;g.selectSelf('P01');
 g.adminSaveMatch(t,'B-R1-1',12,8);g.adminSaveMatch(t,'V-SF1',25,10);
 assert.equal(g.getState().data.sportsHidden,false);assert.equal(g.getState().data.sports.length,4);
 g.adminSaveMatch(t,'V-SF2',25,10);
 g.adminChangeTeam(t,'P01','D');g.adminSetPredictionStatus(t,'V-F','受付中');
 const dump=JSON.stringify([g.getState(),g.getPrediction('P01'),g.submitPrediction('P01','V-F','A'),g.selectSelf('P01')]);
 assert.equal(g.getState().data.sportsHidden,true);assert.equal(g.getState().data.sports,null);
 for(const word of ['sportsTotal','sportsRank','volleyball','score1','score2','"total"','totalRank'])assert.ok(!dump.includes(word),word);
 // 取り消したら、また見える。結果公開では結果として出す
 g.adminUnconfirmMatch(t,'V-SF2');assert.equal(g.getState().data.sportsHidden,false);
 g.adminSaveMatch(t,'V-SF2',25,10);g.adminPublishResults(t);
 assert.equal(g.getState().data.sports,null);assert.equal(g.getState().data.results.teams.length,4);
});
test('答え合わせ:アンケートを送るまで返さない。送っていても、名前クイズの全員の締め切りまでは返さない',()=>{
 const e=world(),g=e.ctx;g.adminStartQuiz(e.token);g.startQuiz('P01');
 assert.equal(g.selectSelf('P01').data.surveyDone,false);
 assert.deepEqual(J(g.submitQuiz('P01',{names:['架空 二'],origin:''}).data),{accepted:true,surveyDone:false});
 let r=g.getQuizResult('P01').data;assert.deepEqual([r.answered,r.surveyDone,r.result],[true,false,null]);
 g.submitSurvey(Object.assign({}, SURVEY, {fun:5,talked:5}),'P01');
 assert.equal(g.selectSelf('P01').data.surveyDone,true); // 端末ではなく参加者ごと
 assert.equal(g.selectSelf('P02').data.surveyDone,false);
 r=g.getQuizResult('P01').data;assert.equal(r.result,null);assert.equal(typeof r.availableAt,'number');
 const dump=JSON.stringify(r);assert.ok(!dump.includes('架空'));
 endNamePhase(e);r=g.getQuizResult('P01').data;assert.equal(r.availableAt,null);assert.equal(r.result.correctCount,1);
 // クイズに答えていない人は、アンケートを送っても結果はない
 g.submitSurvey(Object.assign({}, SURVEY, {fun:5,talked:5}),'P02');r=g.getQuizResult('P02').data;assert.deepEqual([r.answered,r.surveyDone,r.result],[false,true,null]);
 // 結果待ちに進んだあとは、すぐ返す
 g.adminSetState(e.token,{mode:'結果待ち'});assert.equal(g.getQuizResult('P01').data.result.total,2);
});
test('運営の判断:同じチームの同じ答えは1回で判断でき、候補も選び直せる',()=>{
 const e=world(),g=e.ctx,t=e.token;g.adminStartQuiz(t);
 g.submitQuiz('P01',{names:['みっちゃん'],origin:''});g.submitQuiz('P02',{names:['ミッチャン'],origin:''});g.submitQuiz('P03',{names:['かくう一郎'],origin:''});
 const list=g.adminListNearMisses(t).data;
 assert.equal(list.pendingCount,3);
 const grp=list.items.find(x=>x.count===2);assert.deepEqual(J(grp.numbers),[101,201]);assert.equal(grp.candidateId,'');
 assert.equal(list.items[0].candidateId!=='',true); // 候補があるものが先
 // 「だれの名前?」で選べるのは、書いた全員のクイズに共通して出ていた人だけ(書いた本人は出ない)
 assert.ok(!grp.choiceIds.includes('P01')&&!grp.choiceIds.includes('P02')&&grp.choiceIds.includes('P03'));
 const one=list.items.find(x=>x.count===1);assert.ok(!one.choiceIds.includes('P03')&&one.choiceIds.includes('P01'));
 assert.deepEqual(J(grp.writerIds),['P01','P02']);assert.deepEqual(J(one.writerIds),['P03']); // 書いた人
 // 2人まとめて、P03 の 0.5人分にする
 assert.equal(g.adminJudgeNearMiss(t,grp.numbers,'0.5人分','P03').data.updated,2);
 for(const pid of ['P01','P02'])assert.deepEqual(J(g.readQuizAnswers_(true).find(a=>a.participantId===pid).halfIds),['P03']);
 assert.equal(g.adminListNearMisses(t,true).data.items.find(x=>x.count===2).candidateId,'P03');
 assert.equal(g.adminGetOverview(t).data.pendingNearMisses,1);
});
test('自動正解が0人でも、公開後に運営の1人分を0.5人分・別の候補・×へ直せる',()=>{
 const e=world(),g=e.ctx,t=e.token;g.adminStartQuiz(t);
 g.submitQuiz('P01',{names:['みっちゃん'],origin:[]});
 g.submitSurvey(SURVEY,'P01');g.adminPublishResults(t);endNamePhase(e);
 const read=()=>g.getQuizResult('P01').data.result;
 assert.equal(g.adminJudgeNearMiss(t,101,'1人分','P02').ok,true);
 assert.equal(read().fullCount,1);
 assert.equal(g.adminJudgeNearMiss(t,101,'0.5人分','P02').ok,true);
 assert.equal(read().fullCount,0);assert.equal(read().correctCount,1);
 assert.equal(g.adminJudgeNearMiss(t,101,'1人分','P03').ok,true);
 assert.equal(read().correctCount,1);
 const a=g.readQuizAnswers_(true).find(x=>x.participantId==='P01');
 assert.deepEqual(J(a.correctIds),['P03']);assert.deepEqual(J(a.halfIds),[]);
 assert.equal(g.adminJudgeNearMiss(t,101,'×').ok,true);
 assert.equal(read().correctCount,0);
 assert.equal(g.adminGetScores(t).data.teams.find(x=>x.team==='C').quiz,0);
});

test('名前の締め切り前に結果待ち・結果公開へ進めても、本人の答え合わせを早く返さない',()=>{
 const e=world(),g=e.ctx,t=e.token;g.adminStartQuiz(t);
 g.submitQuiz('P01',{names:['架空 二'],origin:[]});g.submitSurvey(SURVEY,'P01');
 for(const mode of ['結果待ち','結果公開']) {
  g.adminSetState(t,{mode});
  const r=g.getQuizResult('P01').data;
  assert.equal(r.result,null);assert.equal(typeof r.availableAt,'number');
 }
 endNamePhase(e);assert.equal(g.getQuizResult('P01').data.result.correctCount,1);
});

test('候補が出せない答えを一覧に出すかは NEAR_INCLUDE_UNKNOWN で切り替えられる',()=>{
 const e=world(),g=e.ctx,t=e.token;g.adminStartQuiz(t);
 require('node:vm').runInContext('NEAR_INCLUDE_UNKNOWN = false',g);
 g.submitQuiz('P01',{names:['ぜんぜんちがう','かくう一郎'],origin:''});
 assert.deepEqual(J(g.adminListNearMisses(t).data.items.map(x=>x.input)),['かくう一郎']);
});
test('名簿の名前が空白で分かれていない人数を、運営画面に返す(名前は返さない)',()=>{
 const e=world(),g=e.ctx,t=e.token;
 assert.equal(g.adminGetOverview(t).data.unsplitNames,0);
 const form=e.roster.getSheetByName('フォームの回答 1');form.data[1][0]='架空一';g.invalidateRoster_();
 assert.equal(g.adminGetOverview(t).data.unsplitNames,1);
 assert.equal(g.adminImportRoster(t).data.unsplitNames,1);
});
// 6人チーム(全員架空)。出身地:宮城2・東京1・新潟1・福島2
function bigWorld() {
 const e=loadGas({props:{ROSTER_SPREADSHEET_ID:'r',ADMIN_PASSWORD:'pw'}}), g=e.ctx;
 const origins=['宮城県','宮城県','東京都','新潟県','福島県','福島県'];
 e.roster.insertSheet('フォームの回答 1').data=[['フルネーム(漢字)','フルネーム(ひらがな)','出身地(都道府県)','チーム'], ...['一','二','三','四','五','六'].map((x,i)=>['見本 '+x,'みほん '+x,origins[i],'C'])];
 g.setup(); e.token=g.adminLogin('pw').data.token; g.adminImportRoster(e.token); return e;
}
test('出身地クイズ:3問(B と C)を出し、C は人数ぶん選んでぴったりなら正解。問題・答えはシートに書かない',()=>{
 const e=bigWorld(),g=e.ctx;g.adminStartQuiz(e.token);
 assert.equal(g.getState().data.quiz.originSeconds,60);
 const view=g.startQuiz('P01').data.origin.questions;
 assert.equal(view.length,3);
 const c=view.find(x=>x.type==='C');
 assert.ok(c,'C が1問ある');assert.equal(c.choices.length,4);assert.ok(c.count>=1&&c.count<=3);
 assert.ok(c.choices.every(x=>/^P0\d$/.test(x.id)&&x.name.startsWith('見本 ')));
 assert.ok(!JSON.stringify(view).includes('answer')); // 正解は画面に返さない
 const qs=g.cacheGetJson_('origin:P01').questions;
 // C は正解、B は1問だけ正解にして送る
 let wrongOne=false;
 const ans=qs.map(x=>{ if(x.type==='C')return x.answerIds.slice().reverse(); if(!wrongOne){wrongOne=true;return x.choices.find(p=>p!==x.answer);} return x.answer; });
 assert.equal(g.submitQuiz('P01',{names:[],origin:ans}).ok,true);
 const sh=e.app.getSheetByName('クイズ回答'),h=sh.data[0],row=sh.data.find(r=>r[0]==='P01');
 assert.deepEqual([row[h.indexOf('出身地の正誤')],row[h.indexOf('出身地の問題数')],row[h.indexOf('出身地の回答')]],[2,3,'']);
 const dump=JSON.stringify(e.app.getSheets().map(s=>s.data));
 for(const word of ['宮城県','東京都','新潟県','福島県','見本'])assert.ok(!dump.includes(word),word);
 const o=myResult(e,'P01').origin;
 assert.deepEqual([o.correct,o.total],[2,3]);
 const rc=o.questions.find(x=>x.type==='C');
 assert.equal(rc.correct,true);assert.deepEqual(J(rc.yourNames).sort(),J(rc.answerNames).sort());
 assert.equal(o.questions.filter(x=>x.type==='B'&&x.correct).length,1);
 // 時間切れ(何も選ばずに送る)は0問正解。チームの正答率 = 正解数の合計 ÷ 問題数の合計 = 2/6
 g.startQuiz('P02');assert.equal(g.submitQuiz('P02',{names:[],origin:[]}).ok,true);
 const st=g.adminGetQuizStatus(e.token).data.teams.find(t=>t.team==='C');
 assert.equal(st.originRate,33.3);
});
test('前の形のシート(出身地の正誤が TRUE/FALSE)も集計できる',()=>{
 const g=require('../src/core_score.js');
 const q=g.computeQuizPoints([
  {team:'A',nameRate:1.2,originCorrect:2,originTotal:3},{team:'A',nameRate:0.8,originCorrect:0,originTotal:3},
  {team:'A',nameRate:null,originCorrect:null,originTotal:0},
  {team:'B',nameRate:1,originCorrect:true},{team:'B',nameRate:0,originCorrect:false}],g.DEFAULT_SETTINGS);
 assert.equal(q.A.originRate,2/6);assert.equal(q.A.originPoints,1);assert.equal(q.A.namePoints,7); // 平均 (1.2+0.8)/2 = 1.0 → 7点
 assert.equal(q.A.points,8);
 assert.equal(q.B.originRate,0.5);assert.equal(q.B.points,5);
});
test('アンケート:新しい7項目を、列を右に足して保存する',()=>{
 const e=world(),g=e.ctx,sh=e.app.getSheetByName('アンケート'),h=sh.data[0];
 assert.deepEqual(J(h.slice(0,6)),['送信時刻','楽しかったか(1〜5)','普段話さない人と話せたか(1〜5)','また参加したいか','自由記述','参加者ID']); // 前からある列の順番は変えない
 const full={fun:5,talked:4,learned:'3〜5人',best:'お題カード',next:['その他','ご飯','ご飯','知らない値'],nextOther:'ボウリング',help:'内容による',comment:'=楽しかった',snsOk:true};
 assert.equal(g.submitSurvey(full,'P01').ok,true);
 const row=sh.data[1],v=k=>row[h.indexOf(k)];
 assert.deepEqual([v('楽しかったか(1〜5)'),v('普段話さない人と話せたか(1〜5)'),v('新しく名前を覚えた人数'),v('一番楽しかった種目・企画'),v('次にやってほしいイベント'),v('次にやってほしいイベント(その他)'),v('準備の手伝い'),v('自由記述'),v('感想をSNSで紹介してよい'),v('参加者ID'),v('また参加したいか')],
  [5,4,'3〜5人','お題カード','ご飯、その他','ボウリング','内容による','=楽しかった','○','P01','']);
 // 必須:1〜4 と 6。5(次のイベント)は0個でもよい、7(感想)は任意
 for(const k of ['fun','talked','learned','best','help']){const x=Object.assign({},full);delete x[k];assert.equal(g.submitSurvey(x,'P02').error.code,'INVALID',k);}
 assert.equal(g.submitSurvey(Object.assign({},full,{best:'カバディ'}),'P02').error.code,'INVALID');
 assert.equal(g.submitSurvey({fun:3,talked:3,learned:'0人',best:'クイズ',help:'今回はパス',snsOk:true,nextOther:'その他を選んでいない'},'P02').ok,true);
 const r2=sh.data[2];
 assert.deepEqual([r2[h.indexOf('次にやってほしいイベント')],r2[h.indexOf('次にやってほしいイベント(その他)')],r2[h.indexOf('感想をSNSで紹介してよい')]],['','','']); // 感想がなければSNSの○は付けない
 assert.equal(g.selectSelf('P02').data.surveyDone,true);
});
test('状態・集計・クイズの開始と送信で、全員分のキャッシュを1件ずつ読まない(30人同時の負荷対策)',()=>{
 const e=bigWorld(),g=e.ctx;g.adminStartQuiz(e.token);
 for(const id of ['P01','P02','P03','P04','P05'])g.submitQuiz(id,{names:[],origin:[]});
 let n=0;const c=g.CacheService.getScriptCache(),orig=c.get;c.get=k=>{ if(/origin(Response)?:/.test(k))n++; return orig(k); };
 g.getState();g.adminGetScores(e.token);assert.equal(n,0,'状態と集計では出身地のキャッシュを読まない');
 g.startQuiz('P06');assert.equal(n,1,'startQuiz は自分の問題だけ読む');
 n=0;g.submitQuiz('P06',{names:[],origin:[]});assert.equal(n,1,'submitQuiz も自分の問題だけ読む');
 c.get=orig;
});
test('結果発表:チームの内訳(種目の順位・バレーの勝ちボーナス・クイズの点数と正答率・予想の的中率)と 👑 の名前',()=>{
 const e=bigWorld(),g=e.ctx,t=e.token;
 // バレー:A が準決勝と決勝に勝つ。予想は C(試合に出ないチーム)から
 ['P01','P02','P03'].forEach(id=>g.selectSelf(id));
 g.adminSetPredictionStatus(t,'V-SF1','受付中');
 g.submitPrediction('P01','V-SF1','A');g.submitPrediction('P02','V-SF1','A');g.submitPrediction('P03','V-SF1','B');
 g.adminSaveMatch(t,'V-SF1',25,20);g.adminSaveMatch(t,'V-SF2',10,25); // A・D が決勝へ
 g.adminSaveMatch(t,'V-F',25,23);
 ['B-R1-1','B-R1-2','B-R2-1','B-R2-2','B-R3-1','B-R3-2'].forEach(id=>g.adminSaveMatch(t,id,10,5));
 // クイズ:P01 は来場している2人をフルネームで(👑👑)、P02 は名前だけで(👑)、P03 は1人だけ
 g.adminStartQuiz(t);
 g.submitQuiz('P01',{names:['見本 二','みほん 三'],origin:[]});
 g.submitQuiz('P02',{names:['一','三'],origin:[]});
 g.submitQuiz('P03',{names:['見本 一'],origin:[]});
 const view=J(g.adminGetScores(t).data);
 const A=view.teams.find(x=>x.team==='A').breakdown,C=view.teams.find(x=>x.team==='C');
 assert.deepEqual([A.volleyScored,A.volleyWins,A.volleyBonus],[50,2,8]); // 25+25 点、2勝 × 4
 assert.equal(view.teams.find(x=>x.team==='A').volleyball,58);
 assert.equal(A.basketballRank,1);assert.equal(A.badmintonRank,null);assert.equal(A.dodgeballRank,null); // 確定していない種目は null
 assert.equal(C.breakdown.predictionRate,66.7); // 3人中2人が的中
 assert.equal(view.teams.find(x=>x.team==='A').breakdown.predictionRate,null);
 // 名前:(1.2 + 0.6 + 0.5) ÷ 3 = 76.7% → 7 × 0.767 = 5.4点。出身地は全員0問
 assert.equal(C.quizNameRate,76.7);assert.equal(C.breakdown.quizNamePoints,5.4);assert.equal(C.breakdown.quizOriginPoints,0);
 assert.equal(C.quiz,5.4);
 assert.deepEqual(view.crowns,{allFull:[{name:'見本 一',team:'C'}],complete:[{name:'見本 二',team:'C'}]});
 // 参加者には、結果公開のあとだけ同じ内訳を返す
 assert.equal(g.getState().data.results,null);
 g.adminPublishResults(t);
 const res=J(g.getState().data.results);
 assert.deepEqual(res.crowns,view.crowns);
 assert.deepEqual(res.teams.find(x=>x.team==='C').breakdown,C.breakdown);
 // 👑 の名前はキャッシュから出す(状態を見るたびに名簿ファイルを開かない)
 let opened=0;const orig=g.SpreadsheetApp.openById;g.SpreadsheetApp.openById=id=>{opened++;return orig(id);};
 e.clock.advance(11000);g.getState();g.getState();g.SpreadsheetApp.openById=orig;
 assert.equal(opened,0);
});
test('predictionTeamRates: 確定した試合の予想だけ数える',()=>{
 const S=require('../src/core_score.js');
 const ms=S.INITIAL_MATCHES.map(m=>Object.assign({score1:null,score2:null,status:'予定',predictionStatus:'なし'},m));
 const sf1=ms.find(m=>m.id==='V-SF1');Object.assign(sf1,{score1:25,score2:10,status:'確定'}); // A 対 B、A の勝ち
 const r=S.predictionTeamRates(ms,[{matchId:'V-SF1',team:'C',choice:'A'},{matchId:'V-SF1',team:'C',choice:'B'},{matchId:'V-SF1',team:'D',choice:'A'},
  {matchId:'V-SF2',team:'A',choice:'C'},{matchId:'V-SF1',team:'A',choice:'A'}]); // V-SF2 は未確定、試合に出ているチームの予想は数えない
 assert.deepEqual(r,{A:null,B:null,C:0.5,D:1});
});
test('ひとこと:setup で候補16個を○付きで入れ、「使う」に○があるものだけページに埋め込む',()=>{
 const e=world(),g=e.ctx,sh=e.app.getSheetByName('ひとこと');
 assert.deepEqual(J(sh.data[0]),['一言','出すモード','使う']);
 assert.equal(sh.getLastRow(),17);
 let tips=J(g.readTips_());assert.equal(tips.length,16);
 assert.deepEqual([...new Set(tips.map(t=>t.mode))],['いつでも','待ち','予想','クイズの前','結果公開']);
 assert.ok(!tips.some(t=>t.text.includes('何年生'))); // 外した候補
 // ○を外したものは出さない。知らないモードは「いつでも」。setup をやり直しても、消した候補を足し直さない
 sh.data[1][2]='';sh.data[2][1]='へんなモード';sh.data[3][0]='</script><b>x';g.invalidate_(['ひとこと']);g.setup();
 tips=J(g.readTips_());assert.equal(tips.length,15);assert.equal(tips[0].mode,'いつでも');
 assert.equal(sh.getLastRow(),17);
 const json=g.tipsJson_();assert.ok(!json.includes('<'));assert.equal(JSON.parse(json)[1].text,'</script><b>x');
 // シートが無くても(setup をやり直す前でも)落ちない
 e.app.deleteSheet(sh);g.invalidate_(['ひとこと']);assert.equal(J(g.readTips_()).length,16);
 // 当日のデータを消しても、ひとことは残す
 const e2=world();e2.ctx.resetEventData();assert.equal(e2.app.getSheetByName('ひとこと').getLastRow(),17);
});
