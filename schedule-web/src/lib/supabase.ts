// Supabase につなぐ。参加者はログイン画面なしで、開いたときに自動で匿名ログインする
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = !!(url && key);

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sch.auth' },
});

let ready: Promise<void> | null = null;

/** ログインしていなければ匿名ログインする(何度呼んでも1回だけ) */
export function ensureSession(): Promise<void> {
  ready ??= (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new ApiError('NETWORK');
  })().catch((e) => {
    ready = null; // 失敗したら次はやり直す
    throw e;
  });
  return ready;
}

export type ErrorCode = 'AUTH' | 'NOT_FOUND' | 'NO_MEMBER' | 'CLOSED' | 'INVALID' | 'DUPLICATE_NAME' | 'NETWORK' | 'INTERNAL';

const MESSAGES: Record<ErrorCode, string> = {
  AUTH: 'うまくつながりませんでした。ページを読み込み直してください',
  NOT_FOUND: 'このリンクは使えなくなっています。幹事に新しいリンクを聞いてね',
  NO_MEMBER: '先に自分の名前を選んでね',
  CLOSED: '締め切りを過ぎたので、答えは変えられません',
  INVALID: '入力を確かめてください',
  DUPLICATE_NAME: '同じ名前の人がもういます。「前にこのグループに入ったことがある」から選ぶか、ちがう名前にしてください',
  NETWORK: '通信できませんでした。電波のよいところでもう一度押してください',
  INTERNAL: 'エラーが起きました。少し待ってからもう一度ためしてください',
};

export class ApiError extends Error {
  constructor(readonly code: ErrorCode) {
    super(MESSAGES[code]);
  }
}

const CODES = Object.keys(MESSAGES) as ErrorCode[];

/** データベースの関数(RPC)を呼ぶ。エラーは日本語のメッセージにする */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  await ensureSession();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const code = CODES.find((c) => error.message?.startsWith(c));
    if (code) throw new ApiError(code);
    if (!error.code || /fetch|network/i.test(error.message ?? '')) throw new ApiError('NETWORK');
    throw new ApiError('INTERNAL');
  }
  return data as T;
}
