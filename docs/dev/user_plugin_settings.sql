create table if not exists public.user_plugin_settings (
  voter_id text not null,
  plugin_id text not null default 'proton-pulse',
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (voter_id, plugin_id)
);

create index if not exists idx_user_plugin_settings_plugin_id
  on public.user_plugin_settings (plugin_id);

alter table public.user_plugin_settings enable row level security;

drop policy if exists "Public read user plugin settings" on public.user_plugin_settings;
create policy "Public read user plugin settings"
  on public.user_plugin_settings
  for select
  using (true);

drop policy if exists "Insert user plugin settings" on public.user_plugin_settings;
create policy "Insert user plugin settings"
  on public.user_plugin_settings
  for insert
  with check (true);

drop policy if exists "Update user plugin settings" on public.user_plugin_settings;
create policy "Update user plugin settings"
  on public.user_plugin_settings
  for update
  using (true)
  with check (true);

drop policy if exists "No deletes user plugin settings" on public.user_plugin_settings;
create policy "No deletes user plugin settings"
  on public.user_plugin_settings
  for delete
  using (false);
