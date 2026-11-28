// 運営の画面から使うデータ。表は RLS で「自分が管理できる行」だけが読み書きできる
import type { AttendanceStatus, EventStatus, Mark, Stage, Visibility } from '../core/types';
import type { Kind } from './api';
import { supabase } from './supabase';

/** 飲み会(コース・会費・割り勘を使う)/イベント(遊び・運動会など) */
export type EventStyle = 'event' | 'party';

export interface AdminGroup {
  id: string; name: string; kind: Kind; token: string; mascot: boolean; archived: boolean; created_at: string;
  events: { id: string; name: string; status: EventStatus; deadline: string | null; created_at: string }[];
}

export interface AdminMember {
  id: string; name: string; kana: string | null; grade: string | null; gender: string | null; active: boolean; user_id: string | null;
}

export interface StaffResults {
  event: {
    id: string; group_id: string; name: string; description: string; place: string; cost: string; url: string;
    status: EventStatus; visibility: Visibility; deadline: string | null;
    decided_candidate_id: string | null; decided: { date: string; time: string } | null;
    style: EventStyle; notice: string; duration_min: number; place_url: string; links: { label: string; url: string }[];
  };
  group: { id: string; name: string; kind: Kind; token: string };
  candidates: { id: string; date: string; time: string; memo: string; stage: Stage }[];
  courses: { id: string; name: string; price: number }[];
  wanted: string[];
  members: {
    id: string; name: string; kana: string | null; grade: string | null; gender: string | null;
    answers: Record<string, Mark>; comment: string; attendance: AttendanceStatus | null; arrive_at: string;
    att_comment: string; course_id: string | null; paid: boolean;
  }[];
}

/** エラーを日本語に(表の制約・トリガーのメッセージから) */
export function adminError(e: { message?: string } | null | undefined): Error {
  const m = e?.message ?? '';
  if (/members_name_active|duplicate key/.test(m)) return new Error('同じ名前の人がいます');
  const own = /(?:INVALID|FORBIDDEN|TOO_MANY|IMMUTABLE): (.+)/.exec(m);
  if (own) return new Error(own[1]);
  if (/FORBIDDEN|row-level security/.test(m)) return new Error('この操作はできません(権限がありません)');
  if (/fetch|network/i.test(m)) return new Error('通信できませんでした。もう一度ためしてください');
  return new Error('うまくいきませんでした。少し待ってからもう一度ためしてください');
}

async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw adminError(error);
  return data as T;
}

export const admin = {
  groups: () => q<AdminGroup[]>(supabase.from('groups')
    .select('id, name, kind, token, mascot, archived, created_at, events(id, name, status, deadline, created_at)')
    .order('created_at', { ascending: false })),
  group: (id: string) => q<AdminGroup>(supabase.from('groups')
    .select('id, name, kind, token, mascot, archived, created_at, events(id, name, status, deadline, created_at)').eq('id', id).single()),
  createGroup: (name: string, kind: Kind) => q<{ id: string }>(supabase.from('groups').insert({ name, kind }).select('id').single()),
  updateGroup: (id: string, patch: Partial<Pick<AdminGroup, 'name' | 'kind' | 'mascot' | 'archived'>>) =>
    q(supabase.from('groups').update(patch).eq('id', id)),
  members: (groupId: string) => q<AdminMember[]>(supabase.from('members')
    .select('id, name, kana, grade, gender, active, user_id').eq('group_id', groupId).order('kana', { nullsFirst: false }).order('name')),
  setMemberActive: (id: string, active: boolean) => q(supabase.from('members').update({ active }).eq('id', id)),
  /** メンバーごとの「答えたイベントの数」 */
  answeredCounts: async (eventIds: string[]) => {
    if (!eventIds.length) return {} as Record<string, number>;
    const rows = await q<{ member_id: string; event_id: string }[]>(supabase.from('answers').select('member_id, event_id').in('event_id', eventIds));
    const sets: Record<string, Set<string>> = {};
    for (const r of rows) (sets[r.member_id] ??= new Set()).add(r.event_id);
    return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.size]));
  },

  results: (eventId: string) => q<StaffResults>(supabase.rpc('staff_event_results', { p_event: eventId })),
  decide: (eventId: string, candidateId: string, times: string[] | null) =>
    q<StaffResults>(supabase.rpc('staff_decide', { p_event: eventId, p_candidate: candidateId, p_times: times })),
  decideTime: (eventId: string, candidateId: string) =>
    q<StaffResults>(supabase.rpc('staff_decide_time', { p_event: eventId, p_candidate: candidateId })),
  undecide: (eventId: string) => q<StaffResults>(supabase.rpc('staff_undecide', { p_event: eventId })),

  createEvent: async (ev: {
    group_id: string; name: string; description: string; place: string; cost: string; place_url: string;
    links: { label: string; url: string }[];
    deadline: string | null; visibility: Visibility; style: EventStyle; notice: string; duration_min: number;
  }, candidates: { date: string; time: string; memo: string }[], courses: { name: string; price: number }[]) => {
    const { id } = await q<{ id: string }>(supabase.from('events').insert(ev).select('id').single());
    if (candidates.length) await q(supabase.from('candidates').insert(candidates.map((c) => ({ ...c, event_id: id }))));
    if (courses.length) await q(supabase.from('event_courses').insert(courses.map((c, i) => ({ ...c, sort: i, event_id: id }))));
    return id;
  },
  updateEvent: (id: string, patch: Partial<{ name: string; description: string; place: string; cost: string; url: string;
    place_url: string; links: { label: string; url: string }[];
    deadline: string | null; visibility: Visibility; status: EventStatus; style: EventStyle; notice: string; duration_min: number }>) => q(supabase.from('events').update(patch).eq('id', id)),
  deleteEvent: (id: string) => q(supabase.from('events').delete().eq('id', id)),
  addCandidates: (eventId: string, list: { date: string; time: string; memo?: string; stage?: Stage }[]) =>
    q(supabase.from('candidates').insert(list.map((c) => ({ memo: '', stage: 'date', ...c, event_id: eventId })))),
  removeCandidates: (ids: string[]) => q(supabase.from('candidates').delete().in('id', ids)),
  setCourses: async (eventId: string, list: { id?: string; name: string; price: number }[], removed: string[]) => {
    if (removed.length) await q(supabase.from('event_courses').delete().in('id', removed));
    for (const [i, c] of list.entries()) {
      if (c.id) await q(supabase.from('event_courses').update({ name: c.name, price: c.price, sort: i }).eq('id', c.id));
      else await q(supabase.from('event_courses').insert({ event_id: eventId, name: c.name, price: c.price, sort: i }));
    }
  },

  /** 代わりに入れる(LINEなどで聞いた答え) */
  saveProxy: async (r: StaffResults, memberId: string, marks: Record<string, Mark | ''>) => {
    const set = Object.entries(marks).filter(([, m]) => m);
    const clear = Object.entries(marks).filter(([, m]) => !m).map(([id]) => id);
    if (set.length) await q(supabase.from('answers').upsert(set.map(([candidate_id, mark]) => ({
      group_id: r.group.id, event_id: r.event.id, member_id: memberId, candidate_id, mark,
    })), { onConflict: 'member_id,candidate_id' }));
    if (clear.length) await q(supabase.from('answers').delete().eq('member_id', memberId).in('candidate_id', clear));
  },
  saveResponse: (r: StaffResults, memberId: string, patch: { attendance?: AttendanceStatus | null; paid?: boolean; course_id?: string | null }) =>
    q(supabase.from('responses').upsert({
      group_id: r.group.id, event_id: r.event.id, member_id: memberId, ...patch,
      ...(patch.paid !== undefined ? { paid_at: patch.paid ? new Date().toISOString() : null } : {}),
    }, { onConflict: 'event_id,member_id' })),
  setWanted: async (r: StaffResults, ids: string[]) => {
    await q(supabase.from('wanted').delete().eq('event_id', r.event.id));
    if (ids.length) await q(supabase.from('wanted').insert(ids.map((member_id) => ({ group_id: r.group.id, event_id: r.event.id, member_id }))));
  },
};

export const participantLink = (token: string, eventId?: string) =>
  location.origin + '/g/' + token + (eventId ? '/e/' + eventId : '');

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
