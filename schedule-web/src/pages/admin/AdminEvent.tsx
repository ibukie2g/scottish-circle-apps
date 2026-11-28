// 運営:イベントの画面(結果・決める・時間も聞く・出欠・コースと会費・割り勘・答えていない人・代わりに入れる)
import { useEffect, useMemo, useState } from 'react';
import { currentStage, filterMembers, formatDateJa, stageCandidates, summarize, unanswered } from '../../core/schedule';
import type { AttendanceStatus, Mark, Member, Visibility } from '../../core/types';
import { admin, copyText, nowLabel, participantLink, toStatusInput, type EventStyle, type StaffResults } from '../../lib/admin';
import { eventStatusLines } from '../../core/status';
import { Confirm, Loading, navigate, toast } from '../../ui';
import { StatusBadge } from './AdminGroups';
import { CandidatePicker, StylePicker, VisibilityPicker } from './EventForm';
import { checkEventFields, cleanEventFields, EventFields, type Course, type EventFieldsValue } from './EventFields';

const ATT: [AttendanceStatus, string][] = [['go', '行く'], ['partial', '途中から'], ['no', '行かない']];
const MARKS: [Mark, string][] = [['o', '○'], ['t', '△'], ['x', '×']];
const yen = (n: number) => n.toLocaleString('ja-JP') + '円';

type Modal =
  | { kind: 'decide'; candId: string; askTime: boolean; times: string[] }
  | { kind: 'proxy'; memberId: string; marks: Record<string, Mark | ''> }
  | { kind: 'wanted'; ids: string[] }
  | { kind: 'edit' }
  | { kind: 'addCands'; list: { date: string; time: string; memo: string }[] }
  | { kind: 'addTimes'; times: string[] }
  | null;

export function AdminEvent({ id }: { id: string }) {
  const [r, setR] = useState<StaffResults | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<{ grade?: string; gender?: string }>({});
  const [modal, setModal] = useState<Modal>(null);
  const [confirm, setConfirm] = useState<{ text: string; yes: string; run: () => Promise<unknown> } | null>(null);
  const [bill, setBill] = useState('');

  const load = () => admin.results(id).then(setR).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'event' in res) setR(res as StaffResults);
      else await load();
      toast(msg);
      setModal(null);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const calc = useMemo(() => {
    if (!r) return null;
    const ev = r.event;
    const stage = currentStage(ev.status);
    const cands = stageCandidates(r.candidates, stage);
    const all: Member[] = r.members.map((m) => ({ id: m.id, name: m.name, kana: m.kana ?? undefined, grade: m.grade ?? undefined, gender: m.gender ?? undefined }));
    const members = filterMembers(all, filter);
    const answers = r.members.flatMap((m) => Object.entries(m.answers).map(([candidateId, mark]) => ({ memberId: m.id, candidateId, mark })));
    const sum = summarize(cands, answers, members, { wanted: r.wanted });
    const dateSum = stage === 'time' || ev.status !== 'poll' ? summarize(stageCandidates(r.candidates, 'date'), answers, members, { wanted: r.wanted }) : null;
    const notYet = ev.status === 'rsvp' || ev.status === 'done'
      ? members.filter((m) => !r.members.find((x) => x.id === m.id)?.attendance)
      : unanswered(members, answers, cands.map((c) => c.id));
    return { stage, cands, members, sum, dateSum, notYet };
  }, [r, filter]);

  if (err) return <div className="err">{err}</div>;
  if (!r || !calc) return <Loading />;
  const ev = r.event, g = r.group;
  const link = participantLink(g.token, g.kind === 'once' ? undefined : ev.id);
  const grades = [...new Set(r.members.map((m) => m.grade).filter(Boolean))] as string[];
  const genders = [...new Set(r.members.map((m) => m.gender).filter(Boolean))] as string[];
  const isRsvp = ev.status === 'rsvp' || ev.status === 'done';
  const party = ev.style === 'party'; // 飲み会のときだけ、コース・会費・割り勘を出す
  const decidedCand = r.candidates.find((c) => c.id === ev.decided_candidate_id);

  // ---- 見出し ----
  const head = (
    <>
      <div className="topbar"><button className="back" onClick={() => navigate(`/admin/g/${g.id}`)}>← {g.name}</button></div>
      <div className="row"><h1 className="grow">{ev.name}</h1><StatusBadge s={ev.status} /></div>
      <div className="meta">
        {ev.deadline && ev.status === 'poll' && <>締め切り <b>{formatDateJa(ev.deadline)}</b> ・ </>}
        {ev.decided && <>決定 <b>{formatDateJa(ev.decided.date)}{ev.decided.time && ' ' + ev.decided.time}</b> ・ </>}
        {!isRsvp && <>回答 {calc.sum.answeredCount}/{calc.sum.memberCount}人</>}
      </div>
      <div className="quick" style={{ flexWrap: 'wrap' }}>
        <button className="chip" onClick={async () => toast((await copyText(link)) ? 'リンクをコピーしました' : 'コピーできませんでした')}>リンクをコピー</button>
        <button className="chip" onClick={() => run(load, '最新にしました')}>最新にする</button>
        <button className="chip" onClick={async () => {
          const text = [`${nowLabel()} 時点の状況(名前なし)`, '', ...eventStatusLines(toStatusInput(r, g.name))].join('\n');
          toast((await copyText(text)) ? '状況をコピーしました(名前なし)' : 'コピーできませんでした');
        }}>状況をコピー(名前なし)</button>
        <button className="chip" onClick={() => setModal({ kind: 'edit' })}>変える</button>
        {(grades.length > 1 || genders.length > 1) && (
          <>
            {grades.length > 1 && <select value={filter.grade ?? ''} onChange={(e) => setFilter({ ...filter, grade: e.target.value || undefined })}><option value="">全学年</option>{grades.map((x) => <option key={x}>{x}</option>)}</select>}
            {genders.length > 1 && <select value={filter.gender ?? ''} onChange={(e) => setFilter({ ...filter, gender: e.target.value || undefined })}><option value="">男女とも</option>{genders.map((x) => <option key={x}>{x}</option>)}</select>}
          </>
        )}
      </div>
    </>
  );

  // ---- 候補ごとの結果カード ----
  const resultCards = (sum: typeof calc.sum, timeOnly: boolean, act: 'decide' | 'decideTime' | null) => sum.byDate.map((b) => (
    <div key={b.candidateId} className={'card res' + (b.best ? ' best' : '')}>
      {b.best && <div className="crown">{timeOnly ? 'いちばん多い時間' : 'いちばん多い日'}</div>}
      <div className="row">
        <b className="grow" style={{ fontSize: 16 }}>
          {timeOnly ? `${b.time}〜` : <>{formatDateJa(b.date)}{b.time && <span className="muted"> {b.time}</span>}</>}
          {b.memo && <span className="muted" style={{ fontSize: 12 }}> {b.memo}</span>}
        </b>
        <span className="cnt"><span className="o">○{b.o}</span><span className="t">△{b.t}</span><span className="x">×{b.x}</span></span>
      </div>
      {b.names && (
        <div className="names">
          {MARKS.map(([m, lab]) => b.names![m].length > 0 && <div key={m}><span className={'lab ' + m}>{lab}</span>{b.names![m].join('・')}</div>)}
        </div>
      )}
      {b.wanted && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>来てほしい人:○{b.wanted.ok.length} △{b.wanted.maybe.length} ×{b.wanted.ng.length} まだ{b.wanted.none.length}</div>}
      {act && (
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end', gap: 6 }}>
          {act === 'decide' && <button className="chip" onClick={() => setConfirm({ text: `${formatDateJa(b.date)} を候補から消しますか?この日への答えも消えます。`, yes: '消す', run: () => admin.removeCandidates([b.candidateId]) })}>候補から消す</button>}
          <button className="btn small" style={{ background: 'var(--o)' }} disabled={busy}
            onClick={() => act === 'decide'
              ? setModal({ kind: 'decide', candId: b.candidateId, askTime: false, times: b.time ? [b.time] : ['18:00', '19:00'] })
              : setConfirm({ text: `${b.time}〜 に決めて、出欠確認に進みますか?`, yes: '決める', run: () => admin.decideTime(ev.id, b.candidateId) })}>
            {act === 'decide' ? 'この日に決める' : 'この時間に決める'}
          </button>
        </div>
      )}
    </div>
  ));

  // ---- 出欠・コース・会費 ----
  const coursePrice = (cid: string | null) => r.courses.find((c) => c.id === cid)?.price ?? 0;
  const att = { go: 0, partial: 0, no: 0 };
  let expected = 0, collected = 0, paidCount = 0;
  const shown = new Set(calc.members.map((m) => m.id));
  for (const m of r.members) {
    if (!shown.has(m.id)) continue;
    if (m.attendance) att[m.attendance]++;
    if (m.attendance && m.attendance !== 'no') expected += coursePrice(m.course_id);
    if (m.paid) { paidCount++; collected += coursePrice(m.course_id); }
  }
  const comers = att.go + att.partial;
  const perHead = comers && +bill > 0 ? Math.ceil(+bill / comers / 10) * 10 : 0;

  const rsvpPart = isRsvp && (
    <>
      <div className="section">出欠</div>
      <div className="card">
        <div className="cnt"><span className="o">行く {att.go}</span><span className="t">途中から {att.partial}</span><span className="x">行かない {att.no}</span><span>まだ {calc.notYet.length}</span></div>
        {party && r.courses.length > 0 && (
          <div className="muted" style={{ marginTop: 6 }}>
            {r.courses.map((c) => `${c.name} ${r.members.filter((m) => shown.has(m.id) && m.course_id === c.id && m.attendance !== 'no').length}人`).join(' ・ ')}
            <br />会費の予定 {yen(expected)} ・ 受け取り済み {paidCount}人 {r.courses.some((c) => c.price) && yen(collected)}
          </div>
        )}
      </div>
      {r.members.filter((m) => shown.has(m.id)).map((m) => (
        <div key={m.id} className="card" style={{ padding: '8px 12px' }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <b className="grow">{m.name}{m.arrive_at && m.attendance === 'partial' && <span className="muted"> ({m.arrive_at}〜)</span>}</b>
            <select value={m.attendance ?? ''} onChange={(e) => run(() => admin.saveResponse(r, m.id, { attendance: (e.target.value || null) as AttendanceStatus | null }), '変えました')}>
              <option value="">まだ</option>{ATT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {party && r.courses.length > 0 && (
              <select value={m.course_id ?? ''} onChange={(e) => run(() => admin.saveResponse(r, m.id, { course_id: e.target.value || null }), '変えました')}>
                <option value="">コース未定</option>{r.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {party && <label className="muted" style={{ whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={m.paid} onChange={(e) => run(() => admin.saveResponse(r, m.id, { paid: e.target.checked }), e.target.checked ? '受け取りました' : '受け取りを外しました')} /> 受け取り
            </label>}
          </div>
          {m.att_comment && <div className="muted" style={{ fontSize: 12 }}>{m.att_comment}</div>}
          {party && m.paid && m.attendance === 'no' && <div className="err" style={{ fontSize: 12, margin: 0 }}>払ったあとで「行かない」になっています(返金するか確認)</div>}
        </div>
      ))}
      {party && <div className="card">
        <b>割り勘の計算</b>
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <span className="muted">合計</span>
          <input type="number" min={0} step={100} value={bill} placeholder="お店の合計" onChange={(e) => setBill(e.target.value)} style={{ width: 120, padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 }} />
          <span className="muted">円 ÷ 来る人 {comers}人 =</span>
          <b>{perHead ? yen(perHead) : '—'}</b>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>10円単位で切り上げ。途中からの人も1人として数えています</div>
      </div>}
    </>
  );

  const comments = r.members.filter((m) => shown.has(m.id) && (m.comment || m.att_comment));
  return (
    <>
      {head}
      {ev.notice && ev.status !== 'poll' && <div className="note" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>📣 {ev.notice}<div className="muted" style={{ fontSize: 11 }}>参加者に出ている案内</div></div>}
      {party && ev.status === 'time' && r.courses.length > 0 && (
        <div className="card muted">コース:{r.courses.map((c) => `${c.name} ${r.members.filter((m) => m.course_id === c.id).length}人`).join(' ・ ')} ・ まだ {r.members.filter((m) => !m.course_id).length}人</div>
      )}
      {ev.status === 'time' && decidedCand && (
        <div className="decided"><div className="muted">決まった日</div><div className="big">{formatDateJa(decidedCand.date)}</div><div className="muted">何時からがいいかを聞いています</div></div>
      )}
      {isRsvp && ev.decided && (
        <div className="decided"><div className="muted">決まった日</div><div className="big">{formatDateJa(ev.decided.date)}{ev.decided.time && ` ${ev.decided.time}〜`}</div></div>
      )}

      {ev.status === 'poll' && <>{resultCards(calc.sum, false, 'decide')}<button className="chip" onClick={() => setModal({ kind: 'addCands', list: [] })}>＋ 候補日を足す</button></>}
      {ev.status === 'time' && <>{resultCards(calc.sum, true, 'decideTime')}<button className="chip" onClick={() => setModal({ kind: 'addTimes', times: [''] })}>＋ 時間の候補を足す</button></>}
      {rsvpPart}

      <div className="section">{isRsvp ? '出欠をまだ答えていない人' : '答えていない人'}({calc.notYet.length}人)</div>
      <div className="card">{calc.notYet.length ? calc.notYet.map((m) => m.name).join('・') : <span className="muted">全員答えています</span>}</div>

      {comments.length > 0 && (
        <>
          <div className="section">ひとこと</div>
          <div className="card">{comments.map((m) => <div key={m.id}><b>{m.name}</b>:{[m.comment, m.att_comment].filter(Boolean).join(' / ')}</div>)}</div>
        </>
      )}

      {calc.dateSum && (ev.status !== 'poll') && (
        <details><summary>日程調整のときの結果</summary>{resultCards(calc.dateSum, false, null)}</details>
      )}

      <div className="section">そのほか</div>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}><span className="grow">来てほしい人({r.wanted.length}人)</span><button className="chip" onClick={() => setModal({ kind: 'wanted', ids: r.wanted })}>選ぶ</button></div>
        {!isRsvp && <div className="row"><span className="grow">LINEなどで聞いた答えを代わりに入れる</span><button className="chip" onClick={() => setModal({ kind: 'proxy', memberId: '', marks: {} })}>入れる</button></div>}
      </div>
      <div className="quick" style={{ flexWrap: 'wrap', marginTop: 12 }}>
        {(ev.status === 'time' || ev.status === 'rsvp') && (
          <button className="chip" onClick={() => setConfirm({
            text: ev.status === 'time' ? '日程調整中に戻しますか?時間の候補と、時間への答えは消えます。' : '1段戻しますか?(出欠の答えは残ります)',
            yes: '戻す', run: () => admin.undecide(ev.id),
          })}>{ev.status === 'rsvp' && decidedCand?.stage === 'time' ? '時間の調整に戻す' : '日程調整に戻す'}</button>
        )}
        {ev.status === 'rsvp' && <button className="chip" onClick={() => setConfirm({ text: 'このイベントを「終了」にしますか?参加者は出欠を変えられなくなります。', yes: '終了にする', run: () => admin.updateEvent(ev.id, { status: 'done' }) })}>終了にする</button>}
        {ev.status === 'done' && <button className="chip" onClick={() => run(() => admin.updateEvent(ev.id, { status: 'rsvp' }), '出欠確認に戻しました')}>出欠確認に戻す</button>}
        <button className="chip" style={{ color: 'var(--danger)' }} onClick={() => setConfirm({ text: `「${ev.name}」を削除しますか?答えもすべて消え、元に戻せません。`, yes: '削除する', run: async () => { await admin.deleteEvent(ev.id); navigate(`/admin/g/${g.id}`); } })}>イベントを削除</button>
      </div>

      {modal && <EventModal r={r} modal={modal} setModal={setModal} busy={busy} run={run} />}
      {confirm && (
        <Confirm text={confirm.text} yes={confirm.yes} no="やめる"
          onYes={() => { const c = confirm; setConfirm(null); run(c.run, '終わりました'); }}
          onNo={() => setConfirm(null)} />
      )}
    </>
  );
}

function EventModal({ r, modal, setModal, busy, run }: {
  r: StaffResults; modal: NonNullable<Modal>; setModal: (m: Modal) => void; busy: boolean;
  run: (fn: () => Promise<unknown>, msg: string) => Promise<void>;
}) {
  const ev = r.event;
  const close = () => setModal(null);
  let body: React.ReactNode = null;

  if (modal.kind === 'decide') {
    const c = r.candidates.find((x) => x.id === modal.candId)!;
    const times = modal.times.filter((t) => /^\d{2}:\d{2}$/.test(t));
    body = (
      <>
        <h2 style={{ marginTop: 0 }}>{formatDateJa(c.date)} に決める</h2>
        <label className="card row" style={{ cursor: 'pointer' }}><input type="radio" checked={!modal.askTime} onChange={() => setModal({ ...modal, askTime: false })} style={{ width: 'auto' }} />
          <span className="grow">そのまま出欠確認に進む{c.time && `(${c.time}〜)`}</span></label>
        <label className="card row" style={{ cursor: 'pointer' }}><input type="radio" checked={modal.askTime} onChange={() => setModal({ ...modal, askTime: true })} style={{ width: 'auto' }} />
          <span className="grow">時間も聞く(同じリンクのまま、時間の候補に答えてもらう)</span></label>
        {modal.askTime && (
          <div className="card">
            {modal.times.map((t, i) => (
              <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
                <input type="time" value={t} onChange={(e) => setModal({ ...modal, times: modal.times.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button className="chip" onClick={() => setModal({ ...modal, times: modal.times.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button className="link" onClick={() => setModal({ ...modal, times: [...modal.times, ''] })}>＋ 時間</button>
          </div>
        )}
        <button className="btn" disabled={busy || (modal.askTime && !times.length)}
          onClick={() => run(() => admin.decide(ev.id, c.id, modal.askTime ? times : null), modal.askTime ? '時間を聞く形にしました' : '決めました')}>決める</button>
      </>
    );
  } else if (modal.kind === 'proxy') {
    const stage = currentStage(ev.status);
    const cands = stageCandidates(r.candidates, stage);
    const m = r.members.find((x) => x.id === modal.memberId);
    body = (
      <>
        <h2 style={{ marginTop: 0 }}>代わりに入れる</h2>
        <div className="field"><select value={modal.memberId} onChange={(e) => {
          const mm = r.members.find((x) => x.id === e.target.value);
          setModal({ ...modal, memberId: e.target.value, marks: Object.fromEntries(cands.map((c) => [c.id, mm?.answers[c.id] ?? ''])) });
        }}><option value="">だれの答え?</option>{r.members.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        {m && cands.map((c) => (
          <div key={c.id} className="card row">
            <div className="date grow">{stage === 'time' ? `${c.time}〜` : formatDateJa(c.date)}</div>
            <div className="opts">{MARKS.map(([mk, lab]) => (
              <button key={mk} className={`opt ${mk}${modal.marks[c.id] === mk ? ' on' : ''}`}
                onClick={() => setModal({ ...modal, marks: { ...modal.marks, [c.id]: modal.marks[c.id] === mk ? '' : mk } })}>{lab}</button>
            ))}</div>
          </div>
        ))}
        <button className="btn" disabled={busy || !m} onClick={() => run(() => admin.saveProxy(r, modal.memberId, modal.marks), `${m?.name} さんの答えを入れました`)}>保存</button>
      </>
    );
  } else if (modal.kind === 'wanted') {
    body = (
      <>
        <h2 style={{ marginTop: 0 }}>来てほしい人</h2>
        <div className="muted">選んだ人がそれぞれの日に来られるかが、結果に出ます</div>
        <div style={{ maxHeight: '50vh', overflow: 'auto', margin: '8px 0' }}>
          {r.members.map((m) => (
            <label key={m.id} className="row" style={{ padding: '6px 2px' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={modal.ids.includes(m.id)}
                onChange={(e) => setModal({ ...modal, ids: e.target.checked ? [...modal.ids, m.id] : modal.ids.filter((x) => x !== m.id) })} />
              <span>{m.name}</span>
            </label>
          ))}
        </div>
        <button className="btn" disabled={busy} onClick={() => run(() => admin.setWanted(r, modal.ids), '保存しました')}>保存</button>
      </>
    );
  } else if (modal.kind === 'addCands') {
    body = (
      <>
        <h2 style={{ marginTop: 0 }}>候補日を足す</h2>
        <CandidatePicker list={modal.list} setList={(list) => setModal({ ...modal, list })} />
        <button className="btn" disabled={busy || !modal.list.length} onClick={() => run(() => admin.addCandidates(ev.id, modal.list), '足しました')}>{modal.list.length}日を足す</button>
      </>
    );
  } else if (modal.kind === 'addTimes') {
    const date = r.candidates.find((c) => c.id === ev.decided_candidate_id)?.date ?? '';
    const times = modal.times.filter((t) => /^\d{2}:\d{2}$/.test(t));
    body = (
      <>
        <h2 style={{ marginTop: 0 }}>時間の候補を足す</h2>
        {modal.times.map((t, i) => (
          <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
            <input type="time" value={t} onChange={(e) => setModal({ ...modal, times: modal.times.map((x, j) => (j === i ? e.target.value : x)) })} />
            <button className="chip" onClick={() => setModal({ ...modal, times: modal.times.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="link" onClick={() => setModal({ ...modal, times: [...modal.times, ''] })}>＋ 時間</button>
        <button className="btn" disabled={busy || !times.length} onClick={() => run(() => admin.addCandidates(ev.id, times.map((time) => ({ date, time, stage: 'time' as const }))), '足しました')}>足す</button>
      </>
    );
  } else if (modal.kind === 'edit') {
    body = <EditEvent r={r} busy={busy} run={run} />;
  }

  return (
    <div className="dialog-back" onClick={close}>
      <div className="dialog" style={{ maxWidth: 520, maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        {body}
        <button className="btn ghost" onClick={close}>閉じる</button>
      </div>
    </div>
  );
}

function EditEvent({ r, busy, run }: { r: StaffResults; busy: boolean; run: (fn: () => Promise<unknown>, msg: string) => Promise<void> }) {
  const ev = r.event;
  const [f, setF] = useState<EventFieldsValue>({
    name: ev.name, description: ev.description, place: ev.place, place_url: ev.place_url ?? '', cost: ev.cost,
    links: ev.links ?? [], deadline: ev.deadline ?? '', visibility: ev.visibility as Visibility, style: ev.style as EventStyle,
    notice: ev.notice, duration_min: ev.duration_min ?? 120,
  });
  const [courses, setCourses] = useState<Course[]>(r.courses);
  const [err, setErr] = useState('');
  async function save() {
    await admin.updateEvent(ev.id, cleanEventFields(f));
    const keep = f.style === 'party' ? courses.filter((c) => c.name.trim()) : r.courses;
    await admin.setCourses(ev.id, keep, r.courses.filter((c) => !keep.some((k) => k.id === c.id)).map((c) => c.id));
  }
  return (
    <>
      <h2 style={{ marginTop: 0 }}>イベントを変える</h2>
      <div className="field"><label>名前</label><input maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <StylePicker value={f.style} onChange={(style) => setF({ ...f, style })} />
      <div className="field"><label>締め切り</label><input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
      <VisibilityPicker value={f.visibility} onChange={(visibility) => setF({ ...f, visibility })} />
      <EventFields f={f} setF={setF} courses={courses} setCourses={setCourses} />
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy} onClick={() => {
        const problem = checkEventFields(f);
        if (problem) { setErr(problem); return; }
        setErr('');
        run(save, '保存しました');
      }}>保存</button>
    </>
  );
}
