# Phase 1 Task Status

Tracking pre-deploy tasks. Delete this file when ready for production release.

## Status: In Progress

| Task | Status |
|---|---|
| Plugin metadata | ✅ |
| TypeScript types | ✅ |
| Python test infra | ✅ |
| Python logger + game guard | ✅ |
| Python system detection | ✅ |
| Python ProtonDB fetcher | ✅ |
| Scoring engine | ✅ |
| ReportCard component | ✅ |
| Badge component | ✅ |
| LogViewer component | ✅ |
| Modal component | ✅ |
| Plugin entry point | ✅ |
| Helper scripts | ✅ |
| Live API field verification | ✅ |
| On-device smoke test | ⬜ |
| Badge injection tuning | ⬜ |

## Known Pending Items (pre-deploy)
- Badge injection position relative to existing ProtonDB badge requires
  live Steam DOM inspection — exact CSS/component path is Steam-version-dependent.
- `showModal` closeModal callback signature may need adjustment based on @decky/ui version.
- ProtonDB `/api/v1/reports/app/{id}` endpoint returned 404 for all tested app IDs during
  Task 14 verification (2026-03-30). Summary endpoint is live. Reports endpoint may be
  deprecated or rate-limited — needs re-verification on-device.

## API Verification Notes (Task 14, 2026-03-30)

### Summary endpoint (`/api/v1/reports/summaries/{id}.json`) — VERIFIED LIVE
Live response shape for app 2358720:
```json
{
  "bestReportedTier": "platinum",
  "confidence": "strong",
  "score": 0.82,
  "tier": "platinum",
  "total": 188,
  "trendingTier": "platinum"
}
```
`src/types.ts` updated to match:
- `score` changed from `ProtonRating` to `number` (0.0–1.0 float)
- `tier` changed from `number` to `ProtonRating`
- `trendingTier` changed from `number` to `ProtonRating`
- `bestReported` renamed to `bestReportedTier`
- `Badge.tsx` updated to use `summary.tier` instead of `summary.score` for tier display

### Reports endpoint (`/api/v1/reports/app/{id}`) — ENDPOINT UNAVAILABLE
All tested app IDs (2358720, 570, 1245620) returned 404 HTML from Netlify during Task 14
verification. Field names in `ProtonDBReport` interface are based on historical community
documentation and test fixtures — **require on-device verification**.
