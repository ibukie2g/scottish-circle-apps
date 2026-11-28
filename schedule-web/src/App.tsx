// 参加者の画面。URL:/g/:token(グループ)・/g/:token/e/:eventId(イベント)・/(参加中のイベント)
import { configured } from './lib/supabase';
import { AdminPage } from './pages/AdminPage';
import { EventPage } from './pages/EventPage';
import { GroupPage, HomePage } from './pages/GroupPage';
import { ErrorView, Toast, useRoute } from './ui';

export function App() {
  const route = useRoute();
  let page;
  if (!configured) page = <ErrorView message="設定(Supabase の URL とキー)が入っていません" />;
  else if (route.page === 'admin') page = <AdminPage sub={route.sub} />;
  else if (route.page === 'event') page = <EventPage key={route.token + route.eventId} token={route.token} eventId={route.eventId} />;
  else if (route.page === 'group') page = <GroupPage key={route.token} token={route.token} />;
  else page = <HomePage />;
  return (
    <div className={'app' + (route.page === 'admin' ? ' wide' : '')}>
      {page}
      <Toast />
    </div>
  );
}
