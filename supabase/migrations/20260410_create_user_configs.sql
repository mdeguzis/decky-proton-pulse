-- user_configs: ProtonDB-style compatibility reports submitted by plugin users.
-- Only stores CUSTOM user-submitted configs, not imported/scraped data.
-- Mirrors the report_votes identity model (anonymous client_id hash).

create table if not exists public.user_configs (
  id bigint generated always as identity primary key,
  client_id text not null,
  app_id text not null,
  title text not null,
  cpu text not null,
  gpu text not null,
  gpu_driver text not null default '',
  ram text not null,
  os text not null,
  kernel text not null default '',
  proton_version text not null,
  duration text not null default 'unreported',
  rating text not null,
  notes text not null default '',
  launch_options text not null default '',
  enabled_vars jsonb not null default '{}',
  gpu_vendor text not null default 'other',
  confidence_score smallint,
  source text not null default 'user',
  created_at timestamptz not null default now(),

  -- one report per client per app
  constraint uq_user_configs_client_app unique (client_id, app_id)
);

create index if not exists idx_user_configs_app on public.user_configs (app_id);

-- check constraints for validated enum-like fields
alter table public.user_configs
  add constraint chk_rating
  check (rating in ('platinum', 'gold', 'silver', 'bronze', 'borked'));

alter table public.user_configs
  add constraint chk_os
  check (os in (
    'SteamOS 3.0', 'SteamOS 3.5', 'SteamOS 3.6',
    'Ubuntu 22.04', 'Ubuntu 24.04',
    'Fedora 40', 'Fedora 41',
    'Arch Linux',
    'Linux Mint 22',
    'Nobara 40', 'Nobara 41',
    'Pop!_OS 22.04',
    'Manjaro',
    'openSUSE Tumbleweed',
    'Debian 12',
    'ChimeraOS',
    'Bazzite'
  ));

alter table public.user_configs
  add constraint chk_proton_version
  check (proton_version ~ '^(Proton |GE-Proton|Proton-)\d');

alter table public.user_configs
  add constraint chk_ram
  check (ram ~ '^\d+ GB$');

alter table public.user_configs
  add constraint chk_gpu_vendor
  check (gpu_vendor in ('nvidia', 'amd', 'intel', 'other'));

alter table public.user_configs
  add constraint chk_source
  check (source in ('user', 'protondb', 'protondb-local'));

alter table public.user_configs
  add constraint chk_confidence_score
  check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 200));

-- grants (same pattern as report_votes)
grant usage on schema public to anon, authenticated;
grant select, insert on table public.user_configs to anon, authenticated;

-- RLS
alter table public.user_configs enable row level security;

create policy "public read configs"
  on public.user_configs for select
  to anon, authenticated
  using (true);

create policy "public insert configs"
  on public.user_configs for insert
  to anon, authenticated
  with check (true);
