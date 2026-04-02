# Real CDN Failover Plan

Last updated: 2026-04-02

## Goal

Move Proton Pulse from the current prototype hosting model to a production-oriented delivery path:

1. Cloudflare edge in front of the current GitHub Pages site as the first production step
2. Independent backup hosting only after the prototype proves out and we actually need it
3. Live ProtonDB summary as last-resort fallback

The important distinction is that Cloudflare-over-GitHub-Pages is a great zero-cost edge layer, but it is not the same thing as a fully independent backup source. In that model, GitHub Pages remains the origin.

## Why Change

- GitHub Pages is convenient, but not a full CDN product we control.
- We want better cache behavior, purge options, observability, and uptime characteristics.
- We want a cleaner path for future features like signed artifacts, regional caching, and traffic growth.
- We should reduce the risk that one hosting issue takes down report delivery for the Decky plugin.

## Recommended Rollout

### Stage 1: Cheapest production hardening

- Keep GitHub Pages as the only artifact origin.
- Put Cloudflare in front of it as a reverse proxy on a project-owned hostname.
- Let the plugin use the Cloudflare hostname as the primary URL.
- Keep the direct GitHub Pages URL available as a plugin-side fallback.

This gives us the biggest practical performance win for the least operational work and effectively zero monthly cost on the Cloudflare free tier.

### Stage 2: True independent backup

- Add an independent origin later, such as R2 or another object store.
- Decide whether Cloudflare should front that new origin directly.
- Keep GitHub Pages as a second host serving the same artifact tree.

This is the stage where “primary CDN plus secondary backup host” becomes literally true instead of just logically approximated.

## Proposed Target Architecture

### Data flow

### Stage 1 data flow

1. Pipeline builds report artifacts from upstream ProtonDB-derived data.
2. Artifacts publish to GitHub Pages.
3. Cloudflare reverse-proxies that GitHub Pages site on a custom hostname.
4. The plugin fetches from the Cloudflare hostname first.
5. If the Cloudflare hostname fails, the plugin retries the direct GitHub Pages URL.
6. If both fail, the plugin falls back to live ProtonDB summary only.

### Stage 2 data flow

1. Pipeline builds report artifacts from upstream ProtonDB-derived data.
2. Artifacts publish to a durable origin bucket or object store.
3. The same artifact tree also publishes to GitHub Pages.
4. Cloudflare serves the primary hostname in front of the chosen primary origin.
5. The plugin fetches from the Cloudflare hostname first.
6. If the primary host fails, the plugin retries GitHub Pages.
7. If both artifact sources fail, the plugin falls back to live ProtonDB summary only.

### Suggested concrete stack for Stage 1

- Primary edge: Cloudflare free tier reverse proxy
- Primary origin: `https://mdeguzis.github.io/proton-pulse-data/`
- Primary hostname: `cdn.protonpulse.app` or similar project-owned domain
- Plugin backup host: direct GitHub Pages URL
- Last resort: `https://www.protondb.com/api/v1/reports/summaries/{id}.json`

This is the preferred immediate plan because it keeps deployment almost exactly as simple as today while adding Cloudflare edge caching, a custom hostname, and room for later growth.

### Suggested concrete stack for Stage 2

- Primary CDN: Cloudflare in front of R2 or another object store
- Primary hostname: `cdn.protonpulse.app` or similar project-owned domain
- Secondary backup: `https://mdeguzis.github.io/proton-pulse-data/`
- Last resort: `https://www.protondb.com/api/v1/reports/summaries/{id}.json`

This becomes the higher-availability version once we actually need a second independent origin.

## Plugin Fetch Order

### Stage 1 fetch order

1. `https://cdn.protonpulse.app/data/{appId}/index.json`
2. `https://mdeguzis.github.io/proton-pulse-data/data/{appId}/index.json`
3. live ProtonDB summary only if both URLs fail or return no usable report rows

### Stage 2 fetch order

1. `https://cdn.protonpulse.app/data/{appId}/index.json`
2. `https://mdeguzis.github.io/proton-pulse-data/data/{appId}/index.json`
3. live ProtonDB summary only if both CDN sources fail or return no usable report rows

Votes can follow the same policy:

1. primary CDN votes path
2. GitHub Pages votes path
3. no live fallback for votes

## Expected Plugin Changes

### Phase 1

- Add a primary CDN base URL constant.
- Keep a direct GitHub Pages fallback base URL constant.
- Update diagnostics to distinguish:
  - `cdn-primary`
  - `cdn-backup`
  - `live-summary`
  - `none`
- Keep fallback rules simple and deterministic.
- Do not assume Cloudflare and GitHub Pages are independent in this stage; diagnostics should make that clear in the docs even if the runtime labels stay simple.

### Phase 2

- Add Cloudflare-specific deployment notes:
  - proxied CNAME to `mdeguzis.github.io`
  - orange-cloud proxy enabled
  - browser cache TTL tuned for static JSON
- Validate cache headers and edge hit behavior.
- Confirm the plugin can fail over to direct GitHub Pages if the Cloudflare hostname breaks.

### Phase 3

- Add lightweight retry policy:
  - one attempt on primary CDN
  - one attempt on backup CDN
  - then last-resort live summary
- Capture per-source status codes in diagnostics.
- Surface which source actually won in the UI and logs.

### Phase 4

- Add stale-data metadata in top-level CDN index:
  - generated timestamp
  - upstream snapshot timestamp
  - total app count
  - schema version
- Optionally show “data age” in the plugin diagnostics UI.

## Expected Pipeline Changes

- Stage 1 requires no artifact-format change.
- Keep artifact names and JSON schema stable so the Cloudflare hostname and direct GitHub Pages URL are interchangeable.
- Once Stage 2 exists, publish the exact same artifact tree to both destinations from one build output.
- Make the pipeline fail if the publish steps would diverge in content layout.
- Emit a manifest file that includes:
  - artifact version
  - generated timestamp
  - schema version
  - source commit SHA

## Cloudflare-Specific Notes

- Cloudflare free tier is likely enough for this project size.
- Use Cloudflare as a reverse proxy first; do not overbuild the origin story before we need it.
- This gives us unmetered bandwidth and global edge caching without changing the current deploy flow much.
- We need a custom domain or subdomain under a domain we control; the raw `.github.io` hostname cannot itself be “put behind” Cloudflare without that.
- Prefer cacheable immutable per-app year files.
- Use explicit cache headers rather than relying on defaults.
- Keep purge scope narrow for changed objects only.
- Start without Workers unless we need request routing or signed access later.
- If we later need smarter routing, add a thin Worker only at the edge boundary, not inside the plugin contract.

## Reliability Rules

- The backup GitHub Pages path must stay deployable from the same pipeline.
- In Stage 1, “backup” means direct-origin fallback, not fully independent disaster recovery.
- The plugin must never depend on live ProtonDB detailed reports.
- The plugin must behave acceptably when votes are unavailable.
- Source selection should be visible in logs so field debugging on Deck stays simple.

## Open Questions

- Which domain should host the Cloudflare front door?
- Is direct GitHub Pages fallback sufficient for the first public release, or do we want a truly independent backup before broader rollout?
- Should R2 be the origin of truth later, or should GitHub remain the artifact source of truth with Cloudflare pull-through caching?
- Do we want a signed manifest before opening this to broader public traffic?
- How aggressively should the plugin fail over if the primary CDN is merely slow, not down?

## Suggested Implementation Order

1. Keep the current GitHub Pages prototype stable.
2. Add dual-base-URL support in plugin code behind constants only.
3. Put Cloudflare in front of the existing GitHub Pages site on a custom domain.
4. Switch the plugin to Cloudflare-first, direct-GitHub-Pages-second.
5. Add diagnostics and test coverage for source failover.
6. Measure whether this is already “good enough” for the project scale.
7. Only then decide whether to add a truly independent second origin such as R2.

## Definition Of Done

- The plugin successfully renders reports from the Cloudflare hostname for known hit titles.
- If the Cloudflare hostname is forced to fail, the plugin renders the same reports from direct GitHub Pages.
- If both URLs fail, the plugin exposes live summary fallback cleanly.
- Tests cover all three source outcomes.
- Logs and diagnostics make the winning source obvious.
