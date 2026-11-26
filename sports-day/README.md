# sports-day(合同運動会アプリ)

2026-11-24(火) スコティッシュ×バレサー 合同運動会の当日に使うWebアプリ。Google Apps Script+スプレッドシートで作る。

- 仕様書:OneDrive `Univ\スコサー\合同運動会\Webアプリ仕様書.md`
- UIの参考:同フォルダの `参考_AiCTハッカソンのUI.md`
- デプロイ:clasp で Apps Script に送る(`clasp push`)

## フォルダ
| パス | 中身 |
|---|---|
| `src/` | clasp の rootDir(ここが Apps Script に送られる) |
| `src/core_name.js` `core_pref.js` `core_score.js` | 純粋関数(名前の判定、出身地の選択肢、試合・集計)。GASにもNodeにも依存しない |
| `src/store.js` `domain.js` `roster.js` `setup.js` | シートの読み書き・キャッシュ・ロック、名簿ファイル、setup() |
| `src/api_participant.js` `api_admin.js` | 画面から google.script.run で呼ぶ関数 |
| `src/main.js` `participant.html` `admin.html` | doGet と仮の画面 |
| `docs/データ設計.md` | シートの約束 |
| `docs/API.md` | 画面から呼ぶ関数の一覧 |
| `tests/` | Node.js のテスト(`npm test` または `node --test tests/*.test.js`) |

## 最初にやること
1. Apps Script の「プロジェクトの設定 → スクリプト プロパティ」に `ROSTER_SPREADSHEET_ID`(名簿=フォームの回答スプレッドシートのID)と `ADMIN_PASSWORD` を入れる
2. `clasp push` → エディタで `setup` を実行(権限を許可)
3. 名簿の回答シートの右端に「チーム」列を足して A〜D を書く → エディタで `importRosterFromEditor` を実行(または運営画面から)
4. デプロイ → ウェブアプリ(次のユーザーとして実行:自分、アクセス:全員)。更新は同じデプロイを編集する
