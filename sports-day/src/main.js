/**
 * Webアプリの入口
 * - ?page=admin → 運営画面(admin.html)
 * - それ以外   → 参加者画面(participant.html)。?team=A〜D でチームを最初から選んだ状態にできる
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.page === 'bots') {
    // デモ用のサクラ。スクリプト プロパティ DEMO_BOTS が on のときだけ(本番の名簿で動かさないため)
    if (PropertiesService.getScriptProperties().getProperty('DEMO_BOTS') !== 'on') {
      return HtmlService.createHtmlOutput('サクラは止めてあります(スクリプト プロパティ DEMO_BOTS が on ではありません)').setTitle('サクラ');
    }
    return HtmlService.createHtmlOutputFromFile('bots').setTitle('サクラ');
  }
  var isAdmin = params.page === 'admin';
  var t = HtmlService.createTemplateFromFile(isAdmin ? 'admin' : 'participant');
  t.team = normTeam_(params.team); // A〜D 以外は ''
  if (isAdmin) t.basketballCore = basketballRoundScores.toString();
  // 「ひとこと」は、アプリを開いたときにページに埋め込む(読み込み中にも出せる。通信は増えない)
  t.tips = '[]';
  if (!isAdmin) { try { t.tips = tipsJson_(); } catch (err) { t.tips = '[]'; } }
  return t.evaluate()
    .setTitle(isAdmin ? '運動会 運営' : '合同運動会')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** HTMLから別のHTMLファイルを読み込む(<?!= include('ファイル名') ?>) */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
