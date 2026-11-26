// assets/ の画像を data URL にして src/assets.html を作る(GASのHTMLに画像を埋め込むため)
// 使い方: cd schedule && node tools/build_assets.js
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'assets');
const out = {};
fs.readdirSync(dir).sort().forEach(f => {
  const ext = path.extname(f).slice(1);
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : null;
  if (!mime) return;
  out[path.basename(f, '.' + ext)] = 'data:' + mime + ';base64,' + fs.readFileSync(path.join(dir, f)).toString('base64');
});
fs.writeFileSync(path.join(__dirname, '..', 'src', 'assets.html'),
  '<!-- 自動生成: node tools/build_assets.js(手で編集しない。元の画像は schedule/assets/) -->\n<script>\nwindow.ASSETS = ' + JSON.stringify(out, null, 2) + ';\n</script>\n');
console.log('assets.html:', Object.keys(out).join(', '));
