// 運営画面(admin.html)をローカルで確かめるためのサーバー
// - サーバー側の src/*.js を tests/helpers/fake_gas.js の偽の GAS でそのまま動かす
// - 画面の google.script.run は、このサーバーへの fetch に置きかえる(src には入れない)
// - 名前はすべて架空。パスワードは pw
// 使い方: node tools/admin_preview/server.js → http://localhost:8787/
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadGas } = require('../../tests/helpers/fake_gas.js');

const PORT = Number(process.env.PORT || 8787);
const SRC = path.join(__dirname, '..', '..', 'src');
const DELAY = Number(process.env.DELAY || 400); // 通信の遅さのまね(ミリ秒)

const FORM_HEADERS = ['タイムスタンプ', 'フルネーム(漢字)', 'フルネーム(ひらがな)', '性別', '大学', '学年', '所属',
  '出身地(都道府県)', '学籍番号(任意)', '11/24(火)の運動会に参加できますか？', '名簿としての保存について',
  '何時ごろから参加できそうですか？(途中から参加の人)', 'チーム'];
// 架空の名前(実在の人とは関係ない)
const FAKE = [
  ['青木 春香', 'あおき はるか', '福島県'], ['石井 夏樹', 'いしい なつき', '宮城県'], ['上田 秋人', 'うえだ あきと', '山形県'],
  ['江口 冬美', 'えぐち ふゆみ', '新潟県'], ['大野 空', 'おおの そら', '栃木県'], ['加藤 海斗', 'かとう かいと', '茨城県'],
  ['木村 陸', 'きむら りく', '群馬県'], ['工藤 森', 'くどう しん', '埼玉県'], ['小池 星', 'こいけ ほし', '千葉県'],
  ['斎藤 月子', 'さいとう つきこ', '東京都'], ['島田 風太', 'しまだ ふうた', '神奈川県'], ['杉本 雪', 'すぎもと ゆき', '長野県'],
  ['関口 雷', 'せきぐち らい', '静岡県'], ['高田 虹', 'たかだ にじ', '愛知県'], ['千葉 雲', 'ちば くも', '北海道'],
  ['土屋 霧', 'つちや きり', '青森県'], ['戸田 嵐', 'とだ あらし', '岩手県'], ['中川 波', 'なかがわ なみ', '秋田県'],
  ['西村 岬', 'にしむら みさき', '富山県'], ['野口 林', 'のぐち りん', '石川県'], ['橋本 泉', 'はしもと いずみ', '福井県'],
  ['平野 丘', 'ひらの おか', '山梨県'], ['福田 谷', 'ふくだ たに', '岐阜県'], ['堀 湖', 'ほり みずうみ', '三重県'],
  ['松田 島', 'まつだ しま', '滋賀県'], ['三浦 浜', 'みうら はま', '京都府'], ['村上 岩', 'むらかみ いわ', '大阪府'],
  ['森田 砂', 'もりた すな', '兵庫県'], ['山口 石', 'やまぐち いし', '奈良県'], ['吉田 草', 'よしだ くさ', '福岡県']
];

function makeWorld() {
  const env = loadGas({ props: { ROSTER_SPREADSHEET_ID: 'roster', ADMIN_PASSWORD: 'pw' } });
  const form = env.roster.insertSheet('フォームの回答 1');
  form.data = [FORM_HEADERS].concat(FAKE.map((p, i) =>
    ['2026/11/12', p[0], p[1], '', '', '', '', p[2], '', '参加', '同意', '', 'ABCD'[i % 4]]));
  const g = env.ctx;
  g.setup();
  const tok = g.adminLogin('pw').data.token;
  g.adminImportRoster(tok);
  // 3/4 の人が来場、半分くらいが自己紹介を入力
  const ids = JSON.parse(JSON.stringify(g.adminGetOverview(tok).data.participants)).map(p => p.id);
  ids.forEach((id, i) => {
    if (i % 4 !== 3) g.selectSelf(id);
    if (i % 2 === 0) g.saveIntro(id, { sports: ['バスケ'], comment: 'ラーメンが好き', nickname: '', snsConsent: '顔OK' });
  });
  return env;
}

let env = makeWorld();
let failNext = 0; // 次の何回かを通信失敗にする(/fail?n=1)

function page() {
  let html = fs.readFileSync(path.join(SRC, 'admin.html'), 'utf8');
  html = html.replace(/<\?!=\s*basketballCore\s*\?>/g, require(path.join(SRC, 'core_basket.js')).basketballRoundScores.toString());
  html = html.replace(/<\?!=\s*include\('([\w-]+)'\)\s*\?>/g, (_, f) => fs.readFileSync(path.join(SRC, f + '.html'), 'utf8'));
  const shim = `<script>
  (function () {
    function runner(ok, ng) {
      return new Proxy({}, { get: function (_, name) {
        if (name === 'withSuccessHandler') return function (f) { return runner(f, ng); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch('/api/' + name, { method: 'POST', body: JSON.stringify(args) })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (res) { ok && ok(res); })
            .catch(function (e) { ng && ng(e); });
        };
      } });
    }
    window.google = { script: { run: runner(null, null) } };
  })();
  </script>`;
  return html.replace('<head>', '<head>' + shim);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/phone') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888"><iframe id="phone" src="/" style="width:390px;height:844px;border:0;display:block"></iframe>');
    return;
  }
  if (url.pathname === '/' || url.pathname === '/admin') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page());
    return;
  }
  if (url.pathname === '/reset') { env = makeWorld(); res.end('reset'); return; }
  if (url.pathname === '/fail') { failNext = Number(url.searchParams.get('n') || 1); res.end('fail ' + failNext); return; }
  if (url.pathname.startsWith('/api/') && req.method === 'POST') {
    const fn = url.pathname.slice(5);
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => setTimeout(() => {
      if (failNext > 0) { failNext--; res.writeHead(500); res.end('fail'); return; }
      if (typeof env.ctx[fn] !== 'function' || fn.endsWith('_')) { res.writeHead(404); res.end('no function'); return; }
      try {
        const out = env.ctx[fn].apply(null, JSON.parse(body || '[]'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out === undefined ? null : out));
      } catch (e) {
        res.writeHead(500); res.end(String(e && e.stack || e));
      }
    }, DELAY));
    return;
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log('admin preview: http://localhost:' + PORT + '/  (password: pw)'));
