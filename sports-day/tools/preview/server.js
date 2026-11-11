#!/usr/bin/env node
/**
 * 参加者画面のローカル確認用サーバー(src には入れない。外部ライブラリなし)
 * - src/participant.html の <?!= include('x') ?> と <?!= team ?> を GAS と同じように埋めて返す
 * - google.script.run の偽物(mock.js、架空のデータ)を先に読み込む。右下の「⚙」で mode などを切り替えられる
 *
 * 使い方: cd sports-day && node tools/preview/server.js  → http://localhost:8790/?team=A
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const PORT = Number(process.env.PORT) || 8790;

function include(name) {
  return fs.readFileSync(path.join(SRC, name + '.html'), 'utf8');
}

function page(team) {
  let html = include('participant');
  html = html.replace(/<\?!=\s*include\('([\w]+)'\)\s*\?>/g, (_, n) => include(n));
  html = html.replace(/<\?!=\s*team\s*\?>/g, team);
  const mock = '<script>' + fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8') + '</script>';
  return html.replace('<head>', '<head>\n' + mock);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/phone') {
    // スマホ幅(390×844)の枠に入れて見る
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888">' +
      '<iframe id="f" src="/' + url.search + '" style="width:390px;height:844px;border:0;background:#fff;display:block"></iframe>');
    return;
  }
  if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
  const t = String(url.searchParams.get('team') || '').toUpperCase();
  const team = /^[A-D]$/.test(t) ? t : '';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page(team));
}).listen(PORT, () => console.log('http://localhost:' + PORT + '/?team=A'));
