# Supabase Voting System Design

Replaces the current GitHub Actions dispatch voting system with Supabase (PostgreSQL). Per-report voting with anonymous voter IDs, no login required, no GitHub PAT needed.

## Decisions

- **Scope**: per-report votes only (upvote/downvote per report per user)
- **Voter ID**: SHA-256 hash of `username + random_salt`. Salt generated once at install, stored in localStorage
- **Auth**: Supabase anon key + Row Level Security. No Supabase Auth, no JWT
- **Client**: `@supabase/supabase-js` frontend library (~30KB)
- **Migration**: clean break, Supabase starts fresh with zero votes. Old GitHub votes archived
- **Rate limiting**: DB unique constraint prevents duplicates, 2-3 second frontend cooldown after voting
- **Generation**: all vote logic runs on the frontend (TypeScript). No Python backend dependency

## Database Schema

### Table: report_votes

```sql
CREATE TABLE report_votes (
  voter_id    TEXT NOT NULL,
  app_id      TEXT NOT NULL,
  report_key  TEXT NOT NULL,
  vote        SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (voter_id, app_id, report_key)
);

CREATE INDEX idx_report_votes_app ON report_votes (app_id);
```

### View: report_vote_totals

```sql
CREATE VIEW report_vote_totals AS
SELECT
  app_id,
  report_key,
  COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
  COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
FROM report_votes
GROUP BY app_id, report_key;
```

### Row Level Security

```sql
ALTER TABLE report_votes ENABLE ROW LEVEL SECURITY;

-- anyone with the anon key can read all votes
CREATE POLICY "Public read" ON report_votes FOR SELECT USING (true);

-- anyone can insert (PK constraint prevents duplicates)
CREATE POLICY "Insert own vote" ON report_votes FOR INSERT
  WITH CHECK (true);

-- upserts go through INSERT policy (PostgREST uses INSERT ... ON CONFLICT)
-- standalone UPDATEs not needed, but allow them scoped to matching voter_id
CREATE POLICY "Update own vote" ON report_votes FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- no deletes allowed
CREATE POLICY "No deletes" ON report_votes FOR DELETE USING (false);
```

## Frontend Architecture

### New file: src/lib/voting.ts

Single module that handles all vote operations. Replaces the GitHub dispatch flow.

**Voter ID generation:**
1. Check localStorage for `proton-pulse-voter-salt`
2. If missing, generate 32 random bytes via `crypto.getRandomValues()`, store as hex
3. Get Steam username from SteamClient APIs
4. Compute `SHA-256(username + salt)` via `crypto.subtle.digest()`
5. Cache the hex string in memory for the session

**Supabase client:**
- Initialized once with hardcoded project URL + anon key (both are public by design)
- Constants: `SUPABASE_URL`, `SUPABASE_ANON_KEY`

**Exported functions:**
- `getVoterId(): Promise<string>` -- returns the cached or freshly computed voter ID
- `submitVote(appId: string, reportKey: string, vote: 1 | -1): Promise<boolean>` -- upserts a vote row
- `getVoteTotals(appId: string): Promise<Record<string, { upvotes: number; downvotes: number }>>` -- queries the view
- `getUserVote(appId: string, reportKey: string): Promise<1 | -1 | null>` -- checks if user already voted

**Vote submission flow:**
1. Get voter ID
2. Upsert into `report_votes` with `onConflict: 'voter_id,app_id,report_key'`
3. Set `updated_at = now()` on conflict
4. 2-3 second cooldown disables vote buttons after submission
5. Optimistically update local vote counts (don't wait for refetch)

### Type changes

**src/types.ts:**
- Keep `ScoredReport.upvotes: number`
- Add `ScoredReport.downvotes: number`

**src/lib/cache.ts:**
- `CacheEntry.votes` changes from `Record<string, number>` to `Record<string, { upvotes: number; downvotes: number }>`

### UI changes

**ReportCard (src/components/ReportCard.tsx):**
- Thumbs up shows `report.upvotes`, thumbs down shows `report.downvotes`
- Both icons become interactive
- Add `onDownvote` prop alongside existing `onUpvote`

**ReportDetailModal (src/components/ReportDetailModal.tsx):**
- Both thumb buttons become functional
- Add `onDownvote` prop
- Show user's current vote state (highlight the active button)

**ConfigureTab (src/components/tabs/ConfigureTab.tsx):**
- `votes` state type changes to `Record<string, { upvotes: number; downvotes: number }>`
- `handleUpvote` calls `submitVote(appId, reportKey, 1)`
- New `handleDownvote` calls `submitVote(appId, reportKey, -1)`
- Remove 90-second delayed refetch, use optimistic local update instead
- Remove `gh-votes-token` check

**GeneralSettingsTab (src/components/tabs/GeneralSettingsTab.tsx):**
- Remove the GitHub token input field entirely

## Code removed

- `postUpvote()` function in `src/lib/protondb.ts`
- `REPOSITORY_DISPATCH_URL` and `WORKFLOW_DISPATCH_URL` constants in `src/lib/protondb.ts`
- `getVotes()` and `getVotesWithDiagnostics()` in `src/lib/protondb.ts` (replaced by voting.ts)
- `gh-votes-token` setting references in GeneralSettingsTab and ConfigureTab
- `VOTES_URL` constant in `src/lib/protondb.ts`

## Error handling

- Supabase unreachable: voting fails with toast ("Couldn't submit vote, try again later")
- Vote totals fetch failure: show 0/0, log the error
- No fallback to GitHub CDN votes (clean break)

## Supabase project setup (manual steps)

1. Create project at supabase.com
2. Run the SQL from the Database Schema section in the SQL Editor
3. Copy Project URL and anon key from Settings > API
4. Paste them as constants in `src/lib/voting.ts`
5. Verify RLS is enabled on `report_votes`

## Dependencies

- Add `@supabase/supabase-js` to package.json (~30KB bundled)
