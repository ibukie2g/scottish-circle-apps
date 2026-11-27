-- テスト用:Supabase がもともと持っているもの(ロール・auth スキーマ)の最小限のまね。本番には入れない
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  is_anonymous boolean not null default false
);
-- Supabase と同じく、リクエストの JWT(request.jwt.claims)から読む
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
