# schedule-web(出欠・日程調整アプリ B案)

React + Vite + TypeScript(画面)/ Supabase(データ・ログイン)。設計は [docs/設計.md](docs/設計.md)。
いま動いているのは A案(GAS)の `../schedule/`。

## いまできていること(11/28)
- 土台(Vite + React + TypeScript)
- 計算の部品 `src/core/schedule.ts`:A案の `core_schedule.js` を B案の表の形(答え = 1候補日×1人の行、英字の状態)に移したもの
- そのテスト `tests/schedule.test.ts`
- 表・鍵(RLS)・参加者用の関数 `supabase/migrations/20261128000000_init.sql`(まだ Supabase には入れていない)
- そのテスト `tests/db/rls.test.ts`:PGlite(パソコンの中の Postgres)で動かす。Docker はいらない

## 使い方
```
npm install
npm test        # 計算と、表の鍵(RLS)のテスト
npm run dev     # 画面(まだ土台だけ)
```

## 鍵の扱い
- `.env.example` を `.env` にコピーして、Supabase の URL と anon(公開してよい)鍵だけを入れる
- service_role の鍵は画面にもこのフォルダにも入れない(引っ越しスクリプト用は別。設計.md の「6.」)
