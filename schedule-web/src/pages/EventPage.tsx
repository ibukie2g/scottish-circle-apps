// イベントのページ:○△×をつける/出欠を答える/みんなの回答を見る
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { calendarData, calendarDetails, formatDateJa, rankResults } from '../core/schedule';
import type { AttendanceStatus, Mark } from '../core/types';
import { api, isTodo, type EventView, type StageResults } from '../lib/api';
import { ErrorView, groupPath, Hero, Loading, MeBar, navigate, toast, type Face } from '../ui';
import { useGroup, useOthers } from './GroupPage';
import { PickName } from './PickName';

const MARKS: [Mark, string][] = [['o', '○'], ['t', '△'], ['x', '×']];

export function EventPage({ token, eventId }: { token: string; eventId: string }) {
  const { view: gv, error: gErr, reload: reloadGroup, changing, setChanging } = useGroup(token);
  const others = useOthers(token);
  const [d, setD] = useState<EventView | null>(null);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<Record<string, Mark | ''>>({});
  const [comment, setComment] = useState('');
  const [att, setAtt] = useState<{ status: AttendanceStatus | null; arriveAt: string; comment: string }>({ status: null, arriveAt: '', comment: '' });
  const [sending, setSending] = useState(false);
  const [course, setCourse] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);

  const apply = useCallback((v: EventView) => {
    setD(v);
    setDraft({ ...(v.mine?.answers ?? {}) });
    setComment(v.mine?.comment ?? '');
    setAtt({ status: v.mine?.attendance ?? null, arriveAt: v.mine?.arrive_at ?? '', comment: v.mine?.att_comment ?? '' });
    setCourse(v.mine?.course_id ?? null);
  }, []);
  const load = useCallback(() => {
    api.getEvent(token, eventId).then(apply).catch((e) => setErr((e as Error).message));
  }, [token, eventId, apply]);
  const me = gv?.me;
  useEffect(() => { if (me) load(); }, [me, load]);

  // スマホでアプリを切りかえて戻ってきたら、最新にする(送っている途中は除く)
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible' && me && !sending && !thanks) load(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [me, sending, thanks, load]);

  if (gErr || err) return <ErrorView message={gErr || err} />;
  if (!gv) return <Loading />;
  if (!gv.me || changing) return <PickName token={token} view={gv} onDone={reloadGroup} />;
  const g = gv.group;
  const multi = gv.events.length > 1 || g.kind !== 'once' || others.length > 0;
  const top = (
    <>
      <div className="topbar">
        {multi ? <button className="back" onClick={() => navigate(groupPath(token))}>← {g.name}</button> : <span className="grp">{g.name}</span>}
      </div>
      <MeBar name={gv.me.name} onChange={() => setChanging(true)} />
    </>
  );
  if (!d) return <>{top}<Loading /></>;

  const ev = d.event;
  const isTime = ev.status === 'time';
  const answered = Object.keys(d.mine?.answers ?? {}).length > 0;
  let msg: string, face: Face = 'normal';
  if (ev.status === 'rsvp') { msg = '日にちが決まったよ!'; face = 'excited'; }
  else if (isTime) { msg = answered ? '答えてくれてありがとう!' : '日にちが決まったよ!何時からがいい?'; face = answered ? 'joy' : 'excited'; }
  else if (ev.status === 'done') msg = 'このイベントは終わったよ';
  else if (ev.closed) msg = '締め切りを過ぎたよ';
  else if (answered) { msg = '答えてくれてありがとう!'; face = 'joy'; }
  else msg = '来られる日に○をつけてね!';

  async function send(fn: () => Promise<EventView>) {
    setSending(true);
    try {
      apply(await fn());
      setThanks(true); // 送ったら「ありがとう」の画面へ(11/28 伊吹)
      window.scrollTo(0, 0);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const meta: string[] = [];
  if (ev.deadline && ev.status === 'poll') meta.push(`締め切り ${formatDateJa(ev.deadline)}`);
  if (d.results && (ev.status === 'poll' || isTime)) meta.push(`回答 ${d.results.answered_count}人`);
  const otherTodo = others.reduce((n, x) => n + x.events.filter(isTodo).length, 0);
  const courses = d.courses ?? [];

  if (thanks) {
    return (
      <>
        {top}
        <ThanksView d={d} showMascot={g.mascot} courses={courses} otherTodo={otherTodo}
          onEdit={() => setThanks(false)} onGroup={() => navigate(groupPath(token))} multi={multi} />
      </>
    );
  }

  return (
    <>
      {top}
      <Hero show={g.mascot} msg={msg} face={face} />
      <h1>{ev.name}</h1>
      {meta.length > 0 && <div className="meta">{meta.join(' ・ ')}</div>}
      <DetailBox ev={ev} />
      {ev.notice && ev.status !== 'poll' && <div className="note" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>📣 {ev.notice}</div>}
      {isTime && ev.decided && (
        <div className="decided">
          <div className="muted">決まった日</div>
          <div className="big">{formatDateJa(ev.decided.date)}</div>
          <div className="muted" style={{ marginTop: 4 }}>何時からなら来られる?それぞれに ○△× をつけてね</div>
        </div>
      )}
      {ev.status === 'rsvp' || (ev.status === 'done' && ev.decided) ? (
        <RsvpPart d={d} me={gv.me.name} att={att} setAtt={setAtt} sending={sending}
          coursePicker={courses.length > 0 && att.status && att.status !== 'no' ? <CoursePicker courses={courses} value={course} onChange={setCourse} /> : null}
          onSend={() => send(() => api.submitAttendance(token, eventId, att.status!, att.arriveAt, att.comment, att.status === 'no' ? null : course))} />
      ) : (
        <PollPart d={d} me={gv.me.name} draft={draft} setDraft={setDraft} comment={comment} setComment={setComment} sending={sending}
          coursePicker={isTime && courses.length > 0 ? <CoursePicker courses={courses} value={course} onChange={setCourse} /> : null}
          onSend={() => send(async () => {
            const v = await api.submitAnswers(token, eventId, draft, comment);
            return isTime && courses.length && course !== (v.mine?.course_id ?? null) ? api.chooseCourse(token, eventId, course) : v;
          })} />
      )}
      <ResultsPart d={d} />
      {otherTodo > 0 && (
        <button className="card ev" style={{ marginTop: 16 }} onClick={() => navigate(groupPath(token))}>
          <div className="row"><div className="grow"><b>ほかのグループにも、まだ答えていないのが{otherTodo}こあるよ</b></div><span className="muted">›</span></div>
        </button>
      )}
      <div className="foot"><button className="link" onClick={() => setChanging(true)}>{gv.me.name}さんではない</button></div>
    </>
  );
}

const safeUrl = (u?: string) => (u && /^https?:\/\//.test(u) ? u : '');

function DetailBox({ ev }: { ev: EventView['event'] }) {
  const placeUrl = safeUrl(ev.place_url);
  const links = (ev.links ?? []).filter((l) => safeUrl(l.url));
  if (!ev.description && !ev.place && !placeUrl && !ev.cost && !ev.url && !links.length) return null;
  return (
    <div className="detail">
      {ev.description && <div className="desc">{ev.description}</div>}
      {(ev.place || placeUrl) && (
        <div>📍 {placeUrl ? <a href={placeUrl} target="_blank" rel="noopener noreferrer">{ev.place || '地図を開く'}</a> : ev.place}
          {placeUrl && ev.place && <span className="muted" style={{ fontSize: 12 }}>(押すと地図)</span>}</div>
      )}
      {ev.cost && <div>💴 {ev.cost}</div>}
      {links.map((l, i) => <div key={i}>🔗 <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></div>)}
      {safeUrl(ev.url) && <div>🔗 <a href={ev.url} target="_blank" rel="noopener noreferrer">{ev.url}</a></div>}
    </div>
  );
}

function PollPart(p: {
  d: EventView; me: string; draft: Record<string, Mark | ''>;
  setDraft: (f: (prev: Record<string, Mark | ''>) => Record<string, Mark | ''>) => void;
  comment: string; setComment: (v: string) => void; sending: boolean; onSend: () => void; coursePicker: ReactNode;
}) {
  const { d, draft } = p;
  const isTime = d.event.status === 'time';
  const closed = d.event.closed || d.event.status === 'done';
  const filled = d.candidates.filter((c) => draft[c.id]).length;
  return (
    <>
      {!closed && (
        <div className="quick">
          <button className="chip" onClick={() => p.setDraft(() => Object.fromEntries(d.candidates.map((c) => [c.id, 'o'])))}>全部○</button>
          <button className="chip" onClick={() => p.setDraft(() => Object.fromEntries(d.candidates.map((c) => [c.id, 'x'])))}>全部×</button>
        </div>
      )}
      {!isTime && d.candidates.some((c) => c.time) && (
        <div className="muted" style={{ margin: '0 2px 6px' }}>時間は目安です。日にちが決まってから、時間をあらためて聞くこともあります</div>
      )}
      {d.candidates.map((c) => (
        <div key={c.id} className="card row">
          <div className="date grow">
            {isTime ? <>{c.time}〜{c.memo && <small>{c.memo}</small>}</>
              : <>{formatDateJa(c.date)}<small>{c.time ? c.time + '〜(目安)' : '時間未定'}{c.memo && ' ・ ' + c.memo}</small></>}
          </div>
          <div className="opts">
            {MARKS.map(([m, label]) => (
              <button key={m} className={`opt ${m}${draft[c.id] === m ? ' on' : ''}`} disabled={closed}
                onClick={() => p.setDraft((prev) => ({ ...prev, [c.id]: prev[c.id] === m ? '' : m }))}>{label}</button>
            ))}
          </div>
        </div>
      ))}
      {closed ? (
        <div className="note">締め切りを過ぎたので、答えは変えられません。変えたいときは幹事に連絡してね。</div>
      ) : (
        <>
          <div className="field">
            <label>ひとこと(なくてもOK)</label>
            <input maxLength={100} value={p.comment} placeholder="例)22日は少し遅れるかも" onChange={(e) => p.setComment(e.target.value)} />
          </div>
          {p.coursePicker}
          <div className="sendas"><b>{p.me}</b> さんとして送ります</div>
          <button className="btn" disabled={p.sending || !filled} onClick={p.onSend}>
            {p.sending ? '送っています…' : Object.keys(d.mine?.answers ?? {}).length ? '答えを直して送る' : '送る'}
          </button>
          {filled > 0 && filled < d.candidates.length && (
            <div className="muted center" style={{ marginTop: 6 }}>まだ選んでいない{isTime ? '時間' : '日'}があります(そのままでも送れます)</div>
          )}
        </>
      )}
    </>
  );
}

function RsvpPart(p: {
  d: EventView; me: string; sending: boolean; onSend: () => void; coursePicker: ReactNode;
  att: { status: AttendanceStatus | null; arriveAt: string; comment: string };
  setAtt: (v: { status: AttendanceStatus | null; arriveAt: string; comment: string }) => void;
}) {
  const ev = p.d.event;
  const dec = ev.decided!;
  const going = p.d.mine?.attendance === 'go' || p.d.mine?.attendance === 'partial';
  return (
    <>
      <div className="decided">
        <div className="muted">決まった日</div>
        <div className="big">{formatDateJa(dec.date)}{dec.time && ` ${dec.time}〜`}</div>
        {going && ev.status === 'rsvp' && <CalendarButtons ev={ev} />}
      </div>
      {ev.status === 'done' ? (
        <div className="note">このイベントは終わりました。</div>
      ) : (
        <>
          <div className="section">行ける?</div>
          <div className="rsvp">
            {([['go', '行く'], ['partial', '途中から'], ['no', '行かない']] as const).map(([s, label]) => (
              <button key={s} className={s + (p.att.status === s ? ' on' : '')} onClick={() => p.setAtt({ ...p.att, status: s })}>{label}</button>
            ))}
          </div>
          {p.att.status === 'partial' && (
            <div className="field"><label>何時ごろ来られる?</label><input type="time" value={p.att.arriveAt} onChange={(e) => p.setAtt({ ...p.att, arriveAt: e.target.value })} /></div>
          )}
          {p.coursePicker}
          <div className="field"><label>ひとこと(なくてもOK)</label><input maxLength={100} value={p.att.comment} onChange={(e) => p.setAtt({ ...p.att, comment: e.target.value })} /></div>
          <div className="sendas"><b>{p.me}</b> さんとして送ります</div>
          <button className="btn" disabled={p.sending || !p.att.status} onClick={p.onSend}>{p.sending ? '送っています…' : '送る'}</button>
        </>
      )}
    </>
  );
}

function ResultsPart({ d }: { d: EventView }) {
  const ev = d.event;
  const isTime = ev.status === 'time';
  const head = <div className="section">みんなの回答</div>;
  if (!d.results) return <>{head}<div className="note">このイベントの結果は、幹事だけが見られる設定です。</div></>;
  const past = d.date_stage && ev.status !== 'poll' && (
    <details><summary>日程調整のときの回答</summary><DateCards r={d.date_stage} timeOnly={false} /></details>
  );
  if (d.attendance) {
    const a = d.attendance;
    return (
      <>
        {head}
        <div className="card">
          <div className="row"><b className="grow">出欠</b>
            <span className="cnt"><span className="o">行く {a.go}</span><span className="t">途中から {a.partial}</span><span className="x">行かない {a.no}</span></span>
          </div>
          {a.names && <Names list={[['行', 'o', a.names.go], ['途', 't', a.names.partial], ['×', 'x', a.names.no]]} />}
        </div>
        {past}
      </>
    );
  }
  if (!d.results.answered_count) return <>{head}<div className="note">まだだれも答えていません。最初の1人になろう!</div>{past}</>;
  return <>{head}<DateCards r={d.results} timeOnly={isTime} />{past}</>;
}

function DateCards({ r, timeOnly }: { r: StageResults; timeOnly: boolean }) {
  return (
    <>
      {rankResults(r.by_candidate).map((b) => (
        <div key={b.candidate_id} className={'card res' + (b.best ? ' best' : '')}>
          {b.best && <div className="crown">{timeOnly ? 'いちばん多い時間' : 'いちばん多い日'}</div>}
          <div className="row">
            <b className="grow" style={{ fontSize: 16 }}>
              {timeOnly ? `${b.time}〜` : <>{formatDateJa(b.date)}{b.time && <span className="muted"> {b.time}</span>}</>}
            </b>
            <span className="cnt"><span className="o">○{b.o}</span><span className="t">△{b.t}</span><span className="x">×{b.x}</span></span>
          </div>
          {b.names && <Names list={[['○', 'o', b.names.o], ['△', 't', b.names.t], ['×', 'x', b.names.x]]} />}
        </div>
      ))}
    </>
  );
}

function Names({ list }: { list: [string, Mark, string[]][] }) {
  return (
    <div className="names">
      {list.filter(([, , names]) => names.length).map(([lab, cls, names]) => (
        <div key={cls}><span className={'lab ' + cls}>{lab}</span>{names.join('・')}</div>
      ))}
    </div>
  );
}

/** コースを選ぶ(飲み放題/ソフトドリンクなど)。時間を聞いているときと、出欠のときに出す */
function CoursePicker({ courses, value, onChange }: { courses: { id: string; name: string; price: number }[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <>
      <div className="section">コース</div>
      <div className="rsvp" style={{ gridTemplateColumns: `repeat(${Math.min(courses.length, 3)}, 1fr)` }}>
        {courses.map((c) => (
          <button key={c.id} className={'go' + (value === c.id ? ' on' : '')} onClick={() => onChange(value === c.id ? null : c.id)}>
            {c.name}{c.price > 0 && <><br /><small style={{ fontWeight: 400 }}>{c.price.toLocaleString('ja-JP')}円</small></>}
          </button>
        ))}
      </div>
    </>
  );
}

/** カレンダーに追加。iPhone は本物のファイル(/api/ics)を開くと「カレンダーに追加」が出る */
function CalendarButtons({ ev }: { ev: EventView['event'] }) {
  const dec = ev.decided!;
  const link = location.origin + location.pathname;
  // メモには、案内・説明・リンク(地図など)・このページを入れる(11/28 伊吹)
  const details = calendarDetails({
    notice: ev.notice, description: ev.description, placeUrl: safeUrl(ev.place_url),
    links: (ev.links ?? []).filter((l) => safeUrl(l.url)), url: safeUrl(ev.url), page: link,
  });
  const minutes = ev.duration_min || 120;
  const cal = calendarData({ title: ev.name, date: dec.date, time: dec.time, place: ev.place, minutes, details });
  if (!cal) return null;
  const ics = '/api/ics?' + new URLSearchParams({
    title: ev.name, date: dec.date, time: dec.time, min: String(minutes), place: ev.place, desc: details, url: /^https:/.test(ev.place_url ?? '') ? ev.place_url! : link,
  }).toString();
  return (
    <div className="cal">
      <a className="btn ghost small" href={cal.googleUrl} target="_blank" rel="noopener noreferrer">Googleカレンダーに追加</a>
      <a className="btn ghost small" href={ics}>iPhoneのカレンダーに追加</a>
    </div>
  );
}

/** 送ったあとの画面(11/28 伊吹:送ったら「ありがとう、閉じていいよ」に移る) */
function ThanksView({ d, showMascot, courses, otherTodo, onEdit, onGroup, multi }: {
  d: EventView; showMascot: boolean; courses: { id: string; name: string; price: number }[]; otherTodo: number;
  onEdit: () => void; onGroup: () => void; multi: boolean;
}) {
  const ev = d.event, mine = d.mine;
  const isRsvp = ev.status === 'rsvp';
  const going = mine?.attendance === 'go' || mine?.attendance === 'partial';
  const course = courses.find((c) => c.id === mine?.course_id);
  const label: Record<Mark, string> = { o: '○', t: '△', x: '×' };
  return (
    <>
      <Hero show={showMascot} msg="答えてくれてありがとう!" face="joy" />
      <h1>送りました!</h1>
      <p className="muted">このページは閉じて大丈夫だよ。答えを変えたくなったら、同じリンクからいつでも直せます。</p>
      <div className="card">
        <b>{ev.name}</b>
        {isRsvp ? (
          <div style={{ marginTop: 6 }}>
            {ev.decided && <div>{formatDateJa(ev.decided.date)}{ev.decided.time && ` ${ev.decided.time}〜`}</div>}
            <div>出欠:<b>{mine?.attendance === 'go' ? '行く' : mine?.attendance === 'partial' ? `途中から${mine.arrive_at ? `(${mine.arrive_at}〜)` : ''}` : '行かない'}</b></div>
            {course && <div>コース:<b>{course.name}</b>{course.price > 0 && `(${course.price.toLocaleString('ja-JP')}円)`}</div>}
          </div>
        ) : (
          <div className="names" style={{ marginTop: 6, fontSize: 14 }}>
            {d.candidates.filter((c) => mine?.answers[c.id]).map((c) => (
              <div key={c.id}><span className={'lab ' + mine!.answers[c.id]}>{label[mine!.answers[c.id]!]}</span>
                {ev.status === 'time' ? `${c.time}〜` : formatDateJa(c.date)}</div>
            ))}
            {course && <div>コース:<b>{course.name}</b></div>}
          </div>
        )}
      </div>
      {isRsvp && going && ev.decided && (
        <>
          <div className="section">カレンダーに入れておく?</div>
          <CalendarButtons ev={ev} />
        </>
      )}
      <button className="btn ghost" onClick={onEdit}>答えを直す・みんなの回答を見る</button>
      {otherTodo > 0 && <button className="btn" onClick={onGroup}>ほかにも、まだ答えていないのが{otherTodo}こあるよ</button>}
      {multi && otherTodo === 0 && <div className="foot"><button className="link" onClick={onGroup}>イベントの一覧へ</button></div>}
    </>
  );
}
