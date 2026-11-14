const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('負荷テスト: 返事なしを30秒で失敗に数え、遅れた返事は二重に数えない', async () => {
  const timers = [], log = { textContent: '' };
  let success, now = 0;
  const runner = { withSuccessHandler(f) { success = f; return this; }, withFailureHandler() { return this; }, getState() {} };
  const ctx = { document: { getElementById: () => log }, performance: { now: () => now },
    google: { script: { run: runner } }, setTimeout(f, ms) { timers.push({ f, ms }); return 1; }, clearTimeout() {} };
  const source = fs.readFileSync(path.join(__dirname, '../tools/loadtest.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(source, ctx);
  const pending = ctx.call('getState');
  assert.equal(timers[0].ms, 30000);
  now = 30000; timers[0].f();
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.err, 'TIMEOUT');
  success({ ok: true, data: {} });
  ctx.stats('通信なし', [result]);
  assert.match(log.textContent, /失敗 1件.*TIMEOUT/);
  assert.match(log.textContent, /中央値 30000ms・p95 30000ms・最大 30000ms/);
  assert.equal(ctx.quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
});
