const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./helpers/fake_gas');
const J = x => JSON.parse(JSON.stringify(x));
function world() {
  const e = loadGas({ props: { ADMIN_PASSWORD: 'pw', ROSTER_SPREADSHEET_ID: 'fake-roster' } });
  e.ctx.setup(); e.token = e.ctx.adminLogin('pw').data.token;
  return e;
}
test('バスケ内訳: 途中保存・別端末で読み直し・2試合確定・訂正と再集計', () => {
  const e = world(), g = e.ctx, t = e.token;
  const input = { firstHalf: { A: 6, B: 4, C: 0, D: 7 }, questions: [{ difficulty: 'むずかしい', orders: [['B','A'], ['C','D']] }] };
  assert.equal(g.adminGetBasketballRound('invalid',1).error.code,'AUTH');
  assert.equal(g.adminGetBasketballRound(t,4).error.code,'INVALID');
  const empty = g.adminGetBasketballRound(t,1).data;
  assert.deepEqual(J(empty.courts),[['A','B'],['C','D']]);
  assert.equal(g.adminSaveBasketballRound(t,1,input,0,false).ok,true);
  const saved = g.adminGetBasketballRound(t,1).data;
  assert.equal(saved.revision,1);assert.deepEqual(J(saved.input),input);
  assert.ok(saved.matches.every(m=>m.status==='予定'&&m.score1===null));
  const confirmed = g.adminSaveBasketballRound(t,1,input,1,true).data;
  assert.deepEqual(J(confirmed.matches.map(m=>[m.score1,m.score2,m.status])),[[9,9,'確定'],[5,10,'確定']]);
  // 別端末の古い版は、記録も試合も上書きしない。
  assert.equal(g.adminSaveBasketballRound(t,1,input,1,true).error.code,'CONFLICT');
  input.questions[0].orders[0] = ['A'];
  const corrected = g.adminSaveBasketballRound(t,1,input,2,true).data;
  assert.deepEqual(J(corrected.matches.map(m=>[m.score1,m.score2])),[[11,4],[5,10]]);
  for(const round of [2,3]) {
    const courts=g.adminGetBasketballRound(t,round).data.courts;
    assert.equal(g.adminSaveBasketballRound(t,round,{firstHalf:{A:0,B:0,C:0,D:0}},0,true).ok,true);
    assert.equal(courts.length,2);
  }
  assert.equal(g.adminGetScores(t).data.standings.basketball.complete,true);
  g.resetEventData(); assert.equal(g.adminGetBasketballRound(g.adminLogin('pw').data.token,1).data.revision,0);
});
test('バスケ内訳: 不正な入力・前半未入力では2試合とも確定しない', () => {
  const e=world(),g=e.ctx,t=e.token;
  assert.equal(g.adminSaveBasketballRound(t,1,{},0,true).error.code,'INVALID');
  assert.equal(g.adminSaveBasketballRound(t,1,{questions:[{difficulty:'ふつう',orders:[['C'],[]]}]},0,true).error.code,'INVALID');
  const view=g.adminGetBasketballRound(t,1).data;
  assert.equal(view.revision,0);assert.ok(view.matches.every(m=>m.status==='予定'));
});
