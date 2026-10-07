-- Control Centre database. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Every row belongs to the signed-in owner. Nobody else can read or write it.

create table if not exists public.docs (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, path)
);

alter table public.docs enable row level security;

drop policy if exists "owner reads" on public.docs;
drop policy if exists "owner inserts" on public.docs;
drop policy if exists "owner updates" on public.docs;
drop policy if exists "owner deletes" on public.docs;
create policy "owner reads"   on public.docs for select to authenticated using (owner = (select auth.uid()));
create policy "owner inserts" on public.docs for insert to authenticated with check (owner = (select auth.uid()));
create policy "owner updates" on public.docs for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "owner deletes" on public.docs for delete to authenticated using (owner = (select auth.uid()));

-- live sync between phone and laptop
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- private screenshot storage, one folder per owner
insert into storage.buckets (id, name, public)
values ('shots', 'shots', false)
on conflict (id) do nothing;

drop policy if exists "owner reads shots" on storage.objects;
drop policy if exists "owner uploads shots" on storage.objects;
drop policy if exists "owner deletes shots" on storage.objects;
create policy "owner reads shots" on storage.objects for select to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner uploads shots" on storage.objects for insert to authenticated
  with check (bucket_id = 'shots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner deletes shots" on storage.objects for delete to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = (select auth.uid())::text);
