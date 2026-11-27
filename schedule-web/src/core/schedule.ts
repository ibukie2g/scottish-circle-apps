/**
 * 日程調整の計算(画面にもサーバーにも依存しない純粋な関数)
 * A案 schedule/src/core_schedule.js を B案の表の形に合わせて移したもの。
 *
 * A案とのちがい:
 * - 答えは「'C01:○,C02:△' の文字列」ではなく、answers 表の行(1候補日 × 1人)
 *   → parseAnswers / formatAnswers / rowsForCandidates / nextId はいらない
 * - 記号・状態は英字('o'/'t'/'x'、'poll'/'time'/'rsvp'/'done'、'go'/'partial'/'no')
 * - 同じ人の答えは表の主キー(member_id, candidate_id)で1つだけなので、「新しいほうを使う」処理もいらない
 */
import type { Answer, Attendance, AttendanceStatus, Candidate, EventInfo, Mark, Member, Stage } from './types';

export const MARKS: readonly Mark[] = ['o', 't', 'x'];
export const MARK_LABEL: Record<Mark, string> = { o: '○', t: '△', x: '×' };
export const NAME_MAX = 20;
export const COMMENT_MAX = 100;
export const ARCHIVE_DAYS = 30;

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_MS = 86400000;

// ---------- 名前 ----------

/** 表示名を整える(制御文字・改行・続く空白をまとめ、前後を取る) */
export function normalizeName(v: unknown): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 同じ人かどうかを比べる用(= members.name_norm)。空白(全角も)を全部取る */
export function nameKey(v: unknown): string {
  return normalizeName(v).replace(/[\s　]/g, '');
}

/** 文字数(絵文字も1字) */
export function nameLength(v: unknown): number {
  return Array.from(String(v ?? '')).length;
}

// ---------- 日付 ----------

/** 'YYYY-MM-DD' を UTC の Date に(タイムゾーンに左右されないように) */
function parseYmd(ymd: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 日本時間の今日('YYYY-MM-DD')。締め切りの判定に使う */
export function todayJst(now: Date = new Date()): string {
  return ymd(new Date(now.getTime() + 9 * 3600000));
}

/** '2026-12-15' → '12/15(火)' */
export function formatDateJa(s: string | null | undefined): string {
  const d = parseYmd(s);
  if (!d) return String(s ?? '');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS_JA[d.getUTCDay()]})`;
}

/**
 * 候補日の一括作成。「12/1から、火曜と金曜を4週分、19:00」など
 * from の日から weeks 週分(1〜12)。weekdays は 0=日 … 6=土
 */
export function expandDates(opts: { from: string; weekdays: number[]; weeks: number; time?: string }): { date: string; time: string }[] {
  const start = parseYmd(opts.from);
  const weeks = Math.max(1, Math.min(12, Number(opts.weeks) || 1));
  const wds = (opts.weekdays || []).filter((w) => w >= 0 && w <= 6);
  if (!start || !wds.length) return [];
  const out: { date: string; time: string }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    if (wds.includes(d.getUTCDay())) out.push({ date: ymd(d), time: opts.time || '' });
  }
  return out;
}

/** 候補日を日付・時刻の順に(時刻なしは同じ日の最後)。元の配列は変えない */
export function sortCandidates<T extends Pick<Candidate, 'date' | 'time'>>(list: readonly T[]): T[] {
  const key = (c: T) => `${c.date} ${c.time || '99:99'}`;
  return list.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** いまの段階の候補だけ(2段階:日にち → 時間) */
export function stageCandidates(list: readonly Candidate[], stage: Stage): Candidate[] {
  return list.filter((c) => (c.stage ?? 'date') === stage);
}

/** イベントの状態から、いま答えてもらう段階 */
export function currentStage(status: EventInfo['status']): Stage {
  return status === 'time' ? 'time' : 'date';
}

// ---------- メンバー ----------

const isActive = (m: Member) => m.active !== false;

/** 学年・男女で絞り込む(サークルのとき)。条件が空ならそのまま(抜けた人は除く) */
export function filterMembers(members: readonly Member[], filter: { grade?: string; gender?: string } = {}): Member[] {
  return members.filter((m) => isActive(m) && (!filter.grade || m.grade === filter.grade) && (!filter.gender || m.gender === filter.gender));
}

/** 答えていない人(メンバーの順のまま)。candidateIds のどれか1つに答えていれば「答えた」 */
export function unanswered(members: readonly Member[], answers: readonly Answer[], candidateIds: readonly string[]): Member[] {
  const ids = new Set(candidateIds);
  const done = new Set(answers.filter((a) => ids.has(a.candidateId)).map((a) => a.memberId));
  return members.filter((m) => isActive(m) && !done.has(m.id));
}

// ---------- 集計 ----------

export interface DateSummary {
  candidateId: string;
  date: string;
  time: string;
  memo: string;
  o: number;
  t: number;
  x: number;
  names: { o: string[]; t: string[]; x: string[] } | null;
  wanted: { ok: string[]; maybe: string[]; ng: string[]; none: string[] } | null;
  best: boolean;
}

/**
 * 日ごとの集計。並びは ○の多い順 → △の多い順 → 日付・時刻の早い順
 * best(いちばん多い):○も△も1位と同じ数の候補すべて。○が0なら付けない(11/27 伊吹)
 */
export function summarize(
  candidates: readonly Candidate[],
  answers: readonly Answer[],
  members: readonly Member[],
  opts: { wanted?: string[]; withNames?: boolean } = {},
): { byDate: DateSummary[]; answeredCount: number; memberCount: number } {
  const active = members.filter(isActive);
  const nameOf = new Map(active.map((m) => [m.id, m.name]));
  const candIds = new Set(candidates.map((c) => c.id));
  // memberId → (candidateId → mark)。抜けた人・ほかの段階の候補の答えは数えない
  const markOf = new Map<string, Map<string, Mark>>();
  for (const a of answers) {
    if (!nameOf.has(a.memberId) || !candIds.has(a.candidateId)) continue;
    let m = markOf.get(a.memberId);
    if (!m) markOf.set(a.memberId, (m = new Map()));
    m.set(a.candidateId, a.mark);
  }
  const wanted = (opts.wanted ?? []).filter((id) => nameOf.has(id));

  const list = sortCandidates(candidates).map((c, order) => {
    const names = { o: [] as string[], t: [] as string[], x: [] as string[] };
    for (const m of active) {
      const mark = markOf.get(m.id)?.get(c.id);
      if (mark) names[mark].push(m.name);
    }
    let w: DateSummary['wanted'] = null;
    if (wanted.length) {
      w = { ok: [], maybe: [], ng: [], none: [] };
      for (const id of wanted) {
        const mark = markOf.get(id)?.get(c.id);
        (mark === 'o' ? w.ok : mark === 't' ? w.maybe : mark === 'x' ? w.ng : w.none).push(nameOf.get(id)!);
      }
    }
    return {
      order,
      item: {
        candidateId: c.id, date: c.date, time: c.time || '', memo: c.memo || '',
        o: names.o.length, t: names.t.length, x: names.x.length,
        names: opts.withNames === false ? null : names,
        wanted: w,
        best: false,
      } as DateSummary,
    };
  });
  list.sort((a, b) => b.item.o - a.item.o || b.item.t - a.item.t || a.order - b.order);
  const top = list[0]?.item;
  for (const { item } of list) item.best = !!top && top.o > 0 && item.o === top.o && item.t === top.t;

  return { byDate: list.map((x) => x.item), answeredCount: markOf.size, memberCount: active.length };
}

/**
 * サーバー(get_event)が返す候補ごとの人数を並べ、いちばん多いものに印をつける
 * summarize と同じ決まり:○ → △ の多い順、同じなら日付・時刻の早い順。○も△も1位と同じなら全部に印(○が0なら付けない)
 */
export function rankResults<T extends { o: number; t: number; date: string; time: string }>(list: readonly T[]): (T & { best: boolean })[] {
  const sorted = sortCandidates(list).map((it, order) => ({ it, order }));
  sorted.sort((a, b) => b.it.o - a.it.o || b.it.t - a.it.t || a.order - b.order);
  const top = sorted[0]?.it;
  return sorted.map(({ it }) => ({ ...it, best: !!top && top.o > 0 && it.o === top.o && it.t === top.t }));
}

/** 出欠の集計。名前は「途中から」の人だけ (20:30〜) をつける */
export function summarizeAttendance(rows: readonly Attendance[], members: readonly Member[], withNames = true) {
  const nameOf = new Map(members.filter(isActive).map((m) => [m.id, m.name]));
  const out = { go: 0, partial: 0, no: 0, names: withNames ? { go: [] as string[], partial: [] as string[], no: [] as string[] } : null };
  for (const r of rows) {
    const name = nameOf.get(r.memberId);
    if (name === undefined || !r.status) continue;
    out[r.status]++;
    out.names?.[r.status].push(name + (r.status === 'partial' && r.arriveAt ? `(${r.arriveAt}〜)` : ''));
  }
  return out;
}

/** 日にち(時間)を決めたときの出欠の仮入れ:○→行く、×→行かない、それ以外は空 */
export function presetAttendance(mark: Mark | undefined): AttendanceStatus | null {
  return mark === 'o' ? 'go' : mark === 'x' ? 'no' : null;
}

// ---------- 締め切り・しまう ----------

/** 締め切りを過ぎたか(締め切りの日の 23:59 までOK)。nowYmd は日本時間の今日 */
export function isClosed(event: Pick<EventInfo, 'status' | 'deadline'> | null, nowYmd: string): boolean {
  if (!event || event.status === 'done') return true;
  return !!(event.deadline && nowYmd > event.deadline);
}

/** 一覧で「終わったもの」に折りたたむか:決まった日(なければ最後の候補日)から ARCHIVE_DAYS 日たった */
export function isArchived(event: Pick<EventInfo, 'status' | 'decidedCandidateId'> | null, candidates: readonly Candidate[], nowYmd: string): boolean {
  if (!event) return false;
  let base = '';
  if (event.decidedCandidateId) base = candidates.find((c) => c.id === event.decidedCandidateId)?.date ?? '';
  if (!base) for (const c of candidates) if (c.date > base) base = c.date;
  const d = parseYmd(base);
  if (!d) return event.status === 'done';
  return nowYmd > ymd(new Date(d.getTime() + ARCHIVE_DAYS * DAY_MS));
}

// ---------- カレンダー ----------

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * カレンダーに追加するためのデータ
 * - googleUrl:Googleカレンダーの予定作成画面
 * - ics:iPhone などのカレンダー用ファイルの中身(日本時間。時刻がなければ終日)
 */
export function calendarData(opts: { title?: string; date: string; time?: string; place?: string; url?: string; hours?: number }): { googleUrl: string; ics: string } | null {
  const d = parseYmd(opts.date);
  if (!d) return null;
  const title = opts.title || '予定';
  const details = opts.url || '';
  let startStr: string, endStr: string, icsStart: string, icsEnd: string;
  const m = /^(\d{1,2}):(\d{2})$/.exec(opts.time || '');
  if (m) {
    const start = new Date(d.getTime() + (+m[1]! * 60 + +m[2]! - 9 * 60) * 60000); // 日本時間 → UTC
    const end = new Date(start.getTime() + (opts.hours || 2) * 3600000);
    startStr = utcStamp(start);
    endStr = utcStamp(end);
    icsStart = `DTSTART:${startStr}`;
    icsEnd = `DTEND:${endStr}`;
  } else {
    startStr = ymd(d).replace(/-/g, '');
    endStr = ymd(new Date(d.getTime() + DAY_MS)).replace(/-/g, '');
    icsStart = `DTSTART;VALUE=DATE:${startStr}`;
    icsEnd = `DTEND;VALUE=DATE:${endStr}`;
  }
  const googleUrl =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(title)}&dates=${startStr}/${endStr}` +
    (opts.place ? `&location=${encodeURIComponent(opts.place)}` : '') +
    (details ? `&details=${encodeURIComponent(details)}` : '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//scottish-circle//schedule//JA', 'BEGIN:VEVENT',
    `UID:${startStr}-${encodeURIComponent(title).slice(0, 40)}@schedule`,
    icsStart, icsEnd, `SUMMARY:${esc(title)}`,
    ...(opts.place ? [`LOCATION:${esc(opts.place)}`] : []),
    ...(details ? [`DESCRIPTION:${esc(details)}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return { googleUrl, ics };
}
