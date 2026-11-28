// 運営の画面(/admin)。いまは Google でログインして、だれとしてログインしているかを出すところまで
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Loading, type AdminView } from '../ui';
import { AdminEvent } from './admin/AdminEvent';
import { AdminGroupView, AdminHome } from './admin/AdminGroups';
import { EventForm } from './admin/EventForm';

type Staff = { role: 'admin' | 'organizer'; display_name: string } | null;

export function AdminPage({ sub }: { sub: AdminView }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [staff, setStaff] = useState<Staff | undefined>(undefined);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const google = session && !session.user.is_anonymous ? session.user : null;

  useEffect(() => {
    if (!google) { setStaff(undefined); return; }
    supabase.from('staff').select('role, display_name').eq('user_id', google.id).maybeSingle()
      .then(({ data, error }) => { if (error) setErr('読み込めませんでした'); setStaff((data as Staff) ?? null); });
  }, [google?.id]);

  async function login() {
    setErr('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + '/admin' },
    });
    if (error) setErr('ログインを始められませんでした。少し待ってからもう一度押してください');
  }

  async function logout() {
    await supabase.auth.signOut();
    setStaff(undefined);
  }

  if (session === undefined) return <Loading />;

  return (
    <>
      {(!google || !staff) && <><div className="topbar"><span className="grp">運営</span></div><h1>運営の画面</h1></>}
      {!google ? (
        <>
          <p className="muted">幹事・管理者は Google でログインしてください。</p>
          {err && <div className="err">{err}</div>}
          <button className="btn" onClick={login}>Google でログイン</button>
        </>
      ) : (
        <>

          {staff === undefined ? <Loading /> : staff ? (
            <>
              {sub.view === 'home' && <AdminHome />}
              {sub.view === 'group' && <AdminGroupView key={sub.id} id={sub.id} />}
              {sub.view === 'event' && <AdminEvent key={sub.id} id={sub.id} />}
              {sub.view === 'new' && <EventForm key={sub.groupId} groupId={sub.groupId} />}
            </>
          ) : (
            <div className="note">
              まだ幹事・管理者に登録されていません。管理者に「登録して」と伝えてください。
              <div style={{ marginTop: 6, fontSize: 12, wordBreak: 'break-all' }}>あなたのID:{google.id}</div>
            </div>
          )}
          {err && <div className="err">{err}</div>}
          {sub.view === 'home' && (
            <div className="foot muted" style={{ fontSize: 12 }}>
              {google.email} でログイン中 ・ <button className="link" onClick={logout}>ログアウト</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
