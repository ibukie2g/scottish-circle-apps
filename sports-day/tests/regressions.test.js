const test = require('node:test');
const assert = require('node:assert/strict');
const {loadGas} = require('./helpers/fake_gas');
function world() {
 const e=loadGas({props:{ROSTER_SPREADSHEET_ID:'r',ADMIN_PASSWORD:'pw'}}), g=e.ctx;
 e.roster.insertSheet('フォームの回答 1').data=[['フルネーム(漢字)','フルネーム(ひらがな)','出身地(都道府県)','チーム'], ...['一','二','三'].map((x,i)=>['架空 '+x,'かくう '+x,['福島県','宮城県','山形県'][i],'C'])];
 g.setup(); e.token=g.adminLogin('pw').data.token; g.adminImportRoster(e.token); return e;
}
function match(e,id) { return e.ctx.adminGetMatches(e.token).data.matches.find(m=>m.id===id); }
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
test('予想公開後に来場者が増えても変更不可',()=>{
 const e=world(),g=e.ctx;g.selectSelf('P01');g.selectSelf('P02');g.adminSetPredictionStatus(e.token,'V-SF1','受付中');
 g.submitPrediction('P01','V-SF1','A');g.submitPrediction('P02','V-SF1','A');g.selectSelf('P03');
 assert.equal(g.getPrediction('P01').data.revealed,true);assert.equal(g.submitPrediction('P01','V-SF1','B').ok,false);
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
 assert.equal(g.submitSurvey({fun:5,talked:4,again:'はい'}).ok,true);
 e.lock.held=false;
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
 // 送り直しの行が足されても、読むときは最初の行
 g.appendRowNoLock_('クイズ回答',{'参加者ID':'P03','書いた人数':0,'正解と判定した人のID':'','名前の正答率':0,'送信時刻':new Date()});
 g.CacheService.getScriptCache().remove('tbl:クイズ回答');
 const a=g.readQuizAnswers_(true).filter(x=>x.participantId==='P03');
 assert.equal(a.length,1);assert.equal(a[0].writtenCount,1);
});
test('お題は1〜3の整数のみ・集計は範囲外と重複を除外',()=>{
 const e=world(),g=e.ctx;for(const n of [4,1.5])assert.equal(g.adminSaveOdai(e.token,{number:n,team:'C',matched:3,answered:3}).ok,false);
 const s=g.computeOdaiPoints([{number:1,team:'C',matched:3,answered:3},{number:1,team:'C',matched:3,answered:3},{number:4,team:'C',matched:3,answered:3}],g.DEFAULT_SETTINGS);assert.equal(s.C,2);
});

test('締め切りは画面を開かなくても公開履歴を保存する',()=>{
 const e=world(),g=e.ctx;g.adminSetPredictionStatus(e.token,'V-SF1','公開');
 assert.equal(e.app.getSheetByName('予想公開').getLastRow(),3);
 g.adminSetPredictionStatus(e.token,'V-SF1','受付中');
 assert.equal(g.submitPrediction('P01','V-SF1','A').error.code,'PREDICTION_REVEALED');
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
 const e=world(),g=e.ctx;g.adminStartQuiz(e.token);const q=g.cacheGetJson_('origin:P01');
 assert.equal(g.submitQuiz('P01',{names:[],origin:q.answer}).data.origin.correct,true);
 e.cache.store.clear();const result=g.getQuizResult('P01');assert.equal(result.ok,true);assert.equal(result.data.result.origin,null);
 assert.equal(g.submitQuiz('P01',{names:['偽入力'],origin:'別の入力'}).data.correctCount,0);
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
