# Supabase Voting Setup

This document describes the current Proton Pulse voting backend.

## Overview

Votes are stored in Supabase and fetched live by the plugin.

- Frontend: Decky plugin (`src/lib/voting.ts`)
- Database: Supabase Postgres
- Public client key: Supabase publishable key
- Current identity model: hashed local `voter_id`
- Planned future model: Supabase anonymous auth + `auth.uid()`

The public key used by the client is safe to embed in the plugin. It is not a secret. The database must still be protected with grants and RLS.

## Current Database Shape

### Table: `report_votes`

```sql
create table if not exists public.report_votes (
  voter_id text not null,
  app_id text not null,
  report_key text not null,
  vote smallint not null,
  voted_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (voter_id, app_id, report_key)
);

create index if not exists idx_report_votes_app
  on public.report_votes (app_id);
```

### View: `report_vote_totals`

```sql
create or replace view public.report_vote_totals as
select
  app_id,
  report_key,
  coalesce(sum(case when vote = 1 then 1 else 0 end), 0)::integer as upvotes,
  coalesce(sum(case when vote = -1 then 1 else 0 end), 0)::integer as downvotes
from public.report_votes
group by app_id, report_key;
```

## Required Grants

If the plugin needs to talk to Supabase directly from the client, the public roles need access:

```sql
grant usage on schema public to anon, authenticated;

grant select, insert, update on table public.report_votes to anon, authenticated;
grant select on table public.report_vote_totals to anon, authenticated;
```

## If RLS Is Enabled

If `report_votes` has RLS enabled, the current `voter_id` flow needs permissive policies to work:

```sql
alter table public.report_votes enable row level security;

create policy "public read votes"
on public.report_votes
for select
to anon, authenticated
using (true);

create policy "public insert votes"
on public.report_votes
for insert
to anon, authenticated
with check (true);

create policy "public update votes"
on public.report_votes
for update
to anon, authenticated
using (true)
with check (true);
```

These policies restore the current browser-based voting flow. They are not the final security model.

## Client Configuration

The plugin uses:

- Supabase project URL
- Supabase publishable key

Both live in `src/lib/voting.ts`.

Important:

- `sb_publishable_...` is safe to ship in the client
- legacy `anon` keys are also client-safe
- `service_role` or `sb_secret` keys must never be shipped in the plugin

## Current Failure Modes

If voting breaks, check these first:

1. The publishable key in `src/lib/voting.ts` still matches the Supabase project
2. `anon` or `authenticated` still have grants on `report_votes` and `report_vote_totals`
3. RLS policies still allow the current browser flow

Typical symptoms:

- `Invalid API key`
  The key in the plugin is stale, rotated, or incorrect.

- Permission or empty-row errors
  Grants or RLS policies no longer match the client flow.

## Planned Upgrade

The current hashed `voter_id` model works, but the better long-term setup is:

- enable Supabase anonymous auth
- sign in anonymously from the plugin
- store `user_id uuid` instead of `voter_id text`
- enforce ownership with `auth.uid()`

That will give Proton Pulse a proper anonymous user identity without shipping any secret key or relying on an app-local hash.
