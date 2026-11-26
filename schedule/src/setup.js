/**
 * 最初に1回だけ、Apps Script のエディタで実行する
 *
 * 1. スクリプト プロパティに ADMIN_PASSWORD を入れておく(必要なら FOLDER_ID と ROSTER_SPREADSHEET_ID も)
 * 2. setup() を実行 → 管理ファイルができて、INDEX_SPREADSHEET_ID が自動で入る
 *    FOLDER_ID があれば、管理ファイルもそのフォルダに入れる
 * 3. 運営画面(…/exec?page=admin)からグループを作る
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('INDEX_SPREADSHEET_ID');
  if (!id) {
    var ss = SpreadsheetApp.create('出欠アプリ 管理ファイル');
    id = ss.getId();
    props.setProperty('INDEX_SPREADSHEET_ID', id);
    var folderId = props.getProperty('FOLDER_ID');
    if (folderId) {
      try { DriveApp.getFileById(id).moveTo(DriveApp.getFolderById(folderId)); } catch (e) { /* 入れられなくても使える */ }
    }
    var first = ss.getSheets()[0];
    first.setName(IDX_GROUPS);
  }
  sheet_(id, IDX_GROUPS, IDX_GROUPS_H);
  var g = ss_(id).getSheetByName(IDX_GROUPS);
  if (g.getLastRow() === 0) { g.getRange(1, 1, 1, IDX_GROUPS_H.length).setValues([IDX_GROUPS_H]); g.setFrozenRows(1); }
  sheet_(id, IDX_EVENTS, IDX_EVENTS_H);
  return id;
}
