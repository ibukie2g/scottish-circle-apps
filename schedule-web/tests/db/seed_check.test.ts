// 試し用データ(supabase/seed_test.sql)が流せて、2回流しても同じになることの確認
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { TestDb } from './db';

test('試し用データは2回流しても同じ状態になる', async () => {
  const db = await TestDb.create();
  const seed = readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'seed_test.sql'), 'utf8');
  await db.pg.exec(seed);
  await db.pg.exec(seed);
  const counts = await db.as(null, `select (select count(*)::int from public.groups) g, (select count(*)::int from public.members) m,
    (select count(*)::int from public.events) e, (select count(*)::int from public.candidates) c`);
  expect(counts[0]).toEqual({ g: 2, m: 4, e: 2, c: 5 });
  const p = await db.user(true);
  const tok = (await db.as(null, `select token from public.groups where name = '試し用サークル'`))[0]!.token;
  const g = await db.rpc(p, 'open_group', [tok]);
  expect(g.member_count).toBe(4);
  expect(g.events[0].name).toBe('忘年会(試し)');
});
