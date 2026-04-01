# CDN Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead ProtonDB per-report API with the self-hosted GitHub Pages CDN, enrich scoring with driver matching and notes sentiment, redesign ReportCard to match Valve's controller-configs UI, and add an eventually-consistent upvote system backed by GitHub Actions.

**Architecture:** `CdnReport` replaces `ProtonDBReport` throughout — CDN field names map directly without normalization shims. Scoring is a pure function layer on top of raw CDN data. The upvote workflow lives in the data-pipeline repo's GitHub Actions; the plugin only POSTs a `repository_dispatch` event.

**Tech Stack:** TypeScript, React, Decky `@decky/api` (fetchNoCors), Vitest, GitHub Actions (upvote workflow)

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `src/types.ts` | Modify | Retire `ProtonDBReportResponses`, `ProtonDBReport`; add `CdnReport`; update `ScoredReport` |
| `src/lib/protondb.ts` | Modify | CDN URLs, `getProtonDBReports` returns `CdnReport[]`, add `getVotes`, add `postUpvote` |
| `src/lib/protondb.test.ts` | Modify | Update fixtures and URL assertions; add `getVotes`/`postUpvote` tests |
| `src/lib/scoring.ts` | Modify | New WEIGHTS, `parseNotesSentiment`, `gpuDriverMultiplier`, borked decay, update `scoreReport` |
| `src/lib/scoring.test.ts` | Modify | Update fixtures to `CdnReport`; add sentiment, driver, borked decay tests |
| `src/components/ReportCard.tsx` | Modify | Valve-style card layout |
| `src/components/tabs/ConfigureTab.tsx` | Modify | Page header, parallel fetch+votes, sort state, bottom action bar |
| `data-pipeline/.github/workflows/upvote.yml` | Create | GitHub Actions upvote handler |

---

## Task 1: Update Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Replace the types**

Replace the entire contents of `src/types.ts` with:

```typescript
// src/types.ts

// ─── System Info ───────────────────────────────────────────────────────────────

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'other';

export interface SystemInfo {
  cpu: string | null;
  ram_gb: number | null;
  gpu: string | null;
  gpu_vendor: GpuVendor | null;
  driver_version: string | null;
  kernel: string | null;
  distro: string | null;
  proton_custom: string | null;
}

// ─── ProtonDB Summary ─────────────────────────────────────────────────────────
// Still live: https://www.protondb.com/api/v1/reports/summaries/{appId}.json

export type ProtonRating = 'platinum' | 'gold' | 'silver' | 'bronze' | 'borked' | 'pending';

export interface ProtonDBSummary {
  score: number;
  tier: ProtonRating;
  total: number;
  trendingTier: ProtonRating;
  bestReportedTier: ProtonRating;
  confidence: string;
}

// ─── CDN Report ───────────────────────────────────────────────────────────────
// Shape served by https://mdeguzis.github.io/proton-pulse-data/data/{appId}.json
// rating is normalized to lowercase at fetch time ("Silver" → "silver")

export interface CdnReport {
  appId: string;
  cpu: string;
  duration: string;
  gpu: string;
  gpuDriver: string;
  kernel: string;
  notes: string;
  os: string;
  protonVersion: string;
  ram: string;
  rating: ProtonRating;
  timestamp: number;
  title: string;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export type GpuTier = 'nvidia' | 'amd' | 'intel' | 'unknown';

export interface ScoredReport extends CdnReport {
  score: number;
  gpuTier: GpuTier;
  recencyDays: number;
  notesModifier: number;
  upvotes: number;
}

export interface TieredReports {
  nvidia: ScoredReport[];
  amd: ScoredReport[];
  other: ScoredReport[];
}

// ─── Steam CEF ───────────────────────────────────────────────────────────────
// SteamClient global is provided by @decky/ui — no redeclaration needed.
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "refactor: replace ProtonDBReport with CdnReport type"
```

---

## Task 2: Update Fetch Layer (TDD)

**Files:**
- Modify: `src/lib/protondb.test.ts`
- Modify: `src/lib/protondb.ts`

- [ ] **Step 1: Write failing tests**

Replace the entire contents of `src/lib/protondb.test.ts`:

```typescript
// src/lib/protondb.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@decky/api', () => ({
  fetchNoCors: vi.fn(),
}));

import { fetchNoCors } from '@decky/api';
import { getProtonDBSummary, getProtonDBReports, getVotes, postUpvote } from './protondb';
import type { ProtonDBSummary, CdnReport } from '../types';

const mockFetch = fetchNoCors as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockReset();
});

function makeResponse(status: number, body: unknown) {
  return { status, json: () => Promise.resolve(body) };
}

const fakeSummary: ProtonDBSummary = {
  score: 0.85, tier: 'gold', total: 123,
  trendingTier: 'platinum', bestReportedTier: 'platinum', confidence: 'good',
};

// CDN returns capitalized ratings — the fetch layer must lowercase them
const fakeCdnRaw = [
  {
    appId: '730', cpu: 'Intel i7', duration: 'severalHours',
    gpu: 'NVIDIA GeForce RTX 3080', gpuDriver: 'NVIDIA 545.29.06',
    kernel: '6.1.0', notes: 'Works great', os: 'Arch Linux',
    protonVersion: 'GE-Proton9-7', ram: '32 GB', rating: 'Gold',
    timestamp: 1700000000, title: 'Test Game',
  },
  {
    appId: '730', cpu: 'AMD Ryzen 5', duration: 'allTheTime',
    gpu: 'AMD Radeon RX 7900 XT', gpuDriver: 'Mesa 23.1.0',
    kernel: '6.2.0', notes: 'Minor issues', os: 'Ubuntu 22.04',
    protonVersion: 'Proton 9.0', ram: '16 GB', rating: 'Silver',
    timestamp: 1690000000, title: 'Test Game',
  },
];

const fakeCdnNormalized: CdnReport[] = [
  { ...fakeCdnRaw[0], rating: 'gold' },
  { ...fakeCdnRaw[1], rating: 'silver' },
];

// ─── getProtonDBSummary ────────────────────────────────────────────────────────

describe('getProtonDBSummary', () => {
  it('returns parsed summary on 200', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeSummary));
    expect(await getProtonDBSummary('12345')).toEqual(fakeSummary);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.protondb.com/api/v1/reports/summaries/12345.json'
    );
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse(404, null));
    expect(await getProtonDBSummary('99999')).toBeNull();
  });

  it('returns null when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    expect(await getProtonDBSummary('1')).toBeNull();
  });
});

// ─── getProtonDBReports ────────────────────────────────────────────────────────

describe('getProtonDBReports', () => {
  it('fetches from CDN URL', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeCdnRaw));
    await getProtonDBReports('730');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://mdeguzis.github.io/proton-pulse-data/data/730.json'
    );
  });

  it('normalizes rating to lowercase', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeCdnRaw));
    const result = await getProtonDBReports('730');
    expect(result[0].rating).toBe('gold');
    expect(result[1].rating).toBe('silver');
  });

  it('returns parsed array on 200', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeCdnRaw));
    const result = await getProtonDBReports('730');
    expect(result).toHaveLength(2);
    expect(result[0].protonVersion).toBe('GE-Proton9-7');
  });

  it('returns empty array on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse(404, null));
    expect(await getProtonDBReports('0')).toEqual([]);
  });

  it('returns empty array when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    expect(await getProtonDBReports('1')).toEqual([]);
  });
});

// ─── getVotes ─────────────────────────────────────────────────────────────────

describe('getVotes', () => {
  it('fetches from correct votes URL', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, {}));
    await getVotes('730');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://mdeguzis.github.io/proton-pulse-data/data/730/votes.json'
    );
  });

  it('returns parsed vote map on 200', async () => {
    const voteData = { '1700000000_GE-Proton9-7': 5 };
    mockFetch.mockResolvedValue(makeResponse(200, voteData));
    expect(await getVotes('730')).toEqual(voteData);
  });

  it('returns empty object on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse(404, null));
    expect(await getVotes('730')).toEqual({});
  });

  it('returns empty object when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    expect(await getVotes('730')).toEqual({});
  });
});

// ─── postUpvote ───────────────────────────────────────────────────────────────

describe('postUpvote', () => {
  it('returns false immediately when token is empty', async () => {
    expect(await postUpvote('730', '1700000000_GE-Proton9-7', '')).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('posts to GitHub dispatches endpoint with correct payload', async () => {
    mockFetch.mockResolvedValue(makeResponse(204, null));
    await postUpvote('730', '1700000000_GE-Proton9-7', 'mytoken');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/mdeguzis/proton-pulse-data/dispatches',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          event_type: 'upvote',
          client_payload: { appId: '730', reportKey: '1700000000_GE-Proton9-7' },
        }),
      })
    );
  });

  it('returns true on 204', async () => {
    mockFetch.mockResolvedValue(makeResponse(204, null));
    expect(await postUpvote('730', 'key', 'token')).toBe(true);
  });

  it('returns false on non-204', async () => {
    mockFetch.mockResolvedValue(makeResponse(422, null));
    expect(await postUpvote('730', 'key', 'token')).toBe(false);
  });

  it('returns false when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    expect(await postUpvote('730', 'key', 'token')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
pnpm test src/lib/protondb.test.ts
```

Expected: failures on `getProtonDBReports` URL, `getVotes` not found, `postUpvote` not found.

- [ ] **Step 3: Update protondb.ts**

Replace the entire contents of `src/lib/protondb.ts`:

```typescript
// src/lib/protondb.ts
import { fetchNoCors } from '@decky/api';
import type { ProtonDBSummary, CdnReport, ProtonRating } from '../types';

const SUMMARY_URL  = 'https://www.protondb.com/api/v1/reports/summaries/{id}.json';
const REPORTS_URL  = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}.json';
const VOTES_URL    = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/votes.json';
const DISPATCH_URL = 'https://api.github.com/repos/mdeguzis/proton-pulse-data/dispatches';

export async function getProtonDBSummary(appId: string): Promise<ProtonDBSummary | null> {
  try {
    const resp = await fetchNoCors(SUMMARY_URL.replace('{id}', appId));
    if (resp.status !== 200) return null;
    return await resp.json() as ProtonDBSummary;
  } catch {
    return null;
  }
}

export async function getProtonDBReports(appId: string): Promise<CdnReport[]> {
  try {
    const resp = await fetchNoCors(REPORTS_URL.replace('{id}', appId));
    if (resp.status !== 200) return [];
    const raw = await resp.json() as Array<CdnReport & { rating: string }>;
    return raw.map(r => ({ ...r, rating: r.rating.toLowerCase() as ProtonRating }));
  } catch {
    return [];
  }
}

export async function getVotes(appId: string): Promise<Record<string, number>> {
  try {
    const resp = await fetchNoCors(VOTES_URL.replace('{id}', appId));
    if (resp.status !== 200) return {};
    return await resp.json() as Record<string, number>;
  } catch {
    return {};
  }
}

export async function postUpvote(
  appId: string,
  reportKey: string,
  token: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const resp = await fetchNoCors(DISPATCH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'upvote',
        client_payload: { appId, reportKey },
      }),
    });
    return resp.status === 204;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests — expect all passing**

```bash
pnpm test src/lib/protondb.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/protondb.ts src/lib/protondb.test.ts
git commit -m "feat: switch reports to CDN, add getVotes and postUpvote"
```

---

## Task 3: Update Scoring (TDD)

**Files:**
- Modify: `src/lib/scoring.test.ts`
- Modify: `src/lib/scoring.ts`

- [ ] **Step 1: Write failing tests**

Replace the entire contents of `src/lib/scoring.test.ts`:

```typescript
// src/lib/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { scoreReport, bucketByGpuTier, parseNotesSentiment } from './scoring';
import type { CdnReport, SystemInfo } from '../types';

const nvidiaSystem: SystemInfo = {
  cpu: 'AMD Ryzen 9 9950X3D',
  ram_gb: 64,
  gpu: 'NVIDIA GeForce RTX 5080',
  gpu_vendor: 'nvidia',
  driver_version: '595.45.04',
  kernel: '6.19.8-1-cachyos',
  distro: 'CachyOS',
  proton_custom: 'cachyos-10.0-202603012',
};

const now = Math.floor(Date.now() / 1000);

function makeCdnReport(overrides: Partial<CdnReport> = {}): CdnReport {
  return {
    appId: '12345',
    cpu: 'Intel Core i7',
    duration: 'severalHours',
    gpu: 'NVIDIA GeForce RTX 3080',
    gpuDriver: 'NVIDIA 545.29.06',
    kernel: '6.1.0',
    notes: '',
    os: 'Arch Linux',
    protonVersion: 'GE-Proton9-7',
    ram: '32 GB',
    rating: 'platinum',
    timestamp: now - 30 * 86400,
    title: 'Test Game',
    ...overrides,
  };
}

const platinumNvidiaRecent = makeCdnReport();
const goldAmdOld = makeCdnReport({
  gpu: 'AMD Radeon RX 7900 XTX', gpuDriver: 'Mesa 23.1.0',
  rating: 'gold', timestamp: now - 400 * 86400,
});

// ─── scoreReport ──────────────────────────────────────────────────────────────

describe('scoreReport', () => {
  it('attaches gpuTier, recencyDays, notesModifier, upvotes to result', () => {
    const scored = scoreReport(platinumNvidiaRecent, nvidiaSystem);
    expect(scored.gpuTier).toBe('nvidia');
    expect(scored.recencyDays).toBeGreaterThan(25);
    expect(scored.recencyDays).toBeLessThan(35);
    expect(typeof scored.notesModifier).toBe('number');
    expect(scored.upvotes).toBe(0);
  });

  it('score is never negative', () => {
    const r = makeCdnReport({ rating: 'borked', gpu: '' });
    expect(scoreReport(r, nvidiaSystem).score).toBeGreaterThanOrEqual(0);
  });

  it('gives higher score to matching GPU vendor report', () => {
    const nvidiaScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const amdScore = scoreReport(goldAmdOld, nvidiaSystem).score;
    expect(nvidiaScore).toBeGreaterThan(amdScore);
  });

  it('gives recency bonus for reports under 90 days', () => {
    const recentScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const oldScore = scoreReport(makeCdnReport({ timestamp: now - 400 * 86400 }), nvidiaSystem).score;
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('gives custom proton bonus', () => {
    const geScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const vanillaScore = scoreReport(makeCdnReport({ protonVersion: 'Proton 9.0' }), nvidiaSystem).score;
    expect(geScore).toBeGreaterThan(vanillaScore);
  });

  // ── driver matching ──────────────────────────────────────────────────────────

  it('exact driver version gives higher score than close version', () => {
    const exactDriver = makeCdnReport({ gpuDriver: 'NVIDIA 595.45.04' }); // matches nvidiaSystem
    const closeDriver = makeCdnReport({ gpuDriver: 'NVIDIA 593.10.00' }); // within 2 major
    const exactScore = scoreReport(exactDriver, nvidiaSystem).score;
    const closeScore = scoreReport(closeDriver, nvidiaSystem).score;
    expect(exactScore).toBeGreaterThan(closeScore);
  });

  it('close driver version gives higher score than far version', () => {
    const closeDriver = makeCdnReport({ gpuDriver: 'NVIDIA 593.10.00' });
    const farDriver   = makeCdnReport({ gpuDriver: 'NVIDIA 410.93' });
    const closeScore = scoreReport(closeDriver, nvidiaSystem).score;
    const farScore   = scoreReport(farDriver, nvidiaSystem).score;
    expect(closeScore).toBeGreaterThan(farScore);
  });

  it('different vendor driver gives mismatch multiplier', () => {
    const amdDriverReport = makeCdnReport({ gpu: 'AMD Radeon RX 6800', gpuDriver: 'Mesa 23.1.0' });
    const nvidiaScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const amdScore    = scoreReport(amdDriverReport, nvidiaSystem).score;
    expect(nvidiaScore).toBeGreaterThan(amdScore);
  });

  // ── borked decay ─────────────────────────────────────────────────────────────

  it('fresh borked report scores lower than old borked (decay raises old score)', () => {
    const freshBorked = makeCdnReport({ rating: 'borked', timestamp: now - 30 * 86400 });
    const oldBorked   = makeCdnReport({ rating: 'borked', timestamp: now - 400 * 86400 });
    const freshScore = scoreReport(freshBorked, nvidiaSystem).score;
    const oldScore   = scoreReport(oldBorked, nvidiaSystem).score;
    expect(oldScore).toBeGreaterThan(freshScore);
  });
});

// ─── parseNotesSentiment ──────────────────────────────────────────────────────

describe('parseNotesSentiment', () => {
  it('returns 0 for empty notes', () => {
    expect(parseNotesSentiment('')).toBe(0);
  });

  it('returns negative value for crash keyword', () => {
    expect(parseNotesSentiment('the game crash on launch')).toBeLessThan(0);
  });

  it('returns negative value for multiple negative keywords', () => {
    const single = parseNotesSentiment('crash');
    const multi  = parseNotesSentiment('crash freeze black screen');
    expect(multi).toBeLessThan(single);
  });

  it('returns positive value for positive keywords', () => {
    expect(parseNotesSentiment('works great out of the box')).toBeGreaterThan(0);
  });

  it('is capped at +10', () => {
    const heavy = 'perfect flawless works great no issues out of the box excellent runs perfectly zero issues works flawlessly';
    expect(parseNotesSentiment(heavy)).toBeLessThanOrEqual(10);
  });

  it('is capped at -10', () => {
    const heavy = "crash broken freeze black screen hang softlock corrupted doesn't work unplayable won't launch";
    expect(parseNotesSentiment(heavy)).toBeGreaterThanOrEqual(-10);
  });

  it('is case-insensitive', () => {
    expect(parseNotesSentiment('CRASH')).toBe(parseNotesSentiment('crash'));
  });
});

// ─── bucketByGpuTier ──────────────────────────────────────────────────────────

describe('bucketByGpuTier', () => {
  it('separates nvidia and amd into correct buckets', () => {
    const scored = [platinumNvidiaRecent, goldAmdOld].map(r => scoreReport(r, nvidiaSystem));
    const buckets = bucketByGpuTier(scored);
    expect(buckets.nvidia).toHaveLength(1);
    expect(buckets.amd).toHaveLength(1);
    expect(buckets.other).toHaveLength(0);
  });

  it('sorts each bucket by score descending', () => {
    const r1 = makeCdnReport();
    const r2 = makeCdnReport({ rating: 'silver', timestamp: now - 500 * 86400 });
    const buckets = bucketByGpuTier([r1, r2].map(r => scoreReport(r, nvidiaSystem)));
    expect(buckets.nvidia[0].score).toBeGreaterThanOrEqual(buckets.nvidia[1].score);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
pnpm test src/lib/scoring.test.ts
```

Expected: failures on `parseNotesSentiment` not exported, `CdnReport` type mismatches, new scoring properties missing.

- [ ] **Step 3: Update scoring.ts**

Replace the entire contents of `src/lib/scoring.ts`:

```typescript
// src/lib/scoring.ts
import type { CdnReport, ScoredReport, SystemInfo, TieredReports, GpuTier } from '../types';

// ─── Weights — edit these to tune ranking ─────────────────────────────────────
export const WEIGHTS = {
  BASE_MAX: 60,
  RECENCY_RECENT: 15,
  RECENCY_MID: 5,
  RECENCY_OLD: -5,
  CUSTOM_PROTON: 10,
  GPU_MATCH: 1.0,
  GPU_MISMATCH: 0.5,
  GPU_UNKNOWN: 0.75,
  GPU_DRIVER_EXACT: 1.3,
  GPU_DRIVER_CLOSE: 1.1,
  BORKED_DECAY_DAYS: 365,
  NOTES_MAX: 10,
} as const;

const RATING_SCORES: Record<string, number> = {
  platinum: 1.0,
  gold: 0.8,
  silver: 0.6,
  bronze: 0.4,
  borked: 0.0,
};

const CUSTOM_PROTON_MARKERS = ['ge', 'cachyos', 'tkg', 'protonplus', 'experimental'];

const NEGATIVE_KEYWORDS = [
  'crash', 'broken', 'freeze', 'black screen', 'hang', 'softlock',
  'corrupted', "doesn't work", 'unplayable', "won't launch",
];

const POSITIVE_KEYWORDS = [
  'perfect', 'flawless', 'works great', 'no issues', 'out of the box',
  'excellent', 'runs perfectly', 'zero issues', 'works flawlessly',
];

export function parseNotesSentiment(notes: string): number {
  if (!notes) return 0;
  const lower = notes.toLowerCase();
  let score = 0;
  for (const kw of NEGATIVE_KEYWORDS) {
    if (lower.includes(kw)) score -= 3;
  }
  for (const kw of POSITIVE_KEYWORDS) {
    if (lower.includes(kw)) score += 2;
  }
  return Math.max(-WEIGHTS.NOTES_MAX, Math.min(WEIGHTS.NOTES_MAX, score));
}

function detectReportGpuTier(report: CdnReport): GpuTier {
  const gpu = (report.gpu ?? '').toLowerCase();
  if (!gpu) return 'unknown';
  if (/nvidia|geforce|rtx|gtx|quadro/.test(gpu)) return 'nvidia';
  if (/amd|radeon|rx \d|vega/.test(gpu)) return 'amd';
  if (/intel|arc|iris|uhd/.test(gpu)) return 'intel';
  return 'unknown';
}

function isCustomProton(version: string): boolean {
  const lower = version.toLowerCase();
  return CUSTOM_PROTON_MARKERS.some(m => lower.includes(m));
}

function parseDriverMajor(driverStr: string): number | null {
  // "NVIDIA 545.29.06" → 545, "Mesa 23.1.0" → 23, "NVIDIA 410.93" → 410
  const match = driverStr.match(/(\d+)\.\d+/);
  return match ? parseInt(match[1], 10) : null;
}

function gpuDriverMultiplier(report: CdnReport, sysInfo: SystemInfo): number {
  const reportTier = detectReportGpuTier(report);
  const sysVendor = sysInfo.gpu_vendor;

  if (!sysVendor || reportTier === 'unknown') return WEIGHTS.GPU_UNKNOWN;
  if (reportTier !== sysVendor) return WEIGHTS.GPU_MISMATCH;

  // Same GPU vendor — compare driver versions
  const reportMajor = parseDriverMajor(report.gpuDriver ?? '');
  const sysMajor    = parseDriverMajor(sysInfo.driver_version ?? '');

  if (reportMajor === null || sysMajor === null) return WEIGHTS.GPU_MATCH;
  if (reportMajor === sysMajor) return WEIGHTS.GPU_DRIVER_EXACT;
  if (Math.abs(reportMajor - sysMajor) <= 2) return WEIGHTS.GPU_DRIVER_CLOSE;
  return WEIGHTS.GPU_MATCH;
}

export function scoreReport(report: CdnReport, sysInfo: SystemInfo): ScoredReport {
  const gpuTier = detectReportGpuTier(report);
  const mult = gpuDriverMultiplier(report, sysInfo);

  const recencyDays = Math.round((Date.now() / 1000 - report.timestamp) / 86400);

  // Borked decay: old borked reports are treated as bronze instead of fully penalized
  const effectiveRating =
    report.rating === 'borked' && recencyDays > WEIGHTS.BORKED_DECAY_DAYS
      ? 'bronze'
      : report.rating;

  const ratingScore = (RATING_SCORES[effectiveRating] ?? 0) * WEIGHTS.BASE_MAX;
  const recencyBonus =
    recencyDays < 90  ? WEIGHTS.RECENCY_RECENT :
    recencyDays < 365 ? WEIGHTS.RECENCY_MID :
                        WEIGHTS.RECENCY_OLD;
  const customBonus = isCustomProton(report.protonVersion) ? WEIGHTS.CUSTOM_PROTON : 0;
  const notesModifier = parseNotesSentiment(report.notes);

  const raw = (ratingScore + recencyBonus + customBonus) * mult + notesModifier;

  return {
    ...report,
    score: Math.max(0, Math.round(raw)),
    gpuTier,
    recencyDays,
    notesModifier,
    upvotes: 0,
  };
}

export function bucketByGpuTier(reports: ScoredReport[]): TieredReports {
  const buckets: TieredReports = { nvidia: [], amd: [], other: [] };
  for (const r of reports) {
    if (r.gpuTier === 'nvidia') buckets.nvidia.push(r);
    else if (r.gpuTier === 'amd') buckets.amd.push(r);
    else buckets.other.push(r);
  }
  const byScore = (a: ScoredReport, b: ScoredReport) => b.score - a.score;
  buckets.nvidia.sort(byScore);
  buckets.amd.sort(byScore);
  buckets.other.sort(byScore);
  return buckets;
}
```

- [ ] **Step 4: Run tests — expect all passing**

```bash
pnpm test src/lib/scoring.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
pnpm test
```

Expected: all tests pass. Fix any type errors in other test files that still reference `ProtonDBReport`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scoring.ts src/lib/scoring.test.ts
git commit -m "feat: add driver matching, notes sentiment, borked decay to scoring"
```

---

## Task 4: Add Upvote GitHub Actions Workflow

**Files:**
- Create: `data-pipeline/.github/workflows/upvote.yml`

- [ ] **Step 1: Create the workflow**

```yaml
# data-pipeline/.github/workflows/upvote.yml
name: Handle Upvote

on:
  repository_dispatch:
    types: [upvote]

jobs:
  upvote:
    runs-on: ubuntu-latest
    permissions:
      contents: write   # needed to push vote count update to gh-pages

    steps:
      - name: Checkout gh-pages
        uses: actions/checkout@v4
        with:
          ref: gh-pages

      - name: Increment vote count
        run: |
          APP_ID="${{ github.event.client_payload.appId }}"
          REPORT_KEY="${{ github.event.client_payload.reportKey }}"
          VOTES_FILE="data/${APP_ID}/votes.json"

          mkdir -p "data/${APP_ID}"

          python3 - "$VOTES_FILE" "$REPORT_KEY" <<'PYEOF'
          import json, sys, os

          votes_file = sys.argv[1]
          report_key = sys.argv[2]

          data = {}
          if os.path.exists(votes_file):
              with open(votes_file) as f:
                  data = json.load(f)

          data[report_key] = data.get(report_key, 0) + 1

          with open(votes_file, 'w') as f:
              json.dump(data, f, separators=(',', ':'))

          print(f"Vote recorded: {report_key!r} = {data[report_key]}")
          PYEOF

      - name: Commit and push
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add "data/${{ github.event.client_payload.appId }}/votes.json"
          git diff --cached --quiet && echo "No changes" && exit 0
          git commit -m "vote: app ${{ github.event.client_payload.appId }} +1"
          git push
```

- [ ] **Step 2: Commit**

```bash
git add data-pipeline/.github/workflows/upvote.yml
git commit -m "feat: add GitHub Actions upvote workflow"
```

---

## Task 5: Redesign ReportCard

**Files:**
- Modify: `src/components/ReportCard.tsx`

- [ ] **Step 1: Replace ReportCard with Valve-style layout**

Replace the entire contents of `src/components/ReportCard.tsx`:

```typescript
// src/components/ReportCard.tsx
import type { ScoredReport } from '../types';

interface Props {
  report: ScoredReport;
  selected: boolean;
  onSelect: (report: ScoredReport) => void;
}

const RATING_COLORS: Record<string, string> = {
  platinum: '#b0e0e6',
  gold:     '#ffd700',
  silver:   '#c0c0c0',
  bronze:   '#cd7f32',
  borked:   '#ff4444',
  pending:  '#888888',
};

function confidenceColor(score: number): string {
  if (score >= 80) return '#4caf50';
  if (score >= 60) return '#ffeb3b';
  if (score >= 40) return '#ff9800';
  return '#f44336';
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

export function ReportCard({ report, selected, onSelect }: Props) {
  const ratingColor = RATING_COLORS[report.rating] ?? '#888';
  const confScore = (report.score / 10).toFixed(1);
  const confColor = confidenceColor(report.score);

  return (
    <div
      style={{
        border: `2px solid ${selected ? '#4c9eff' : '#2a3a4a'}`,
        borderRadius: 4,
        padding: '10px 14px',
        marginBottom: 6,
        background: selected ? 'rgba(76,158,255,0.08)' : 'rgba(255,255,255,0.03)',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'flex',
        gap: 12,
      }}
      onClick={() => onSelect(report)}
    >
      {/* Left: main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff', marginBottom: 2 }}>
          {report.protonVersion}
        </div>
        <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 6 }}>
          {[report.gpu, report.os].filter(Boolean).join(' · ')}
        </div>
        {report.notes && (
          <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.4 }}>
            {truncate(report.notes, 160)}
          </div>
        )}
      </div>

      {/* Right: stats */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        justifyContent: 'space-between', minWidth: 90, flexShrink: 0,
      }}>
        <span style={{
          background: ratingColor, color: '#111', borderRadius: 3,
          padding: '1px 7px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
          {report.rating}
        </span>
        <span style={{ fontSize: 11, color: '#aaa' }}>
          Votes: {report.upvotes}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: confColor }}>
          ⚡ {confScore}/10
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ReportCard.tsx
git commit -m "feat: redesign ReportCard to Valve controller-configs style"
```

---

## Task 6: Update ConfigureTab

**Files:**
- Modify: `src/components/tabs/ConfigureTab.tsx`

- [ ] **Step 1: Replace ConfigureTab**

Replace the entire contents of `src/components/tabs/ConfigureTab.tsx`:

```typescript
// src/components/tabs/ConfigureTab.tsx
import { useState, useEffect } from 'react';
import { DialogButton, Focusable } from '@decky/ui';
import { toaster } from '@decky/api';
import { ReportCard } from '../ReportCard';
import { scoreReport, bucketByGpuTier } from '../../lib/scoring';
import { getProtonDBReports, getVotes, postUpvote } from '../../lib/protondb';
import { getSetting } from '../../lib/settings';
import type { CdnReport, ScoredReport, SystemInfo, GpuVendor } from '../../types';

interface Props {
  appId: number | null;
  appName: string;
  sysInfo: SystemInfo | null;
}

type FilterTier = GpuVendor | 'all';
type SortMode = 'score' | 'votes';

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

const reportKey = (r: CdnReport) => `${r.timestamp}_${r.protonVersion}`;

const FILTER_ORDER: FilterTier[] = ['nvidia', 'amd', 'other', 'all'];
const FILTER_LABELS: Record<FilterTier, string> = {
  nvidia: 'NVIDIA', amd: 'AMD', other: 'Other', all: 'All',
};

export function ConfigureTab({ appId, appName, sysInfo }: Props) {
  const [reports, setReports]   = useState<CdnReport[]>([]);
  const [votes, setVotes]       = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState<ScoredReport | null>(null);
  const [applying, setApplying] = useState(false);
  const [upvoting, setUpvoting] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('score');

  const gpuVendor = sysInfo?.gpu_vendor ?? null;
  const initialFilter: FilterTier =
    gpuVendor === 'nvidia' || gpuVendor === 'amd' ? gpuVendor : 'other';
  const [filter, setFilter] = useState<FilterTier>(initialFilter);

  useEffect(() => {
    if (!appId) return;
    setLoading(true);
    setReports([]);
    setVotes({});
    setSelected(null);
    Promise.all([getProtonDBReports(String(appId)), getVotes(String(appId))])
      .then(([r, v]) => { setReports(r); setVotes(v); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [appId]);

  const refreshVotes = () => {
    if (appId) getVotes(String(appId)).then(setVotes).catch(console.error);
  };

  if (!appId) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        Navigate to a game first.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        Fetching ProtonDB reports…
      </div>
    );
  }

  if (!sysInfo || reports.length === 0) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        {!sysInfo ? 'Loading system info…' : 'No ProtonDB reports found for this game.'}
      </div>
    );
  }

  const scored: ScoredReport[] = reports.map(r => ({
    ...scoreReport(r, sysInfo),
    upvotes: votes[reportKey(r)] ?? 0,
  }));

  const buckets = bucketByGpuTier(scored);

  const visibleReports: ScoredReport[] =
    filter === 'all'    ? [...buckets.nvidia, ...buckets.amd, ...buckets.other] :
    filter === 'nvidia' ? buckets.nvidia :
    filter === 'amd'    ? buckets.amd :
                          buckets.other;

  const sortedReports =
    sortMode === 'votes'
      ? [...visibleReports].sort((a, b) => b.upvotes - a.upvotes)
      : visibleReports;

  const cycleFilter = () => {
    const idx = FILTER_ORDER.indexOf(filter);
    setFilter(FILTER_ORDER[(idx + 1) % FILTER_ORDER.length]);
  };

  const handleApply = async () => {
    if (!selected || !appId) return;
    const running = (SteamClient.GameSessions as any).GetRunningApps();
    if (running.length > 0) {
      toaster.toast({ title: 'Proton Pulse', body: 'Quit your game first.' });
      return;
    }
    setApplying(true);
    try {
      await SteamClient.Apps.SetAppLaunchOptions(
        appId, `PROTON_VERSION="${selected.protonVersion}" %command%`
      );
      toaster.toast({ title: 'Proton Pulse', body: `Applied for ${appName}` });
    } catch (e) {
      console.error('Proton Pulse: apply failed', e);
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to apply — check logs.' });
    } finally {
      setApplying(false);
    }
  };

  const handleUpvote = async () => {
    if (!selected || !appId) return;
    const token = getSetting<string>('gh-votes-token', '');
    if (!token) {
      toaster.toast({ title: 'Proton Pulse', body: 'Set a GitHub token in Settings to upvote.' });
      return;
    }
    setUpvoting(true);
    try {
      const ok = await postUpvote(String(appId), reportKey(selected), token);
      if (ok) {
        toaster.toast({ title: 'Proton Pulse', body: 'Vote submitted! Count updates in ~60s.' });
        setTimeout(refreshVotes, 90_000);
      } else {
        toaster.toast({ title: 'Proton Pulse', body: 'Vote failed — check token in Settings.' });
      }
    } finally {
      setUpvoting(false);
    }
  };

  const btnStyle = (active?: boolean) => ({
    padding: '3px 8px', minWidth: 0, flex: '0 0 auto', fontSize: 10,
    background: active ? '#4c9eff' : '#333',
    color: active ? '#fff' : '#aaa',
  });

  return (
    <Focusable style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <img
          src={STEAM_HEADER_URL(appId)}
          style={{ height: 40, borderRadius: 3, objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff' }}>
            {appName}
          </div>
          <div style={{ fontSize: 11, color: '#7a9bb5' }}>
            {reports.length} community reports
          </div>
        </div>
      </div>

      {/* Report list */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 8 }}>
        {sortedReports.length === 0 ? (
          <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
            No reports for this GPU tier.
          </div>
        ) : (
          sortedReports.map(r => (
            <ReportCard
              key={reportKey(r)}
              report={r}
              selected={selected === r}
              onSelect={setSelected}
            />
          ))
        )}
      </div>

      {/* Bottom action bar */}
      <div style={{
        display: 'flex', gap: 4, flexWrap: 'wrap',
        paddingTop: 6, borderTop: '1px solid #2a3a4a',
      }}>
        <DialogButton onClick={() => setSortMode('votes')} style={btnStyle(sortMode === 'votes')}>
          SORT BY VOTES
        </DialogButton>
        <DialogButton onClick={() => setSortMode('score')} style={btnStyle(sortMode === 'score')}>
          SORT BY SCORE
        </DialogButton>
        <DialogButton onClick={cycleFilter} style={btnStyle()}>
          FILTER: {FILTER_LABELS[filter]}
        </DialogButton>
        <div style={{ flex: 1 }} />
        <DialogButton
          onClick={handleApply}
          disabled={!selected || applying}
          style={btnStyle(!!selected)}
        >
          {applying ? 'APPLYING…' : 'APPLY'}
        </DialogButton>
        <DialogButton
          onClick={handleUpvote}
          disabled={!selected || upvoting}
          style={{ ...btnStyle(), color: '#ffd700' }}
        >
          {upvoting ? '★ …' : '★ UPVOTE'}
        </DialogButton>
      </div>
    </Focusable>
  );
}
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Build to verify TypeScript compiles cleanly**

```bash
pnpm build
```

Expected: no type errors. Fix any that appear (likely in files that still import `ProtonDBReport` — replace with `CdnReport`).

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/ConfigureTab.tsx
git commit -m "feat: CDN integration — page header, votes, sort modes, action bar"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Types: `CdnReport`, `ScoredReport extends CdnReport` — Task 1
- ✅ Fetch: CDN URL, lowercase rating, `getVotes`, `postUpvote` — Task 2
- ✅ Scoring: driver tiers, notes sentiment, borked decay, new WEIGHTS — Task 3
- ✅ Upvote workflow: `repository_dispatch` handler — Task 4
- ✅ ReportCard: Valve-style layout, confidence color, votes display — Task 5
- ✅ ConfigureTab: header, parallel fetch, vote merge, sort, action bar — Task 6
- ✅ Arch note on eventual consistency: in spec, referenced in `handleUpvote` toast copy

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:** `reportKey` helper defined once in ConfigureTab and used consistently for both ReportCard `key` prop and upvote payload. `ScoredReport.upvotes` initialized to `0` in `scoreReport`, then overwritten with actual vote count in ConfigureTab — consistent.
