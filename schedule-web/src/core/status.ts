/**
 * 「状況をコピー(名前なし)」の文を作る(11/28 伊吹)
 * 本名が入ったあと、AI に状況を伝えるときに使う。**名前・ひとことは絶対に入れない**(人数と日付だけ)
 */
import { currentStage, formatDateJa, stageCandidates, summarize } from './schedule';
import type { AttendanceStatus, Candidate, EventStatus, Mark } from './types';

export interface StatusEventInput {
  groupName: string;
  name: string;
  status: EventStatus;
  style: 'event' | 'party';
  deadline: string | null;
  decided: { date: string; time: string } | null;
  candidates: Candidate[];
  courses: { id: string; name: string }[];
  members: { id: string; answers: Record<string, Mark>; attendance: AttendanceStatus | null; course_id: string | null; paid: boolean }[];
}

const STATUS: Record<EventStatus, string> = { poll: '日程調整中', time: '時間調整中', rsvp: '出欠確認中', done: '終了' };

/** 1つのイベントの状況(名前なし) */
export function eventStatusLines(e: StatusEventInput): string[] {
  const head = [`【${e.groupName}】${e.name} ・ ${STATUS[e.status]}`];
  if (e.status === 'poll' && e.deadline) head.push(`締め切り ${formatDateJa(e.deadline)}`);
  if (e.decided && e.status !== 'poll') head.push(`決定 ${formatDateJa(e.decided.date)}${e.decided.time ? ' ' + e.decided.time + '〜' : ''}`);
  const lines = [head.join(' ・ ')];
  const total = e.members.length;

  if (e.status === 'poll' || e.status === 'time') {
    const cands = stageCandidates(e.candidates, currentStage(e.status));
    // 名前の代わりに番号だけを入れる(summarize は名前を使うが、ここでは数だけ取り出す)
    const members = e.members.map((m, i) => ({ id: m.id, name: String(i) }));
    const answers = e.members.flatMap((m) => Object.entries(m.answers).map(([candidateId, mark]) => ({ memberId: m.id, candidateId, mark })));
    const s = summarize(cands, answers, members, { withNames: false });
    lines.push(` 回答 ${s.answeredCount}/${total}人 ・ まだ ${total - s.answeredCount}人`);
    for (const b of s.byDate) {
      const when = e.status === 'time' ? `${b.time}〜` : `${formatDateJa(b.date)}${b.time ? ' ' + b.time : ''}`;
      lines.push(` ${when} ○${b.o} △${b.t} ×${b.x}${b.best ? ' ← いちばん多い' : ''}`);
    }
  }
  if (e.status === 'rsvp' || e.status === 'done') {
    const n = (s: AttendanceStatus) => e.members.filter((m) => m.attendance === s).length;
    const notYet = e.members.filter((m) => !m.attendance).length;
    lines.push(` 行く ${n('go')} ・ 途中から ${n('partial')} ・ 行かない ${n('no')} ・ まだ ${notYet}`);
  }
  if (e.style === 'party' && e.status !== 'poll') {
    const coming = e.members.filter((m) => m.attendance === 'go' || m.attendance === 'partial' || (e.status === 'time'));
    if (e.courses.length) {
      const parts = e.courses.map((c) => `${c.name} ${coming.filter((m) => m.course_id === c.id).length}`);
      lines.push(` コース:${parts.join(' ・ ')} ・ 未定 ${coming.filter((m) => !m.course_id).length}`);
    }
    if (e.status !== 'time') lines.push(` 受け取り済み ${e.members.filter((m) => m.paid).length}人`);
  }
  return lines;
}

/** 進行中のイベントをまとめた文。なければ「進行中のイベントはありません」 */
export function statusText(events: StatusEventInput[], nowLabel: string): string {
  const live = events.filter((e) => e.status !== 'done');
  if (!live.length) return `${nowLabel} 時点:進行中のイベントはありません`;
  return [`${nowLabel} 時点の状況(名前なし)`, ...live.flatMap((e) => ['', ...eventStatusLines(e)])].join('\n');
}
