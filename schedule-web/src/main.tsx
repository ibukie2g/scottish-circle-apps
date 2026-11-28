import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// LINE の中のブラウザで開かれたら、Safari・Chrome(外部ブラウザ)で開き直す(11/28 伊吹)
// - LINE の中では iPhone のカレンダーに追加できない・Google でログインできない
// - いつも同じブラウザで開くので、「自分」(匿名ログイン)が LINE と Safari で分かれない
// LINE は URL に openExternalBrowser=1 が付いていると外部ブラウザで開く
const FLAG = 'openExternalBrowser';
const inLine = /\bLine\//i.test(navigator.userAgent);
const url = new URL(location.href);
if (inLine && !url.searchParams.has(FLAG)) {
  url.searchParams.set(FLAG, '1');
  location.replace(url.toString());
} else {
  if (url.searchParams.has(FLAG)) {
    url.searchParams.delete(FLAG); // 外部ブラウザでは、URL から印を消しておく(コピーしたときにきれいなように)
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
