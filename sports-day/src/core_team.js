/**
 * チーム名(2026-11-16 追加)
 * 開会でチームごとに決めて、チームのだれでもアプリから入れられる。運営が締め切れる。
 * 名前がまだないチームは、画面では「Aチーム」のまま出す。
 */

var TEAM_NAME_MAX = 10; // チーム名の文字数の上限

/**
 * 入力されたチーム名を整える(前後の空白を取り、続く空白や改行を1つの空白にし、制御文字を消す)
 * 長さはここでは切らない(長すぎるときは、切らずにエラーにして本人に直してもらう)
 * @param {*} v
 * @return {string}
 */
function normalizeTeamName(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 文字数(絵文字なども1文字に数える) */
function teamNameLength(name) {
  return Array.from(String(name || '')).length;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeTeamName: normalizeTeamName, teamNameLength: teamNameLength, TEAM_NAME_MAX: TEAM_NAME_MAX };
}
