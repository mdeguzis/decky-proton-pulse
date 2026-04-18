-- user_systems: one row per (Steam ID, device) with the user's ProtonDB-style
-- system info blob. Powers the "My Hardware" feature - plugin uploads rows
-- keyed by the device it's running on, web profile lists them per Steam ID and
-- uses the default to pre-fill report submissions.

create table if not exists public.user_systems (
  steam_id     text not null,
  device_id    text not null,
  label        text not null default '',
  sysinfo_text text not null,
  is_default   boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (steam_id, device_id)
);

create index if not exists idx_user_systems_steam_id
  on public.user_systems (steam_id);

-- at most one default row per steam_id
create unique index if not exists uq_user_systems_default
  on public.user_systems (steam_id)
  where is_default;

-- grants mirror report_votes/user_configs (anon read+write)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.user_systems to anon, authenticated;

-- RLS
alter table public.user_systems enable row level security;

create policy "public read systems"
  on public.user_systems for select
  to anon, authenticated
  using (true);

create policy "public insert systems"
  on public.user_systems for insert
  to anon, authenticated
  with check (true);

create policy "public update systems"
  on public.user_systems for update
  to anon, authenticated
  using (true) with check (true);

create policy "public delete systems"
  on public.user_systems for delete
  to anon, authenticated
  using (true);
