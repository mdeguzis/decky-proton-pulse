# CDN Integration Design

**Date:** 2026-04-01
**Status:** Approved — ready for implementation planning

---

## Overview

The ProtonDB per-report API (`/api/v1/reports/app/{id}`) is dead. This design integrates the self-hosted GitHub Pages CDN at `https://mdeguzis.github.io/proton-pulse-data/` as the replacement data source, updates scoring to use all available CDN fields, redesigns the ReportCard UI to mirror Valve's Controller Configurations list, and adds an eventually-consistent community upvote system backed by GitHub Actions.

---

## Architecture

```
GitHub Pages CDN (mdeguzis/proton-pulse-data)
  data/{appId}.json         ← full reports array for a game
  data/{appId}/votes.json   ← upvote counts per report
  index.json                ← metadata (updated timestamp, game count)
        │
        ▼  fetchNoCors (CEF frontend)
src/lib/protondb.ts
        │  returns CdnReport[]
        ▼
src/lib/scoring.ts
        │  scoreReport(CdnReport, SystemInfo) → ScoredReport
        ▼
src/components/tabs/ConfigureTab.tsx
        │  bucketByGpuTier, filter, select
        ▼
src/components/ReportCard.tsx
        └  Valve-style card list + bottom action bar
```

---

## Types (`src/types.ts`)

### Retired
- `ProtonDBReportResponses` — removed (was an artifact of the old nested API shape)
- `ProtonDBReport` — replaced by `CdnReport`

### New: `CdnReport`

Matches CDN JSON shape exactly. `rating` is normalized to lowercase at fetch time.

```typescript
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
  rating: ProtonRating;   // lowercased at fetch: "Silver" → "silver"
  timestamp: number;
  title: string;
}
```

### Updated: `ScoredReport`

```typescript
export interface ScoredReport extends CdnReport {
  score: number;
  gpuTier: GpuTier;
  recencyDays: number;
  notesModifier: number;   // [-10, +10] from sentiment analysis
  upvotes: number;         // 0 until votes.json is loaded
}
```

`ProtonDBSummary` is unchanged — the summary endpoint is still live and used for the tier badge in the page header.

---

## Fetch Layer (`src/lib/protondb.ts`)

### URL changes

```typescript
// Replace dead ProtonDB reports URL:
const REPORTS_URL = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}.json';
const VOTES_URL   = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/votes.json';

// Unchanged:
const SUMMARY_URL = 'https://www.protondb.com/api/v1/reports/summaries/{id}.json';
```

### `getProtonDBReports`

Returns `CdnReport[]`. Normalizes `rating` to lowercase at fetch boundary. No other transformation — CDN field names already match `CdnReport`.

### New: `getVotes(appId: string): Promise<Record<string, number>>`

Fetches `votes.json` for a game. Returns `{}` on 404 (game has no votes yet) or any error. Shape: `{ "{timestamp}_{protonVersion}": count }`.

### New: `postUpvote(appId: string, reportKey: string, token: string): Promise<boolean>`

Calls GitHub `repository_dispatch` on `mdeguzis/proton-pulse-data` with:
```json
{ "event_type": "upvote", "client_payload": { "appId": "730", "reportKey": "1547686646_Beta (3.16-6)" } }
```
Returns `true` on 204, `false` otherwise. No-ops if `token` is empty.

---

## Scoring (`src/lib/scoring.ts`)

### New WEIGHTS constants

```typescript
BORKED_DECAY_DAYS: 365,      // beyond this, borked → treated as bronze
NOTES_MAX: 10,               // ± cap on notes sentiment modifier
GPU_DRIVER_EXACT: 1.3,       // exact driver version match multiplier
GPU_DRIVER_CLOSE: 1.1,       // same vendor, within N major versions
```

Existing constants unchanged: `GPU_MATCH: 1.0`, `GPU_MISMATCH: 0.5`, `GPU_UNKNOWN: 0.75`.

### Driver version matching

`gpuDriverMultiplier(report: CdnReport, sysInfo: SystemInfo): number`

Parses the numeric version from `gpuDriver` string (e.g. `"NVIDIA 410.93"` → `410.93`, `"Mesa 23.1.0"` → `23.1`). Compares against `sysInfo.driver_version`:

| Condition | Multiplier |
|-----------|-----------|
| Same vendor + exact version match | `GPU_DRIVER_EXACT` (1.3) |
| Same vendor + parsed major version differs by ≤ 2 | `GPU_DRIVER_CLOSE` (1.1) |
| Same vendor, driver far apart or unparseable | `GPU_MATCH` (1.0) |
| Different vendor | `GPU_MISMATCH` (0.5) |
| Missing driver info on either side | `GPU_UNKNOWN` (0.75) |

This replaces the existing `gpuMultiplier` function (which only handled vendor-level matching).

### Borked time-decay

If `rating === 'borked'` and `recencyDays > BORKED_DECAY_DAYS`, the rating score is computed as `bronze` (0.4) instead of `borked` (0.0). Stale broken reports lose their full veto weight.

### Notes sentiment: `parseNotesSentiment(notes: string): number`

Returns a modifier in `[-10, +10]` added to `raw` score after all other factors.

**Negative keywords** (each hit: −3, capped at −10):
`crash`, `broken`, `freeze`, `black screen`, `hang`, `softlock`, `corrupted`, `doesn't work`, `unplayable`, `won't launch`

**Positive keywords** (each hit: +2, capped at +10):
`perfect`, `flawless`, `works great`, `no issues`, `out of the box`, `excellent`, `runs perfectly`, `zero issues`, `works flawlessly`

Keyword matching is case-insensitive. Density-scaled: multiple hits in the same direction accumulate, but the total is clamped to ±10.

### Updated `scoreReport` signature

```typescript
export function scoreReport(report: CdnReport, sysInfo: SystemInfo): ScoredReport
```

GPU detection reads `report.gpu` directly (no more `report.responses?.gpu`).

---

## ReportCard UI (`src/components/ReportCard.tsx`)

Redesigned to mirror Valve's Controller Configurations list.

### Card layout

Full-width dark rectangle. Selected card gets a bright blue border highlight.

```
┌───────────────────────────────────────────┬──────────────────────┐
│  GE-Proton9-7                 (bold white) │  Rating: Platinum    │
│  NVIDIA RTX 3080 · Arch Linux   (grey)     │  Votes: 42           │
│                                            │  ⚡ 8.2/10           │
│  Works perfectly out of the box. No        │                      │
│  tweaks needed, high settings fine.        │                      │
└───────────────────────────────────────────┴──────────────────────┘
```

| Zone | Content |
|------|---------|
| Title (bold white) | `protonVersion` |
| Subtitle (grey, small) | `gpu · os` |
| Body (grey, wrapping, ~3 lines max) | `notes` |
| Right col top | Rating badge (colored pill) + `Votes: {n}` |
| Right col bottom | `⚡ {score}/10` color-coded |

### Confidence score colors

| Score | Color |
|-------|-------|
| ≥ 8.0 | Green |
| 6.0–7.9 | Yellow |
| 4.0–5.9 | Orange |
| < 4.0 | Red |

Score displayed as `score / 10` (raw score 0–100 divided by 10).

### Bottom action bar

Direct parallel to Valve's bottom bar:

```
[ SORT BY VOTES ]  [ SORT BY SCORE ]  [ FILTER: GPU ]  [ BACK ]  [ APPLY ]  [ UPVOTE ]
```

- `SORT BY VOTES` / `SORT BY SCORE` — toggle sort mode
- `FILTER: GPU` — cycles nvidia → amd → other → all
- `BACK` — returns to previous page
- `APPLY` — sets launch options from selected report (existing logic)
- `UPVOTE` — upvotes selected report via `postUpvote`; disabled if no token configured

No per-card thumbnail. Game header image (Steam CDN capsule) displayed in `ConfigureTab` page header only, constructed from `appId`:
`https://cdn.akamai.steamstatic.com/steam/apps/{appId}/header.jpg`

---

## ConfigureTab (`src/components/tabs/ConfigureTab.tsx`)

- Page header: game title + Steam capsule image
- `getProtonDBReports` + `getVotes` called in parallel on mount
- Votes merged into `ScoredReport[]` after scoring (match by `reportKey = "{ts}_{protonVersion}"`)
- Sort state: `'votes' | 'score'` (default: `'score'`)
- Filter state: GPU tier (existing behavior)
- `UPVOTE` calls `postUpvote`, then re-fetches `votes.json` to update counts

---

## Upvote System

### Vote storage

`data/{appId}/votes.json` on the `gh-pages` branch:
```json
{
  "1547686646_Beta (3.16-6)": 12,
  "1693526400_Proton 8.0-5": 4
}
```

### GitHub Actions workflow

Triggered by `repository_dispatch` event `upvote`. Reads current votes file, increments `reportKey` count, commits back to `gh-pages`. Votes are **eventually consistent** — typically visible within 30–90 seconds.

### Token

`repository_dispatch` requires a GitHub token with `workflow` scope. Stored in plugin settings under key `proton-pulse:gh-votes-token`. If empty, upvoting is disabled (star shows read-only count). Token risk is minimal — it can only trigger the upvote workflow in one repo.

### Architecture note (for developer wiki)

> Votes are eventually consistent by design. The plugin reads `votes.json` at card load time; counts do not update in real-time within a session. The monthly pipeline run can optionally re-aggregate vote totals. If vote throughput grows, the `repository_dispatch` approach should be replaced with a lightweight serverless proxy (e.g. a GitHub App or Cloudflare Worker) to avoid Actions queue saturation.

---

## Tests

### `protondb.test.ts`
- Update fake report fixtures to `CdnReport` shape
- Update URL assertions to CDN URLs
- Add tests for `getVotes` (200, 404, error)
- Add tests for `postUpvote` (204 success, non-204 failure, empty token no-op)

### `scoring.test.ts`
- Add tests for `parseNotesSentiment` (negative keywords, positive keywords, mixed, empty)
- Add tests for borked time-decay (fresh borked = 0, old borked = bronze score)
- Add tests for `gpuDriverMultiplier` (exact match, close match, mismatch, missing)

---

## Out of Scope

- Real-time vote counts within a session
- Per-user vote deduplication (Phase 2 if needed)
- `data/{appId}/latest.json` — this is a GitHub Pages browsing convenience file only, not consumed by the plugin
