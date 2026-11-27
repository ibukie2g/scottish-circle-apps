// 名前を選ぶ/加わる画面
import { useEffect, useState } from 'react';
import { api, type GroupView, type MemberItem } from '../lib/api';
import { ApiError } from '../lib/supabase';
import { Confirm, Hero, Loading, toast } from '../ui';

const lsGet = (k: string) => {
  try { return localStorage.getItem(k) ?? ''; } catch { return ''; }
};
const lsSet = (k: string, v: string) => {
  try { localStorage.setItem(k, v); } catch { /* 保存できない端末でも使える */ }
};

export function PickName({ token, view, onDone }: { token: string; view: GroupView; onDone: () => void }) {
  const g = view.group;
  const circle = g.kind === 'circle';
  const [members, setMembers] = useState<MemberItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [showReturning, setShowReturning] = useState(false);
  const [joinMode, setJoinMode] = useState(false);
  const [name, setName] = useState(() => lsGet('sch.name'));
  const [join, setJoin] = useState({ name: '', kana: '', grade: '', gender: '' });
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmFor, setConfirmFor] = useState<MemberItem | null>(null);

  const needList = circle || showReturning;
  useEffect(() => {
    if (needList && !members) api.listMembers(token).then(setMembers).catch((e) => setErr((e as Error).message));
  }, [needList, members, token]);

  function welcome(me: { name: string }) {
    lsSet('sch.name', me.name);
    toast(me.name + ' さん、ようこそ!', true);
    onDone();
  }

  async function pick(m: MemberItem, confirmed = false) {
    setSending(true);
    setErr('');
    try {
      const r = await api.claimMember(token, m.id, confirmed);
      if (r.needs_confirm) setConfirmFor(m);
      else if (r.me) welcome(r.me);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function doJoin(n: string, extra?: { kana: string; grade: string; gender: string }) {
    setSending(true);
    setErr('');
    try {
      welcome((await api.joinGroup(token, n, extra)).me);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'うまく登録できませんでした');
    } finally {
      setSending(false);
    }
  }

  const memberButton = (m: MemberItem, detail: boolean) => (
    <button key={m.id} className="card member" disabled={sending} onClick={() => pick(m)}>
      <b>{m.name}</b>
      {detail && m.grade && <span className="grade">{m.grade}</span>}
      {detail && m.kana && <div className="kana">{m.kana}</div>}
    </button>
  );

  const dialog = confirmFor && (
    <Confirm
      text={<>「<b>{confirmFor.name}</b>」は、別のスマホで使われています。あなたで合っていますか?</>}
      yes="はい、自分です"
      no="ちがう名前を選ぶ"
      onYes={() => { const m = confirmFor; setConfirmFor(null); pick(m, true); }}
      onNo={() => setConfirmFor(null)}
    />
  );

  // サークル:一覧に自分がいないときの登録
  if (circle && joinMode) {
    return (
      <>
        <div className="topbar"><button className="back" onClick={() => { setJoinMode(false); setErr(''); }}>← 名前の一覧にもどる</button></div>
        <h1>サークルに登録</h1>
        <div className="meta">名前は幹事だけが管理する名簿に入ります</div>
        <div className="field"><label>フルネーム</label><input maxLength={20} value={join.name} placeholder="例)会津 太郎" onChange={(e) => setJoin({ ...join, name: e.target.value })} /></div>
        <div className="field"><label>ふりがな</label><input maxLength={30} value={join.kana} placeholder="例)あいづ たろう" onChange={(e) => setJoin({ ...join, kana: e.target.value })} /></div>
        <div className="field"><label>学年</label>
          <select value={join.grade} onChange={(e) => setJoin({ ...join, grade: e.target.value })}>
            {['', '1年', '2年', '3年', '4年', 'その他'].map((v) => <option key={v} value={v}>{v || '選んでください'}</option>)}
          </select>
        </div>
        <div className="field"><label>性別</label>
          <select value={join.gender} onChange={(e) => setJoin({ ...join, gender: e.target.value })}>
            {['', '男性', '女性', '答えない'].map((v) => <option key={v} value={v}>{v || '選んでください'}</option>)}
          </select>
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn" disabled={sending} onClick={() => {
          if (!join.name.trim() || !join.kana.trim() || !join.grade) { setErr('フルネーム・ふりがな・学年を入れてください'); return; }
          doJoin(join.name, { kana: join.kana, grade: join.grade, gender: join.gender });
        }}>登録する</button>
      </>
    );
  }

  if (circle) {
    const q = search.replace(/\s/g, '');
    return (
      <>
        <div className="topbar"><span className="grp">{g.name}</span></div>
        <Hero show={g.mascot} msg="はじめに、自分を選んでね!" />
        <h1>あなたはだれ?</h1>
        <div className="meta">名前を選ぶと、このスマホが覚えます</div>
        <div className="field"><input placeholder="名前やふりがなでさがす" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {err && <div className="err">{err}</div>}
        {!members ? <Loading /> : members.filter((m) => !q || (m.name + (m.kana ?? '')).replace(/\s/g, '').includes(q)).map((m) => memberButton(m, true))}
        <div className="foot"><button className="link" onClick={() => { setJoinMode(true); setErr(''); }}>一覧に自分がいない</button></div>
        {dialog}
      </>
    );
  }

  // サークル以外:名前を入れて加わる。前に入った人は一覧から選ぶ
  const count = members ? members.length : view.member_count;
  return (
    <>
      <div className="topbar"><span className="grp">{g.name}</span></div>
      <Hero show={g.mascot} msg="はじめに、自分を選んでね!" />
      <h1>名前を入れて参加</h1>
      <div className="meta">みんながわかる名前で。このスマホが覚えます</div>
      <div className="field"><input maxLength={20} placeholder="例)会津 太郎" value={name} onChange={(e) => setName(e.target.value)} /></div>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={sending} onClick={() => {
        if (!name.trim()) { setErr('名前を入れてください'); return; }
        doJoin(name);
      }}>この名前で参加する</button>
      {count > 0 && (
        <>
          <div className="or"><span>または</span></div>
          <div className="returning">
            <button className={'btn ghost' + (showReturning ? ' open' : '')} onClick={() => setShowReturning(!showReturning)}>
              前にこのグループに入ったことがある<small>自分の名前を一覧から選ぶ</small>
            </button>
            {showReturning && (!members ? <Loading /> : members.map((m) => memberButton(m, false)))}
          </div>
        </>
      )}
      {dialog}
    </>
  );
}
