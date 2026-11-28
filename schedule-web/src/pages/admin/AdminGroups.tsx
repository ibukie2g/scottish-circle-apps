// 運営:グループの一覧と、グループの画面(設定・リンク・メンバー)
import { useEffect, useState } from 'react';
import { formatDateJa } from '../../core/schedule';
import type { EventStatus } from '../../core/types';
import type { Kind } from '../../lib/api';
import { admin, buildStatus, copyText, participantLink, type AdminGroup, type AdminMember } from '../../lib/admin';
import { Confirm, Loading, navigate, toast } from '../../ui';


export const KIND_LABEL: Record<Kind, string> = { circle: 'サークル', group: 'グループ', once: '1回きり' };
export const STATUS_LABEL: Record<EventStatus, string> = { poll: '日程調整中', time: '時間調整中', rsvp: '出欠確認中', done: '終了' };

export function StatusBadge({ s }: { s: EventStatus }) {
  const cls = s === 'done' ? 'badge' : s === 'rsvp' ? 'badge done' : 'badge todo';
  return <span className={cls}>{STATUS_LABEL[s]}</span>;
}

function go(path: string) {
  return (e: React.MouseEvent) => { e.preventDefault(); navigate(path); };
}

export function AdminHome() {
  const [groups, setGroups] = useState<AdminGroup[] | null>(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('group');
  const [showArchived, setShowArchived] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  /** 進行中のイベントの状況を、名前なしの文にしてコピーする(AI に状況を伝える用。11/28) */
  async function copyStatus() {
    if (!groups) return;
    setMaking(true);
    try {
      const text = await buildStatus(groups.filter((g) => !g.archived)
        .flatMap((g) => g.events.filter((e) => e.status !== 'done').map((e) => ({ groupName: g.name, eventId: e.id }))));
      setStatus(text);
      toast((await copyText(text)) ? '状況をコピーしました(名前なし)' : '下の文を長押ししてコピーしてください');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setMaking(false);
    }
  }

  useEffect(() => { admin.groups().then(setGroups).catch((e) => setErr(e.message)); }, []);

  async function create() {
    if (!name.trim()) { setErr('名前を入れてください'); return; }
    try {
      const { id } = await admin.createGroup(name.trim(), kind);
      navigate(kind === 'once' ? `/admin/new/${id}` : `/admin/g/${id}`);
    } catch (e) { setErr((e as Error).message); }
  }

  if (!groups) return err ? <div className="err">{err}</div> : <Loading />;
  const live = groups.filter((g) => !g.archived), old = groups.filter((g) => g.archived);
  const row = (g: AdminGroup) => {
    const open = g.events.filter((e) => e.status !== 'done').sort((a, b) => b.created_at.localeCompare(a.created_at));
    return (
      <a key={g.id} className="card ev" style={{ display: 'block' }} href={`/admin/g/${g.id}`} onClick={go(`/admin/g/${g.id}`)}>
        <div className="row"><b className="grow">{g.name}</b><span className="badge">{KIND_LABEL[g.kind]}</span></div>
        {open.length ? open.map((e) => (
          <div key={e.id} className="row muted" style={{ marginTop: 4 }}>
            <span className="grow">{e.name}{e.deadline && e.status === 'poll' ? `(締め切り ${formatDateJa(e.deadline)})` : ''}</span>
            <StatusBadge s={e.status} />
          </div>
        )) : <div className="muted" style={{ marginTop: 4 }}>進行中のイベントはありません</div>}
      </a>
    );
  };
  return (
    <>
      <div className="row" style={{ margin: '8px 0' }}>
        <h1 className="grow" style={{ margin: 0 }}>グループ</h1>
        <button className="btn small" onClick={() => { setCreating(!creating); setErr(''); }}>{creating ? 'やめる' : '＋ 作る'}</button>
      </div>
      {creating && (
        <div className="card">
          <div className="field"><label>名前</label><input maxLength={40} value={name} placeholder="例)男子飲み会" onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>種類</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="group">グループ(同じメンバーで何回も使う)</option>
              <option value="once">1回きり(このイベントだけ)</option>
              <option value="circle">サークル(名簿から名前を選ぶ)</option>
            </select>
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn" onClick={create}>作る{kind === 'once' ? '(続けてイベントを作る)' : ''}</button>
        </div>
      )}
      {!creating && err && <div className="err">{err}</div>}
      {!live.length && <p className="muted">まだグループがありません。「＋ 作る」から作ってください。</p>}
      <div className="row" style={{ margin: '4px 0 10px', gap: 8 }}>
        <button className="chip" disabled={making} onClick={copyStatus}>{making ? '作っています…' : '全部の状況をコピー(名前なし)'}</button>
        <span className="muted" style={{ fontSize: 12 }}>AIに相談するときに貼る用。人数と日付だけ</span>
      </div>
      {status && <textarea readOnly value={status} style={{ width: '100%', minHeight: 160, fontSize: 12, padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 }} />}
      {live.map(row)}
      {old.length > 0 && (
        <details open={showArchived} onToggle={(e) => setShowArchived((e.target as HTMLDetailsElement).open)}>
          <summary>しまったグループ({old.length})</summary>
          {old.map(row)}
        </details>
      )}
    </>
  );
}

export function AdminGroupView({ id }: { id: string }) {
  const [g, setG] = useState<AdminGroup | null>(null);
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'group' as Kind, mascot: true });
  const [removeFor, setRemoveFor] = useState<AdminMember | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function copyGroupStatus() {
    if (!g) return;
    try {
      const text = await buildStatus(g.events.filter((e) => e.status !== 'done').map((e) => ({ groupName: g.name, eventId: e.id })));
      setStatus(text);
      toast((await copyText(text)) ? 'このグループの状況をコピーしました(名前なし)' : '下の文を長押ししてコピーしてください');
    } catch (e) { toast((e as Error).message); }
  }

  async function load() {
    try {
      const grp = await admin.group(id);
      setG(grp);
      setForm({ name: grp.name, kind: grp.kind, mascot: grp.mascot });
      setMembers(await admin.members(id));
      setCounts(await admin.answeredCounts(grp.events.map((e) => e.id)));
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { load(); }, [id]);

  async function save(patch: Parameters<typeof admin.updateGroup>[1], msg = '保存しました') {
    try { await admin.updateGroup(id, patch); toast(msg); setEditing(false); load(); }
    catch (e) { toast((e as Error).message); }
  }
  async function setActive(m: AdminMember, active: boolean) {
    try { await admin.setMemberActive(m.id, active); toast(active ? '戻しました' : '削除しました'); load(); }
    catch (e) { toast((e as Error).message); }
  }

  if (err) return <div className="err">{err}</div>;
  if (!g || !members) return <Loading />;
  const link = participantLink(g.token);
  const events = g.events.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const active = members.filter((m) => m.active), removed = members.filter((m) => !m.active);

  return (
    <>
      <div className="topbar"><a className="back" href="/admin" onClick={go('/admin')}>← グループの一覧</a></div>
      <div className="row"><h1 className="grow">{g.name}</h1><span className="badge">{KIND_LABEL[g.kind]}</span></div>
      {g.archived && <div className="note">このグループはしまってあります(参加者のリンクは開けません)</div>}

      <div className="card">
        <div className="muted">参加者に送るリンク</div>
        <div className="row" style={{ marginTop: 6 }}>
          <input className="grow" readOnly value={link} style={{ fontSize: 13, padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 }} />
          <button className="btn small" onClick={async () => toast((await copyText(link)) ? 'コピーしました' : 'コピーできませんでした')}>コピー</button>
        </div>
      </div>

      <div className="row section"><span className="grow">イベント</span>
        <button className="chip" onClick={copyGroupStatus}>状況をコピー(名前なし)</button>
        <button className="btn small" onClick={() => navigate(`/admin/new/${g.id}`)}>＋ イベントを作る</button>
      </div>
      {status && <textarea readOnly value={status} style={{ width: '100%', minHeight: 120, fontSize: 12, padding: 8, border: '1.5px solid var(--line)', borderRadius: 10 }} />}
      {!events.length && <p className="muted">まだイベントがありません。</p>}
      {events.map((e) => (
        <a key={e.id} className="card ev" style={{ display: 'block' }} href={`/admin/e/${e.id}`} onClick={go(`/admin/e/${e.id}`)}>
          <div className="row"><b className="grow">{e.name}</b><StatusBadge s={e.status} /></div>
          {e.deadline && e.status === 'poll' && <div className="muted">締め切り {formatDateJa(e.deadline)}</div>}
        </a>
      ))}

      <div className="section">メンバー({active.length}人)</div>
      {!active.length && <p className="muted">まだだれもいません。リンクから入ってもらうと、ここに出ます。</p>}
      {active.map((m) => (
        <div key={m.id} className="card row">
          <div className="grow">
            <b>{m.name}</b>{m.grade && <span className="grade">{m.grade}</span>}
            <div className="muted" style={{ fontSize: 12 }}>答え {counts[m.id] ?? 0}件{m.user_id ? '' : ' ・ まだだれも選んでいない'}</div>
          </div>
          <button className="chip" onClick={() => setRemoveFor(m)}>削除</button>
        </div>
      ))}
      {removed.length > 0 && (
        <details>
          <summary>削除したメンバー({removed.length})</summary>
          {removed.map((m) => (
            <div key={m.id} className="card row">
              <div className="grow"><b>{m.name}</b><div className="muted" style={{ fontSize: 12 }}>答え {counts[m.id] ?? 0}件</div></div>
              <button className="chip" onClick={() => setActive(m, true)}>戻す</button>
            </div>
          ))}
        </details>
      )}

      <div className="section">グループの設定</div>
      {!editing ? (
        <div className="card row">
          <div className="grow muted">名前・種類・つなぼる({g.mascot ? '出す' : '出さない'})</div>
          <button className="chip" onClick={() => setEditing(true)}>変える</button>
        </div>
      ) : (
        <div className="card">
          <div className="field"><label>名前</label><input maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          {g.kind !== 'circle' && (
            <div className="field"><label>種類</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
                <option value="group">グループ(何回も使う)</option>
                <option value="once">1回きり(リンクを開くとイベントが直接開く)</option>
              </select>
            </div>
          )}
          <div className="field"><label><input type="checkbox" checked={form.mascot} onChange={(e) => setForm({ ...form, mascot: e.target.checked })} style={{ width: 'auto', marginRight: 6 }} />つなぼるを出す</label></div>
          <button className="btn" onClick={() => save({ name: form.name.trim(), kind: form.kind, mascot: form.mascot })}>保存</button>
          <button className="btn ghost" onClick={() => setEditing(false)}>やめる</button>
        </div>
      )}
      <div className="foot">
        <button className="link" onClick={() => save({ archived: !g.archived }, g.archived ? '一覧に戻しました' : 'しまいました')}>
          {g.archived ? 'このグループを一覧に戻す' : 'このグループをしまう(参加者は開けなくなる)'}
        </button>
      </div>
      {removeFor && (
        <Confirm
          text={<>「<b>{removeFor.name}</b>」を削除しますか?答え({counts[removeFor.id] ?? 0}件)は残り、あとで「削除したメンバー」から戻せます。</>}
          yes="削除する" no="やめる"
          onYes={() => { const m = removeFor; setRemoveFor(null); setActive(m, false); }}
          onNo={() => setRemoveFor(null)}
        />
      )}
    </>
  );
}
