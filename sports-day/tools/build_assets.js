#!/usr/bin/env node
/**
 * assets/ の画像を data URI にして src/assets.html を作る(外部ライブラリなし)
 * GAS の HtmlService はファイルを直接配信できないので、画像は HTML に埋め込む。
 *
 * 使い方: cd sports-day && node tools/build_assets.js
 * 出力: src/assets.html(<script>window.ASSETS = { tsunaboru_normal: 'data:image/webp;base64,...', ... }</script>)
 * 画面では <?!= include('assets') ?> で読み込み、ASSETS.tsunaboru_normal のように使う。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'assets');
const OUT = path.join(ROOT, 'src', 'assets.html');
const TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
const WARN_TOTAL = 400 * 1024; // これを超えたら警告(体育館の電波を考えて軽く)

const files = fs.readdirSync(SRC_DIR)
  .filter((f) => TYPES[path.extname(f).toLowerCase()])
  .sort();

let total = 0;
const lines = files.map((f) => {
  const buf = fs.readFileSync(path.join(SRC_DIR, f));
  const key = path.basename(f, path.extname(f)).replace(/[^A-Za-z0-9_]/g, '_');
  const uri = 'data:' + TYPES[path.extname(f).toLowerCase()] + ';base64,' + buf.toString('base64');
  total += uri.length;
  console.log(key.padEnd(20) + String(buf.length).padStart(8) + ' bytes');
  return '  ' + JSON.stringify(key) + ': ' + JSON.stringify(uri);
});

const html = '<!-- 自動生成: node tools/build_assets.js(手で編集しない。元の画像は sports-day/assets/) -->\n' +
  '<script>\nwindow.ASSETS = {\n' + lines.join(',\n') + '\n};\n</script>\n';
fs.writeFileSync(OUT, html);
console.log('-> ' + path.relative(ROOT, OUT) + ' (' + Math.round(total / 1024) + ' KB, ' + files.length + ' files)');
if (total > WARN_TOTAL) console.warn('注意: 画像の合計が ' + Math.round(WARN_TOTAL / 1024) + 'KB を超えています。画像を小さくしてください');
