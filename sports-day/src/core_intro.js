/** 既存のスポーツ列の中で「その他」の詳細を保持する。列は追加しない。 */
function parseIntroSports(sport) {
  var text = String(sport || ''), marker = 'その他（', start = text.indexOf(marker);
  var other = '';
  if (start >= 0 && text.slice(-1) === '）') {
    other = text.slice(start + marker.length, -1);
    text = text.slice(0, start) + 'その他';
  }
  return { sports: text ? text.split('・') : [], sportOther: other };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { parseIntroSports: parseIntroSports };
