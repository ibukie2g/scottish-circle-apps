# sports-day API(画面 → サーバー)

画面(HTML)から `google.script.run` で呼ぶ関数の一覧。画面を作るときはこのファイルだけを見ればよいように書いている。
シートの中身は `docs/データ設計.md`。

## 0. 共通の約束

### 呼び方
```js
google.script.run
  .withSuccessHandler(function (res) { /* res は下の形 */ })
  .withFailureHandler(function (err) { /* 通信エラー・タイムアウト。再試行ボタンを出す */ })
  .getState();
```

### 戻り値の形(すべての関数で同じ)
```js
// 成功
{ ok: true, data: { ... } }
// 失敗(サーバーが判断したエラー。withSuccessHandler に来る)
{ ok: false, error: { code: 'INVALID', message: '画面にそのまま出せる日本語' } }
```
- `withFailureHandler` に来るのは通信の失敗などだけ。その場合は「もう一度送る」ボタンを出す
- 時刻はすべて **ミリ秒の数値**(`Date.now()` と同じ単位)。`null` は「まだない」
- チームは `'A'`〜`'D'` の文字列

### エラーコード
| code | いつ | 画面ですること |
|---|---|---|
| `INVALID` | 入力の値がおかしい | message を出して直してもらう |
| `NOT_FOUND` | 参加者ID・試合IDなどが無い | 参加者なら、保存していた自分のIDを消して名前を選び直す |
| `QUIZ_MODE` | クイズ中に名前の一覧を開こうとした | 「クイズ中は名前の一覧を開けません」 |
| `NOT_QUIZ_MODE` | クイズの時間でないのに startQuiz | 待ち画面に戻る |
| `NO_QUIZ` | 問題がないのに submitQuiz | startQuiz からやり直す |
| `QUIZ_CLOSED` | 結果公開のあとに submitQuiz | 「受付は終わりました」 |
| `PREDICTION_*` | 予想できない(下の reason と同じ後半) | message を出す。`PREDICTION_CLOSED` は「予想は締め切られました」 |
| `BUSY` | 書き込みが混んでいる(20秒待っても順番が来ない) | 少し待って再送 |
| `AUTH` | 運営:パスワード違い・トークン切れ | ログイン画面に戻る |
| `FORBIDDEN` | エディタ専用の関数を画面から呼んだ | (画面からは呼ばない) |
| `SETUP` | シートやスクリプト プロパティが未設定 | 運営に知らせる |
| `INTERNAL` | 想定外のエラー | message を出して再試行 |

### 負荷についての約束(30人同時)
- `getState` は **4秒ごと**に呼ぶ。人ごとに最初の呼び出しを 0〜4秒ランダムにずらす。サーバーは10秒キャッシュしている
- クイズは `startQuiz` で問題をまとめて受け取り、答えは端末に置いておき、最後に `submitQuiz` を **1回だけ** 呼ぶ(失敗したら再送ボタン。再送しても二重にならない)
- 画面がバックグラウンドから戻ったとき(`visibilitychange`)は、すぐ `getState` を呼び直す

### URL
| URL | 画面 |
|---|---|
| `…/exec` | 参加者画面(participant.html) |
| `…/exec?team=A` | 参加者画面。最初からチームAの名前一覧を出す(チームごとのQRコード用) |
| `…/exec?page=admin` | 運営画面(admin.html) |

参加者画面のテンプレートでは、サーバーが検証したチームが変数 `team`(`'A'`〜`'D'` か `''`)で使える:
```html
<script>var TEAM = '<?!= team ?>';</script>
```
HTMLを別ファイルに分けるときは `<?!= include('ファイル名') ?>` で読み込める(拡張子 .html なし)。

---

## 1. 参加者の画面

参加者は自分の **参加者ID**(`'P01'` など)を端末の localStorage に覚えておき、以降の関数に渡す。

### getState()
画面の状態。**4秒ごと**に呼び、`mode` に合わせて画面を切り替える。
```js
data = {
  mode: '待ち' | '予想' | 'クイズ' | '結果待ち' | '結果公開',
  currentEvent: 'バスケ',          // 今の種目(空文字あり)
  nextEvent: 'バド+ドッジ',        // 次の種目(空文字あり)
  updatedAt: 1764000000000 | null, // 状態を最後に変えた時刻
  serverNow: 1764000001234,        // サーバーの今の時刻(端末の時計とのずれを直すのに使う)
  sportsHidden: false,             // true = 運動の点数を隠している(バレーの準決勝 V-SF1・V-SF2 が両方確定したあと)
  sports: null | [                 // 運動の点数だけ(仲良しポイントは含めない)。A,B,C,D の順。sportsHidden のときは null
    { team: 'A', basketball: 10, badminton: 7, dodgeball: 4, volleyball: 28,
      sportsTotal: 49, sportsRank: 1 },
    ...
  ],
  prediction: null | {             // mode が '予想' のときだけ。予想する試合(点数は入れない)
    id: 'V-SF1', sport: 'バレー', round: '準決勝①', team1: 'A', team2: 'B',
    status: '予定' | '確定',
    predictionStatus: 'なし' | '受付前' | '受付中' | '公開', related: ''
  },
  quiz: null | {                   // mode が 'クイズ' のときだけ
    startedAt: 1764000000000,      // 運営が「クイズ開始」を押した時刻
    nameEndsAt: 1764000120000,     // 名前の問題の締め切り = startedAt + 120秒
    originEndsAt: 1764000135000,   // 出身地の問題の締め切り = nameEndsAt + 15秒
    nameSeconds: 120, originSeconds: 15
  },
  results: null | {                // mode が '結果公開' のときだけ。総合結果と内訳
    teams: [
      { team: 'A',
        basketball, badminton, dodgeball, volleyball, sportsTotal, sportsRank,
        quiz: 5.7, odai: 3.1, prediction: 1.3, nakayoshiTotal: 10.1,
        total: 59.1, totalRank: 1,
        quizNameRate: 66.7 | null,   // チームの名前の平均正答率(%)。回答者なしは null
        quizOriginRate: 33.3 | null  // チームの出身地の正答率(%)
      }, ...
    ]
  }
}
```
- 点数はすべて小数第1位まで。順位は同点なら同じ数(1,1,3,4)
- 待ち画面:`currentEvent`/`nextEvent` と `sports`。「※仲良しポイントは、最後に発表!」を添える
- **点数を隠す**(2026-11-13):バレーの準決勝2試合が確定したら `sportsHidden: true`・`sports: null` になり、参加者向けのどの関数も運動の点数・順位・試合の点数を返さない。待ち画面は「ここからの点数はひみつ!」。結果公開で `results` に出る
- バスケ・ドッジの順位点は全試合が確定するまで0、バドは決勝・3位決定戦が確定したところから入る

### listTeamMembers(team)
名前を選ぶ画面。チームのメンバー一覧。**クイズ中(mode='クイズ')はエラー `QUIZ_MODE`**。
```js
listTeamMembers('A')
data = { team: 'A', members: [ { id: 'P01', name: '斎藤 花子', kana: 'さいとう はなこ' }, ... ] } // ひらがな順
```

### selectSelf(participantId)
名前を選んだとき。初めてならその時刻を来場時刻として記録する(何度呼んでもよい)。QRを読み直したとき、覚えているIDで呼んで本人確認にも使える。
```js
data = { id: 'P01', name: '斎藤 花子', kana: 'さいとう はなこ', team: 'A', introDone: true | false }
```
- `introDone` が false なら自己紹介の入力画面へ進める
- チームが変わっていることがある(当日のチーム変更)。表示は常にこの `team` を使う

### getIntro(participantId)
自己紹介の画面を開いたとき。
```js
data = {
  intro: null | { sport: 'バスケ', comment: 'ラーメンが好き', nickname: 'はな', snsConsent: '顔OK', updatedAt: '2026-11-20 12:00:00' },
  options: {
    sports: ['バスケ', 'バレー', 'バドミントン', 'その他', '特になし'],
    snsConsent: ['顔OK', '顔を隠せばOK', '載せない'],
    commentMax: 20, nicknameMax: 20
  }
}
```

### saveIntro(participantId, intro)
自己紹介の保存(上書き)。いつでも何度でも。
```js
saveIntro('P01', { sports: ['バスケ', 'バレー'], comment: 'ラーメンが好き', nickname: 'はな', snsConsent: '顔OK' })
// やっていたスポーツは複数選択可(配列 sports)。「特になし」はほかと一緒に選べない。
// 保存・取得のときの sport は「バスケ・バレー」のように「・」でつないだ文字列になる。旧形式 { sport: 'バスケ' } も受け付ける
// 写真のSNS掲載(snsConsent)の画面の文言は「顔が写っていてもOK/顔を隠せばOK/載せないでほしい」。送る値は '顔OK' / '顔を隠せばOK' / '載せない'
data = { saved: true }
```
- `sport`:options.sports のどれか(必須)
- `comment`:必須、20字まで(「思いつかなければ好きな食べ物でOK」と添える)
- `nickname`:任意(空文字可)、20字まで
- `snsConsent`:options.snsConsent のどれか(必須)。質問文「写真をサークルのSNS(インスタなど)に載せてもいいですか？」
- 違反は `INVALID`(message にどれがだめか)

### getPrediction(participantId, matchId?)
予想の画面。`matchId` を省くと、状態の「予想の試合ID」(= getState().prediction.id)。mode が '予想' の間、getState と一緒に4秒ごとに呼んでよい(10秒キャッシュ)。
```js
data = {
  match: null | { id, sport, round, team1, team2, status, predictionStatus, related }, // 点数は入れない
  myTeam: 'C',
  canPredict: true | false,       // いま予想(または変更)できるか
  reason: null | 'NO_MATCH' | 'TEAMS_UNKNOWN' | 'PLAYING' | 'NOT_OPEN' | 'CLOSED',
  myChoice: null | 'A',           // 自分の予想
  revealed: true | false,         // 締め切られて、人数の集計を見せてよいか
  teams: null | [                 // 予想した2チームの人数だけの集計(revealed のときだけ。自分のチームが先)
    { team: 'C', counts: [ { team: 'A', count: 4 }, { team: 'B', count: 2 } ] },
    { team: 'D', counts: [ { team: 'A', count: 1 }, { team: 'B', count: 5 } ] }
  ],
  counts: null | [ ... ],         // teams のうち自分のチームの counts(前の形との互換用)
  hit: null | {                   // 的中率(%)。試合が確定してから。どちらが勝ったかは返さない
    overall: 41.7,                // 2チーム合計
    teams: [ { team: 'C', rate: 66.7, predicted: 6 }, { team: 'D', rate: 16.7, predicted: 6 } ] // 予想者なしは rate: null
  },
  progress: { predicted: 6, arrived: 8 } // 自分のチームの来場者のうち予想した人数
}
```
| reason | 意味 | 画面 |
|---|---|---|
| `PLAYING` | 自分のチームの試合 | 予想画面を出さず待ち画面のまま |
| `NOT_OPEN` | 受付前 | 「まもなく受付」 |
| `CLOSED` | 締め切った(運営が締め切ったか、点数が確定した) | teams を表示。確定後は hit も |
| `TEAMS_UNKNOWN` / `NO_MATCH` | 対戦が未定・試合がない | 待ち画面 |

- **締め切るまで、人数の内訳はだれにも返さない**(`teams`・`counts` は null)。チーム全員がそろっても自動では公開しない(2026-11-13)
- 予想したら「あなたは🔴Aの勝ちを予想しました!応援しよう!」(`myChoice`)。締め切りまで何回でも変えられる

### submitPrediction(participantId, matchId, winnerTeam, seq?)
予想を送る。締め切るまでは何度でも上書きできる。
```js
submitPrediction('P06', 'V-SF1', 'A', Date.now())
data = (getPrediction と同じ形。送ったあとの最新)
```
- `seq`:端末で押した時刻(ミリ秒)。前に受け取った番号より古い送信は、書かずに今の状態を返す(素早く変えたとき、遅れて届いた古い送信で上書きしないため)。省くと必ず上書き
- 画面側は、送信を1本ずつにする(送っている間に押したものは、前の送信が終わってから送る)
- できないときは `PREDICTION_PLAYING` / `PREDICTION_NOT_OPEN` / `PREDICTION_CLOSED` / `PREDICTION_TEAMS_UNKNOWN` / `PREDICTION_NO_MATCH`
- `winnerTeam` が対戦チームでなければ `INVALID`

### startQuiz(participantId)
クイズ画面を開いたとき(mode が 'クイズ' になったとき)に1回呼ぶ。自分用の問題をまとめて返す。mode が 'クイズ' 以外なら `NOT_QUIZ_MODE`。
```js
data = {
  alreadyAnswered: false,
  timing: { startedAt, nameEndsAt, originEndsAt, nameSeconds, originSeconds }, // getState().quiz と同じ
  serverNow: 1764000005000,
  names: {
    count: 7,                       // 書くべき人数(チームで来場している自分以外)
    hints: [                        // count 個。順番はランダム(誰のヒントかは分からない)
      { sport: 'バスケ', comment: 'ラーメンが好き' },
      null,                         // 自己紹介がない人はヒントなし
      ...
    ]
  },
  origin: null | {                  // 出身地の4択。対象がいなければ null(この問題はとばす)
    targetName: '渡辺 太郎',          // 「〇〇さんの出身地は？」
    choices: ['宮城県', '山形県', '福島県', '岩手県']
  }
}
// すでに送っていたとき(画面の開き直し)
data = { alreadyAnswered: true, result: (submitQuiz の data と同じ形) }
```

**クイズの進み方(全員同時)**
1. 名前の問題:`nameEndsAt` まで。入力欄に `names.count` 人分の欄と、`names.hints` を「スポーツ/ひとこと」で並べる(ヒントはどの欄の人かは対応しない)。あだ名は出さない。漢字・ひらがな・カタカナどれでもよい
2. 本人が「次へ」を押すか `nameEndsAt` になったら、出身地の問題へ。出身地の問題は `originEndsAt` まで(`origin` が null なら飛ばす)
3. 本人が選ぶか `originEndsAt` になったら、`submitQuiz` を呼ぶ(時間切れで未選択なら `origin: ''`)
- 時間は **各自の開始からではなく、運営が「クイズ開始」を押した時刻が基準**。残り時間は `nameEndsAt - (Date.now() + (serverNow - 受け取った時の Date.now()))` のように、サーバー時刻とのずれを直して数える
- 途中で開いた人は、残り時間だけになる(締め切り後に開いた人も、送信は受け付ける)
- `targetName`(出身地の対象者の名前)は、名前の問題が終わるまで画面に出さない
- 答えは端末(localStorage)に置いておき、送信が失敗したら再送ボタン

### submitQuiz(participantId, answers)
クイズの答えをまとめて1回送る。判定して、本人用の答え合わせを返す。**再送しても最初の答えのまま**(二重にならない)。mode が '結果公開' になったあとは `QUIZ_CLOSED`。
```js
submitQuiz('P01', { names: ['さいとうはなこ', '渡辺太郎', ''], origin: '宮城県' })
data = {
  total: 7,              // 書くべき人数
  correctCount: 5,       // 書けた人数(「7人中5人書けた!」)
  pendingCount: 1,       // 「惜しい」で運営が確認中の人数
  members: [             // 書けなかった人が先。あだ名は答え合わせでだけ出す
    { name: '高橋 健', kana: 'たかはし けん', nickname: 'けんけん', written: false, pending: true },
    { name: '斎藤 花子', kana: 'さいとう はなこ', nickname: '', written: true, pending: false },
    ...
  ],
  origin: null | { targetName: '渡辺 太郎', answer: '宮城県', yourAnswer: '山形県', correct: false }
}
```
- 書けなかった人は「〇〇さん(ひらがな)を覚えよう!」のように出す。`pending: true` は「確認中」と出してよい
- 個人の正答率(%)は出さない
- 判定:スペース・全角半角・カタカナ/ひらがな・よくある異体字(斎/齋/齊、辺/邊/邉、高/髙、崎/﨑 など)の違いは無視。名字+名前のフルネームで正解。同じ人を2回書いても1回分

### getQuizResult(participantId)
答え合わせを取り直す(画面の開き直し・運営が惜しい答えを判定したあと)。
```js
data = { answered: true | false, result: null | (submitQuiz の data と同じ形) }
```

### submitSurvey(survey, participantId)
アンケート(運営だけが見る。名前は保存せず参加者IDだけ。2026-11-11 に匿名をやめた)。二重送信は端末側で防ぐ(送ったら localStorage に記録)。名前を選んでいない端末は participantId を空にする。
```js
submitSurvey({ fun: 5, talked: 4, again: 'はい', comment: '楽しかった' }, 'P07')
data = { saved: true }
```
- `fun`(今日は楽しかったですか？)・`talked`(普段あまり話さない人と話せましたか？):1〜5 の整数
- `again`(またこういうイベントがあったら参加したいですか？):`'はい'` か `'いいえ'`
- `comment`:任意、1000字まで

---

## 2. 運営の画面

最初に `adminLogin` でトークンを受け取り、sessionStorage に置いて、以降すべての関数の **第1引数** に渡す。トークンは最後に使ってから6時間有効。`AUTH` が返ったらログインし直す。

### adminLogin(password)
```js
data = { token: 'xxxxxxxx-...', expiresInSec: 21600 }
```

### adminGetOverview(token)
運営画面を開いたとき・タブを切り替えたときにまとめて取得する。
```js
data = {
  state: {
    mode, currentEvent, nextEvent, predictionMatchId: 'V-SF1' | '',
    predictionOpenedAt: ms | null, // 予想の受付を始めた時刻(経過時間の表示に使う)
    quizStartedAt: ms | null, updatedAt: ms | null,
    quiz: null | { startedAt, nameEndsAt, originEndsAt, nameSeconds, originSeconds },
    modes: ['待ち', '予想', 'クイズ', '結果待ち', '結果公開']
  },
  participants: [ // チーム順 → ひらがな順
    { id: 'P01', name: '斎藤 花子', kana: 'さいとう はなこ', team: 'A',
      arrivedAt: ms | null, walkIn: false, quizInclude: true,
      introDone: true, quizAnswered: false }, ...
  ],
  matches: [ { id, sport, round, team1, team2, score1, score2, status, predictionStatus, related }, ... ], // 18試合
  settings: [ { key: '順位点', value: '10,7,4,2', description: '...' }, ... ],
  pendingNearMisses: 2, // 未判定の惜しい答えの数
  serverNow: ms
}
```

### adminSetState(token, patch)
状態の切り替え。渡した項目だけ変える。
```js
adminSetState(token, { mode: '待ち', currentEvent: 'バスケ', nextEvent: 'バド+ドッジ', predictionMatchId: 'V-SF1' })
data = (adminGetOverview の state と同じ形)
```
- `mode: 'クイズ'` にすると `adminStartQuiz` と同じ(開始時刻を今にして問題を作る)。ふつうは adminStartQuiz を使う
- `predictionMatchId` は存在する試合IDか `''`

### adminGetMatches(token)
```js
data = { matches: [ ...18試合 ] }
```

### adminSaveMatch(token, matchId, score1, score2)
点数を入れて確定する。確定済みの修正も同じ関数。
```js
adminSaveMatch(token, 'V-SF1', 25, 20)
data = {
  match: { ...確定後の試合 },
  changes: [ { id: 'V-F', team1: 'A', team2: 'C' }, { id: 'V-3RD', team1: 'B', team2: 'D' } ], // 自動で埋めた組み合わせ
  teams: [ ...集計(adminGetScores の teams と同じ形、ただし率なし) ],
  predictionClosed: true | false // 予想が受付中だったので、自動で締め切った
}
```
- 点数は0以上の数。バド・バレーは引き分け不可(`INVALID`)。対戦チームが未定なら `INVALID`
- バスケは前半+後半(クイズ)の合計を入れる
- 準決勝が2試合確定すると、決勝・3位決定戦・ドッジ(G-3, G-4)のチームが自動で入る

### adminUnconfirmMatch(token, matchId)
確定を取り消して「予定」に戻す(点数は残る)。`data = { match, teams }`

### adminSetMatchTeams(token, matchId, team1, team2)
対戦チームを手で直す。`data = { match }`

### adminSetPredictionStatus(token, matchId, status)
予想の受付。`status`:
- `'受付中'`:受付開始。**あわせて mode を '予想'、予想の試合IDをこの試合にし、受付開始時刻を記録する**(「受付中に戻す」では開始時刻を変えない)
- `'公開'`:締め切り。予想した2チームに人数の集計が見えるようになり、変更できなくなる。**全員がそろっても自動では締め切らない**。受付中のまま adminSaveMatch で点数を確定すると、自動で締め切る
- `'受付前'` / `'なし'`:戻す

試合が終わったら mode を `'待ち'` に戻すのは adminSetState で。
```js
data = (adminGetPredictionSummary と同じ形)
```

### adminGetPredictionSummary(token, matchId?)
予想の集まり具合。matchId を省くと状態の予想の試合ID。
```js
data = {
  match: { ... },
  closed: false,                 // 締め切ったか
  openedAt: ms | null,           // 受付を始めた時刻(状態の予想の試合IDがこの試合のとき)
  teams: [ // 試合に出ていない2チーム
    { team: 'C', arrived: 8, predicted: 6, complete: false,
      counts: null | [ { team: 'A', count: 4 }, { team: 'B', count: 2 } ] }, ... // 締め切るまで counts は null(運営にも内訳は見せない)
  ],
  hit: null | { overall: 41.7, teams: [ { team: 'C', rate: 66.7, predicted: 6 }, ... ] } // 試合が確定してから
}
```
- 締め切り前に運営画面でも内訳を見たいときは、`api_admin.js` の `PREDICTION_ADMIN_SEES_COUNTS` を true にする

### adminStartQuiz(token, options?)
クイズ開始:mode を 'クイズ'、クイズ開始時刻を今にして、全員分の問題を作る(すでに作った人の問題はそのまま)。もう一度押すと開始時刻が今になる(やり直し)。
```js
adminStartQuiz(token)                        // ふつう
adminStartQuiz(token, { regenerate: true })  // まだ答えていない人の問題を作り直す(チーム変更のあとなど)
data = { generated: 30, kept: 0, state: { ... } }
```
- 名前の対象は「チームで来場している自分以外」。来場記録のない人は対象外なので、スマホがない人は先に adminSetArrived で来場にしておく
- クイズが終わったら adminSetState で mode を '結果待ち' にする

### adminGetQuizStatus(token)
```js
data = { teams: [ { team: 'A', members: 8, arrived: 8, answered: 6, nameRate: 71.4 | null, originRate: 50 | null, points: 6.5 }, ... ] }
```

### adminListNearMisses(token, includeJudged?)
惜しい答えの一覧(未判定のみ。`includeJudged=true` なら判定済みも)。
```js
data = { items: [
  { number: 3, participantId: 'P01', participantName: '斎藤 花子', team: 'A',
    input: 'たかはしけ' | null,   // 書かれた名前。6時間たった・判定済み・キャッシュが消えたときは null(「入力は表示できません」と出す)
    candidateId: 'P03', candidateName: '高橋 健', candidateKana: 'たかはし けん',
    judgement: '未' | 'OK' | 'NG' }, ...
] }
```

### adminJudgeNearMiss(token, number, decision)
`decision` は `'OK'` か `'NG'`。OK ならその人のクイズの正解に足して正答率を計算し直す。判定済みを逆にすることもできる。
```js
data = { number: 3, judgement: 'OK' }
```

### adminGetOdai(token)
```js
data = {
  rows: [ { number: 1, theme: '好きな果物', team: 'A', matched: 6, answered: 8 }, ... ],
  defaultAnswered: { A: 8, B: 7, C: 8, D: 7 } // 「答えた人数」の初期値(チームの来場人数)
}
```

### adminSaveOdai(token, input)
お題カード1枚・1チーム分(お題番号+チームが同じなら上書き)。
```js
adminSaveOdai(token, { number: 1, theme: '好きな果物', team: 'A', matched: 6, answered: 8 })
data = { saved: true, teams: [ ...集計 ] }
```
- `matched` ≤ `answered`。`theme` は省略可(省くと前の値のまま)

### adminImportRoster(token, options?)
名簿の「チーム」列が入っている人に参加者IDを採番して、参加者シートに追加する。何度押してもよい。
```js
adminImportRoster(token)                          // すでにいる人のチームは変えない
adminImportRoster(token, { overwriteTeams: true }) // 名簿のチームで上書きする
data = {
  assignedIds: 3,        // 新しく採番した人数
  added: 3,              // 参加者シートに足した人数
  teamUpdated: 0,
  teamDiffs: [ { id: 'P05', appTeam: 'B', rosterTeam: 'C' } ], // 名簿とアプリでチームが違う人(上書きしなかった)
  totalWithTeam: 30
}
```

### adminAddWalkIn(token, input)
当日追加。名前などは名簿ファイルの「当日追加」シートに書き、来場済みとして参加者に足す。
```js
adminAddWalkIn(token, { name: '小林 七子', kana: 'こばやし ななこ', team: 'B', origin: '群馬県' })
data = { id: 'P31', team: 'B' }
```
- `name`・`kana`・`team` は必須。名字と名前の間にスペースを入れる。`origin` は任意(都道府県名。「群馬」でも可)

### adminChangeTeam(token, participantId, team)
### adminSetQuizInclude(token, participantId, include)
### adminSetArrived(token, participantId, arrived)
参加者の変更(アプリ用の参加者シートだけ。名簿のチーム列は変えない)。
```js
data = { id: 'P05', updated: ['チーム'] }
```
- `include`:true/false。途中参加などでクイズの平均から外すとき false
- `arrived`:true で来場時刻を今に、false で消す

### adminGetScores(token)
集計(集計シートも書き直す)。結果発表の読み上げ用。
```js
data = {
  teams: [ { team, basketball, badminton, dodgeball, volleyball, sportsTotal, sportsRank,
             quiz, odai, prediction, nakayoshiTotal, total, totalRank,
             quizNameRate, quizOriginRate }, ... ],              // A〜D の順
  sportsRanking: [ { team: 'A', rank: 1, points: 49 }, ... ],    // 運動だけの順位(仲良しポイントを足す前)
  totalRanking: [ { team: 'C', rank: 1, points: 60.2 }, ... ],   // 仲良しポイント込みの順位
  standings: {
    basketball: { complete, standings: [ { team, wins, diff, played, rank } ], points: { A: 10, ... } },
    dodgeball:  { complete, standings: [ ... ], points: { ... } },
    badminton:  { complete, ranks: { A: 1 | null, ... }, points: { ... } },
    volleyball: { complete, scored: { A: 50, ... }, wins: { A: 2, ... }, points: { ... } }
  }
}
```
- 読み上げ:`sportsRanking` →(仲良しポイントの内訳)→ `totalRanking` の順に見せる。4位から出すなら配列を逆から

### adminPublishResults(token)
結果を全員のスマホに公開する(mode を '結果公開' に)。`data = (state)`

### adminGetSettings(token) / adminSaveSettings(token, values)
配点・制限時間の変更。
```js
adminSaveSettings(token, { 'バレー勝ちボーナス': 5, '順位点': '10,7,4,2' })
data = { rows: [ { key, value, description } ], parsed: { rankPoints: [10,7,4,2], volleyWinBonus: 5, quizNameMax: 7,
         quizOriginMax: 3, odaiAllMatch: 2, odaiFactor: 1.5, predictionMax: 2, quizNameSeconds: 120, quizOriginSeconds: 15 } }
```
キー:`順位点` / `バレー勝ちボーナス` / `クイズ:名前の満点` / `クイズ:出身地の満点` / `お題カード:全員一致の点` / `お題カード:それ以外の係数` / `予想:1試合の満点` / `クイズ:名前の制限時間(秒)` / `クイズ:出身地の制限時間(秒)`(「:」は半角)。知らないキーは `INVALID`。

---

## 3. エディタから実行する関数(画面からは呼ばない)
| 関数 | すること |
|---|---|
| `setup()` | シートを作る(何度実行してもよい) |
| `importRosterFromEditor()` | 名簿の読み込み(adminImportRoster と同じ。チームは上書きしない) |
