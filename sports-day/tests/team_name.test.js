// チーム名(2026-11-16 追加):チームのだれでも入れられる。運営が直す・消す・締め切る
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./helpers/fake_gas.js');
const { normalizeTeamName, teamNameLength, TEAM_NAME_MAX } = require('../src/core_team.js');

const FORM_HEADERS = ['タイムスタンプ', 'フルネーム(漢字)', 'フルネーム(ひらがな)', '性別', '大学', '学年', '所属',
  '出身地(都道府県)', '学籍番号(任意)', '11/24(火)の運動会に参加できますか？', '名簿としての保存について',
  '何時ごろから参加できそうですか？(途中から参加の人)', 'チーム'];
const person = (name, kana, team) => ['2026/11/12', name, kana, '', '', '', '', '福島県', '', '参加', '同意', '', team];

function world() {
  const env = loadGas({ props: { ROSTER_SPREADSHEET_ID: 'roster', ADMIN_PASSWORD: 'pw' } });
  env.roster.insertSheet('フォームの回答 1').data = [FORM_HEADERS,
    person('斎藤 花子', 'さいとう はなこ', 'A'), person('渡辺 太郎', 'わたなべ たろう', 'A'),
    person('佐藤 一郎', 'さとう いちろう', 'B'), person('田中 三郎', 'たなか さぶろう', 'C')];
  env.ctx.setup();
  const token = ok(env.ctx.adminLogin('pw')).token;
  ok(env.ctx.adminImportRoster(token)); // P01,P02 = A、P03 = B、P04 = C
  return { ...env, g: env.ctx, token };
}
function ok(res) {
  assert.equal(res.ok, true, JSON.stringify(res));
  return JSON.parse(JSON.stringify(res.data));
}

test('チーム名を整える:前後の空白・改行・続く空白、文字数は絵文字も1字', () => {
  assert.equal(normalizeTeamName('  つなぼる\n  ズ '), 'つなぼる ズ');
  assert.equal(normalizeTeamName(null), '');
  assert.equal(teamNameLength('🔥🔥つなぼる'), 6);
  assert.equal(TEAM_NAME_MAX, 10);
});

test('チームのだれでも自分のチームの名前を入れられ、全員の状態に出る', () => {
  const { g } = world();
  assert.deepEqual(ok(g.getState()).teamNames, { A: '', B: '', C: '', D: '' });
  const r = ok(g.setTeamName('P02', ' つなぼるズ '));
  assert.equal(r.team, 'A');
  assert.equal(r.name, 'つなぼるズ');
  ok(g.setTeamName('P03', '青いイナズマ'));
  const st = ok(g.getState());
  assert.deepEqual(st.teamNames, { A: 'つなぼるズ', B: '青いイナズマ', C: '', D: '' });
  assert.equal(st.teamNameLocked, false);
  // 同じチームの別の人が上書きできる
  ok(g.setTeamName('P01', 'はなチーム'));
  assert.equal(ok(g.getState()).teamNames.A, 'はなチーム');
});

test('11字以上・知らない参加者はエラー。数式に見える名前もそのまま文字で残る', () => {
  const { g, app } = world();
  assert.equal(g.setTeamName('P01', 'あ'.repeat(11)).error.code, 'INVALID');
  assert.equal(g.setTeamName('P99', 'x').error.code, 'NOT_FOUND');
  ok(g.setTeamName('P01', '=1+1'));
  assert.equal(ok(g.getState()).teamNames.A, '=1+1');
  const row = app.getSheetByName('状態').data.find(r => r[0] === 'チーム名A');
  assert.equal(row[1], '=1+1'); // 偽シートは先頭の ' を外して持つ(本物では文字として入る)
});

test('締め切ると参加者は変えられない。運営は直せる・消せる。再開できる', () => {
  const { g, token } = world();
  ok(g.setTeamName('P01', 'つなぼるズ'));
  const st = ok(g.adminSetTeamNameLocked(token, true));
  assert.equal(st.teamNameLocked, true);
  assert.equal(ok(g.getState()).teamNameLocked, true);
  assert.equal(g.setTeamName('P01', 'べつの名前').error.code, 'TEAM_NAME_LOCKED');
  assert.equal(ok(g.adminSetTeamName(token, 'a', 'つなぼる')).teamNames.A, 'つなぼる');
  assert.equal(ok(g.adminSetTeamName(token, 'A', '')).teamNames.A, ''); // 消すと「Aチーム」に戻る
  assert.equal(g.adminSetTeamName(token, 'E', 'x').error.code, 'INVALID');
  assert.equal(g.adminSetTeamName('bad', 'A', 'x').error.code, 'AUTH');
  ok(g.adminSetTeamNameLocked(token, false));
  ok(g.setTeamName('P01', 'また変えた'));
  assert.equal(ok(g.getState()).teamNames.A, 'また変えた');
});

test('チーム名を変えても「更新時刻」は動かない(画面の切り替えの合図にしない)', () => {
  const { g } = world();
  const before = ok(g.getState()).updatedAt;
  ok(g.setTeamName('P01', 'つなぼるズ'));
  assert.equal(ok(g.getState()).updatedAt, before);
});

test('resetEventData でチーム名と締め切りも消える', () => {
  const { g, token } = world();
  ok(g.setTeamName('P01', 'つなぼるズ'));
  ok(g.adminSetTeamNameLocked(token, true));
  g.resetEventData();
  const st = ok(g.getState());
  assert.equal(st.teamNames.A, '');
  assert.equal(st.teamNameLocked, false);
});
