// 実際の画面スクリプトを実行し、通信の返事と時間切れの順番を制御する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function screen() {
  const requests = [], timers = [];
  function runner(ok, ng) {
    return new Proxy({}, { get(_, name) {
      if (name === 'withSuccessHandler') return f => runner(f, ng);
      if (name === 'withFailureHandler') return f => runner(ok, f);
      return (...args) => requests.push({ name, args, ok: data => ok({ ok: true, data }), ng });
    } });
  }
  const google = { script: { run: runner() } };
  const ctx = { window: { google }, google, document: { addEventListener() {}, getElementById() { return {}; } },
    setInterval() {}, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, console };
  let source = fs.readFileSync(path.join(__dirname, '../src/participant_js.html'), 'utf8').replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
  // 本番コードに公開用の口は追加しない。起動処理だけを外し、通信と予想処理はそのまま動かす。
  source = source.slice(0, source.indexOf('  // ============ はじめ ============')) +
    '\nrender = function () {}; toast = function () {}; window.testScreen = { S:S, pick:submitPrediction };\n})();';
  vm.runInNewContext(source, ctx);
  const api = ctx.window.testScreen;
  api.S.pid = 'P01'; api.S.state = { mode: '予想' };
  api.S.pred = view('A');
  return { ...api, requests, timers };
}
function view(choice) { return { match: { id: 'V-SF1', team1: 'A', team2: 'B' }, canPredict: true, myChoice: choice }; }

test('予想画面: AからBへ送信中にAへ戻したら、最後のAも送る', () => {
  const p = screen(); p.pick('B'); p.pick('A');
  assert.equal(p.requests.length, 1);
  p.requests[0].ok(view('B'));
  assert.equal(p.requests.length, 2);
  assert.equal(p.requests[1].args[2], 'A');
  p.requests[1].ok(view('A'));
  assert.equal(p.S.pred.myChoice, 'A'); assert.equal(p.S.predSending, '');
});

test('予想画面: 時間切れのあとに古い返事が届いても、次の送信状態を壊さない', () => {
  const p = screen(); p.pick('B'); p.pick('A');
  p.timers[0](); // Bの返事が来ないまま時間切れ。Aを送り直す。
  assert.equal(p.requests.length, 2);
  p.requests[0].ok(view('B'));
  assert.equal(p.S.predSending, 'A');
  p.requests[1].ok(view('A'));
  p.requests[0].ok(view('B'));
  assert.equal(p.S.pred.myChoice, 'A');
});
