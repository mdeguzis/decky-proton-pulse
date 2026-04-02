# Current Handoff

Last updated: 2026-04-02

This file is the lightweight checkpoint for the next coding session.
Use it to track what is working, what still needs on-device testing, and what polish work is still open.

## Current State

- ProtonDB lookup now uses:
  1. Proton Pulse CDN on GitHub Pages
  2. ProtonDB live summary fallback
- Horizon Zero Dawn Remastered is now treated as app ID `2561580`, which is confirmed correct.
- The current prototype prefers CDN report data and only falls back to live ProtonDB summary when CDN report data is unavailable.
- `Manage This Game` was simplified back toward a safer single-column layout after a render crash on Steam beta.
- `make take-screenshot` now uses the CEF screenshot path through `scripts/take_cef_screenshot.py`.

## Current Blocker

- No known data-source blocker at the moment.
- The next architecture step is planning a production-grade CDN primary with GitHub Pages retained as backup.

## Verified Working

- `pnpm test` passed before the latest checkpoint push.
- `make build` passed before the latest checkpoint push.
- CDN-first report fetch behavior is now the intended plugin model.
- The top toolbar now groups:
  - sort controls
  - GPU filter controls
  - compact status text

## Still Needs On-Device Testing

### Highest Priority

- Re-test `Manage This Game` on Steam beta after the single-column simplification.
- Confirm whether the crash still occurs before any report rows are visibly rendered.
- If the crash persists, temporarily reduce the page further to:
  - summary header
  - diagnostics block
  - very plain report buttons/list
- Re-test the same build on Steam stable once available, to determine whether this is beta-only or a broader SharedSteamUI issue.

### ProtonDB Behavior

- Re-test Horizon Zero Dawn Remastered (`2561580`) end-to-end after deploy:
  - confirm cards render from `cdn`
  - confirm the header, preview pane, and apply action all use the same selected report
- Re-test a known CDN-hit game to make sure the `cdn` path behaves correctly.
- Re-test a CDN-miss game besides Horizon, like Hades II, to confirm live summary fallback is generally sound.

### Logs / Diagnostics

- Confirm the `Manage This Game` diagnostics reflect the actual source used:
  - `cdn`
  - `live-summary`
- Confirm the CDN and live-summary logs are visible in the plugin Logs tab after deploy.

## UI / UX Polish Still Open

- The top toolbar likely still needs visual tuning on-device:
  - spacing
  - width usage
  - whether the GPU segment feels too wide
- Once the crash is fixed, the report list/details view still needs refinement to feel more Valve-like and less developer-tool-like.
- The action area should likely return to a stronger “preview first” hierarchy after the Steam beta compatibility issue is understood.

## Likely Next Feature Work

- Spec and implement a real CDN primary with GitHub Pages as secondary backup.
- Add a fuller report-details page / subview that feels closer to Valve’s controller configuration preview flow.
- Improve sorting / filtering controls using stronger Steam-like visual grouping and focus treatment.
- Consider adding more meaningful report metadata in the detail pane:
  - exact hardware match summary
  - score breakdown
  - stronger “what will be applied” presentation
- Add a beta/stable compatibility strategy:
  - detect the Steam / SharedSteamUI environment in logs
  - keep a small allowlist/denylist of UI patterns known to be safe on beta vs stable
  - add a dev/test script or checklist for validating component compatibility after Steam client updates

## Good Retest Flow

1. `make build`
2. deploy to Deck
3. open Horizon Zero Dawn Remastered
4. open `Game > Settings > ProtonDB Config`
5. verify:
   - cards render
   - left/right pane navigation works
   - top toolbar feels usable
   - apply preview is clear
6. if anything is off:
   - use `make take-screenshot`
   - use `make get-logs`

## Note For Future Codex Sessions

Codex does not reliably retain project memory across sessions unless it is written into the repo or wiki.
For ongoing work, prefer updating files like this one, the dev docs, or the wiki rather than relying on prior chat context alone.
