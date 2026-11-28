-- 11/29 引っ越しのとき:管理用の鍵(service_role)に表の権限をつける
-- プロジェクトを作るとき「新しい表に自動で権限をつける」をオフにしたので、service_role にも権限がなかった
-- (service_role は RLS を通らない。使うのは伊吹のパソコンの引っ越しスクリプトだけ。画面には入れない)
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
-- 合言葉を作る・名前を比べるなどの部品(private)も使えるようにする(表を入れるときの既定値・生成列で使う)
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;
