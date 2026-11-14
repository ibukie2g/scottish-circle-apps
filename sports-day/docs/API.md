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
同じように「ひとこと」(ひとことシートで「使う」に○があるもの)が変数 `tips`(JSON の文字列)で使える:
```html
<script>var TIPS = <?!= tips ?>;</script>
<!-- TIPS = [ { text: '水分補給、忘れずに💧', mode: 'いつでも' | '待ち' | '予想' | 'クイズの前' | '結果公開' }, ... ] -->
```
- 読み込み中は、つなぼるが跳ねるアニメーション + その下に「💡ひとこと」。待ち画面・予想・結果待ち・結果公開にも「💡ひとこと」の欄を出し、10秒ごとに入れ替える。一言は人ごとにランダム。クイズ中は出さない
- どのモードで出すかは `docs/データ設計.md` の「13. ひとこと」

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
    originEndsAt: 1764000180000,   // 出身地の問題の締め切り = nameEndsAt + 60秒(3問)
    nameSeconds: 120, originSeconds: 60
  },
  results: null | {                // mode が '結果公開' のときだけ。総合結果と内訳
    teams: [
      { team: 'A',
        basketball, badminton, dodgeball, volleyball, sportsTotal, sportsRank,
        quiz: 5.7, odai: 3.1, prediction: 1.3, nakayoshiTotal: 10.1,
        total: 59.1, totalRank: 1,
        quizNameRate: 76.7 | null,   // チームの名前の平均正答率(%)。ボーナス込みで100を超えることがある。回答者なしは null
        quizOriginRate: 33.3 | null, // チームの出身地の正答率(%)= 正解数の合計 ÷ 問題数の合計
        breakdown: {                 // タップで開く内訳(2026-11-13)
          basketballRank: 1 | null, badmintonRank: 2 | null, dodgeballRank: 3 | null, // 種目ごとの順位(決まっていなければ null)
          volleyScored: 50, volleyWins: 2, volleyBonus: 8, // バレー:取った点数、勝った数、勝ちボーナスの合計(volleyball = volleyScored + volleyBonus)
          quizNamePoints: 5.4, quizOriginPoints: 1,        // quiz の内訳
          predictionRate: 66.7 | null                      // 予想の的中率(%)。予想なしは null
        }
      }, ...
    ],
    crowns: {                        // 名前クイズで全員を書けた人(紹介する)
      allFull: [ { name: '斎藤 花子', team: 'A' }, ... ],  // 👑👑 チーム全員をフルネームで書けた
      complete: [ { name: '渡辺 太郎', team: 'B' }, ... ]  // 👑 チーム全員を書けた(0.5人分を含む。allFull の人は入らない)
    }
  }
}
```
- 点数はすべて小数第1位まで。順位は同点なら同じ数(1,1,3,4)
- 結果公開の画面:チームをタップすると内訳が開く(自分のチームは最初から開く)。種目ごとの順位と点数(バレーは取った点+勝ちボーナス)、名前クイズ・出身地クイズの点数と正答率、お題カード、勝敗予想の点数と的中率。その下に 👑👑・👑 の人の名前
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
data = { id: 'P01', name: '斎藤 花子', kana: 'さいとう はなこ', team: 'A', introDone: true | false, surveyDone: true | false }
```
- `introDone` が false なら自己紹介の入力画面へ進める
- `surveyDone`:アンケートを送ったか(**端末ではなく参加者ごと**。端末側の「送った」の印は、この値に合わせる)
- チームが変わっていることがある(当日のチーム変更)。表示は常にこの `team` を使う

### getIntro(participantId)
自己紹介の画面を開いたとき。
```js
data = {
  intro: null | { sport: 'バスケ', comment: 'ラーメンが好き', nickname: 'はな', snsConsent: '顔OK', updatedAt: '2026-11-20 12:00:00' },
  options: {
    sports: ['バスケ', 'バレー', 'バドミントン', 'その他', '特になし'],
    snsConsent: ['顔OK', '顔を隠せばOK', '載せない'],
    commentMax: 20, nicknameMax: 30, nicknameCount: 3
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
- `nickname`:任意(空文字可)。「、」「,」「/」で区切って3つまで、合わせて30字まで(スペースは区切りにしない)。「、」でつないで保存される。4つ以上は `INVALID`
  - 入力欄の説明:「呼ばれたい呼び方だけを書いてください。いくつかあるときは『、』で区切る。名前と関係ないあだ名がある人はここに書いてね(クイズで正解になります)」。見本は「例)はな、はなちゃん」
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

出身地クイズは、C形式で複数人を正解にした結果3問に足りなくなる県を避け、残りをB形式で埋める。出身地が分かる対象が3人以上いれば3問。対象が不足する場合は作れる問数だけ返す。
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
  origin: null | {                  // 出身地クイズ(ふつう3問)。作れなければ null(とばす)
    questions: [                    // 順番は人ごとにランダム。正解は入っていない
      { type: 'B', targetName: '渡辺 太郎',               // 「〇〇さんの出身は?」→ 4つの県から1つ選ぶ
        choices: ['宮城県', '山形県', '福島県', '岩手県'] },
      { type: 'C', pref: '東京都', count: 2,               // 「東京都出身はだれ?(2人)」→ 名前4人から count 人まで選ぶ
        choices: [ { id: 'P03', name: '高橋 健' }, { id: 'P05', name: '小島 さくら' }, ... ] },
      ...
    ]
  }
}
// すでに送っていたとき(画面の開き直し)。答え合わせは返さない(getQuizResult で受け取る)
data = { alreadyAnswered: true, surveyDone: true | false }
```

**クイズの進み方(全員同時)**
1. 名前の問題:`nameEndsAt` まで。入力欄に `names.count` 人分の欄と、`names.hints` を「スポーツ/ひとこと」で並べる(ヒントはどの欄の人かは対応しない)。あだ名は出さない。漢字・ひらがな・カタカナどれでもよい
   - 画面の説明:「フルネームで書くと高得点。漢字でもひらがなでもOK。名前だけ・名字だけ・あだ名でもOK(〜さん・〜先輩は付けてもOK)」。ボーナスの数字は出さない
2. 本人が「次へ」を押すか `nameEndsAt` になったら、出身地クイズへ。出身地クイズは `originEndsAt` まで(`origin` が null なら飛ばす)。早く進んだ人も、持ち時間は `originSeconds`(60秒)まで
   - B は選ぶと次の問題へ進む。C は `count` 人まで選んで「次の問題」。前の問題に戻って直せる
   - **最後に3問の答えを一覧で確かめて、「送信する」ボタンで `submitQuiz` を呼ぶ**(選んだ瞬間には送らない)
3. `originEndsAt`(または持ち時間)になったら、そのときの答えで自動で `submitQuiz` を呼ぶ(選んでいない問題は `''` か `[]` = 不正解)
- 時間は **各自の開始からではなく、運営が「クイズ開始」を押した時刻が基準**。残り時間は `nameEndsAt - (Date.now() + (serverNow - 受け取った時の Date.now()))` のように、サーバー時刻とのずれを直して数える
- 途中で開いた人は、残り時間だけになる(締め切り後に開いた人も、送信は受け付ける)
- 出身地クイズの中身(チームメイトの名前が出る)は、本人の名前の問題が終わるまで画面に出さない
- 名前の問題:残り時間は画面の上に固定する(キーボードが出ていても見える)。入力欄は横幅いっぱい、ヒントは入力欄と別の枠にまとめる
- 答えは端末(localStorage)に置いておき、送信が失敗したら再送ボタン

### submitQuiz(participantId, answers)
クイズの答えをまとめて1回送る。**再送しても最初の答えのまま**(二重にならない)。mode が '結果公開' になったあとは `QUIZ_CLOSED`。
```js
submitQuiz('P01', { names: ['さいとうはなこ', '渡辺太郎', ''], origin: ['宮城県', ['P03', 'P05'], ''] })
data = { accepted: true, surveyDone: true | false }
```
- `origin`:出身地クイズの答え。**startQuiz の `origin.questions` と同じ順番の配列**。B は選んだ県名、C は選んだ人の `id` の配列。選んでいない問題は `''` か `[]`
  - 1問1点。B は正解の県名と同じなら正解。C は正解の人とぴったり同じ人を選んだら正解(`count` 人より多く送ると、先頭から `count` 人だけ使う)
  - 選択肢にない答えは不正解で、どこにも保存しない
- **答え合わせは返さない**(2026-11-14)。送ったあとは「アンケートに答えると、自分の結果が見られるよ」と出し、アンケートを送ってから `getQuizResult` で受け取る
- 名前の判定(サーバー側):
  | 答え | 判定 |
  |---|---|
  | フルネームと完全一致(漢字・ひらがな・混ぜ書き) | 自動で1人分 |
  | 名前だけ・名字だけ・登録したあだ名と完全一致 | 自動で0.5人分 |
  | だれかに近い(頭2文字以上が同じ、1文字違い) | 運営が判断(1人分/0.5人分/×) |
  | だれにも近くない | 運営の一覧の下に出る(判断しなければ×) |
  - スペース・全角半角・カタカナ/ひらがな・よくある異体字(斎/齋/齊、辺/邊/邉、高/髙、崎/﨑 など)の違いは無視
  - 最後の敬称(さん・先輩・せんぱい・くん・君・ちゃん・様 など)は、まずそのまま比べ、だめなら外して比べる
  - 同じ人を何回書いても、いちばん高い1回だけ。1つの答えが何人かに当てはまるときは、どちらか1人分

### getQuizResult(participantId)
自分の答え合わせを受け取る(アンケートを送ったあと・画面の開き直し・運営が判断を直したあと)。
```js
data = {
  answered: true | false,     // クイズを送ったか
  surveyDone: true | false,   // アンケートを送ったか
  availableAt: ms | null,     // この時刻(名前クイズの全員の締め切り)まで結果を出さない。null = もう出せる
  serverNow: ms,
  result: null | {
    total: 7,              // 書くべき人数
    correctCount: 5,       // 書けた人数(1人分 + 0.5人分。「7人中5人書けた!」)
    fullCount: 4,          // そのうちフルネームで書けた人数
    pendingCount: 1,       // 書けなかった人のうち、「惜しい」答えを運営が確認中の人数
    pendingOther: 1,       // だれの答えか分からなくて、運営が確認中の答えの数
    published: false,      // 結果公開のあとか(公開後は、確認中を出さない)
    members: [             // 書けなかった人が先。あだ名は答え合わせでだけ出す
      { name: '高橋 健', kana: 'たかはし けん', nickname: 'けんけん', written: false, credit: 0, pending: true },
      { name: '斎藤 花子', kana: 'さいとう はなこ', nickname: '', written: true, credit: 1, pending: false }, // credit は 1 / 0.5 / 0
      ...
    ],
    origin: null | {       // 出身地クイズの答え合わせ(問題がなかった・6時間たったときは null)
      correct: 2, total: 3,
      questions: [
        { type: 'B', targetName: '渡辺 太郎', answer: '宮城県', yourAnswer: '山形県', correct: false }, // 選んでいなければ yourAnswer: ''
        { type: 'C', pref: '東京都', answerNames: ['高橋 健', '小島 さくら'], yourNames: ['高橋 健', '小島 さくら'], correct: true },
        ...
      ]
    }
  }
}
```
- `result` が入るのは、**クイズを送っていて、アンケートも送っていて、名前クイズの全員の締め切り(nameEndsAt)を過ぎている**ときだけ
  - `surveyDone: false` → 「アンケートに答えると、自分の結果が見られるよ」
  - `availableAt` あり → 「自分の結果は、名前クイズが終わったら表示します」。その時刻のあとに取り直す(早く終わった人が、ほかの人が書いている間に答えを見られないようにするため)
- 書けなかった人は「〇〇さん(ひらがな)を覚えよう!」のように出す。`pending: true` は「確認中」と出す
- 個人の正答率(%)・チームの点数・順位は出さない(結果公開まで隠す)

### submitSurvey(survey, participantId)
アンケート(運営だけが見る。名前は保存せず参加者IDだけ。2026-11-11 に匿名をやめた)。送ったかどうかは参加者ごとにサーバーが覚える(selectSelf・getQuizResult の `surveyDone`)。名前を選んでいない端末は participantId を空にする。**送ったあと、画面は getQuizResult で自分の結果を受け取る**。
```js
submitSurvey({ fun: 5, talked: 4, learned: '3〜5人', best: 'バレー', next: ['ご飯', 'その他'], nextOther: 'ボウリング',
               help: 'いいよ', comment: '楽しかった', snsOk: true }, 'P07')
data = { saved: true }
```
| # | 項目 | 値 | 必須 |
|---|---|---|---|
| 1 | `fun` 楽しかった? | 1〜5 の整数 | ○ |
| 2 | `talked` 普段話さない人と話せた? | 1〜5 の整数 | ○ |
| 3 | `learned` 今日、新しく名前を覚えた人数 | `'0人'` / `'1〜2人'` / `'3〜5人'` / `'6人以上'` | ○ |
| 4 | `best` 一番楽しかった種目・企画 | `'バスケ'` / `'バド'` / `'ドッジ'` / `'バレー'` / `'クイズ'` / `'お題カード'` / `'予想'` から1つ | ○ |
| 5 | `next` 次にやってほしいイベント | `'クリスマス会'` / `'ご飯'` / `'雪遊び'` / `'ミックスチーム大会'` / `'その他'` の配列(いくつでも。0個でもよい)。`nextOther` は「その他」の中身(50字まで) | |
| 6 | `help` 次のイベントの準備、ちょっと手伝ってもいい? | `'いいよ'` / `'内容による'` / `'今回はパス'` | ○ |
| 7 | `comment` ひとこと感想 | 自由(1000字まで)。`snsOk` は「SNSで紹介してもいい(名前は出しません)」のチェック(感想があるときだけ有効) | |
- 必須の項目が足りない・選択肢にない値は `INVALID`
- 「また参加したいか」(`again`)はやめた

---

## 2. 運営の画面

最初に `adminLogin` でトークンを受け取り、sessionStorage に置いて、以降すべての関数の **第1引数** に渡す。トークンは最後に使ってから6時間有効。`AUTH` が返ったらログインし直す。

**通信の約束(運営画面)**
- 返事が30秒来ないときは「返事が届きません。保存できたかどうか、結果を確かめてください」と出し、「最新の状態を確かめる」で取り直す。**保存されていないと決めつけない**(サーバーでは終わっていることがある)。遅れて返事が届いたら、古い返事で画面を書き換えず、最新の状態を取り直す
- `adminStartQuiz` は、やり直すと開始時刻が変わるので、通信に失敗しても「もう一度送る」を出さない。まず最新の状態を確かめる
- 点数欄の Enter は入力を終えるだけ。確定は大きなボタンで押す
- 準決勝(D-SF・V-SF)の修正で勝ったチームが変わるとき・確定を取り消すときは、あとの試合(決勝・3位決定戦・G-3・G-4)から消えるもの(確定した点数、集まった予想)を具体的に出して確認する。保存のあとは試合をまとめて取り直す

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
  pendingNearMisses: 2, // 運営がまだ判断していない答えの数
  odaiCount: 8,         // お題カードの入力済みの数(3枚×4チーム = 12 で全部)
  unsplitNames: 0,      // 名簿の名前が「名字 名前」と空白で分かれていない人数(名前だけ・名字だけの判定が使えない)
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
運営が判断する答えの一覧(未判断のみ。`includeJudged=true` なら判断済みも。公開後に直すときに使う)。**同じチームの同じ答えは1件にまとめる**。未判断が先、その中では候補があるものが先。
```js
data = {
  items: [
    { number: 101, numbers: [101, 201],  // まとめた番号(adminJudgeNearMiss に numbers をそのまま渡す)
      count: 2,                           // 同じ答えを書いた人数
      team: 'A',
      input: 'たかはしけ' | null,         // 書かれた名前。6時間たった・キャッシュが消えたときは null(「入力は表示できません」と出す。まとめない)
      candidateId: 'P03' | '',            // アプリが推測した人(だれにも近くなければ '')
      candidateName: '高橋 健', candidateKana: 'たかはし けん',
      judgement: '未' | '1人分' | '0.5人分' | '×' }, ...
  ],
  pendingCount: 3,                        // 未判断の答えの数(まとめる前)
  decisions: ['1人分', '0.5人分', '×']
}
```

### adminJudgeNearMiss(token, numbers, decision, candidateId?)
運営の判断。その人のクイズの点数と総合点を計算し直す。**結果を公開したあとでも直せる**。
```js
adminJudgeNearMiss(token, [101, 201], '0.5人分', 'P03')
data = { numbers: [101, 201], judgement: '0.5人分', updated: 2 }
```
- `numbers`:番号1つ、または配列(同じ答えをまとめて判断)
- `decision`:`'1人分'` / `'0.5人分'` / `'×'`(`'未'` に戻すこともできる。古い `'OK'`=1人分・`'NG'`=× も受け付ける)
- `candidateId`:だれの答えとして数えるか(チームメイトの一覧から選ぶ)。省くとアプリの推測のまま。1人分・0.5人分にするのに候補がない、候補がその人のクイズの対象でない、は `INVALID`
- 同じ人は、自動の判定と運営の判断のうち高いほうだけ数える。×や未に戻すと自動の判定の点に戻る
- 結果を公開する時点で判断していないものは×の扱い

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
  totalWithTeam: 30,
  unsplitNames: 0        // 名前が「名字 名前」と空白で分かれていない人数(名前は返さない)
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
             quizNameRate, quizOriginRate, breakdown: { ... } }, ... ], // A〜D の順。getState().results.teams と同じ形
  crowns: { allFull: [ { name, team } ], complete: [ { name, team } ] }, // getState().results.crowns と同じ
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
- **読み上げ用の原稿**(順位タブの「② 仲良しポイント込み」):`totalRanking` を4位から並べ、点数・運動と仲良しの内訳・一言(そのチームでいちばん目立つところを画面側で選ぶ)、最後に `crowns` の名前。このデータだけで作り、通信は増やさない

### adminPublishResults(token)
結果を全員のスマホに公開する(mode を '結果公開' に)。`data = (state)`
- 押す前の確認画面に、adminGetOverview の値から「試合の確定数/18、お題カードの入力数/12、クイズの回答数/来場人数、まだ判断していない答えの件数」を出す。判断していない答えは、公開のときに×の扱いになる(公開後も直せる)ことも書く。足りなくても公開は止めない

### adminGetSettings(token) / adminSaveSettings(token, values)
配点・制限時間の変更。
```js
adminSaveSettings(token, { 'バレー勝ちボーナス': 5, '順位点': '10,7,4,2' })
data = { rows: [ { key, value, description } ], parsed: { rankPoints: [10,7,4,2], volleyWinBonus: 5, quizNameMax: 7,
         quizOriginMax: 3, odaiAllMatch: 2, odaiFactor: 1.5, predictionMax: 2, quizNameSeconds: 120, quizOriginSeconds: 60 } }
```
キー:`順位点` / `バレー勝ちボーナス` / `クイズ:名前の満点` / `クイズ:出身地の満点` / `お題カード:全員一致の点` / `お題カード:それ以外の係数` / `予想:1試合の満点` / `クイズ:名前の制限時間(秒)` / `クイズ:出身地の制限時間(秒)`(「:」は半角)。知らないキーは `INVALID`。

---

## 3. エディタから実行する関数(画面からは呼ばない)
| 関数 | すること |
|---|---|
| `setup()` | シートを作る(何度実行してもよい) |
| `importRosterFromEditor()` | 名簿の読み込み(adminImportRoster と同じ。チームは上書きしない) |
