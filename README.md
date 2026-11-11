# scottish-circle-apps

スコティッシュサークル(会津大学・会津大学短期大学部)の運営で使う小さなアプリをまとめるリポジトリ。

| フォルダ | 中身 |
|---|---|
| `sports-day/` | 2026年度 スコティッシュ×バレサー 合同運動会の当日アプリ(Google Apps Script) |
| (予定)`sns-post/` | イベント後のSNS(インスタ)投稿の下書きを作り、伊吹が確認してからボタンで投稿する道具。運動会のあとに作る |

## 注意
- 個人情報(名簿・回答)はリポジトリに入れない。データはGoogleスプレッドシートにだけ置く
- 運営パスワードやスプレッドシートのIDは、Apps Scriptの「スクリプト プロパティ」に保存し、コードに書かない
- 企画資料は OneDrive の `Univ\スコサー\` にある

## sports-day の公開(Webアプリ)
- 公開ID:`AKfycbzOqG83Ph4ABN0AJUtYZNklxZqd427C2XHBJr3fVmO8UsorQvkiPQpxhk7RDV7_ZPwd`
- 参加者画面:`https://script.google.com/macros/s/<公開ID>/exec?team=A`(B・C・D も同じ形)
- 運営画面:`https://script.google.com/macros/s/<公開ID>/exec?page=admin`
- 直したあとの更新は、URLを変えないように**同じ公開IDを指定する**(QRコードを刷り直さずに済む)
  ```
  cd sports-day
  clasp push --force
  clasp deploy -i <公開ID> --description "変更の内容"
  ```
- `clasp deploy` を ID なしで実行すると、新しいURLができてしまうので注意
