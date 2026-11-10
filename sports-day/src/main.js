/**
 * Webアプリの入口
 * - ?page=admin → 運営画面(admin.html)
 * - それ以外   → 参加者画面(participant.html)。?team=A〜D でチームを最初から選んだ状態にできる
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var isAdmin = params.page === 'admin';
  var t = HtmlService.createTemplateFromFile(isAdmin ? 'admin' : 'participant');
  t.team = normTeam_(params.team); // A〜D 以外は ''
  return t.evaluate()
    .setTitle(isAdmin ? '運動会 運営' : '合同運動会')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** HTMLから別のHTMLファイルを読み込む(<?!= include('ファイル名') ?>) */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
