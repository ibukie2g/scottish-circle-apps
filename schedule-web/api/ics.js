// カレンダーに追加するためのファイル(.ics)を返す(Vercel の関数)
// iPhone は data URL では「カレンダーに追加」を出さないので、本物のファイルとして返す(11/28)
// 受け取るのはイベント名・日にち・時刻・場所・リンクだけ(参加者の名前は受け取らない)
// 例:/api/ics?title=忘年会&date=2026-12-19&time=19:00&place=駅前&url=https://...

const clip = (v, n) => String(v ?? '').slice(0, n);
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\r?\n/g, '\\n');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export default function handler(req, res) {
  const q = req.query ?? {};
  const title = clip(q.title, 60) || '予定';
  const place = clip(q.place, 100);
  const url = /^https:\/\//.test(String(q.url ?? '')) ? clip(q.url, 300) : '';
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
    const end = new Date(start.getTime() + 2 * 3600000);
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
    ...(url ? [`DESCRIPTION:${esc(url)}`, `URL:${url}`] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="event.ics"');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(ics);
}
