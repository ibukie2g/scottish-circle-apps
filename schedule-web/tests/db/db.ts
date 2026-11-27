// テスト用のデータベース(PGlite = パソコンの中で動く Postgres)。名前はすべて架空
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const stub = readFileSync(join(here, 'supabase_stub.sql'), 'utf8');
const migDir = join(here, '..', '..', 'supabase', 'migrations');
const migrations = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(join(migDir, f), 'utf8'));

/** null = postgres(準備用。RLS を通らない) */
export type Who = { id: string; role: 'authenticated' | 'anon' } | null;
export const ANON: Who = { id: '', role: 'anon' };

export class TestDb {
  private constructor(readonly pg: PGlite) {}

  static async create(): Promise<TestDb> {
    const pg = new PGlite();
    await pg.exec(stub);
    for (const m of migrations) await pg.exec(m);
    return new TestDb(pg);
  }

  /** 利用者を作る。anonymous = 匿名ログインの参加者、false = Google でログインした人 */
  async user(anonymous: boolean): Promise<{ id: string; role: 'authenticated' }> {
    const id = crypto.randomUUID();
    await this.pg.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [id, anonymous]);
    return { id, role: 'authenticated' };
  }

  /** その人として SQL を実行する(Supabase の API と同じく、ロールと JWT を切りかえる) */
  async as<T = Record<string, any>>(who: Who, sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      const claims = !who ? '' : JSON.stringify(who.role === 'anon' ? { role: 'anon' } : { sub: who.id, role: 'authenticated' });
      await this.pg.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
      if (who) await this.pg.exec(`set role ${who.role}`);
      const r = await this.pg.query<T>(sql, params);
      return r.rows;
    } finally {
      await this.pg.exec('reset role');
    }
  }

  /** RPC を呼んで jsonb の結果を返す */
  async rpc<T = any>(who: Who, fn: string, args: unknown[] = []): Promise<T> {
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.as<{ r: T }>(who, `select public.${fn}(${ph}) as r`, args);
    return rows[0]!.r;
  }
}

/** 失敗するはずの操作。エラーの文を返す(成功したらテストを落とす) */
export async function fails(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('成功してしまった(失敗するはず)');
}
