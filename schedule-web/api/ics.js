// カレンダーに追加するためのファイル(.ics)を返す(Vercel の関数)
// iPhone は data URL では「カレンダーに追加」を出さないので、本物のファイルとして返す(11/28)
// 受け取るのはイベント名・日にち・時刻・長さ・場所・メモ・リンクだけ(参加者の名前は受け取らない)
// 例:/api/ics?title=忘年会&date=2026-12-19&time=19:00&min=180&place=駅前&desc=現地集合&url=https://...

const clip = (v, n) => String(v ?? '').slice(0, n);
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\r?\n/g, '\\n');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// 75バイトを超える行は折り返す(カレンダーの決まり。長いメモが途中で切れないように)
const fold = (line) => {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
};

export default function handler(req, res) {
  const q = req.query ?? {};
  const title = clip(q.title, 60) || '予定';
  const place = clip(q.place, 100);
  const url = /^https:\/\//.test(String(q.url ?? '')) ? clip(q.url, 300) : '';
  const desc = clip(q.desc, 1000) || url;
  const min = Math.min(1440, Math.max(15, Number(q.min) || 120));
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(q.date ?? ''));
  if (!m) {
    res.status(400).send('date が正しくありません');
    return;
  }
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(q.time ?? ''));
  let dates;
  if (t) {
    const start = new Date(day.getTime() + ((+t[1]) * 60 + (+t[2]) - 9 * 60) * 60000); // 日本時間 → UTC
    const end = new Date(start.getTime() + min * 60000);
    dates = [`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`];
  } else {
    dates = [`DTSTART;VALUE=DATE:${ymd(day)}`, `DTEND;VALUE=DATE:${ymd(new Date(day.getTime() + 86400000))}`];
  }
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//scottish-circle//schedule//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ymd(day)}-${encodeURIComponent(title).slice(0, 40)}@scottish-schedule`,
    `DTSTAMP:${stamp(new Date())}`,
    ...dates,
    `SUMMARY:${esc(title)}`,
    ...(place ? [`LOCATION:${esc(place)}`] : []),
    ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="event.ics"');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(ics);
}
