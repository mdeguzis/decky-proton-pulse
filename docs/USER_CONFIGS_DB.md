# Supabase User Configs Setup

Custom user-submitted compatibility reports (ProtonDB-style). Only stores configs submitted by plugin users — never imported/scraped data.

## Overview

- Frontend: `src/lib/userConfigs.ts`
- Database: Supabase Postgres (`user_configs` table)
- Migration: `supabase/migrations/20260410_create_user_configs.sql`
- Identity: Same anonymous `client_id` hash as the voting system (`getVoterId()`)
- Type: `UserConfig` in `src/types.ts`

## Table: `user_configs`

| Column | Type | Constraint |
|--------|------|------------|
| id | bigint (identity) | PK |
| client_id | text | NOT NULL, unique with app_id |
| app_id | text | NOT NULL |
| title | text | NOT NULL |
| cpu | text | NOT NULL |
| gpu | text | NOT NULL |
| gpu_driver | text | default '' |
| gpu_vendor | text | CHECK in (nvidia, amd, intel, other), default 'other' |
| ram | text | CHECK `^\d+ GB$` |
| os | text | CHECK against allowed distros |
| kernel | text | default '' |
| proton_version | text | CHECK `^(Proton \|GE-Proton\|Proton-)\d` |
| duration | text | default 'unreported' |
| rating | text | CHECK in (platinum, gold, silver, bronze, borked) |
| notes | text | default '' |
| launch_options | text | default '' — full launch option string |
| enabled_vars | jsonb | default '{}' — env vars map, e.g. `{"DXVK_ASYNC":"1"}` |
| confidence_score | smallint | CHECK 0-200, nullable — plugin's computed relevance score |
| source | text | CHECK in (user, protondb, protondb-local), default 'user' |
| created_at | timestamptz | default now() |

One report per client per app (unique constraint on `client_id, app_id`).

## Allowed OS Values

SteamOS: `SteamOS 3.0`, `SteamOS 3.5`, `SteamOS 3.6`

Major distros: `Ubuntu 22.04`, `Ubuntu 24.04`, `Fedora 40`, `Fedora 41`, `Arch Linux`, `Linux Mint 22`, `Nobara 40`, `Nobara 41`, `Pop!_OS 22.04`, `Manjaro`, `openSUSE Tumbleweed`, `Debian 12`, `ChimeraOS`, `Bazzite`

These are enforced both client-side (`VALID_OS` in `userConfigs.ts`) and server-side (SQL CHECK).

## Proton Version Format

Must match `^(Proton |GE-Proton|Proton-)\d`. Examples:
- `Proton 9.0-4`
- `GE-Proton9-20`
- `Proton-9.22`

## Grants & RLS

Mirrors `report_votes` exactly:

```sql
grant usage on schema public to anon, authenticated;
grant select, insert on table public.user_configs to anon, authenticated;

-- RLS: public read, public insert
alter table public.user_configs enable row level security;
```

No UPDATE grant — configs are insert-only (upsert via `on_conflict`).

## Client API

```ts
import { submitUserConfig, getUserConfigs, getMyConfig, validateUserConfig, VALID_OS, VALID_RATINGS } from './lib/userConfigs';

// Validate before submit
const err = validateUserConfig(input);
if (err) { /* show error */ }

// Submit (upserts — one per client per app)
const { ok, error } = await submitUserConfig(input);

// Fetch all configs for an app
const configs = await getUserConfigs('20');

// Fetch current user's config for an app
const mine = await getMyConfig('20');
```

## Applying the Migration

Run against your Supabase project:

```bash
supabase db push
# or manually via SQL editor in the Supabase dashboard
```

## Failure Modes

Same as voting — check these first:

1. Publishable key in `userConfigs.ts` matches the Supabase project
2. `anon`/`authenticated` roles have grants on `user_configs`
3. RLS policies allow the current flow
4. CHECK constraint violations return a Postgres error — the client-side `validateUserConfig()` should catch these before they hit the DB
