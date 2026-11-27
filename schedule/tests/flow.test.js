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

test('日にちを決めてから時間を聞く(2段階):時間調整中 → 時間を決める → 出欠。戻すと1段ずつ戻る', () => {
  const { g, token, files } = world();
  const made = ok(g.adminCreateGroup(token, { name: '友達', kind: 'グループ' }));
  const tk = made.link.split('g=')[1], gid = made.groupId;
  // 「段階」の列がない古いファイルでも動くように、列を消しておく
  const gf = Object.values(files).find(f => f.getSheetByName('候補日'));
  const cs = gf.getSheetByName('候補日');
  cs.data = [cs.data[0].slice(0, 5)];
  const ev = ok(g.adminCreateEvent(token, gid, { name: 'ご飯', candidates: [{ date: '2026-12-19', time: '18:00' }, { date: '2026-12-20', time: '' }] }));
  const a = ok(g.joinGroup(tk, { name: 'たろう' })), b = ok(g.joinGroup(tk, { name: 'はなこ' }));
  let view = ok(g.getEvent(tk, ev.eventId, a.memberId));
  const [D1, D2] = view.candidates.map(x => x.id);
  ok(g.submitAnswers(tk, ev.eventId, a.memberId, { [D1]: '○', [D2]: '×' }, '楽しみ'));
  ok(g.submitAnswers(tk, ev.eventId, b.memberId, { [D1]: '○', [D2]: '○' }, ''));

  // 時間の候補がないとだめ
  assert.equal(g.adminDecide(token, gid, ev.eventId, D1, { askTime: true, times: [] }).error.code, 'INVALID');
  const e1 = ok(g.adminDecide(token, gid, ev.eventId, D1, { askTime: true, times: ['17:00', '19:00', '19:00'] }));
  assert.equal(e1.status, '時間調整中');
  assert.equal(e1.decidedId, D1);
  assert.equal(e1.candidates.filter(c => c.stage === 'time').length, 2, '同じ時刻は1つにまとまる');
  assert.equal(cs.data[0][5], '段階', '古いファイルにも列が足される');

  // 参加者:同じリンクで時間の候補だけが出る。日程の答えは残る
  view = ok(g.getEvent(tk, ev.eventId, a.memberId));
  assert.equal(view.event.status, '時間調整中');
  assert.equal(view.event.decided.date, '2026-12-19');
  assert.equal(view.event.decided.time, '');
  assert.equal(view.event.closed, false);
  assert.equal(view.event.calendar, null);
  assert.deepEqual(view.candidates.map(c => c.time), ['17:00', '19:00']);
  assert.deepEqual(view.mine.answers, {}, '時間はまだ答えていない');
  assert.equal(view.results.dateStage.byDate.length, 2);
  const [T1, T2] = view.candidates.map(x => x.id);
  ok(g.submitAnswers(tk, ev.eventId, a.memberId, { [T1]: '×', [T2]: '○' }, undefined));
  ok(g.submitAnswers(tk, ev.eventId, b.memberId, { [T1]: '○', [T2]: '×' }, ''));
  view = ok(g.getEvent(tk, ev.eventId, a.memberId));
  assert.deepEqual(view.mine.answers, { [T1]: '×', [T2]: '○' });
  assert.equal(view.mine.comment, '楽しみ', 'ひとことは消えない');
  assert.equal(view.results.dateStage.byDate.find(x => x.candidateId === D1).o, 2, '日程の答えも残っている');
  const home = ok(g.openGroup(tk, a.memberId)).events[0];
  assert.equal(home.myAnswered, true);

  // 運営:結果は時間の候補。LINEの文は「何時からがいいか」
  let res = ok(g.adminGetResults(token, gid, ev.eventId));
  assert.deepEqual(res.byDate.map(x => x.time), ['17:00', '19:00']);
  assert.match(res.shareText, /12\/19.*に決まりました/);
  assert.match(res.shareText, /何時から/);
  assert.equal(res.dateStage.byDate.length, 2);
  // 日程の候補は時間調整中には消せない(決まった日)
  assert.equal(g.adminRemoveCandidates(token, gid, ev.eventId, [D1]).error.code, 'INVALID');
  // 時間の候補を足せる(日付は決まった日になる)
  const added = ok(g.adminAddCandidates(token, gid, ev.eventId, [{ date: '2026-12-01', time: '20:00' }]));
  const T3 = added.candidates.find(c => c.stage === 'time' && c.time === '20:00');
  assert.equal(T3.date, '2026-12-19');
  ok(g.adminRemoveCandidates(token, gid, ev.eventId, [T3.id]));

  // 時間を決める → 出欠確認中。時間の答えから 行く/行かない が仮に入る
  assert.equal(g.adminDecideTime(token, gid, ev.eventId, D2).error.code, 'NOT_FOUND');
  const e2 = ok(g.adminDecideTime(token, gid, ev.eventId, T2));
  assert.equal(e2.status, '出欠確認中');
  res = ok(g.adminGetResults(token, gid, ev.eventId));
  assert.deepEqual(res.attendance.totals.names, { go: ['たろう'], partial: [], no: ['はなこ'] });
  assert.match(res.shareText, /12\/19.*19:00 に決まりました/);
  assert.equal(res.dateStage.timeStage.byDate.length, 2);
  view = ok(g.getEvent(tk, ev.eventId, b.memberId));
  assert.equal(view.event.decided.time, '19:00');
  assert.ok(view.event.calendar);

  // 戻す:出欠確認中 → 時間調整中 → 日程調整中
  assert.equal(ok(g.adminUndecide(token, gid, ev.eventId)).status, '時間調整中');
  const back = ok(g.adminUndecide(token, gid, ev.eventId));
  assert.equal(back.status, '日程調整中');
  assert.equal(back.candidates.length, 2, '時間の候補は消える');
  view = ok(g.getEvent(tk, ev.eventId, a.memberId));
  assert.deepEqual(view.mine.answers, { [D1]: '○', [D2]: '×' }, '日程の答えはそのまま、時間の答えは外れる');
});

test('日にちを決めるとき、時間を聞かなければ今までどおり出欠確認中になる', () => {
  const { g, token } = world();
  const made = ok(g.adminCreateGroup(token, { name: '友達', kind: 'グループ' }));
  const gid = made.groupId;
  const ev = ok(g.adminCreateEvent(token, gid, { name: 'ご飯', candidates: [{ date: '2026-12-19', time: '18:00' }] }));
  const D1 = ev.eventId && ok(g.adminGetResults(token, gid, ev.eventId)).byDate[0].candidateId;
  const e = ok(g.adminDecide(token, gid, ev.eventId, D1, { askTime: false }));
  assert.equal(e.status, '出欠確認中');
  assert.equal(ok(g.adminUndecide(token, gid, ev.eventId)).status, '日程調整中');
});

test('二重登録:空白のあるなしだけちがう名前は止める。運営はメンバーを消せて、戻せる', () => {
  const { g, token } = world();
  const made = ok(g.adminCreateGroup(token, { name: '友達', kind: 'グループ' }));
  const tk = made.link.split('g=')[1], gid = made.groupId;
  const ev = ok(g.adminCreateEvent(token, gid, { name: 'ご飯', candidates: [{ date: '2026-12-19', time: '18:00' }] }));
  const a = ok(g.joinGroup(tk, { name: '山田 太郎' }));
  assert.equal(g.joinGroup(tk, { name: '山田太郎' }).error.code, 'INVALID');
  assert.equal(g.joinGroup(tk, { name: '山田　太郎' }).error.code, 'INVALID');
  const b = ok(g.joinGroup(tk, { name: '山田 次郎' }));
  const C1 = ok(g.getEvent(tk, ev.eventId, a.memberId)).candidates[0].id;
  ok(g.submitAnswers(tk, ev.eventId, a.memberId, { [C1]: '○' }, ''));
  ok(g.submitAnswers(tk, ev.eventId, b.memberId, { [C1]: '○' }, ''));

  let grp = ok(g.adminGetGroup(token, gid));
  assert.equal(grp.members.find(m => m.memberId === b.memberId).answered, 1);
  ok(g.adminSetMemberActive(token, gid, b.memberId, false));
  grp = ok(g.adminGetGroup(token, gid));
  assert.deepEqual(grp.members.map(m => m.memberId), [a.memberId]);
  assert.deepEqual(grp.removed.map(m => m.memberId), [b.memberId]);
  assert.equal(ok(g.listMembers(tk)).members.length, 1, '名前を選ぶ画面にも出ない');
  assert.equal(ok(g.openGroup(tk, '')).group.memberCount, 1, '最初の読み込みで人数が分かる(ボタンを先に出す用)');
  assert.equal(ok(g.adminGetResults(token, gid, ev.eventId)).byDate[0].o, 1, '消した人の答えは集計に出ない');
  assert.equal(ok(g.openGroup(tk, b.memberId)).me, null, '消された人のスマホは、名前を選び直しになる');

  ok(g.adminSetMemberActive(token, gid, b.memberId, true));
  assert.equal(ok(g.adminGetResults(token, gid, ev.eventId)).byDate[0].o, 2, '戻すと答えも戻る');
  assert.equal(g.adminSetMemberActive(token, gid, 'M999', false).error.code, 'NOT_FOUND');
});

test('サークル:消した名簿の人は「名簿の新しい人を足す」で戻ってこない', () => {
  const { g, token } = world();
  const made = ok(g.adminCreateGroup(token, { name: 'サークル', kind: 'サークル' }));
  const gid = made.groupId;
  const first = ok(g.adminGetGroup(token, gid)).members[0];
  ok(g.adminSetMemberActive(token, gid, first.memberId, false));
  assert.equal(ok(g.adminSyncRoster(token, gid)).added, 0);
  assert.equal(ok(g.adminGetGroup(token, gid)).members.length, 2);
});

test('ほかのグループのイベントもまとめて見る:リンクとメンバーIDが合うものだけ。名前では結ばない', () => {
  const { g, token } = world();
  const A = ok(g.adminCreateGroup(token, { name: 'サークルっぽい', kind: 'グループ' }));
  const B = ok(g.adminCreateGroup(token, { name: '男子会っぽい', kind: 'グループ' }));
  const tA = A.link.split('g=')[1], tB = B.link.split('g=')[1];
  const eA = ok(g.adminCreateEvent(token, A.groupId, { name: 'ご飯', candidates: [{ date: '2099-12-19', time: '18:00' }] }));
  ok(g.adminCreateEvent(token, B.groupId, { name: '飲み', candidates: [{ date: '2099-12-20', time: '19:00' }] }));
  const meA = ok(g.joinGroup(tA, { name: 'たろう' }));
  const meB = ok(g.joinGroup(tB, { name: 'たろちゃん' })); // グループごとに名前がちがってもよい
  const otherB = ok(g.joinGroup(tB, { name: 'たろう' })); // 同じ名前の別人

  let r = ok(g.myEvents([{ token: tA, memberId: meA.memberId }, { token: tB, memberId: meB.memberId }]));
  assert.deepEqual(r.groups.map(x => [x.group.name, x.me.name, x.events.length]), [['サークルっぽい', 'たろう', 1], ['男子会っぽい', 'たろちゃん', 1]]);
  assert.equal(r.groups[0].events[0].myAnswered, false);
  const C1 = ok(g.getEvent(tA, eA.eventId, meA.memberId)).candidates[0].id;
  ok(g.submitAnswers(tA, eA.eventId, meA.memberId, { [C1]: '○' }, ''));
  r = ok(g.myEvents([{ token: tA, memberId: meA.memberId }]));
  assert.equal(r.groups[0].events[0].myAnswered, true);

  // Aのメンバーで、Bのリンクを使っても見えない(メンバーIDがそのグループにいない)
  assert.equal(ok(g.myEvents([{ token: tB, memberId: 'M999' }])).groups.length, 0);
  // リンクがちがう・空は無視
  assert.equal(ok(g.myEvents([{ token: 'xxxx', memberId: meA.memberId }, { token: '', memberId: '' }, null])).groups.length, 0);
  // 同じ名前の別人の分は、その人のメンバーIDがないと出ない(名前では結ばない)
  assert.equal(ok(g.myEvents([{ token: tB, memberId: otherB.memberId }])).groups[0].me.name, 'たろう');
  // 削除されたメンバーは出ない
  ok(g.adminSetMemberActive(token, B.groupId, meB.memberId, false));
  assert.equal(ok(g.myEvents([{ token: tB, memberId: meB.memberId }])).groups.length, 0);
});
