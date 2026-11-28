// 運営:イベントを作る(候補日を1つずつ/「火曜と金曜を4週分」のようにまとめて足す・コース)
import { useEffect, useState } from 'react';
import { durationLabel, expandDates, formatDateJa, sortCandidates, todayJst } from '../../core/schedule';
import type { Visibility } from '../../core/types';
import { admin, type AdminGroup, type EventStyle } from '../../lib/admin';
import { checkEventFields, cleanEventFields, emptyEvent, EventFields, type Course, type EventFieldsValue } from './EventFields';
import { Loading, navigate, toast } from '../../ui';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
type Cand = { date: string; time: string; memo: string };

export function CandidatePicker({ list, setList }: { list: Cand[]; setList: (l: Cand[]) => void }) {
  const [one, setOne] = useState<Cand>({ date: '', time: '', memo: '' });
  const [bulk, setBulk] = useState({ open: false, from: todayJst(), weekdays: [] as number[], weeks: 4, time: '' });
  const add = (items: Cand[]) => {
    const key = (c: Cand) => c.date + ' ' + c.time;
    const have = new Set(list.map(key));
    setList(sortCandidates([...list, ...items.filter((c) => c.date && !have.has(key(c)))]));
  };
  return (
    <>
      {list.map((c, i) => (
        <div key={c.date + c.time} className="card row" style={{ padding: '8px 12px' }}>
          <div className="grow"><b>{formatDateJa(c.date)}</b> <span className="muted">{c.time || '時間未定'}{c.memo && ' ・ ' + c.memo}</span></div>
          <button className="chip" onClick={() => setList(list.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="card">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input type="date" value={one.date} onChange={(e) => setOne({ ...one, date: e.target.value })} style={{ flex: '1 1 140px', padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 }} />
          <input type="time" value={one.time} onChange={(e) => setOne({ ...one, time: e.target.value })} style={{ flex: '1 1 100px', padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 }} />
          <input placeholder="メモ(なくてOK)" maxLength={40} value={one.memo} onChange={(e) => setOne({ ...one, memo: e.target.value })} style={{ flex: '2 1 160px', padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 }} />
          <button className="btn small" disabled={!one.date} onClick={() => { add([one]); setOne({ ...one, date: '' }); }}>＋ 足す</button>
        </div>
        <button className="link" onClick={() => setBulk({ ...bulk, open: !bulk.open })}>{bulk.open ? '閉じる' : '曜日でまとめて足す(例:火曜と金曜を4週分)'}</button>
        {bulk.open && (
          <div style={{ marginTop: 6 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <label className="muted">いつから <input type="date" value={bulk.from} onChange={(e) => setBulk({ ...bulk, from: e.target.value })} /></label>
              <label className="muted"><input type="number" min={1} max={12} value={bulk.weeks} onChange={(e) => setBulk({ ...bulk, weeks: +e.target.value })} style={{ width: 56 }} /> 週分</label>
              <label className="muted">時間 <input type="time" value={bulk.time} onChange={(e) => setBulk({ ...bulk, time: e.target.value })} /></label>
            </div>
            <div className="quick" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              {WD.map((w, i) => (
                <button key={w} className="chip" style={bulk.weekdays.includes(i) ? { background: 'var(--ink)', color: '#fff' } : undefined}
                  onClick={() => setBulk({ ...bulk, weekdays: bulk.weekdays.includes(i) ? bulk.weekdays.filter((x) => x !== i) : [...bulk.weekdays, i] })}>{w}</button>
              ))}
            </div>
            <button className="btn small" disabled={!bulk.weekdays.length} onClick={() => add(expandDates(bulk).map((c) => ({ ...c, memo: '' })))}>
              {expandDates(bulk).length}日を足す
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function CourseEditor({ list, setList }: { list: { id?: string; name: string; price: number }[]; setList: (l: { id?: string; name: string; price: number }[]) => void }) {
  return (
    <>
      {list.map((c, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
          <input className="grow" placeholder="例)飲み放題つき" maxLength={30} value={c.name} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 }} />
          <input type="number" min={0} step={100} value={c.price} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, price: Math.max(0, +e.target.value || 0) } : x)))} style={{ width: 90, padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 }} />
          <span className="muted">円</span>
          <button className="chip" onClick={() => setList(list.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="link" onClick={() => setList([...list, { name: '', price: 0 }])}>＋ コースを足す</button>
    </>
  );
}

const DURATIONS = [60, 90, 120, 150, 180, 240, 300, 360, 480];

/** カレンダーに入れる長さ(時刻が決まっているとき) */
export function DurationPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="field"><label>長さ(カレンダーに入れるとき)</label>
      <select value={value} onChange={(e) => onChange(+e.target.value)}>
        {(DURATIONS.includes(value) ? DURATIONS : [...DURATIONS, value].sort((a, b) => a - b)).map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
      </select>
    </div>
  );
}

/** 飲み会かイベントか(11/28 伊吹:お金まわりの画面は飲み会のときだけ) */
export function StylePicker({ value, onChange }: { value: EventStyle; onChange: (v: EventStyle) => void }) {
  return (
    <div className="field">
      <label>種類</label>
      <div className="rsvp" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className={'go' + (value === 'event' ? ' on' : '')} onClick={() => onChange('event')}>イベント<br /><small style={{ fontWeight: 400 }}>遊び・運動会など</small></button>
        <button className={'go' + (value === 'party' ? ' on' : '')} onClick={() => onChange('party')}>飲み会<br /><small style={{ fontWeight: 400 }}>コース・会費・割り勘</small></button>
      </div>
    </div>
  );
}

export function EventForm({ groupId }: { groupId: string }) {
  const [g, setG] = useState<AdminGroup | null>(null);
  const [f, setF] = useState<EventFieldsValue>(emptyEvent);
  const [cands, setCands] = useState<Cand[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => { admin.group(groupId).then((x) => { setG(x); if (x.kind === 'once' && !x.events.length) setF((p) => ({ ...p, name: x.name })); }).catch((e) => setErr(e.message)); }, [groupId]);

  async function create() {
    const problem = checkEventFields(f) || (!cands.length ? '候補日を1つ以上足してください' : '');
    if (problem) { setErr(problem); return; }
    const cs = f.style === 'party' ? courses.filter((c) => c.name.trim()) : [];
    setSending(true); setErr('');
    try {
      const id = await admin.createEvent({ group_id: groupId, ...cleanEventFields(f) }, cands, cs);
      toast('作りました');
      navigate(`/admin/e/${id}`);
    } catch (e) { setErr((e as Error).message); setSending(false); }
  }

  if (!g) return err ? <div className="err">{err}</div> : <Loading />;
  return (
    <>
      <div className="topbar"><button className="back" onClick={() => navigate(`/admin/g/${g.id}`)}>← {g.name}</button></div>
      <h1>イベントを作る</h1>
      <div className="field"><label>名前</label><input maxLength={60} value={f.name} placeholder="例)忘年会" onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <StylePicker value={f.style} onChange={(style) => setF({ ...f, style })} />
      <div className="section">候補日</div>
      <CandidatePicker list={cands} setList={setCands} />
      <div className="field"><label>締め切り(なくてもOK。その日の23:59まで)</label><input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
      <VisibilityPicker value={f.visibility} onChange={(visibility) => setF({ ...f, visibility })} />
      <details>
        <summary>くわしく(説明・場所・リンク・決まったあとの案内・カレンダー{f.style === 'party' ? '・コース' : ''})</summary>
        <EventFields f={f} setF={setF} courses={courses} setCourses={setCourses} />
      </details>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={sending} onClick={create}>{sending ? '作っています…' : '作る'}</button>
    </>
  );
}

export function VisibilityPicker({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <div className="field"><label>結果の見せ方</label>
      <select value={value} onChange={(e) => onChange(e.target.value as Visibility)}>
        <option value="names">名前も見せる</option>
        <option value="counts">人数だけ見せる</option>
        <option value="hidden">見せない(運営だけ)</option>
      </select>
    </div>
  );
}
