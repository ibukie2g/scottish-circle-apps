-- A案からの引っ越し用(11/28):A のグループID を覚えておき、引っ越しをやり直すときに同じグループを入れ直せるようにする
alter table public.groups add column import_key text unique;
