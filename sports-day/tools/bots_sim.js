// サクラ(src/bots.html)を偽物のGASで最初から最後まで動かす確認用。使い方: node tools/bots_sim.js <sports-day のフォルダ>
const fs=require('fs'),vm=require('vm'),path=require('path');
process.chdir(process.argv[2]);
const {loadGas}=require(path.resolve('tests/helpers/fake_gas'));
const e=loadGas({props:{ROSTER_SPREADSHEET_ID:'r',ADMIN_PASSWORD:'pw',DEMO_BOTS:'on'}}),g=e.ctx;
const fam=['青木','石井','上田','遠藤','大野','加藤','木村','工藤','小松','斎藤','佐野','杉山'],kfam=['あおき','いしい','うえだ','えんどう','おおの','かとう','きむら','くどう','こまつ','さいとう','さの','すぎやま'];
const rows=[];for(let i=0;i<12;i++)rows.push([fam[i]+' 太郎',kfam[i]+' たろう',['福島県','宮城県','山形県','新潟県'][i%4],'ABCD'[i%4]]);
e.roster.insertSheet('フォームの回答 1').data=[['フルネーム(漢字)','フルネーム(ひらがな)','出身地(都道府県)','チーム'],...rows];
g.setup();const tok=g.adminLogin('pw').data.token;g.adminImportRoster(tok);
// ページの script を取り出して、DOM と google.script.run の偽物で動かす
const html=fs.readFileSync('src/bots.html','utf8');const js=html.match(/<script>([\s\S]*)<\/script>/)[1];
const els={};const el=id=>els[id]||(els[id]={textContent:'',value:id==='skip'?'P01':'',className:'',innerHTML:'',querySelector:()=>({set innerHTML(v){}})});
const timers=[];let now=Date.now();
const run=new Proxy({},{get:(t,k)=>{if(k==='withSuccessHandler')return f=>{run._ok=f;return run};if(k==='withFailureHandler')return f=>run;return (...a)=>{const ok=run._ok;Promise.resolve().then(()=>ok(g[k](...a)));};}});
const sandbox={document:{getElementById:el},google:{script:{run:new Proxy({},{get:(t,k)=>{ // 呼ぶたびに新しい鎖
  let ok;const chain={withSuccessHandler(f){ok=f;return chain},withFailureHandler(){return chain}};
  return chain[k]?chain[k].bind(chain):undefined;}})}},
  setTimeout:(fn,ms)=>{timers.push({t:now+(ms||0),fn});return timers.length},clearTimeout(){},Promise,Math,Date,console,String,Object};
// google.script.run.withSuccessHandler(...).withFailureHandler(...)[name](...)
sandbox.google.script.run={withSuccessHandler(f){const c={withFailureHandler(){return new Proxy({},{get:(t,k)=>(...a)=>{Promise.resolve().then(()=>f(g[k](...a)))}})}};return c;}};
vm.createContext(sandbox);vm.runInContext(js+';this.startBots=startBots;this.getBots=()=>BOTS;',sandbox);
async function tick(ms){const end=now+ms;for(;;){await new Promise(r=>setImmediate(r));timers.sort((a,b)=>a.t-b.t);const n=timers[0];if(!n||n.t>end)break;timers.shift();now=n.t;e.clock.now=now;n.fn();}now=end;e.clock.now=now;}
function counts(){const c={};sandbox.getBots().forEach(b=>c[b.status]=(c[b.status]||0)+1);return JSON.stringify(c);}
(async()=>{
 sandbox.startBots();await tick(60000);console.log('来場後',counts());
 g.adminSetPredictionStatus(tok,'V-SF1','受付中');g.adminSetState(tok,{mode:'予想',predictionMatchId:'V-SF1'});await tick(60000);console.log('予想後',counts());
 // 締め切るまで内訳は出ない(counts は null)。締め切ると、予想した2チームの人数の集計が出る
 console.log('予想の件数',g.readPredictions_(true).length,'締め切り前の内訳',JSON.stringify(g.adminGetPredictionSummary(tok,'V-SF1').data.teams.map(t=>t.counts)));
 console.log('締め切り後',JSON.stringify(g.adminSetPredictionStatus(tok,'V-SF1','公開').data.teams.map(t=>[t.team,t.predicted,t.counts.map(c=>c.team+c.count).join('/')])));
 g.adminStartQuiz(tok);await tick(150000);console.log('クイズ後',counts());
 const qa=g.readQuizAnswers_(true);
 console.log('クイズ回答',qa.length,'うち0.5人分あり',qa.filter(a=>a.halfIds.length).length,'出身地の問題数',JSON.stringify(qa.map(a=>a.originTotal)),'運営が判断する答え',g.readNearMisses_(true).length);
 // クイズ中(名前クイズの全員の締め切り前)は、アンケートを送っても自分の結果は出ない → 結果公開のあとに見られる
 g.adminPublishResults(tok);await tick(70000);console.log('結果公開後',counts());
 const sv=e.app.getSheetByName('アンケート').data;
 console.log('アンケート',sv.slice(1).filter(r=>r[sv[0].indexOf('参加者ID')]).length,'人');
 console.log('ログ先頭:\n'+els.log.textContent.split('\n').slice(0,6).join('\n'));
})();
