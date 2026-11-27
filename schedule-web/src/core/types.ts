// B案(Supabase)の表に合わせた型。設計は docs/設計.md の「2. 表」

/** ○ = 'o'、△ = 't'、× = 'x' */
export type Mark = 'o' | 't' | 'x';

/** poll = 日程調整中 / time = 時間調整中 / rsvp = 出欠確認中 / done = 終了 */
export type EventStatus = 'poll' | 'time' | 'rsvp' | 'done';

export type Stage = 'date' | 'time';

export type AttendanceStatus = 'go' | 'partial' | 'no';

export type Visibility = 'names' | 'counts' | 'hidden';

export interface Candidate {
  id: string;
  date: string; // 'YYYY-MM-DD'
  time: string; // '19:00' か ''
  memo?: string;
  stage?: Stage; // 省略は 'date'
}

export interface Member {
  id: string;
  name: string;
  kana?: string;
  grade?: string;
  gender?: string;
  active?: boolean; // 省略は true
}

/** answers 表の1行(1候補日 × 1人) */
export interface Answer {
  memberId: string;
  candidateId: string;
  mark: Mark;
}

/** responses 表のうち出欠の部分 */
export interface Attendance {
  memberId: string;
  status: AttendanceStatus | null;
  arriveAt?: string;
}

export interface EventInfo {
  name: string;
  status: EventStatus;
  deadline?: string | null; // 'YYYY-MM-DD'
  place?: string;
  decidedCandidateId?: string | null;
}
