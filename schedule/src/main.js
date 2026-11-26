/**
 * Webアプリの入口
 * - ?page=admin → 運営画面(admin.html。パソコン前提)
 * - それ以外   → 参加者画面(participant.html)。?g=合言葉 でグループ、&e=イベントID でイベントを直接開く
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var isAdmin = params.page === 'admin';
  var t = HtmlService.createTemplateFromFile(isAdmin ? 'admin' : 'participant');
  t.groupToken = String(params.g || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  t.eventId = String(params.e || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);
  t.appUrl = ScriptApp.getService().getUrl();
  return t.evaluate()
    .setTitle(isAdmin ? '日程調整 運営' : '日程調整')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** HTMLから別のHTMLファイルを読み込む(<?!= include('ファイル名') ?>) */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
