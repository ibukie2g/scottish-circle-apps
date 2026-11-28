// グループのページ:名前を選ぶ → イベントの一覧(+ほかのグループ)
import { useCallback, useEffect, useState } from 'react';
import { todayJst } from '../core/schedule';
import { api, isTodo, type GroupView, type OtherGroup } from '../lib/api';
import { ErrorView, EventCard, eventPath, Hero, isOld, Loading, MeBar } from '../ui';
import { PickName } from './PickName';

/** グループを読み込む。名前を選び直すとき(changing)は名前の画面を出す */
export function useGroup(token: string) {
  const [view, setView] = useState<GroupView | null>(null);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const reload = useCallback(() => {
    api.openGroup(token).then((v) => { setView(v); setChanging(false); }).catch((e) => setError((e as Error).message));
  }, [token]);
  useEffect(reload, [reload]);
  return { view, error, reload, changing, setChanging };
}

/** このスマホで名前を選んだ、ほかのグループ */
export function useOthers(exceptToken?: string) {
  const [others, setOthers] = useState<OtherGroup[]>([]);
  useEffect(() => {
    api.myEvents().then((list) => setOthers(list.filter((x) => x.group.token !== exceptToken && x.events.length))).catch(() => setOthers([]));
  }, [exceptToken]);
  return others;
}

export function OthersPart({ title, others }: { title: string; others: OtherGroup[] }) {
  if (!others.length) return null;
  const todo = others.reduce((n, x) => n + x.events.filter(isTodo).length, 0);
  return (
    <>
      <div className="section">{title}{todo > 0 && <> <span className="badge todo">まだ {todo}</span></>}</div>
      {others.map((x) => (
        <div key={x.group.id}>
          <div className="muted" style={{ margin: '10px 2px 6px' }}>
            {x.group.name}<span style={{ fontSize: 12 }}> ・ {x.me.name} さんとして</span>
          </div>
          {x.events.map((e) => <EventCard key={e.id} e={e} href={eventPath(x.group.token, e.id)} />)}
        </div>
      ))}
    </>
  );
}

export function GroupPage({ token }: { token: string }) {
  const { view, error, reload, changing, setChanging } = useGroup(token);
  const others = useOthers(token);
  // 1回きりのグループは、リンクを開くとそのイベントが直接開く(A案と同じ)
  const onlyEvent = view?.me && !changing && view.group.kind === 'once' && view.events.length === 1 ? view.events[0]!.id : null;
  useEffect(() => {
    if (onlyEvent) { history.replaceState(null, '', eventPath(token, onlyEvent)); window.dispatchEvent(new PopStateEvent('popstate')); }
  }, [onlyEvent, token]);
  if (error) return <ErrorView message={error} />;
  if (!view) return <Loading />;
  if (!view.me || changing) return <PickName token={token} view={view} onDone={reload} />;

  const g = view.group;
  const today = todayJst();
  const live = view.events.filter((e) => !isOld(e, today));
  const old = view.events.filter((e) => isOld(e, today));
  const todo = live.filter(isTodo).length;
  return (
    <>
      <div className="topbar"><span className="grp">{g.name}</span></div>
      <MeBar name={view.me.name} onChange={() => setChanging(true)} />
      <Hero show={g.mascot} msg={todo ? `答えていないのが${todo}こあるよ!` : 'ぜんぶ答えてあるよ!'} face={todo ? 'normal' : 'joy'} />
      <h1>イベント</h1>
      {!live.length && <p className="muted">いまは、答えるイベントはありません。</p>}
      {live.map((e) => <EventCard key={e.id} e={e} href={eventPath(token, e.id)} />)}
      {old.length > 0 && (
        <details>
          <summary>終わったもの({old.length})</summary>
          {old.map((e) => <EventCard key={e.id} e={e} href={eventPath(token, e.id)} />)}
        </details>
      )}
      <OthersPart title="ほかのグループ" others={others} />
      <div className="foot"><button className="link" onClick={() => setChanging(true)}>{view.me.name}さんではない</button></div>
    </>
  );
}

export function HomePage() {
  const [others, setOthers] = useState<OtherGroup[] | null>(null);
  useEffect(() => {
    api.myEvents().then(setOthers).catch(() => setOthers([]));
  }, []);
  return (
    <>
      <h1 style={{ marginTop: 20 }}>日程調整</h1>
      {!others ? <Loading /> : others.length ? <OthersPart title="参加中のイベント" others={others} /> : <p className="muted">LINEなどで送られたリンクから開いてね。</p>}
    </>
  );
}
