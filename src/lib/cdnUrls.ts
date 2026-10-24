// src/lib/cdnUrls.ts
//
// Where the per-game report buckets live. Since the web app moved to
// Cloudflare Pages (proton-pulse-web#362) they are on R2 behind
// data.proton-pulse.com. www.proton-pulse.com/data/... answers 200 with the
// SPA HTML shell, so pointing there looks like "no CDN data" for every game
// (#131). Keep lib/prefetch.py CDN_BASE in step with this.

export const CDN_DATA_BASE = 'https://data.proton-pulse.com/data';
export const APP_INDEX_URL = `${CDN_DATA_BASE}/{id}/index.json`;
export const YEAR_URL = `${CDN_DATA_BASE}/{id}/{year}.json`;
