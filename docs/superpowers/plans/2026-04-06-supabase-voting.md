# Supabase Voting System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GitHub Actions dispatch voting system with Supabase PostgreSQL for per-report up/down voting with anonymous voter IDs.

**Architecture:** Frontend-only voting via `@supabase/supabase-js`. Anonymous voter IDs generated from SHA-256(username + random salt). Supabase anon key + RLS for security. No Python backend involvement. Clean break from old GitHub-based votes.

**Tech Stack:** Supabase (PostgreSQL), @supabase/supabase-js, Web Crypto API (SHA-256), Decky SteamClient APIs

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/lib/voting.ts` | Supabase client init, voter ID generation, vote submission, vote fetching |
| Create | `src/lib/voting.test.ts` | Unit tests for voter ID generation and vote data transforms |
| Modify | `src/types.ts:57-63` | Add `downvotes` field to `ScoredReport` |
| Modify | `src/lib/cache.ts:30-38` | Change `CacheEntry.votes` type to support up+down |
| Modify | `src/lib/cache.ts:203-209` | Update `updateCachedVotes` signature |
| Modify | `src/lib/scoring.ts:125-132` | Add `downvotes: 0` default in `scoreReport` return |
| Modify | `src/lib/protondb.ts:26-32,379-517` | Remove vote-related code (VOTES_URL, dispatch URLs, getVotes, postUpvote) |
| Modify | `src/components/tabs/ConfigureTab.tsx:323,347-355,377-378,415-431,722-762` | Wire up Supabase voting, add downvote handler |
| Modify | `src/components/ReportCard.tsx:19,165-172` | Add `onDownvote` prop, make thumbs down interactive |
| Modify | `src/components/ReportDetailModal.tsx:83,380-388` | Add `onDownvote` prop, wire both thumb buttons |
| Modify | `src/components/tabs/GeneralSettingsTab.tsx:123,144-213` | Remove GitHub token UI |
| Modify | `src/lib/i18n.ts` | Remove ghToken keys, add new vote-related strings |
| Modify | `src/components/CacheManagerModal.tsx:86` | Update vote count display for new shape |
| Modify | `package.json` | Add `@supabase/supabase-js` dependency |

---

### Task 1: Install Supabase JS client

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the dependency**

```bash
pnpm add @supabase/supabase-js
```

- [ ] **Step 2: Verify it builds**

```bash
pnpm build
```

Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "add @supabase/supabase-js dependency"
```

---

### Task 2: Add `downvotes` to types and scoring

**Files:**
- Modify: `src/types.ts:57-63`
- Modify: `src/lib/scoring.ts:125-132`
- Modify: `src/lib/scoring.test.ts`

- [ ] **Step 1: Write a failing test for downvotes in scored reports**

In `src/lib/scoring.test.ts`, add a test that checks the scored report includes a `downvotes` field:

```typescript
it('scored report includes downvotes defaulting to 0', () => {
  const report = scoreReport(makeReport(), defaultContext);
  expect(report.downvotes).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/lib/scoring.test.ts
```

Expected: FAIL, `downvotes` does not exist on type.

- [ ] **Step 3: Add `downvotes` to `ScoredReport`**

In `src/types.ts`, add after line 62:

```typescript
export interface ScoredReport extends CdnReport {
  score: number;
  gpuTier: GpuTier;
  recencyDays: number;
  notesModifier: number;
  upvotes: number;
  downvotes: number;
}
```

- [ ] **Step 4: Add `downvotes: 0` in `scoreReport` return**

In `src/lib/scoring.ts`, update the return object (around line 125):

```typescript
  return {
    ...report,
    score: Math.max(0, Math.round(raw)),
    gpuTier,
    recencyDays,
    notesModifier,
    upvotes: 0,
    downvotes: 0,
  };
```

- [ ] **Step 5: Run tests**

```bash
pnpm test -- src/lib/scoring.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Build check**

```bash
pnpm build
```

Expected: clean build. Some downstream components may show warnings about missing `downvotes` -- that's OK, we'll fix them in later tasks.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/lib/scoring.ts src/lib/scoring.test.ts
git commit -m "add downvotes field to ScoredReport"
```

---

### Task 3: Update cache to support up/down vote shape

**Files:**
- Modify: `src/lib/cache.ts:30-38`
- Modify: `src/lib/cache.ts:203-209`
- Modify: `src/lib/cache.test.ts`

- [ ] **Step 1: Write a failing test for the new votes shape**

In `src/lib/cache.test.ts`, add a test that uses the new vote shape:

```typescript
it('updateCachedVotes stores upvotes and downvotes', () => {
  const appId = '999';
  setCache(appId, [], null, {}, 'cdn');
  updateCachedVotes(appId, { 'report_key_1': { upvotes: 3, downvotes: 1 } });
  const cached = getCached(appId);
  expect(cached?.votes).toEqual({ 'report_key_1': { upvotes: 3, downvotes: 1 } });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/lib/cache.test.ts
```

Expected: FAIL, type mismatch.

- [ ] **Step 3: Update `CacheEntry.votes` type**

In `src/lib/cache.ts`, change the `CacheEntry` interface:

```typescript
export interface VoteTotals {
  upvotes: number;
  downvotes: number;
}

export interface CacheEntry {
  appId: string;
  reports: CdnReport[];
  summary: ProtonDBSummary | null;
  votes: Record<string, VoteTotals>;
  cachedAt: number;
  lastAccessedAt: number;
  source: 'cdn' | 'live-summary' | 'prefetch';
}
```

- [ ] **Step 4: Update `updateCachedVotes` signature**

```typescript
export function updateCachedVotes(appId: string, votes: Record<string, VoteTotals>): void {
  const entry = memCache.get(appId);
  if (!entry) return;
  entry.votes = votes;
  entry.lastAccessedAt = Date.now();
  persistToStorage();
}
```

- [ ] **Step 5: Fix `setCache` call if it references the old votes type**

Check the `setCache` function signature and update the `votes` parameter type there too:

```typescript
export function setCache(
  appId: string,
  reports: CdnReport[],
  summary: ProtonDBSummary | null,
  votes: Record<string, VoteTotals>,
  source: CacheEntry['source'],
): void {
```

- [ ] **Step 6: Fix any other existing tests that use the old `Record<string, number>` shape**

Search `cache.test.ts` for `votes:` references and update them to use `{ upvotes: N, downvotes: 0 }` or `{}`.

- [ ] **Step 7: Run tests**

```bash
pnpm test -- src/lib/cache.test.ts
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/cache.ts src/lib/cache.test.ts
git commit -m "update cache votes type to support upvotes and downvotes"
```

---

### Task 4: Create `src/lib/voting.ts` -- voter ID and Supabase client

**Files:**
- Create: `src/lib/voting.ts`
- Create: `src/lib/voting.test.ts`

- [ ] **Step 1: Write failing tests for voter ID generation**

Create `src/lib/voting.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock crypto.subtle and crypto.getRandomValues for test env
const mockDigest = vi.fn();
const mockGetRandomValues = vi.fn();

vi.stubGlobal('crypto', {
  subtle: { digest: mockDigest },
  getRandomValues: mockGetRandomValues,
});

// mock localStorage
const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
});

// mock SteamClient
vi.stubGlobal('SteamClient', {
  User: { GetCurrentUser: () => ({ strAccountName: 'testuser' }) },
});

// mock logger
vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn(),
}));

describe('voter ID generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(store).forEach(k => delete store[k]);
    // reset the cached voter ID by re-importing
  });

  it('generates a salt on first call and stores it', async () => {
    // setup: getRandomValues fills with predictable bytes
    mockGetRandomValues.mockImplementation((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = i;
      return arr;
    });
    // setup: digest returns a predictable ArrayBuffer
    const fakeHash = new Uint8Array(32).fill(0xAB);
    mockDigest.mockResolvedValue(fakeHash.buffer);

    const { getVoterId } = await import('./voting');
    const id = await getVoterId();

    expect(typeof id).toBe('string');
    expect(id.length).toBe(64); // 32 bytes as hex
    expect(store['proton-pulse-voter-salt']).toBeDefined();
    expect(mockDigest).toHaveBeenCalledOnce();
  });

  it('reuses stored salt on subsequent calls', async () => {
    store['proton-pulse-voter-salt'] = 'existing-salt-hex';
    const fakeHash = new Uint8Array(32).fill(0xCD);
    mockDigest.mockResolvedValue(fakeHash.buffer);

    const { getVoterId } = await import('./voting');
    const id = await getVoterId();

    expect(id.length).toBe(64);
    // should NOT have called getRandomValues since salt already exists
    expect(mockGetRandomValues).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/lib/voting.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/lib/voting.ts`**

```typescript
// src/lib/voting.ts
//
// Supabase-backed voting system. Handles voter ID generation,
// vote submission (upsert), and fetching vote totals.
// No login required -- uses the Supabase anon key with RLS.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logFrontendEvent } from './logger';
import type { VoteTotals } from './cache';

// these are public by design -- RLS controls access
const SUPABASE_URL = 'https://PLACEHOLDER.supabase.co';
const SUPABASE_ANON_KEY = 'PLACEHOLDER';

const SALT_KEY = 'proton-pulse-voter-salt';
const VOTE_COOLDOWN_MS = 3000;

let supabase: SupabaseClient | null = null;
let cachedVoterId: string | null = null;
let lastVoteAt = 0;

function getClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

// ── voter ID ──────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getSalt(): string {
  let salt = localStorage.getItem(SALT_KEY);
  if (!salt) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    salt = bytesToHex(bytes);
    localStorage.setItem(SALT_KEY, salt);
    void logFrontendEvent('INFO', 'Generated new voter salt');
  }
  return salt;
}

function getSteamUsername(): string {
  try {
    const user = (SteamClient as any).User?.GetCurrentUser?.();
    return user?.strAccountName ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function getVoterId(): Promise<string> {
  if (cachedVoterId) return cachedVoterId;

  const salt = getSalt();
  const username = getSteamUsername();
  const data = new TextEncoder().encode(username + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  cachedVoterId = bytesToHex(new Uint8Array(hashBuffer));

  void logFrontendEvent('DEBUG', 'Voter ID computed', {
    usernameLength: username.length,
    idPrefix: cachedVoterId.slice(0, 8),
  });
  return cachedVoterId;
}

// ── vote submission ───────────────────────────────────────────────────────

export async function submitVote(
  appId: string,
  reportKey: string,
  vote: 1 | -1,
): Promise<boolean> {
  const now = Date.now();
  if (now - lastVoteAt < VOTE_COOLDOWN_MS) {
    void logFrontendEvent('DEBUG', 'Vote cooldown active, ignoring', { appId, reportKey });
    return false;
  }

  const voterId = await getVoterId();
  void logFrontendEvent('INFO', 'Submitting vote', {
    appId, reportKey, vote, voterIdPrefix: voterId.slice(0, 8),
  });

  try {
    const { error } = await getClient()
      .from('report_votes')
      .upsert(
        {
          voter_id: voterId,
          app_id: appId,
          report_key: reportKey,
          vote,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'voter_id,app_id,report_key' },
      );

    lastVoteAt = Date.now();

    if (error) {
      void logFrontendEvent('ERROR', 'Vote submission failed', {
        appId, reportKey, error: error.message,
      });
      return false;
    }

    void logFrontendEvent('INFO', 'Vote submitted', { appId, reportKey, vote });
    return true;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Vote submission threw', {
      appId, reportKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ── fetch vote totals ─────────────────────────────────────────────────────

export async function getVoteTotals(
  appId: string,
): Promise<Record<string, VoteTotals>> {
  void logFrontendEvent('DEBUG', 'Fetching vote totals', { appId });

  try {
    const { data, error } = await getClient()
      .from('report_vote_totals')
      .select('report_key, upvotes, downvotes')
      .eq('app_id', appId);

    if (error) {
      void logFrontendEvent('ERROR', 'Vote totals fetch failed', {
        appId, error: error.message,
      });
      return {};
    }

    const totals: Record<string, VoteTotals> = {};
    for (const row of data ?? []) {
      totals[row.report_key] = {
        upvotes: row.upvotes ?? 0,
        downvotes: row.downvotes ?? 0,
      };
    }

    void logFrontendEvent('DEBUG', 'Vote totals fetched', {
      appId, reportCount: Object.keys(totals).length,
    });
    return totals;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Vote totals fetch threw', {
      appId, error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

// ── check user's existing vote on a report ───────────────────────────────

export async function getUserVote(
  appId: string,
  reportKey: string,
): Promise<1 | -1 | null> {
  try {
    const voterId = await getVoterId();
    const { data, error } = await getClient()
      .from('report_votes')
      .select('vote')
      .eq('voter_id', voterId)
      .eq('app_id', appId)
      .eq('report_key', reportKey)
      .maybeSingle();

    if (error || !data) return null;
    return data.vote as 1 | -1;
  } catch {
    return null;
  }
}

// ── cooldown check (for UI button state) ─────────────────────────────────

export function isVoteCooldownActive(): boolean {
  return Date.now() - lastVoteAt < VOTE_COOLDOWN_MS;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- src/lib/voting.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Build check**

```bash
pnpm build
```

Expected: may have warnings from other files referencing old vote types. That's fine.

- [ ] **Step 6: Commit**

```bash
git add src/lib/voting.ts src/lib/voting.test.ts
git commit -m "add voting module with Supabase client and voter ID generation"
```

---

### Task 5: Remove old GitHub voting code from protondb.ts

**Files:**
- Modify: `src/lib/protondb.ts:26-32,379-517`
- Modify: `src/lib/protondb.test.ts` (if it references vote functions)

- [ ] **Step 1: Remove vote-related constants**

In `src/lib/protondb.ts`, delete these lines (around lines 26-32):

```typescript
// DELETE these:
const VOTES_URL = ...
const REPOSITORY_DISPATCH_URL = ...
const WORKFLOW_DISPATCH_URL = ...
const WORKFLOW_REF = "main";
```

- [ ] **Step 2: Remove `getVotes`, `getVotesWithDiagnostics`, and `postUpvote` functions**

Delete the entire `getVotes` function (line ~379-381), the entire `getVotesWithDiagnostics` function (lines ~384-435), and the entire `postUpvote` function (lines ~437-517).

Also remove the `VotesFetchDiagnostics` export interface if it exists.

- [ ] **Step 3: Remove the `updateCachedVotes` import**

In `src/lib/protondb.ts`, remove `updateCachedVotes` from the cache import line since it's no longer used here.

- [ ] **Step 4: Update protondb.test.ts**

Remove any tests that reference `getVotes`, `getVotesWithDiagnostics`, `postUpvote`, or `VotesFetchDiagnostics`.

- [ ] **Step 5: Run tests**

```bash
pnpm test -- src/lib/protondb.test.ts
```

Expected: all remaining tests PASS.

- [ ] **Step 6: Build check**

```bash
pnpm build
```

Expected: will show errors in ConfigureTab and CacheManagerModal where these removed functions are still imported. That's expected, we fix those in the next tasks.

- [ ] **Step 7: Commit**

```bash
git add src/lib/protondb.ts src/lib/protondb.test.ts
git commit -m "remove GitHub-based voting code from protondb module"
```

---

### Task 6: Wire up ConfigureTab to Supabase voting

**Files:**
- Modify: `src/components/tabs/ConfigureTab.tsx`

- [ ] **Step 1: Update imports**

Replace the old vote imports:

```typescript
// REMOVE these imports from protondb:
// getVotes, getVotesWithDiagnostics, postUpvote, VotesFetchDiagnostics

// ADD:
import { getVoteTotals, submitVote } from '../../lib/voting';
import type { VoteTotals } from '../../lib/cache';
```

- [ ] **Step 2: Update votes state type**

Change line ~323:

```typescript
const [votes, setVotes] = useState<Record<string, VoteTotals>>({});
```

- [ ] **Step 3: Update report display mapping**

Change lines ~347-355 where `upvotes` is assigned:

```typescript
const baseDisplayReports: DisplayReportCard[] = reports.map(r => ({
  ...scoreReport(r, scoreContext),
  upvotes: votes[reportKey(r)]?.upvotes ?? 0,
  downvotes: votes[reportKey(r)]?.downvotes ?? 0,
  displayKey: `cdn:${reportKey(r)}`,
}));

const editedDisplayReports: DisplayReportCard[] = editedReports.map((entry) => ({
  ...scoreReport(entry.report, scoreContext),
  upvotes: votes[reportKey(entry.report)]?.upvotes ?? 0,
  downvotes: votes[reportKey(entry.report)]?.downvotes ?? 0,
  displayKey: `edited:${entry.id}`,
  isEdited: true,
  editLabel: entry.label,
}));
```

- [ ] **Step 4: Update sort by votes**

Change lines ~377-378:

```typescript
const sortedReports =
  sortMode === 'votes'
    ? [...visibleReports].sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes))
    : visibleReports;
```

- [ ] **Step 5: Update data loading to use `getVoteTotals`**

In the `useEffect` that loads data (around line 415), replace the vote fetch:

```typescript
void Promise.all([
  getProtonDBReportsWithDiagnostics(String(appId)),
  getVoteTotals(String(appId)),
]).then(([reportResult, voteTotals]) => {
  if (cancelled) return;
  const r = reportResult.reports;
  void logFrontendEvent('INFO', `Manage This Game: loaded (${Date.now() - loadT0}ms)`, {
    appId,
    appName,
    reportCount: r.length,
    voteCount: Object.keys(voteTotals).length,
    durationMs: Date.now() - loadT0,
    source: reportResult.diagnostics.source,
  });
  setReports(r);
  setVotes(voteTotals);
  setReportDiagnostics(reportResult.diagnostics);
```

Remove `setVoteDiagnostics` and the `voteDiagnostics` state if it's no longer used (Supabase errors are logged directly).

- [ ] **Step 6: Replace `handleUpvote` with Supabase version**

Replace the entire `handleUpvote` function (lines ~723-762):

```typescript
const handleUpvote = async (targetReport: DisplayReportCard) => {
  if (!appId) return;
  const key = reportKey(targetReport);
  void logFrontendEvent('INFO', 'Upvote requested', { appId, appName, reportKey: key });

  const ok = await submitVote(String(appId), key, 1);
  if (ok) {
    // optimistic update
    setVotes(prev => ({
      ...prev,
      [key]: {
        upvotes: (prev[key]?.upvotes ?? 0) + 1,
        downvotes: prev[key]?.downvotes ?? 0,
      },
    }));
    toaster.toast({ title: 'Proton Pulse', body: t().configure.voteSubmitted });
  } else {
    toaster.toast({ title: 'Proton Pulse', body: t().configure.voteFailed });
  }
};
```

- [ ] **Step 7: Add `handleDownvote`**

Add right after `handleUpvote`:

```typescript
const handleDownvote = async (targetReport: DisplayReportCard) => {
  if (!appId) return;
  const key = reportKey(targetReport);
  void logFrontendEvent('INFO', 'Downvote requested', { appId, appName, reportKey: key });

  const ok = await submitVote(String(appId), key, -1);
  if (ok) {
    setVotes(prev => ({
      ...prev,
      [key]: {
        upvotes: prev[key]?.upvotes ?? 0,
        downvotes: (prev[key]?.downvotes ?? 0) + 1,
      },
    }));
    toaster.toast({ title: 'Proton Pulse', body: t().configure.voteSubmitted });
  } else {
    toaster.toast({ title: 'Proton Pulse', body: t().configure.voteFailed });
  }
};
```

- [ ] **Step 8: Pass `onDownvote` to ReportCard and ReportDetailModal**

In the JSX where `ReportCard` is rendered, add `onDownvote={handleDownvote}`.

In the `openReportDetail` function where `ReportDetailModal` is opened via `showModal`, add `onDownvote={handleDownvote}`.

- [ ] **Step 9: Build check**

```bash
pnpm build
```

Expected: errors in ReportCard and ReportDetailModal about missing `onDownvote` prop. We fix those next.

- [ ] **Step 10: Commit**

```bash
git add src/components/tabs/ConfigureTab.tsx
git commit -m "wire ConfigureTab to Supabase voting with up/down support"
```

---

### Task 7: Update ReportCard with downvote support

**Files:**
- Modify: `src/components/ReportCard.tsx`

- [ ] **Step 1: Add `downvotes` to `DisplayReportCard` and `onDownvote` to Props**

In `src/components/ReportCard.tsx`, the `DisplayReportCard` interface extends `ScoredReport` which already has `downvotes` after Task 2.

Update the `Props` interface:

```typescript
interface Props {
  report: DisplayReportCard;
  selected: boolean;
  focused?: boolean;
  onSelect: (report: DisplayReportCard) => void;
  onFocus?: (report: DisplayReportCard) => void;
  onUpvote?: (report: DisplayReportCard) => void;
  onDownvote?: (report: DisplayReportCard) => void;
}
```

- [ ] **Step 2: Update component signature and thumbs down**

Add `onDownvote` to the destructured props:

```typescript
export function ReportCard({ report, selected, focused = false, onSelect, onFocus, onUpvote, onDownvote }: Props) {
```

Update the thumbs down span to be interactive and show `report.downvotes`:

```typescript
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onDownvote?.(report);
              }}
              style={{
                cursor: onDownvote ? 'pointer' : 'default',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                opacity: onDownvote ? 0.85 : 0.4,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.5l-.92 4.65c-.05.22-.02.46.08.66.23.45.52.86.88 1.22L10 22l6.41-6.41c.38-.38.59-.89.59-1.42V6.34C17 5.05 15.95 4 14.66 4h-8.1c-.71 0-1.36.37-1.72.97l-2.67 6.15z" />
              </svg>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#d9e8f4' }}>{report.downvotes}</span>
            </span>
```

- [ ] **Step 3: Build check**

```bash
pnpm build
```

Expected: clean or only warnings from ReportDetailModal.

- [ ] **Step 4: Commit**

```bash
git add src/components/ReportCard.tsx
git commit -m "make ReportCard thumbs down interactive with downvote count"
```

---

### Task 8: Update ReportDetailModal with downvote support

**Files:**
- Modify: `src/components/ReportDetailModal.tsx`

- [ ] **Step 1: Add `onDownvote` to props**

Update the `ReportDetailModalProps` interface:

```typescript
export interface ReportDetailModalProps {
  closeModal?: () => void;
  report: DisplayReportCard;
  appId: number;
  appName: string;
  sysInfo: SystemInfo | null;
  currentLaunchOptions: string;
  onApply: (report: DisplayReportCard) => Promise<void>;
  onUpvote: (report: DisplayReportCard) => Promise<void>;
  onDownvote: (report: DisplayReportCard) => Promise<void>;
  onSaveEdit: (entry: EditedReportEntry) => void;
}
```

- [ ] **Step 2: Add downvote handler and destructure new prop**

Add `onDownvote` to the destructured props. Add a handler:

```typescript
const handleDownvote = async () => {
  void logFrontendEvent('INFO', 'ReportDetail: Downvote requested', {
    appId, appName, protonVersion: report.protonVersion,
  });
  setUpvoting(true); // reuse the same loading state
  try {
    await onDownvote(report);
  } finally {
    setUpvoting(false);
  }
};
```

- [ ] **Step 3: Wire the thumbs down button**

Update the thumbs down `DialogButton` to call `handleDownvote` instead of being inert:

```typescript
          <DialogButton
            onClick={handleDownvote}
            disabled={upvoting}
            style={{ flex: 0.5, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          >
            {upvoting ? <SteamSpinner /> : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.5l-.92 4.65c-.05.22-.02.46.08.66.23.45.52.86.88 1.22L10 22l6.41-6.41c.38-.38.59-.89.59-1.42V6.34C17 5.05 15.95 4 14.66 4h-8.1c-.71 0-1.36.37-1.72.97l-2.67 6.15z" />
                </svg>
                <span>{report.downvotes}</span>
              </>
            )}
          </DialogButton>
```

- [ ] **Step 4: Update the info row for votes**

Update the votes InfoRow to show both counts:

```typescript
<InfoRow label={t().reports.votes} value={`+${report.upvotes} / -${report.downvotes}`} />
```

- [ ] **Step 5: Build check**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/components/ReportDetailModal.tsx
git commit -m "wire ReportDetailModal thumbs down button to Supabase voting"
```

---

### Task 9: Remove GitHub token UI from GeneralSettingsTab

**Files:**
- Modify: `src/components/tabs/GeneralSettingsTab.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Remove token state and handler**

In `src/components/tabs/GeneralSettingsTab.tsx`, delete:

```typescript
// DELETE:
const [ghToken, setGhToken] = useState(() => getSetting<string>('gh-votes-token', ''));

// DELETE the handleTokenChange function:
const handleTokenChange = (value: string) => { ... };
```

- [ ] **Step 2: Remove the token input UI block**

Delete the entire `<div>` block (lines ~189-213) that contains the "GitHub Token" label, description, and password input.

- [ ] **Step 3: Update i18n strings**

In `src/lib/i18n.ts`:

Remove from the `TranslationTree` interface:
```typescript
// DELETE:
ghToken: string;
ghTokenDescription: string;
```

Remove from the English defaults:
```typescript
// DELETE:
ghToken: 'GitHub Token',
ghTokenDescription: 'Personal access token for submitting votes',
```

Remove from the `configure` section:
```typescript
// DELETE:
setTokenToUpvote: string;   // from interface
setTokenToUpvote: '...',    // from defaults
upvoteFailed: string;       // from interface
upvoteFailed: '...',        // from defaults
```

Update the translation files (`de.ts`, `es.ts`, `fr.ts`, `ja.ts`, `ko.ts`, `pt-BR.ts`, `ru.ts`, `tr.ts`, `zh-CN.ts`) to remove the same keys. (Some may not have all keys translated, just remove what's there.)

- [ ] **Step 4: Build check**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 5: Run all tests**

```bash
pnpm test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/tabs/GeneralSettingsTab.tsx src/lib/i18n.ts src/lib/translations/
git commit -m "remove GitHub token voting UI, no longer needed with Supabase"
```

---

### Task 10: Update CacheManagerModal vote display

**Files:**
- Modify: `src/components/CacheManagerModal.tsx`

- [ ] **Step 1: Update the vote count display**

In `src/components/CacheManagerModal.tsx`, around line 86, the vote count display uses `Object.keys(voteResult.votes).length`. This import comes from protondb.ts which no longer exports vote functions.

Update the refresh handler to fetch votes from the new module:

```typescript
// ADD import at top:
import { getVoteTotals } from '../lib/voting';

// In handleRefresh, replace the votes fetch:
const [reportResult, voteTotals] = await Promise.all([
  getProtonDBReportsWithDiagnostics(appId),
  getVoteTotals(appId),
]);
```

Remove the old `getVotesWithDiagnostics` import from protondb.

Update the log line:

```typescript
void logFrontendEvent('INFO', 'Cache refresh complete', {
  appId,
  reports: reportResult.reports.length,
  votes: Object.keys(voteTotals).length,
});
```

- [ ] **Step 2: Build check**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/CacheManagerModal.tsx
git commit -m "update CacheManagerModal to use Supabase vote fetching"
```

---

### Task 11: Supabase project setup and final integration test

**Files:**
- Modify: `src/lib/voting.ts` (replace placeholder URL and key)

- [ ] **Step 1: Set up Supabase project**

Go to https://supabase.com and create a new project (or use existing account).

- [ ] **Step 2: Run the SQL schema**

In the Supabase SQL Editor, run:

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

CREATE VIEW report_vote_totals AS
SELECT
  app_id,
  report_key,
  COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
  COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
FROM report_votes
GROUP BY app_id, report_key;

ALTER TABLE report_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON report_votes FOR SELECT USING (true);
CREATE POLICY "Insert own vote" ON report_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Update own vote" ON report_votes FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "No deletes" ON report_votes FOR DELETE USING (false);
```

- [ ] **Step 3: Copy the project URL and anon key**

Go to Settings > API in the Supabase dashboard. Copy:
- Project URL
- `anon` public key

- [ ] **Step 4: Update `src/lib/voting.ts` with real values**

Replace the placeholder constants:

```typescript
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...your-anon-key...';
```

- [ ] **Step 5: Full build and test**

```bash
pnpm test && pnpm build
```

Expected: all tests PASS, clean build.

- [ ] **Step 6: Commit**

```bash
git add src/lib/voting.ts
git commit -m "configure Supabase project URL and anon key for voting"
```

- [ ] **Step 7: Deploy and test on Steam Deck**

Deploy to Steam Deck and verify:
1. Vote totals load (0/0 for fresh start)
2. Clicking thumbs up submits a vote and updates the count
3. Clicking thumbs down submits a vote and updates the count
4. Changing vote (up then down) swaps correctly
5. Cooldown prevents rapid double-taps
6. GitHub token field is gone from settings
