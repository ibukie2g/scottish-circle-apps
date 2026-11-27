// 画面の小さな部品(A案 participant_js.html と同じ見た目)
import { useEffect, useState, type ReactNode } from 'react';
import { formatDateJa, isArchived } from './core/schedule';
import { isTodo, type EventSummary } from './lib/api';

// ---------- 画面の移動(/g/:token と /g/:token/e/:eventId) ----------

export type Route = { page: 'home' } | { page: 'group'; token: string } | { page: 'event'; token: string; eventId: string };

export function parseRoute(path: string): Route {
  const m = /^\/g\/([A-Za-z0-9_-]{20,})(?:\/e\/([0-9a-f-]{36}))?\/?$/.exec(path);
  if (!m) return { page: 'home' };
  return m[2] ? { page: 'event', token: m[1]!, eventId: m[2] } : { page: 'group', token: m[1]! };
}

export const groupPath = (token: string) => `/g/${token}`;
export const eventPath = (token: string, eventId: string) => `/g/${token}/e/${eventId}`;

export function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.pathname));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return route;
}

// ---------- お知らせ(画面の下に2秒) ----------

let showToast: (msg: string, big?: boolean) => void = () => {};
export const toast = (msg: string, big = false) => showToast(msg, big);

export function Toast() {
  const [t, setT] = useState<{ msg: string; big: boolean } | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    showToast = (msg, big = false) => {
      setT({ msg, big });
      clearTimeout(timer);
      timer = window.setTimeout(() => setT(null), 2200);
    };
    return () => clearTimeout(timer);
  }, []);
  return t ? <div className={'toast' + (t.big ? ' big' : '')}>{t.msg}</div> : null;
}

// ---------- 部品 ----------

export type Face = 'normal' | 'joy' | 'excited';

/** つなぼる+ふきだし(グループの設定で出さないこともある) */
export function Hero({ show, msg, face = 'normal' }: { show: boolean; msg: string; face?: Face }) {
  if (!show) return null;
  return (
    <div className="hero">
      <img src={`/tsunaboru_${face}.webp`} alt="" width={70} />
      <div className="bubble">{msg}</div>
    </div>
  );
}

/** 自分の名前を上に大きく出す(取り違えにすぐ気づけるように) */
export function MeBar({ name, onChange }: { name: string; onChange: () => void }) {
  return (
    <div className="mebar">
      <div className="grow"><b>{name}</b> さんとして答えています</div>
      <button className="chip" onClick={onChange}>ちがう</button>
    </div>
  );
}

export function Loading() {
  return <div className="loading">読み込み中…</div>;
}

export function ErrorView({ message }: { message: string }) {
  return (
    <>
      <h1 style={{ marginTop: 40 }}>開けませんでした</h1>
      <p className="muted">{message}</p>
      <button className="btn ghost" onClick={() => location.reload()}>もう一度読み込む</button>
    </>
  );
}

export function fmtDecided(d: { date: string; time: string } | null) {
  return d ? formatDateJa(d.date) + (d.time ? ' ' + d.time : '') : '';
}

/** 決まった日(なければ最後の候補日)から30日たったものは「終わったもの」にしまう */
export function isOld(e: EventSummary, today: string): boolean {
  const cands = [e.decided?.date, e.last_date].filter(Boolean).map((date, i) => ({ id: String(i), date: date!, time: '' }));
  return isArchived({ status: e.status, decidedCandidateId: e.decided ? '0' : null }, cands, today);
}

export function EventCard({ e, href }: { e: EventSummary; href: string }) {
  let badge: ReactNode;
  if (e.status === 'done') badge = <span className="badge">終わり</span>;
  else if (e.status === 'rsvp') badge = e.answered ? <span className="badge done">出欠OK</span> : <span className="badge todo">出欠を答えてね</span>;
  else if (e.status === 'time') badge = e.answered ? <span className="badge done">答えた</span> : <span className="badge todo">時間を答えてね</span>;
  else if (e.closed) badge = <span className="badge">締め切り</span>;
  else badge = isTodo(e) ? <span className="badge todo">まだ</span> : <span className="badge done">答えた</span>;
  const sub = e.decided ? '決定:' + fmtDecided(e.decided) : e.deadline ? '締め切り ' + formatDateJa(e.deadline) : '';
  return (
    <a
      className="card ev"
      style={{ display: 'block' }}
      href={href}
      onClick={(ev) => {
        ev.preventDefault();
        navigate(href);
      }}
    >
      <div className="row">
        <div className="grow">
          <b>{e.name}</b>
          {sub && <div className="muted">{sub}</div>}
        </div>
        {badge}
      </div>
    </a>
  );
}

/** 確認のための小さな窓(ブラウザの confirm は LINE の中で出ないことがあるので自前) */
export function Confirm({ text, yes, no, onYes, onNo }: { text: ReactNode; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="dialog-back" onClick={onNo}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <p>{text}</p>
        <button className="btn" onClick={onYes}>{yes}</button>
        <button className="btn ghost" onClick={onNo}>{no}</button>
      </div>
    </div>
  );
}
