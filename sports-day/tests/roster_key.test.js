// 名簿の目印(rosterKey_):テスト名簿と本物の名簿で、端末が覚える参加者IDを分けるためのもの
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadGas} = require('./helpers/fake_gas');

const keyFor = (id) => loadGas({props: {ROSTER_SPREADSHEET_ID: id, ADMIN_PASSWORD: 'pw'}}).ctx.rosterKey_();

test('同じ名簿なら同じ目印、ちがう名簿ならちがう目印', () => {
  const test1 = keyFor('1AbCdEfGhIjKlMnOpQrStUvWxYz_test-roster');
  assert.equal(keyFor('1AbCdEfGhIjKlMnOpQrStUvWxYz_test-roster'), test1);
  assert.notEqual(keyFor('143QJJphQZtOs2E1j9hWxBuSBbApsWOX_vkde_f5nkGM'), test1);
});

test('目印は英数字だけで、名簿のIDそのものは含まない', () => {
  const id = '143QJJphQZtOs2E1j9hWxBuSBbApsWOX_vkde_f5nkGM';
  const k = keyFor(id);
  assert.match(k, /^[0-9a-z]+$/);
  assert.ok(!id.includes(k) || k.length < 4);
});
