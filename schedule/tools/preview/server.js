#!/usr/bin/env node
/**
 * 画面のローカル確認用サーバー(src には入れない。外部ライブラリなし)
 * - サーバー側の処理は、テストと同じ偽物のGAS(tests/helpers/fake_gas.js)で本物の src/*.js を動かす
 * - google.script.run は、このサーバーの /rpc に送る偽物に置きかえる
 * - データはすべて架空。起動するたびに作り直す
 *
 * 使い方: cd schedule && node tools/preview/server.js
 *   → http://localhost:8791/          (起動時に出る「サークル」「友達」「1回きり」のリンクを開く)
 *   → http://localhost:8791/phone?... (スマホ幅の枠で見る)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('../../tests/helpers/fake_gas.js');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const PORT = Number(process.env.PORT) || 8791;
const BASE = 'http://localhost:' + PORT + '/';

// ---- 架空のデータ ----
const env = loadGas({ props: { ADMIN_PASSWORD: 'preview', ROSTER_SPREADSHEET_ID: 'roster' } });
env.ctx.ScriptApp.getService = () => ({ getUrl: () => BASE });
const roster = env.newFile('roster');
roster.sheets[0].setName('フォームの回答 1');
const FAM = ['青木', '石井', '上田', '江口', '大野', '加藤', '木村', '工藤', '小池', '坂本', '島田', '杉山'];
const FAMK = ['あおき', 'いしい', 'うえだ', 'えぐち', 'おおの', 'かとう', 'きむら', 'くどう', 'こいけ', 'さかもと', 'しまだ', 'すぎやま'];
const GIV = ['ひなた', '蓮', '結衣', '颯太', '美咲', '大和', '葵', '悠真', '千尋', '湊', '彩花', '陽斗'];
const GIVK = ['ひなた', 'れん', 'ゆい', 'そうた', 'みさき', 'やまと', 'あおい', 'ゆうま', 'ちひろ', 'みなと', 'あやか', 'はると'];
roster.sheets[0].data = [['フルネーム(漢字)', 'フルネーム(ひらがな)', '性別', '学年', '参加者ID']]
  .concat(FAM.map((f, i) => [f + ' ' + GIV[i], FAMK[i] + ' ' + GIVK[i], i % 2 ? '男性' : '女性', ['1年', '2年', '3年'][i % 3], 'P' + ('0' + (i + 1)).slice(-2)]));
const g = env.ctx;
g.setup();
const tok = g.adminLogin('preview').data.token;
const circle = g.adminCreateGroup(tok, { name: 'スコティッシュサークル', kind: 'サークル' }).data;
const ev1 = g.adminCreateEvent(tok, circle.groupId, {
  name: '忘年会の日程', deadline: '2099-12-05', place: '会津若松駅前の居酒屋(予定)', cost: '3000〜4000円',
  description: 'サークル全体のご飯会です。お酒を飲む・飲まないで会費が変わります',
  candidates: [{ date: '2026-12-15', time: '19:00' }, { date: '2026-12-18', time: '19:00' }, { date: '2026-12-22', time: '19:00', memo: '練習のあと' }]
}).data;
const ev2 = g.adminCreateEvent(tok, circle.groupId, { name: 'ミックスチーム大会', candidates: [{ date: '2027-01-13', time: '18:00' }, { date: '2027-01-20', time: '18:00' }] }).data;
// 何人かが答えておく
const ms = g.adminGetGroup(tok, circle.groupId).data.members;
const marks = [['○', '△', '○'], ['×', '○', '○'], ['○', '○', '×'], ['△', '×', '○'], ['○', '×', '○'], ['×', '○', '△'], ['○', '○', '○']];
marks.forEach((m, i) => g.adminSetAnswer(tok, circle.groupId, ev1.eventId, ms[i + 1].memberId, { C01: m[0], C02: m[1], C03: m[2] }, i === 2 ? '22日はバイト' : ''));
const friends = g.adminCreateGroup(tok, { name: '地元の友達', kind: 'グループ', mascot: false }).data;
const ev3 = g.adminCreateEvent(tok, friends.groupId, { name: '年末のカラオケ', place: 'まねきねこ', visibility: '名前', candidates: [{ date: '2026-12-27' }, { date: '2026-12-28' }, { date: '2026-12-29' }] }).data;
const fTok = friends.link.split('g=')[1];
['たろう', 'はなこ'].forEach((n, i) => { const m = g.joinGroup(fTok, { name: n }).data; g.submitAnswers(fTok, ev3.eventId, m.memberId, i ? { C01: '○', C02: '○' } : { C01: '×', C02: '○', C03: '○' }, ''); });
const once = g.adminCreateEvent(tok, '', { name: '研究室の打ち上げ', candidates: [{ date: '2026-12-10', time: '18:30' }, { date: '2026-12-11', time: '18:30' }] }).data;
// 日にちが決まったイベントも1つ
const ev4 = g.adminCreateEvent(tok, circle.groupId, { name: '男女ミックスバレー', place: '体育館', candidates: [{ date: '2026-12-08', time: '18:00' }, { date: '2026-12-09', time: '18:00' }] }).data;
g.adminSetAnswer(tok, circle.groupId, ev4.eventId, ms[1].memberId, { C01: '○', C02: '×' }, '');
g.adminDecide(tok, circle.groupId, ev4.eventId, 'C01');

// ---- ページ ----
function include(name) { return fs.readFileSync(path.join(SRC, name + '.html'), 'utf8'); }
const SHIM = `<script>
window.google = { script: { run: (function make(ok, ng) {
  return new Proxy({}, { get: function (_, fn) {
    if (fn === 'withSuccessHandler') return function (f) { return make(f, ng); };
    if (fn === 'withFailureHandler') return function (f) { return make(ok, f); };
    return function () { var args = Array.prototype.slice.call(arguments);
      fetch('/rpc', { method: 'POST', body: JSON.stringify({ fn: fn, args: args }) }).then(function (r) { return r.json(); })
        .then(function (res) { setTimeout(function () { ok && ok(res); }, 250); }).catch(function (e) { ng && ng(e); }); };
  } });
})(null, null) } };
</script>`;
function page(file, q) {
  let html = include(file);
  html = html.replace(/<\?!=\s*include\('(\w+)'\)\s*\?>/g, (_, n) => include(n));
  html = html.replace(/<\?!=\s*groupToken\s*\?>/g, String(q.get('g') || '').replace(/[^A-Za-z0-9]/g, ''));
  html = html.replace(/<\?!=\s*eventId\s*\?>/g, String(q.get('e') || '').replace(/[^A-Za-z0-9-]/g, ''));
  html = html.replace(/<\?!=\s*appUrl\s*\?>/g, BASE);
  return html.replace('<head>', '<head>\n' + SHIM);
}

http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  if (req.method === 'POST' && url.pathname === '/rpc') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const { fn, args } = JSON.parse(body);
      const out = typeof g[fn] === 'function' ? g[fn].apply(null, args) : { ok: false, error: { code: 'INTERNAL', message: 'no fn ' + fn } };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (url.pathname === '/phone') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888"><iframe src="/' + url.search + '" style="width:390px;height:844px;border:0;background:#fff;display:block"></iframe>');
    return;
  }
  if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page(url.searchParams.get('page') === 'admin' ? 'admin' : 'participant', url.searchParams));
}).listen(PORT, () => {
  console.log('サークル     ' + circle.link);
  console.log('友達         ' + friends.link);
  console.log('1回きり      ' + once.link);
  console.log('運営(パスワード preview) ' + BASE + '?page=admin');
});
