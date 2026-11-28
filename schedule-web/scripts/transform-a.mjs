// A案(GAS)の書き出し(a-export.json)を、B案(Supabase)の表の行に変える。純粋な関数(テスト:tests/import.test.ts)
// **名前はここでは表示しない**。呼び出し側も、件数だけを出すこと
import { randomUUID } from 'node:crypto';

const KIND = { 'サークル': 'circle', 'グループ': 'group', '1回きり': 'once' };
const STATUS = { '日程調整中': 'poll', '時間調整中': 'time', '出欠確認中': 'rsvp', '終了': 'done' };
const VIS = { '名前': 'names', '人数': 'counts', '伊吹だけ': 'hidden' };
const MARK = { '○': 'o', '△': 't', '×': 'x' };
const ATT = { '行く': 'go', '途中から': 'partial', '行かない': 'no' };
const MAPS = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.)/i;

const str = (v) => (v == null ? '' : String(v));
const clip = (v, n) => Array.from(str(v)).slice(0, n).join('');
const normName = (v) => str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\s　]+/g, ' ').trim();
const nameKey = (v) => normName(v).replace(/[\s　]/g, '');
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v).slice(0, 10)) ? str(v).slice(0, 10) : null);
const hhmm = (v) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(v));
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};
function parseAnswers(s) {
  const out = {};
  for (const part of str(s).split(',')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const id = part.slice(0, i).trim(), mark = MARK[part.slice(i + 1).trim()];
    if (id && mark) out[id] = mark;
  }
  return out;
}
/** 同じ人の行がいくつかあれば、新しいほう */
function latestBy(rows, key) {
  const m = new Map();
  for (const r of rows || []) {
    const k = str(r[key]);
    if (!k) continue;
    const cur = m.get(k);
    if (!cur || (Number(r.updatedAt) || 0) >= (Number(cur.updatedAt) || 0)) m.set(k, r);
  }
  return m;
}

/**
 * @param {object} data a-export.json の中身(format: 'schedule-a-export-v1')
 * @param {{ only?: string[], newId?: () => string }} opts only = 入れる A のグループID
 * @returns 表ごとの行・A のグループID → B のグループID・件数と注意(名前は入れない)
 */
export function transformA(data, opts = {}) {
  if (!data || data.format !== 'schedule-a-export-v1') throw new Error('a-export.json の形がちがいます(A案の「書き出す」で作ったファイルか確かめてください)');
  const newId = opts.newId ?? randomUUID;
  const only = opts.only && opts.only.length ? new Set(opts.only) : null;
  const out = { groups: [], members: [], events: [], candidates: [], decided: [], answers: [], responses: [], wanted: [] };
  const warnings = [];
  const groupMap = {};

  for (const g of data.groups || []) {
    if (only && !only.has(g.id)) continue;
    const kind = KIND[g.kind];
    if (!kind) { warnings.push(`グループ ${g.id}:種類が分からないので入れません`); continue; }
    const gid = newId();
    groupMap[g.id] = gid;
    out.groups.push({ id: gid, name: clip(normName(g.name), 40) || 'グループ', kind, mascot: g.mascot !== false, import_key: g.id });

    // メンバー(同じグループで同じ名前が2人いたら、あとの人は「削除した」扱いで入れる)
    const mem = {};
    const seen = new Set();
    for (const m of g.members || []) {
      const name = clip(normName(m.name), 20);
      if (!name) { warnings.push(`グループ ${g.id}:名前が空のメンバー ${m.memberId} は入れません`); continue; }
      let active = !!m.active;
      if (active && seen.has(nameKey(name))) { active = false; warnings.push(`グループ ${g.id}:メンバー ${m.memberId} は同じ名前の人がいるので「削除した」に入れました`); }
      if (active) seen.add(nameKey(name));
      const id = newId();
      mem[m.memberId] = id;
      out.members.push({
        id, group_id: gid, name, active,
        kana: kind === 'circle' && m.kana ? clip(normName(m.kana), 40) : null,
        grade: kind === 'circle' && m.grade ? clip(m.grade, 10) : null,
        gender: kind === 'circle' && m.gender ? clip(m.gender, 10) : null,
        roster_key: m.rosterId ? str(m.rosterId) : null,
      });
    }

    for (const ev of g.events || []) {
      const eid = newId();
      const url = str(ev.url).trim();
      const isUrl = /^https?:\/\/\S+$/.test(url);
      const status = STATUS[ev.status] ?? 'poll';
      out.events.push({
        id: eid, group_id: gid, name: clip(normName(ev.name), 60) || 'イベント', description: clip(ev.description, 1000),
        place: clip(ev.place, 100), cost: clip(ev.cost, 100), status, visibility: VIS[ev.visibility] ?? 'names',
        deadline: ymd(ev.deadline), place_url: isUrl && MAPS.test(url) ? url.slice(0, 500) : '',
        links: isUrl && !MAPS.test(url) ? [{ label: 'リンク', url: url.slice(0, 500) }] : [],
      });
      // 候補日
      const cand = {};
      const candRows = [];
      for (const c of ev.candidates || []) {
        const date = ymd(c.date);
        if (!date) { warnings.push(`イベント ${ev.id}:日付の読めない候補 ${c.id} は入れません`); continue; }
        const id = newId();
        cand[c.id] = id;
        const row = { id, event_id: eid, date, time: hhmm(c.time), memo: clip(c.memo, 40), stage: c.stage === 'time' ? 'time' : 'date' };
        candRows.push(row);
        out.candidates.push(row);
      }
      // 決まった候補(時間調整中は「決めた日」。時間まで決めたら、その日の日程の候補も覚えておく)
      const dec = cand[ev.decidedId] ?? null;
      if (status !== 'poll' && dec) {
        const d = candRows.find((c) => c.id === dec);
        let dateId = null;
        if (status === 'time') dateId = dec;
        else if (d.stage === 'time') dateId = candRows.find((c) => c.stage === 'date' && c.date === d.date)?.id ?? null;
        out.decided.push({ id: eid, decided_candidate_id: dec, decided_date_id: dateId });
      } else if (status !== 'poll') {
        warnings.push(`イベント ${ev.id}:決まった日が見つからないので「日程調整中」として入れます`);
        out.events[out.events.length - 1].status = 'poll';
      }
      // 答え・ひとこと・出欠
      const resp = new Map();
      const respOf = (mid) => {
        if (!resp.has(mid)) resp.set(mid, { group_id: gid, event_id: eid, member_id: mid, comment: '', attendance: null, arrive_at: '', att_comment: '' });
        return resp.get(mid);
      };
      for (const [aMid, r] of latestBy(ev.answers, 'memberId')) {
        const mid = mem[aMid];
        if (!mid) continue;
        for (const [aCid, mark] of Object.entries(parseAnswers(r.answers))) {
          if (cand[aCid]) out.answers.push({ group_id: gid, event_id: eid, member_id: mid, candidate_id: cand[aCid], mark });
        }
        const comment = clip(normName(r.comment), 100);
        if (comment) respOf(mid).comment = comment;
      }
      for (const [aMid, r] of latestBy(ev.attendance, 'memberId')) {
        const mid = mem[aMid];
        const att = ATT[str(r.status)];
        if (!mid || !att) continue;
        const x = respOf(mid);
        x.attendance = att;
        x.arrive_at = att === 'partial' ? hhmm(r.arriveAt) : '';
        x.att_comment = clip(normName(r.comment), 100);
      }
      out.responses.push(...resp.values());
      for (const aMid of new Set(ev.wanted || [])) if (mem[aMid]) out.wanted.push({ group_id: gid, event_id: eid, member_id: mem[aMid] });
    }
  }
  const counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));
  return { rows: out, groupMap, counts, warnings };
}

/** 入れる前に見せる、グループの一覧(名前はグループ名だけ。メンバーの名前は出さない) */
export function listGroups(data) {
  return (data.groups || []).map((g) => ({
    id: g.id, name: g.name, kind: g.kind,
    members: (g.members || []).filter((m) => m.active).length, events: (g.events || []).length,
  }));
}
