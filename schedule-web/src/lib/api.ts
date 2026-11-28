// 参加者用の関数(supabase/migrations の RPC)を、画面から呼ぶ形にしたもの
import type { AttendanceStatus, EventStatus, Mark, Visibility } from '../core/types';
import { rpc } from './supabase';

export type Kind = 'circle' | 'group' | 'once';

export interface EventSummary {
  id: string;
  name: string;
  status: EventStatus;
  deadline: string | null;
  closed: boolean;
  decided: { date: string; time: string } | null;
  last_date: string | null;
  answered: boolean;
}

export interface GroupView {
  group: { id: string; name: string; kind: Kind; mascot: boolean };
  me: { id: string; name: string } | null;
  member_count: number;
  events: EventSummary[];
}

export interface MemberItem {
  id: string;
  name: string;
  kana: string | null;
  grade: string | null;
  taken: boolean;
  mine: boolean;
}

export interface CandidateResult {
  candidate_id: string;
  date: string;
  time: string;
  memo: string;
  o: number;
  t: number;
  x: number;
  names: { o: string[]; t: string[]; x: string[] } | null;
}

export interface StageResults {
  member_count: number;
  answered_count: number;
  by_candidate: CandidateResult[];
}

export interface EventView {
  event: {
    id: string; name: string; description: string; place: string; cost: string; url: string;
    status: EventStatus; visibility: Visibility; deadline: string | null; stage: 'date' | 'time';
    closed: boolean; decided: { date: string; time: string } | null; notice?: string;
  };
  courses?: { id: string; name: string; price: number }[];
  candidates: { id: string; date: string; time: string; memo: string }[];
  mine: { answers: Record<string, Mark>; comment: string; attendance: AttendanceStatus | null; arrive_at: string; att_comment: string; course_id?: string | null } | null;
  results: StageResults | null;
  date_stage: StageResults | null;
  attendance: { go: number; partial: number; no: number; names: { go: string[]; partial: string[]; no: string[] } | null } | null;
  wanted: string[] | number | null;
}

export interface OtherGroup {
  group: { id: string; name: string; kind: Kind; token: string };
  me: { id: string; name: string };
  events: EventSummary[];
}

export const api = {
  openGroup: (token: string) => rpc<GroupView>('open_group', { p_token: token }),
  listMembers: (token: string) => rpc<MemberItem[]>('list_members', { p_token: token }),
  claimMember: (token: string, memberId: string, confirm = false) =>
    rpc<{ needs_confirm?: true; me?: { id: string; name: string } }>('claim_member', { p_token: token, p_member: memberId, p_confirm: confirm }),
  joinGroup: (token: string, name: string, extra: { kana?: string; grade?: string; gender?: string } = {}) =>
    rpc<{ me: { id: string; name: string } }>('join_group', {
      p_token: token, p_name: name, p_kana: extra.kana ?? null, p_grade: extra.grade ?? null, p_gender: extra.gender ?? null,
    }),
  getEvent: (token: string, eventId: string) => rpc<EventView>('get_event', { p_token: token, p_event: eventId }),
  submitAnswers: (token: string, eventId: string, answers: Record<string, Mark | ''>, comment: string | null) =>
    rpc<EventView>('submit_answers', { p_token: token, p_event: eventId, p_answers: answers, p_comment: comment }),
  submitAttendance: (token: string, eventId: string, status: AttendanceStatus, arriveAt: string, comment: string, course: string | null) =>
    rpc<EventView>('submit_attendance', { p_token: token, p_event: eventId, p_status: status, p_arrive_at: arriveAt, p_comment: comment, p_course: course }),
  chooseCourse: (token: string, eventId: string, course: string | null) =>
    rpc<EventView>('choose_course', { p_token: token, p_event: eventId, p_course: course }),
  myEvents: () => rpc<OtherGroup[]>('my_events'),
};

/** 答えるべきなのにまだのもの */
export function isTodo(e: EventSummary): boolean {
  return !e.answered && !e.closed && e.status !== 'done';
}
