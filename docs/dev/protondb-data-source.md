# ProtonDB Data Source — Investigation & Architecture

> **Status:** Implemented (data pipeline in `data-pipeline/`)
> **Date:** 2026-03-31

---

## Background

Proton Pulse needs community reports from ProtonDB to recommend and apply Proton
versions for specific games. This document records the full investigation of what
API endpoints exist, what changed, and the approach we settled on.

---

## API Investigation Findings

### What used to work

The plugin was originally written against:

```
GET https://www.protondb.com/api/v1/reports/app/{appId}
```

This returned a JSON array of individual community reports. It is **gone** —
returns 404 for all app IDs. No public replacement was announced.

### What still works

```
GET https://www.protondb.com/api/v1/reports/summaries/{appId}.json
```

Returns a summary object only — no individual reports:

```json
{
  "bestReportedTier": "platinum",
  "confidence": "strong",
  "score": 0.91,
  "tier": "platinum",
  "total": 729,
  "trendingTier": "platinum"
}
```

Every active Decky plugin (including OMGDuke/protondb-decky) uses only this
endpoint. It does not provide per-report data like `protonVersion` or `systemInfo`.

### Why the individual API died

The ProtonDB site JS bundle (`head.protondb.pages.dev/static/js/main.2b873513.js`)
reveals the new architecture:

- Individual reports are now served as pre-baked CDN files:
  ```
  /data/reports/{device}/app/{fingerprint_hash}.json
  ```
- The `{fingerprint_hash}` is computed from the user's OS string, Proton version,
  and device type via a custom hash function (`D`) in the bundle.
- The `.netlify/functions/reports` endpoint is POST-only and session-auth-gated
  (returns `{"message":"Session Invalid","success":false}` with a 403 without auth).

These pre-baked files don't exist for arbitrary app IDs — they are system-specific
per-user reports, not a general per-game listing.

### Community alternatives investigated

| Source | URL | Status | Notes |
|--------|-----|--------|-------|
| ProtonDB API v1 | `/api/v1/reports/app/{id}` | **Dead (404)** | Was the primary source |
| ProtonDB summaries | `/api/v1/reports/summaries/{id}.json` | ✅ Live | Summary only, no per-report data |
| protondb.max-p.me | `/games/{id}/reports/` | ✅ Live (returns `[]`) | Returns empty for Hades (729 reports) — data is stale |
| SPCR API | `api.spcr.ovh/v1/reports/app/{id}` | ❌ Dead | Domain unreachable |
| bdefore/protondb-data | GitHub monthly dumps | ✅ Live | **The solution** — see below |

---

## Solution: bdefore/protondb-data + GitHub Pages CDN

### Data source

[bdefore/protondb-data](https://github.com/bdefore/protondb-data) publishes
monthly dumps as `.tar.gz` archives in the `reports/` directory. The most recent
as of this writing is `reports_sep1_2025.tar.gz`.

Each archive contains a single `reports_piiremoved.json` — a JSON array of all
ProtonDB reports across all games (~2.1 GB uncompressed).

**Confirmed data for Hades (appId 1145360) in the Sep 2025 dump:**
- 437 reports found in an 8MB sample of the file
- Verdicts: 371 yes, 66 no
- Top Proton versions: Default (390), 5.21-GE-1 (10), 5.0-9 (8)

### Record format (raw bdefore)

```json
{
  "app": {
    "steam": { "appId": "1145360" },
    "title": "Hades"
  },
  "responses": {
    "protonVersion": "4.11-9",
    "verdict": "yes",
    "notes": { "verdict": "Works great after mouse fix" },
    "installs": "yes",
    "opens": "yes",
    "startsPlay": "yes"
  },
  "timestamp": 1576022103,
  "systemInfo": {
    "cpu": "AMD Ryzen 5 1600 Six-Core",
    "gpu": "NVIDIA GeForce GTX 1060 6GB",
    "gpuDriver": "NVIDIA 435.21",
    "kernel": "5.3.12-1-MANJARO",
    "os": "Manjaro Linux",
    "ram": "16 GB"
  }
}
```

### Stripped format (what we store)

We keep only the 6 fields Proton Pulse uses:

```json
{"pv":"4.11-9","v":"yes","gpu":"NVIDIA GeForce GTX 1060 6GB","drv":"NVIDIA 435.21","os":"Manjaro Linux","ts":1576022103}
```

**Size estimates (Hades, 437 reports):**
- Stripped minified JSON: ~60 KB
- Gzipped: ~4 KB (HTTP transfer from GitHub Pages is gzip-compressed anyway)
- 30,000 games estimate: ~126 MB gzipped, well within GitHub Pages 1 GB limit

---

## Pipeline Architecture

```
bdefore/protondb-data (monthly)
        │
        ▼  GitHub Actions (2nd of each month)
scripts/split_reports.py
        │  streams 2.1 GB JSON, extracts 6 fields per record
        ▼
data/{appId}.json  (one file per game, minified, sorted newest-first)
index.json         (metadata: updated timestamp, game count)
        │
        ▼  force-push to orphan gh-pages branch
https://mdeguzis.github.io/proton-pulse-data/data/{appId}.json
        │
        ▼  fetchNoCors in plugin
ConfigureTab → scoring → GPU-bucketed report cards
```

### Storage approach

The `gh-pages` branch is an **orphan** (no history). Each monthly run
force-pushes a single new commit. This keeps the repository size bounded to
exactly the current dataset — no history accumulation.

Games with fewer than 3 reports are excluded (`MIN_REPORTS = 3` in the script).

---

## Files

| File | Purpose |
|------|---------|
| `data-pipeline/scripts/split_reports.py` | Splits bdefore dump into per-game files |
| `data-pipeline/.github/workflows/update-data.yml` | Monthly GitHub Actions workflow |
| `data-pipeline/README.md` | Docs for the data repo |
| `src/lib/protondb.ts` | Plugin-side fetch (update `REPORTS_URL` constant) |

---

## Plugin Integration (TODO)

Once the data repo is live at `https://mdeguzis.github.io/proton-pulse-data/`,
update `src/lib/protondb.ts`:

```typescript
// Replace:
const REPORTS_URL = 'https://www.protondb.com/api/v1/reports/app/{id}';

// With:
const REPORTS_URL = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}.json';
```

The response is already a plain JSON array — no other changes needed in
`getProtonDBReports()`.

The stripped field names (`pv`, `v`, `gpu`, `drv`, `os`, `ts`) differ from the
original bdefore field names. The `ProtonDBReport` TypeScript type and the
`scoreReport` function in `src/lib/scoring.ts` will need updating to match.

---

## Future Considerations

- **Freshness:** bdefore publishes roughly monthly. Reports are never real-time.
  Consider surfacing the `index.json` `updated` date in the plugin UI.
- **Game coverage:** The Sep 2025 dump is 6 months old relative to this writing.
  If bdefore's cadence changes, we may want to add a fallback to the summaries
  endpoint for the tier badge.
- **Hosting migration:** If the dataset outgrows GitHub Pages (1 GB limit),
  GitHub Releases artifacts are the next natural step — each release can hold
  files up to 2 GB and release assets don't count toward repo storage.
