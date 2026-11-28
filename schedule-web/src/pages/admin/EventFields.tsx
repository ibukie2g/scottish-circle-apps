// 運営:イベントのくわしい中身の入力(作る・変えるで共通)。11/28 伊吹:場所・リンク・カレンダーを分けて分かりやすく
import { calendarDetails, durationLabel } from '../../core/schedule';
import type { Visibility } from '../../core/types';
import type { EventStyle } from '../../lib/admin';
import { CourseEditor, DurationPicker } from './EventForm';

export type Link = { label: string; url: string };
export type EventFieldsValue = {
  name: string; description: string; place: string; place_url: string; cost: string; links: Link[];
  deadline: string; visibility: Visibility; style: EventStyle; notice: string; duration_min: number;
};
export type Course = { id?: string; name: string; price: number };

export const emptyEvent = (): EventFieldsValue => ({
  name: '', description: '', place: '', place_url: '', cost: '', links: [], deadline: '', visibility: 'names',
  style: 'event', notice: '', duration_min: 120,
});

const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s.trim());

/** 保存する前の確かめ。問題があれば日本語の文を返す */
export function checkEventFields(f: EventFieldsValue): string {
  if (!f.name.trim()) return 'イベントの名前を入れてください';
  if (f.place_url.trim() && !isUrl(f.place_url)) return '場所のリンクは http から始まるものにしてください';
  for (const l of f.links) {
    if (!l.label.trim() && !l.url.trim()) continue;
    if (!l.label.trim()) return 'リンクの名前を入れてください';
    if (!isUrl(l.url)) return `「${l.label}」のリンクは http から始まるものにしてください`;
  }
  return '';
}

/** 保存する形に整える(空のリンクは捨てる) */
export function cleanEventFields(f: EventFieldsValue) {
  return {
    ...f, name: f.name.trim(), place: f.place.trim(), place_url: f.place_url.trim(),
    links: f.links.filter((l) => l.label.trim() && l.url.trim()).map((l) => ({ label: l.label.trim().slice(0, 20), url: l.url.trim() })),
    deadline: f.deadline || null,
  };
}

const box = { padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 } as const;

export function EventFields({ f, setF, courses, setCourses }: {
  f: EventFieldsValue; setF: (v: EventFieldsValue) => void; courses: Course[]; setCourses: (c: Course[]) => void;
}) {
  const set = (k: keyof EventFieldsValue) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const details = calendarDetails({ notice: f.notice, description: f.description, placeUrl: f.place_url, links: f.links, page: '(このイベントのページ)' });
  return (
    <>
      <div className="field"><label>説明(なくてOK)</label><textarea maxLength={1000} value={f.description} onChange={set('description')} /></div>

      <div className="section">場所</div>
      <div className="field"><label>場所の名前</label><input maxLength={100} value={f.place} placeholder="例)上酒林" onChange={set('place')} /></div>
      <div className="field"><label>場所のリンク(地図など。なくてOK)</label><input maxLength={500} value={f.place_url} placeholder="https://maps.app.goo.gl/…" onChange={set('place_url')} /></div>

      <div className="section">ほかのリンク(なくてOK。5つまで)</div>
      {f.links.map((l, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <input placeholder="名前(例:メニュー)" maxLength={20} value={l.label} style={{ ...box, flex: '1 1 120px' }}
            onChange={(e) => setF({ ...f, links: f.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
          <input placeholder="https://…" maxLength={500} value={l.url} style={{ ...box, flex: '3 1 200px' }}
            onChange={(e) => setF({ ...f, links: f.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
          <button className="chip" onClick={() => setF({ ...f, links: f.links.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      {f.links.length < 5 && <button className="link" onClick={() => setF({ ...f, links: [...f.links, { label: '', url: '' }] })}>＋ リンクを足す</button>}

      <div className="section">日にちが決まったあと</div>
      <div className="field"><label>案内(参加者の画面とカレンダーのメモに出す。集合・持ち物など)</label><textarea maxLength={500} value={f.notice} onChange={set('notice')} /></div>
      <div className="field"><label>お金の目安(なくてOK)</label><input maxLength={100} value={f.cost} placeholder="例)3000円くらい" onChange={set('cost')} /></div>
      <DurationPicker value={f.duration_min} onChange={(duration_min) => setF({ ...f, duration_min })} />
      {f.style === 'party' && <div className="field"><label>コース(時間や出欠を聞くときに選んでもらう。なくてOK)</label><CourseEditor list={courses} setList={setCourses} /></div>}

      <details>
        <summary>カレンダーにはこう入ります</summary>
        <div className="card" style={{ fontSize: 13 }}>
          <div><span className="muted">名前</span> {f.name || '(イベントの名前)'}</div>
          <div><span className="muted">時間</span> 決まった時刻から {durationLabel(f.duration_min)}(時刻がなければ終日)</div>
          <div><span className="muted">場所</span> {f.place || '(なし)'}</div>
          <div><span className="muted">メモ</span></div>
          <div style={{ whiteSpace: 'pre-wrap', background: 'var(--soft)', borderRadius: 8, padding: 8 }}>{details}</div>
        </div>
      </details>
    </>
  );
}
