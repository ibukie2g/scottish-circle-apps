// A案(GAS)から B案(Supabase)へ引っ越す。伊吹のパソコンで実行する(設計.md の「6.」)
//
//   1回目(確かめるだけ。何も書きこまない):
//     node scripts/import-from-a.mjs a-export.json
//   2回目(入れる。--only で A のグループIDを選ぶ):
//     node scripts/import-from-a.mjs a-export.json --only G001,G002 --yes
//
// - 秘密の鍵は .env の SUPABASE_SECRET_KEY(sb_secret_… か service_role)。VITE_ で始めない(画面に入ってしまうため)
// - **メンバーの名前は画面に出さない**(件数とグループ名だけ)
// - 同じグループ(A のグループID)を入れ直すときは、前に入れた分を消してから入れる(やり直せる)
// - 終わったら:a-export.json を消す/Supabase で秘密の鍵を作り直す/.env から鍵を消す
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { listGroups, transformA } from './transform-a.mjs';

const APP = process.env.APP_URL || 'https://scottish-circle-apps.vercel.app';
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const yes = args.includes('--yes');
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];

function readEnv() {
  const env = {};
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...env, ...process.env };
}

if (!file || !existsSync(file)) {
  console.log('使い方:node scripts/import-from-a.mjs a-export.json [--only G001,G002] [--yes]');
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
console.log(`\n書き出した日時:${data.exportedAt}  A の状態:${data.moveMode || 'ふつう'}`);
if (data.moveMode !== 'moving') console.log('⚠ A がまだ「引っ越し中」ではありません。書き出したあとに答えた人の分は移りません');

console.log('\nA のグループ(メンバーの名前は出しません)');
for (const g of listGroups(data)) {
  console.log(`  ${g.id}  ${g.name}(${g.kind})  メンバー ${g.members}人 ・ イベント ${g.events}`);
}

const { rows, groupMap, counts, warnings } = transformA(data, { only });
console.log(`\n入れるもの${only.length ? `(${only.join(', ')} だけ)` : '(全部のグループ)'}`);
console.log('  ' + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' ・ '));
if (warnings.length) {
  console.log('\n注意');
  for (const w of warnings) console.log('  - ' + w);
}

if (!yes) {
  console.log('\nまだ何も書きこんでいません。よければ、入れるグループを --only で選んで --yes をつけて、もう一度実行してください');
  console.log(`  例:node scripts/import-from-a.mjs ${file} --only ${Object.keys(groupMap).join(',')} --yes\n`);
  process.exit(0);
}

const env = readEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.log('\n.env に SUPABASE_SECRET_KEY(と VITE_SUPABASE_URL)を入れてから実行してください');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function must(p, what) {
  const { data: d, error } = await p;
  if (error) throw new Error(`${what} でエラー:${error.message}`);
  return d;
}
async function insertAll(table, list) {
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    if (chunk.length) await must(db.from(table).insert(chunk), table + ' を入れる');
  }
}

const keys = Object.keys(groupMap);
console.log('\n入れています…');
// やり直し:前に入れた同じグループを消す(メンバー・イベント・答えも一緒に消える)
await must(db.from('groups').delete().in('import_key', keys), '前に入れた分を消す');
await insertAll('groups', rows.groups);
await insertAll('members', rows.members);
await insertAll('events', rows.events);
await insertAll('candidates', rows.candidates);
for (const d of rows.decided) {
  await must(db.from('events').update({ decided_candidate_id: d.decided_candidate_id, decided_date_id: d.decided_date_id }).eq('id', d.id), '決まった日');
}
await insertAll('answers', rows.answers);
await insertAll('responses', rows.responses);
await insertAll('wanted', rows.wanted);

// 確かめ:入った件数(名前は読まない)
const back = await must(db.from('groups').select('import_key, name, token, members(count), events(count)').in('import_key', keys), '確かめ');
const links = {};
console.log('\n入りました');
for (const g of back) {
  links[g.import_key] = `${APP}/g/${g.token}`;
  console.log(`  ${g.import_key}  ${g.name}  メンバー ${g.members[0].count}人 ・ イベント ${g.events[0].count}`);
}
writeFileSync('a-import-links.json', JSON.stringify(links, null, 2));
console.log('\nA の運営の画面「3. 新しいリンク」に貼るもの(a-import-links.json にも保存しました):');
console.log(JSON.stringify(links));
console.log('\n終わったら:a-export.json を消す/Supabase で秘密の鍵を作り直す/.env から SUPABASE_SECRET_KEY を消す\n');
