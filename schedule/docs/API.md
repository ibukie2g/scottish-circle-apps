# schedule API(画面 → サーバー)案

作成:2026-11-27(Claude、同日 伊吹確認)。画面(HTML)から `google.script.run` で呼ぶ関数の一覧。画面を作るときはこのファイルだけを見ればよいように書く。
シートの中身は `docs/データ設計.md`。

## 0. 共通の約束(sports-day と同じ)

### 戻り値の形
```js
{ ok: true, data: { ... } }                                   // 成功
{ ok: false, error: { code: 'INVALID', message: '画面にそのまま出せる日本語' } }  // サーバーが判断したエラー
```
- `withFailureHandler` に来るのは通信の失敗だけ。その場合は「もう一度送る」ボタンを出す
- 時刻はミリ秒の数値。日付は `'2026-12-15'`、時刻は `'19:00'` の文字列
- 答えは `'○' | '△' | '×'`

### エラーコード
| code | いつ | 画面ですること |
|---|---|---|
| `INVALID` | 入力の値がおかしい | message を出す |
| `NOT_FOUND` | 合言葉・イベント・メンバーが無い | 参加者なら、覚えていた自分のメンバーIDを消して選び直す。合言葉が無いときは「リンクが正しくないか、終わったグループです」 |
| `CLOSED` | 締め切りを過ぎた/イベントが終了した | 「締め切りを過ぎたので変えられません」 |
| `BUSY` | 書き込みが混んでいる | 少し待って再送 |
| `AUTH` | 運営:パスワード違い・トークン切れ | ログイン画面に戻る |
| `SETUP` | スクリプト プロパティ・シートが無い | 運営に知らせる |
| `INTERNAL` | 想定外 | message を出して再試行 |

### URL
| URL | 画面 |
|---|---|
| `…/exec?g=<合言葉>` | 参加者画面。そのグループのイベント一覧(1回きりのグループなら、そのイベントを直接開く) |
| `…/exec?g=<合言葉>&e=<イベントID>` | 参加者画面。そのイベントを直接開く(LINEでイベントごとに送る用) |
| `…/exec?page=admin` | 運営画面(パソコン前提) |

### 端末が覚えること(localStorage)
| キー | 中身 |
|---|---|
| `sch.me.<グループID>` | そのグループでの自分のメンバーID |
| `sch.name` | 前に入れた表示名(別のグループに初めて入るとき、名前の欄に最初から入れておく) |

- ほかのグループのメンバーの名前は端末にもサーバーからも出さない

---

## 1. 参加者

### `openGroup(token, memberId)`
リンクを開いたとき。`memberId` は端末が覚えているもの(無ければ空)。
```js
data = {
  group: { id: 'G001', name: 'スコティッシュサークル', kind: 'サークル' | 'グループ' | '1回きり', mascot: true },
  me: { memberId: 'M005', name: '大野 美咲' } | null,   // memberId が正しければ自分。違えば null(→ 選び直し)
  events: [ { id, name, status, deadline, decided: { date, time } | null, myAnswered: true } ]  // 答えていないものが先
}
```

### `listMembers(token)`
「自分を選ぶ」画面用。サークルは名簿の名前(ふりがな順・学年つき)、それ以外は表示名。
```js
data = { members: [ { memberId: 'M005', name: '大野 美咲', kana: 'おおの みさき', grade: '1年' } ] }  // kana/grade はサークルだけ
```

### `joinGroup(token, input)`
一覧に自分がいないとき、自分で加わる。
- サークル:`input = { name, kana, grade, gender }` → 名簿ファイルの「出欠アプリ登録」に書き、メンバーに足す
- それ以外:`input = { name }`(表示名。1〜20文字)
```js
data = { memberId: 'M021', name: 'たろう' }
```
- 同じ名前の人がすでにいるときは `INVALID`(「同じ名前の人がいます。一覧から選ぶか、名前を少し変えてください」)

### `getEvent(token, eventId, memberId)`
```js
data = {
  event: { id, name, description, place, cost, url, status, deadline, visibility: '名前' | '人数' | '伊吹だけ' },  // description/place/cost/url は決まっているものだけ(空文字なら画面に出さない)
  candidates: [ { id: 'C01', date: '2026-12-15', time: '19:00', memo: '' } ],
  mine: { answers: { C01: '○', C02: '△' }, comment: '', attendance: { status, course, comment } | null },
  results: null | {                       // visibility が「伊吹だけ」なら null
    answeredCount: 18, memberCount: 26,   // memberCount はサークルだけ(それ以外は null)
    byDate: [ { candidateId: 'C03', o: 14, t: 3, x: 1,
                names: { o: ['青木', ...], t: [...], x: [...] } | null } ],  // names は visibility が「名前」のときだけ。多い順に並べる
    attendance: { go: 12, partial: 2, no: 5, names: {...} | null } | null   // 出欠確認中のとき
  }
}
```

### `submitAnswers(token, eventId, memberId, answers, comment)`
日程調整の ○△× を送る。`answers = { C01: '○', C02: '×' }`(全部の候補日を送る。空は「未回答」)。送り直したら上書き。締め切り後は `CLOSED`。
```js
data = { savedAt }   // 画面は getEvent を呼び直して結果を更新する
```

### `submitAttendance(token, eventId, memberId, input)`
出欠確認中のイベントで。`input = { status: '行く' | '行かない' | '途中から', comment }`(コースは最初は使わない)
```js
data = { savedAt }
```

---

## 2. 運営(すべて `token` は adminLogin でもらう運営用トークン)

| 関数 | すること | 返すもの |
|---|---|---|
| `adminLogin(password)` | ログイン | `{ token }`(6時間有効) |
| `adminListGroups(token)` | グループとイベントの一覧(管理ファイルの控えから。軽い) | グループごとに、未回答の多いイベント・締め切りが近いイベント |
| `adminCreateGroup(token, { name, kind, mascot })` | グループを作る。**グループのファイルを自動で作る**。サークルなら名簿の全員をメンバーに入れる | `{ groupId, link }` |
| `adminCreateEvent(token, groupId, { name, description, place, cost, url, visibility, deadline, candidates: [{ date, time, memo }] })` | イベントを作る。1回きりの種類を選んだら、グループとイベントを一度に作る | `{ eventId, link }` |
| `adminAddCandidates(token, eventId, candidates)` | 候補日を足す | 候補日の一覧 |
| `adminRemoveCandidate(token, eventId, candidateId)` | 候補日を消す(答えも消える。確認を出してから呼ぶ) | 候補日の一覧 |
| `adminUpdateEvent(token, eventId, patch)` | 名前・説明・場所・お金の目安・リンク・締め切り・結果の見せ方を変える(あとから決まったら足せる) | イベント |
| `adminGetResults(token, eventId, filter)` | 結果を全部見る。`filter = { grade, gender }`(サークルだけ) | 下の形 |
| `adminSetWanted(token, eventId, memberIds)` | 来てほしい人の印 | 来てほしい人の一覧 |
| `adminDecide(token, eventId, candidateId)` | 日にちを決めて「出欠確認中」にする(○→行く、×→行かない を仮に入れる) | イベント |
| `adminSetPaid(token, eventId, memberId, paid)` | 会費の受け取り(**最初は作らない**。場所・お金の連絡はLINE) | 出欠の一覧 |
| `adminSetAnswer(token, eventId, memberId, answers)` | 運営が代わりに入れる(LINEで答えが来た人など。締め切り後も可) | |
| `adminCloseEvent(token, eventId)` | 終了にする | |
| `adminArchiveGroup(token, groupId)` | 一覧からしまう(ファイルは残す) | |

### `adminGetResults` の形
```js
data = {
  byDate: [ { candidateId, date, time, o, t, x,
              names: { o: [...], t: [...], x: [...] },
              wanted: { ok: ['青木'], maybe: [], ng: ['石井'], none: [] } } ],   // 来てほしい人がその日来られるか
  unanswered: [ { memberId, name } ],           // サークルは名簿の全員から。それ以外は「メンバー」にいて答えていない人
  remindText: '【忘年会の日程】まだの人お願いします🙏\n〇〇さん、△△さん…\n締め切り 12/5(金)\n<リンク>',  // LINEに貼る用
  attendance: { rows: [ { memberId, name, status, course, paid, comment } ], totals: { go, partial, no, byCourse: {...}, paid } } | null
}
```

---

## 3. 純粋な処理(core_*.js。GASに依存しない。Node.js でテストし、Bでもそのまま使う)
| 関数 | すること |
|---|---|
| `summarize(candidates, answerRows, members, opts)` | 日ごとの ○△× の人数と名前、多い順の並べ替え、来てほしい人の可否 |
| `filterMembers(members, { grade, gender })` | 学年・男女の絞り込み |
| `unanswered(members, answerRows)` | 未回答の人 |
| `remindText(event, unansweredNames, link)` | 催促文を作る |
| `expandDates({ from, weekdays, weeks, time })` | 「火曜を4週分」のような候補日の一括作成 |
| `parseAnswers(str)` / `formatAnswers(obj)` | `C01:○,C02:△` の形との相互変換 |
| `presetAttendance(answers, decidedId)` | 日にちを決めたときの出欠の仮入れ |

## 4. 最初は作らないもの(あとで足す)
- コースの選択・会費の受け取り(場所・お金などの細かい連絡はLINEで流す。11/27 伊吹)
- 練習の毎週の出欠、LINEへの通知、ほかの人がグループを作る機能
