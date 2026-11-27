// サーバーの通しの流れ(グループを作る → 答える → 結果 → 日にちを決める → 出欠)。名前はすべて架空
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./helpers/fake_gas.js');

function ok(res) {
  assert.equal(res.ok, true, JSON.stringify(res));
  return JSON.parse(JSON.stringify(res.data));
}

function world() {
  const env = loadGas({ props: { ADMIN_PASSWORD: 'pw', ROSTER_SPREADSHEET_ID: 'roster' } });
  // 名簿(運動会の「フォームの回答 1」と同じ見出し。参加者IDがある人だけがサークルのメンバー)
  const roster = env.newFile('roster');
  roster.sheets[0].setName('フォームの回答 1');
  roster.sheets[0].data = [
    ['タイムスタンプ', 'フルネーム(漢字)', 'フルネーム(ひらがな)', '性別', '大学', '学年', '所属', '出身地(都道府県)', '学籍番号', '参加', '同意', '何時', 'チーム', '参加者ID'],
    ['', '青木 ひなた', 'あおき ひなた', '女性', '', '1年', '', '', '', '', '', '', 'A', 'P01'],
    ['', '石井 蓮', 'いしい れん', '男性', '', '2年', '', '', '', '', '', '', 'B', 'P02'],
    ['', '上田 結衣', 'うえだ ゆい', '女性', '', '3年', '', '', '', '', '', '', 'C', 'P03'],
    ['', '来なかった人', 'こなかった', '男性', '', '1年', '', '', '', '', '', '', '', '']
  ];
  env.ctx.setup();
  const token = ok(env.ctx.adminLogin('pw')).token;
  return { ...env, g: env.ctx, token };
}

test('ログイン:パスワード違いは AUTH', () => {
  const { g } = world();
  assert.equal(g.adminLogin('x').error.code, 'AUTH');
  assert.equal(g.adminListGroups('bad').error.code, 'AUTH');
});

test('サークル:名簿の3人がメンバーになり、ふりがな順で選べる。名簿にいない人は自分で加わる', () => {
  const { g, token, files } = world();
  const made = ok(g.adminCreateGroup(token, { name: 'スコティッシュサークル', kind: 'サークル' }));
  assert.match(made.link, /^https:\/\/example\.com\/exec\?g=[A-Za-z0-9]{20}$/);
  const tk = made.link.split('g=')[1];
  const ms = ok(g.listMembers(tk)).members;
  assert.deepEqual(ms.map(m => m.name), ['青木 ひなた', '石井 蓮', '上田 結衣']);
  assert.equal(ms[0].grade, '1年');
  // ふりがな・学年がないとだめ
  assert.equal(g.joinGroup(tk, { name: '新人 太郎' }).error.code, 'INVALID');
  const j = ok(g.joinGroup(tk, { name: '新人 太郎', kana: 'しんじん たろう', grade: '1年', gender: '男性' }));
  assert.equal(j.name, '新人 太郎');
  // 名前は名簿ファイルの「出欠アプリ登録」に入り、グループのファイルには参加者IDだけ
  const self = files.roster.getSheetByName('出欠アプリ登録').data;
  assert.deepEqual(self[1].slice(0, 5), ['S01', '新人 太郎', 'しんじん たろう', '1年', '男性']);
  const groupFile = Object.values(files).find(f => f.getSheetByName('メンバー') && f.getSheetByName('メンバー').data.length > 1);
  const memberRows = groupFile.getSheetByName('メンバー').data;
  assert.ok(memberRows.slice(1).every(r => r[2] === ''), '表示名の列は空');
  assert.equal(ok(g.listMembers(tk)).members.length, 4);
  // 同じ名前は止める
  assert.equal(g.joinGroup(tk, { name: '新人 太郎', kana: 'x', grade: '1年' }).error.code, 'INVALID');
});

test('友達グループ:表示名で加わり、日程調整 → 結果 → 日にちを決める → 出欠', () => {
  const { g, token } = world();
  const made = ok(g.adminCreateGroup(token, { name: '地元の友達', kind: 'グループ', mascot: false }));
  const tk = made.link.split('g=')[1];
  const gid = made.groupId;
  const ev = ok(g.adminCreateEvent(token, gid, {
    name: '忘年会', place: '駅前', cost: '3000円くらい', url: 'https://example.com/shop', deadline: '2099-12-05',
    candidates: [{ date: '2026-12-15', time: '19:00' }, { date: '2026-12-22', time: '19:00' }, { date: '2026-12-15', time: '19:00' }]
  }));
  assert.match(ev.link, /&e=G\d{3}-E01$/);
  const a = ok(g.joinGroup(tk, { name: ' たろう ' }));
  const b = ok(g.joinGroup(tk, { name: 'はなこ' }));
  const c = ok(g.joinGroup(tk, { name: 'じろう' }));
  assert.equal(a.name, 'たろう');

  let view = ok(g.getEvent(tk, ev.eventId, a.memberId));
  assert.equal(view.candidates.length, 2, '同じ日時は1つにまとまる');
  assert.equal(view.event.place, '駅前');
  const [C1, C2] = view.candidates.map(x => x.id);

  ok(g.submitAnswers(tk, ev.eventId, a.memberId, { [C1]: '○', [C2]: '○' }, '何でも'));
  ok(g.submitAnswers(tk, ev.eventId, b.memberId, { [C1]: '×', [C2]: '○' }, ''));
  ok(g.submitAnswers(tk, ev.eventId, a.memberId, { [C1]: '△', [C2]: '○' }, '15日は微妙')); // 上書き

  view = ok(g.getEvent(tk, ev.eventId, a.memberId));
  assert.deepEqual(view.mine.answers, { [C1]: '△', [C2]: '○' });
  assert.equal(view.results.answeredCount, 2);
  assert.equal(view.results.memberCount, null, 'サークル以外は全体の人数を出さない');
  assert.equal(view.results.byDate[0].candidateId, C2);
  assert.deepEqual(view.results.byDate[0].names.o, ['たろう', 'はなこ']);

  // 人数だけにすると名前は出ない
  ok(g.adminUpdateEvent(token, gid, ev.eventId, { visibility: '人数' }));
  assert.equal(ok(g.getEvent(tk, ev.eventId, a.memberId)).results.byDate[0].names, null);
  ok(g.adminUpdateEvent(token, gid, ev.eventId, { visibility: '伊吹だけ' }));
  assert.equal(ok(g.getEvent(tk, ev.eventId, a.memberId)).results, null);

  // 運営の結果:未回答と催促文
  const r = ok(g.adminGetResults(token, gid, ev.eventId, {}));
  assert.match(r.shareText, /^【忘年会】来られる日を教えてください🙌\n締め切り 12\/5\(/);
  assert.ok(!r.shareText.includes('じろう'), '名指ししない');
  assert.deepEqual(r.comments, [{ name: 'たろう', comment: '15日は微妙' }]);

  // 日にちを決める → ○の人は「行く」、×の人は「行かない」が仮に入る
  ok(g.adminDecide(token, gid, ev.eventId, C2));
  assert.equal(g.submitAnswers(tk, ev.eventId, c.memberId, { [C2]: '○' }).error.code, 'CLOSED');
  view = ok(g.getEvent(tk, ev.eventId, b.memberId));
  assert.equal(view.event.status, '出欠確認中');
  assert.equal(view.mine.attendance.status, '行く');
  ok(g.submitAttendance(tk, ev.eventId, c.memberId, { status: '途中から', arriveAt: '20:30' }));
  const r2 = ok(g.adminGetResults(token, gid, ev.eventId, {}));
  assert.deepEqual([r2.attendance.totals.go, r2.attendance.totals.partial, r2.attendance.totals.no], [2, 1, 0]);
  assert.deepEqual(r2.attendance.totals.names.partial, ['じろう(20:30〜)']);

  // 一覧
  const list = ok(g.adminListGroups(token));
  const grp = list.groups.find(x => x.id === gid);
  assert.equal(grp.mascot, false);
  assert.equal(grp.events[0].status, '出欠確認中');
  const opened = ok(g.openGroup(tk, a.memberId));
  assert.equal(opened.me.name, 'たろう');
  assert.equal(opened.events[0].myAnswered, true);
  assert.deepEqual(opened.events[0].decided, { date: '2026-12-22', time: '19:00' });
});

test('締め切りを過ぎたら参加者は変えられない。運営は代わりに入れられる', () => {
  const { g, token } = world();
  const ev = ok(g.adminCreateEvent(token, '', { name: 'カラオケ', deadline: '2000-01-01', candidates: [{ date: '2026-12-20', time: '' }] }));
  const tk = ev.link.split('g=')[1];
  assert.ok(!ev.link.includes('&e='), '1回きりはグループのリンクだけで開く');
  const a = ok(g.joinGroup(tk, { name: 'たろう' }));
  const view = ok(g.getEvent(tk, ev.eventId, a.memberId));
  assert.equal(view.event.closed, true);
  assert.equal(g.submitAnswers(tk, ev.eventId, a.memberId, { C01: '○' }).error.code, 'CLOSED');
  ok(g.adminSetAnswer(token, ev.groupId, ev.eventId, a.memberId, { C01: '○' }, 'LINEで聞いた'));
  assert.deepEqual(ok(g.getEvent(tk, ev.eventId, a.memberId)).mine.answers, { C01: '○' });
});

test('知らないリンク・知らないメンバー', () => {
  const { g, token } = world();
  assert.equal(g.openGroup('nope', '').error.code, 'NOT_FOUND');
  const ev = ok(g.adminCreateEvent(token, '', { name: 'x', candidates: [{ date: '2026-12-20' }] }));
  const tk = ev.link.split('g=')[1];
  assert.equal(g.submitAnswers(tk, ev.eventId, 'M999', { C01: '○' }).error.code, 'NOT_FOUND');
  assert.equal(ok(g.openGroup(tk, 'M999')).me, null);
  assert.equal(g.adminCreateEvent(token, '', { name: 'x', candidates: [] }).error.code, 'INVALID');
  assert.equal(g.adminCreateEvent(token, '', { name: 'x', candidates: [{ date: '12/20' }] }).error.code, 'INVALID');
});

test('候補日を足す・消す、来てほしい人、決めた日の取り消し', () => {
  const { g, token } = world();
  const made = ok(g.adminCreateGroup(token, { name: '研究室', kind: 'グループ' }));
  const tk = made.link.split('g=')[1];
  const ev = ok(g.adminCreateEvent(token, made.groupId, { name: '打ち上げ', candidates: [{ date: '2026-12-10', time: '18:00' }] }));
  let e = ok(g.adminAddCandidates(token, made.groupId, ev.eventId, [{ date: '2026-12-11', time: '18:00' }, { date: '2026-12-10', time: '18:00' }]));
  assert.equal(e.candidates.length, 2);
  const a = ok(g.joinGroup(tk, { name: '先生' }));
  ok(g.submitAnswers(tk, ev.eventId, a.memberId, { C01: '×', C02: '○' }));
  ok(g.adminSetWanted(token, made.groupId, ev.eventId, [a.memberId]));
  const r = ok(g.adminGetResults(token, made.groupId, ev.eventId, {}));
  const c2 = r.byDate.find(d => d.candidateId === 'C02');
  assert.deepEqual(c2.wanted.ok, ['先生']);
  ok(g.adminDecide(token, made.groupId, ev.eventId, 'C02'));
  assert.equal(g.adminRemoveCandidate(token, made.groupId, ev.eventId, 'C02').error.code, 'INVALID');
  ok(g.adminUndecide(token, made.groupId, ev.eventId));
  e = ok(g.adminRemoveCandidate(token, made.groupId, ev.eventId, 'C01'));
  assert.deepEqual(e.candidates.map(c => c.id), ['C02']);
  assert.equal(e.status, '日程調整中');
});

test('候補日をまとめて消す・イベントを削除する(11/27 追加)', () => {
  const { g, token } = world();
  const made = ok(g.adminCreateGroup(token, { name: '研究室', kind: 'グループ' }));
  const tk = made.link.split('g=')[1];
  const ev = ok(g.adminCreateEvent(token, made.groupId, { name: '打ち上げ', candidates: [
    { date: '2026-12-10', time: '18:00' }, { date: '2026-12-10', time: '20:00' }, { date: '2026-12-11', time: '18:00' }] }));
  const a = ok(g.joinGroup(tk, { name: '先生' }));
  ok(g.submitAnswers(tk, ev.eventId, a.memberId, { C01: '○', C02: '○', C03: '×' }));
  // 全部は消せない
  assert.equal(g.adminRemoveCandidates(token, made.groupId, ev.eventId, ['C01', 'C02', 'C03']).error.code, 'INVALID');
  const e = ok(g.adminRemoveCandidates(token, made.groupId, ev.eventId, ['C01', 'C03']));
  assert.deepEqual(e.candidates.map(c => c.id), ['C02']);
  // 消した候補日は集計に出ない
  const r = ok(g.adminGetResults(token, made.groupId, ev.eventId, {}));
  assert.deepEqual(r.byDate.map(d => d.candidateId), ['C02']);
  // 決まった日は消せない
  ok(g.adminAddCandidates(token, made.groupId, ev.eventId, [{ date: '2026-12-12', time: '' }]));
  ok(g.adminDecide(token, made.groupId, ev.eventId, 'C02'));
  assert.equal(g.adminRemoveCandidates(token, made.groupId, ev.eventId, ['C02']).error.code, 'INVALID');
  // イベントを削除すると、参加者からも見えなくなる
  ok(g.adminDeleteEvent(token, made.groupId, ev.eventId));
  assert.equal(g.getEvent(tk, ev.eventId, a.memberId).error.code, 'NOT_FOUND');
  assert.equal(ok(g.openGroup(tk, a.memberId)).events.length, 0);
  assert.equal(ok(g.adminListGroups(token)).groups.find(x => x.id === made.groupId).events.length, 0);
  // 1回きりは、イベントを消すとグループも一覧から消える
  const once = ok(g.adminCreateEvent(token, '', { name: 'カラオケ', candidates: [{ date: '2026-12-20' }] }));
  ok(g.adminDeleteEvent(token, once.groupId, once.eventId));
  assert.ok(!ok(g.adminListGroups(token)).groups.some(x => x.id === once.groupId));
});

test('グループの名前を変えられる(リンクはそのまま)', () => {
  const { g, token } = world();
  const made = ok(g.adminCreateGroup(token, { name: '男子飲み会', kind: 'グループ' }));
  const tk = made.link.split('g=')[1];
  ok(g.adminUpdateGroup(token, made.groupId, { name: '男子会' }));
  assert.equal(ok(g.openGroup(tk, '')).group.name, '男子会');
  assert.equal(g.adminUpdateGroup(token, made.groupId, { name: '  ' }).error.code, 'INVALID');
});
