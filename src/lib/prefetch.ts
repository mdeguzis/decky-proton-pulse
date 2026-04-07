// src/lib/prefetch.ts
//
// On plugin startup, enumerate the user's installed Steam games and
// prefetch ProtonDB data for recently played ones. This warms the
// cache so games load instantly when the user opens them.
//
// Steam's internal collectionStore.allAppsCollection has the full
// library. We filter to installed games, sort by last-played time,
// and fetch data for the top N. Each fetch is throttled so we dont
// hammer the CDN on startup.

import { fetchNoCors } from '@decky/api';
import { logFrontendEvent } from './logger';
import { setCache, getCachedAppIds, initCache } from './cache';
import type { VoteTotals } from './cache';
import {
  startDetailedSpan,
  countPrefetchedGame,
  countFetch,
} from './metrics';
import type { CdnReport, ProtonDBSummary, ProtonRating } from '../types';

// ── config ──────────────────────────────────────────────────────────────────

// only prefetch games played in the last N days
const RECENTLY_PLAYED_DAYS = 30;
// max games to prefetch per startup
const MAX_PREFETCH = 50;
// delay between prefetch requests to be polite to the CDN
const THROTTLE_MS = 200;
// concurrency limit for parallel fetches
const CONCURRENCY = 3;

// same URLs as protondb.ts, kept in sync
// TODO: move to a proper CDN, see protondb.ts
const APP_INDEX_URL = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/index.json';
const YEAR_URL = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/{year}.json';
const SUMMARY_URL = 'https://www.protondb.com/api/v1/reports/summaries/{id}.json';

const VALID_RATINGS = new Set<string>(['platinum', 'gold', 'silver', 'bronze', 'borked', 'pending']);

// ── steam library enumeration ───────────────────────────────────────────────

interface AppOverview {
  appid: number;
  display_name: string;
  rt_last_time_played?: number; // unix timestamp, 0 if never
  installed?: boolean;
}

function getInstalledGames(): AppOverview[] {
  try {
    // collectionStore.allAppsCollection is Steam's internal collection of all
    // library apps. It has an allApps getter or similar. Different Steam
    // client versions expose this differently, so we try a few paths.
    const cs = (globalThis as any).collectionStore;
    if (!cs) {
      void logFrontendEvent('DEBUG', 'collectionStore not available for prefetch');
      return [];
    }

    // allAppsCollection.allApps is an array of app overviews
    const collection = cs.allAppsCollection;
    if (!collection) {
      void logFrontendEvent('DEBUG', 'allAppsCollection not available');
      return [];
    }

    // get the internal app list - try common property names
    let apps: AppOverview[] = [];
    if (typeof collection.allApps !== 'undefined') {
      apps = collection.allApps;
    } else if (collection.apps && Symbol.iterator in collection.apps) {
      apps = Array.from(collection.apps);
    }

    // filter to installed games only (not tools, soundtracks, etc)
    const installed = apps.filter((app: any) => {
      // only include things that look like games with an appid
      if (!app?.appid || app.appid <= 0) return false;
      // rt_installed_at > 0 or some other indicator of installed state
      // different Steam versions might use different field names
      return true;
    });

    void logFrontendEvent('DEBUG', 'Enumerated installed games', {
      total: apps.length,
      installed: installed.length,
    });

    return installed;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Failed to enumerate installed games', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function getRecentlyPlayed(games: AppOverview[], days: number): AppOverview[] {
  const cutoff = Date.now() / 1000 - days * 24 * 60 * 60;
  return games
    .filter(g => (g.rt_last_time_played ?? 0) > cutoff)
    .sort((a, b) => (b.rt_last_time_played ?? 0) - (a.rt_last_time_played ?? 0));
}

// ── individual game prefetch ────────────────────────────────────────────────

function normalizeReports(raw: Array<CdnReport & { rating: string }>): CdnReport[] {
  return raw.map((r) => {
    const normalized = r.rating.toLowerCase();
    const rating = VALID_RATINGS.has(normalized) ? (normalized as ProtonRating) : 'pending';
    return { ...r, rating };
  });
}

async function prefetchGame(appId: string): Promise<boolean> {
  const span = startDetailedSpan('prefetch-game', appId);
  countFetch();

  try {
    // fetch index
    const indexUrl = APP_INDEX_URL.replace('{id}', appId);
    const indexResp = await fetchNoCors(indexUrl);
    if (indexResp.status !== 200) {
      span.end(false, { reason: 'index-miss', status: indexResp.status });
      return false;
    }
    const years = (await indexResp.json()) as string[];
    if (!years.length) {
      span.end(false, { reason: 'index-empty' });
      return false;
    }

    // fetch year files in parallel
    const yearResults = await Promise.all(
      years.map(async (year) => {
        const url = YEAR_URL.replace('{id}', appId).replace('{year}', year);
        try {
          const resp = await fetchNoCors(url);
          if (resp.status !== 200) return [];
          return normalizeReports(
            (await resp.json()) as Array<CdnReport & { rating: string }>,
          );
        } catch { return []; }
      }),
    );
    const reports = yearResults.flat();

    // fetch summary (best effort, dont fail if unavailable)
    let summary: ProtonDBSummary | null = null;
    try {
      const summaryUrl = SUMMARY_URL.replace('{id}', appId);
      const summaryResp = await fetchNoCors(summaryUrl);
      if (summaryResp.status === 200) {
        summary = (await summaryResp.json()) as ProtonDBSummary;
      }
    } catch { /* summary is optional */ }

    // votes come from Supabase at query time, not prefetched
    const votes: Record<string, VoteTotals> = {};

    setCache(appId, reports, summary, votes, 'prefetch');
    countPrefetchedGame();
    span.end(true, { reports: reports.length, years: years.length });
    return true;
  } catch (err) {
    span.end(false, {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ── throttled batch prefetch ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function prefetchBatch(appIds: string[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  let idx = 0;

  // process in chunks of CONCURRENCY
  while (idx < appIds.length) {
    const chunk = appIds.slice(idx, idx + CONCURRENCY);
    const results = await Promise.all(chunk.map(id => prefetchGame(id)));
    for (const success of results) {
      if (success) ok++;
      else failed++;
    }
    idx += CONCURRENCY;
    // throttle between chunks
    if (idx < appIds.length) {
      await sleep(THROTTLE_MS);
    }
  }

  return { ok, failed };
}

// ── main entry point ────────────────────────────────────────────────────────

let prefetchRunning = false;

export async function runStartupPrefetch(): Promise<void> {
  if (prefetchRunning) {
    void logFrontendEvent('DEBUG', 'Prefetch already running, skipping');
    return;
  }
  prefetchRunning = true;
  const batchSpan = startDetailedSpan('prefetch-batch', 'startup');

  try {
    initCache();

    const games = getInstalledGames();
    if (!games.length) {
      void logFrontendEvent('INFO', 'No installed games found for prefetch');
      batchSpan.end(true, { reason: 'no-games' });
      prefetchRunning = false;
      return;
    }

    const recent = getRecentlyPlayed(games, RECENTLY_PLAYED_DAYS);
    void logFrontendEvent('INFO', 'Prefetch: found recently played games', {
      installed: games.length,
      recentlyPlayed: recent.length,
      cutoffDays: RECENTLY_PLAYED_DAYS,
    });

    // filter out games already cached and warm
    const alreadyCached = getCachedAppIds();
    const toPrefetch = recent
      .map(g => String(g.appid))
      .filter(id => !alreadyCached.has(id))
      .slice(0, MAX_PREFETCH);

    if (!toPrefetch.length) {
      void logFrontendEvent('INFO', 'Prefetch: all recent games already cached', {
        cachedCount: alreadyCached.size,
      });
      batchSpan.end(true, { reason: 'all-cached', cached: alreadyCached.size });
      prefetchRunning = false;
      return;
    }

    void logFrontendEvent('INFO', 'Prefetch starting', {
      count: toPrefetch.length,
      maxPrefetch: MAX_PREFETCH,
      firstFew: toPrefetch.slice(0, 5),
    });

    const { ok, failed } = await prefetchBatch(toPrefetch);

    void logFrontendEvent('INFO', 'Prefetch complete', {
      succeeded: ok,
      failed,
      total: toPrefetch.length,
    });

    batchSpan.end(true, { succeeded: ok, failed, total: toPrefetch.length });
  } catch (err) {
    void logFrontendEvent('ERROR', 'Prefetch crashed', {
      error: err instanceof Error ? err.message : String(err),
    });
    batchSpan.end(false, {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    prefetchRunning = false;
  }
}
