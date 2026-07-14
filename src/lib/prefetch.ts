// src/lib/prefetch.ts
//
// On plugin startup, enumerate the user's installed Steam games and
// prefetch ProtonDB data for the top uncached entries. This warms the
// cache so games load quickly when the user opens them.
//
// Steam's internal collectionStore.allAppsCollection has the full
// library. We filter to installed games, rank them by play/update/purchase
// timestamps, then fetch data for the top N uncached entries. Each fetch
// is throttled so we dont hammer the CDN on startup.

import { fetchNoCors } from '@decky/api';
import { callable } from '@decky/api';
import { logFrontendEvent } from './logger';
import { setCache, getCachedAppIds, initCache } from './cache';
import type { VoteTotals } from './cache';
import {
  startDetailedSpan,
  countLocalNonSteamGame,
  countPrefetchedGame,
  countFetch,
  countNoData,
} from './metrics';
import { isSteamShortcutApp } from './steamApps';
import type { CdnReport, ProtonDBSummary, ProtonRating } from '../types';

// --- config ---

// recent-play window used only for logging and sort priority
const RECENTLY_PLAYED_DAYS = 30;
// max games to prefetch per startup
const MAX_PREFETCH = 50;
// delay between prefetch requests to be polite to the CDN
const THROTTLE_MS = 200;
// concurrency limit for parallel fetches
const CONCURRENCY = 3;

// same URLs as protondb.ts, kept in sync
// TODO: move to a proper CDN, see protondb.ts
const APP_INDEX_URL = 'https://www.proton-pulse.com/data/{id}/index.json';
const YEAR_URL = 'https://www.proton-pulse.com/data/{id}/{year}.json';
const SUMMARY_URL = 'https://www.protondb.com/api/v1/reports/summaries/{id}.json';
const getInstalledGameStatsCallable = callable<[], {
  installed_steam_games: number;
  installed_steam_app_ids: string[];
}>('get_installed_game_stats');

const VALID_RATINGS = new Set<string>(['platinum', 'gold', 'silver', 'bronze', 'borked', 'pending']);

// --- steam library enumeration ---

interface AppOverview {
  appid: number;
  display_name: string;
  rt_last_time_played?: number; // unix timestamp, 0 if never
  rtLastTimePlayed?: number;
  rt_last_updated?: number;
  rtLastUpdated?: number;
  rt_purchased?: number;
  rtPurchased?: number;
  bHasAnyLocalContent?: boolean;
  iInstallFolder?: number;
  strInstallFolder?: string;
  installed?: boolean;
  is_shortcut?: boolean;
  isShortcut?: boolean;
  bIsShortcut?: boolean;
}

export interface InstalledGameStats {
  installedSteamGames: number;
  localNonSteamGames: number;
  installedSteamAppIds: string[];
}

function readTimestamp(app: AppOverview, ...keys: Array<keyof AppOverview>): number {
  for (const key of keys) {
    const value = app[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

function isInstalledGame(app: AppOverview): boolean {
  if (!app?.appid || app.appid <= 0) return false;
  if (app.installed === true) return true;
  if (app.bHasAnyLocalContent === true) return true;
  if (typeof app.strInstallFolder === 'string' && app.strInstallFolder.trim().length > 0) return true;
  return false;
}

function isLocalNonSteamGame(app: AppOverview): boolean {
  const shortcutFlags = [app.is_shortcut, app.isShortcut, app.bIsShortcut];
  if (shortcutFlags.some((value) => value === true)) return true;
  return isSteamShortcutApp(app.appid);
}

function enumerateInstalledGames(
  options: { logResults?: boolean; countLocalNonSteam?: boolean } = {},
): { installedGames: AppOverview[]; localNonSteam: number } {
  try {
    // collectionStore.allAppsCollection is Steam's internal collection of all
    // library apps. It has an allApps getter or similar. Different Steam
    // client versions expose this differently, so we try a few paths.
    const cs = (globalThis as any).collectionStore;
    if (!cs) {
      void logFrontendEvent('DEBUG', 'collectionStore not available for prefetch');
      return { installedGames: [], localNonSteam: 0 };
    }

    // allAppsCollection.allApps is an array of app overviews
    const collection = cs.allAppsCollection;
    if (!collection) {
      void logFrontendEvent('DEBUG', 'allAppsCollection not available');
      return { installedGames: [], localNonSteam: 0 };
    }

    // get the internal app list - try common property names
    let apps: AppOverview[] = [];
    if (typeof collection.allApps !== 'undefined') {
      apps = collection.allApps;
    } else if (collection.apps && Symbol.iterator in collection.apps) {
      apps = Array.from(collection.apps);
    }

    // filter to installed games only (not tools, soundtracks, etc)
    const installed = apps.filter(isInstalledGame);
    const steamInstalled: AppOverview[] = [];
    let localNonSteam = 0;
    for (const app of installed) {
      if (isLocalNonSteamGame(app)) {
        localNonSteam++;
        continue;
      }
      steamInstalled.push(app);
    }

    if (options.countLocalNonSteam !== false && localNonSteam > 0) {
      countLocalNonSteamGame(localNonSteam);
    }

    if (options.logResults !== false) {
      void logFrontendEvent('DEBUG', 'Enumerated installed games', {
        total: apps.length,
        installed: steamInstalled.length,
        localNonSteam,
      });
    }

    return { installedGames: steamInstalled, localNonSteam };
  } catch (err) {
    if (options.logResults !== false) {
      void logFrontendEvent('ERROR', 'Failed to enumerate installed games', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { installedGames: [], localNonSteam: 0 };
  }
}

function getInstalledGames(): AppOverview[] {
  return enumerateInstalledGames().installedGames;
}

export function getInstalledGameStats(): InstalledGameStats {
  const { installedGames, localNonSteam } = enumerateInstalledGames({
    logResults: false,
    countLocalNonSteam: false,
  });
  return {
    installedSteamGames: installedGames.length,
    localNonSteamGames: localNonSteam,
    installedSteamAppIds: installedGames.map((game) => String(game.appid)),
  };
}

function getRecentlyPlayed(games: AppOverview[], days: number): AppOverview[] {
  const cutoff = Date.now() / 1000 - days * 24 * 60 * 60;
  return games
    .filter(g => readTimestamp(g, 'rt_last_time_played', 'rtLastTimePlayed') > cutoff)
    .sort(
      (a, b) =>
        readTimestamp(b, 'rt_last_time_played', 'rtLastTimePlayed')
        - readTimestamp(a, 'rt_last_time_played', 'rtLastTimePlayed'),
    );
}

function rankPrefetchCandidates(games: AppOverview[]): AppOverview[] {
  return [...games].sort((a, b) => {
    const playedDiff =
      readTimestamp(b, 'rt_last_time_played', 'rtLastTimePlayed')
      - readTimestamp(a, 'rt_last_time_played', 'rtLastTimePlayed');
    if (playedDiff !== 0) return playedDiff;

    const updatedDiff =
      readTimestamp(b, 'rt_last_updated', 'rtLastUpdated')
      - readTimestamp(a, 'rt_last_updated', 'rtLastUpdated');
    if (updatedDiff !== 0) return updatedDiff;

    const purchasedDiff =
      readTimestamp(b, 'rt_purchased', 'rtPurchased')
      - readTimestamp(a, 'rt_purchased', 'rtPurchased');
    if (purchasedDiff !== 0) return purchasedDiff;

    return b.appid - a.appid;
  });
}

// --- individual game prefetch ---

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
      // 404 = CDN has no data for this game, expected -- not a network error
      countNoData();
      span.end(true, { noData: true, reason: 'index-miss', status: indexResp.status });
      return false;
    }
    const years = (await indexResp.json()) as string[];
    if (!years.length) {
      countNoData();
      span.end(true, { noData: true, reason: 'index-empty' });
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

// --- throttled batch prefetch ---

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

// --- main entry point ---

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

    const frontendGames = getInstalledGames();
    let orderedInstalledAppIds: string[] = [];

    try {
      const backendStats = await getInstalledGameStatsCallable();
      orderedInstalledAppIds = Array.isArray(backendStats.installed_steam_app_ids)
        ? backendStats.installed_steam_app_ids.map(String)
        : [];
      void logFrontendEvent('INFO', 'Using backend installed game list for prefetch', {
        installed: backendStats.installed_steam_games ?? orderedInstalledAppIds.length,
        appIds: orderedInstalledAppIds.slice(0, 5),
      });
    } catch (error) {
      void logFrontendEvent('WARNING', 'Backend installed game stats unavailable for prefetch', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const games = orderedInstalledAppIds.length
      ? orderedInstalledAppIds
        .map((appId) => frontendGames.find((game) => String(game.appid) === appId) ?? {
          appid: Number.parseInt(appId, 10),
          display_name: '',
        })
        .filter((game) => Number.isFinite(game.appid) && game.appid > 0)
      : frontendGames;

    if (!games.length) {
      void logFrontendEvent('INFO', 'No installed games found for prefetch');
      batchSpan.end(true, { reason: 'no-games' });
      prefetchRunning = false;
      return;
    }

    const recent = orderedInstalledAppIds.length ? [] : getRecentlyPlayed(games, RECENTLY_PLAYED_DAYS);
    const ranked = orderedInstalledAppIds.length ? games : rankPrefetchCandidates(games);
    void logFrontendEvent('INFO', 'Prefetch candidate summary', {
      installed: games.length,
      recentlyPlayed: recent.length,
      cutoffDays: RECENTLY_PLAYED_DAYS,
    });

    // filter out games already cached and warm
    const alreadyCached = getCachedAppIds();
    const toPrefetch = ranked
      .map(g => String(g.appid))
      .filter(id => !alreadyCached.has(id))
      .slice(0, MAX_PREFETCH);

    if (!toPrefetch.length) {
      void logFrontendEvent('INFO', 'Prefetch: all ranked candidates already cached', {
        cachedCount: alreadyCached.size,
        candidateCount: ranked.length,
      });
      batchSpan.end(true, { reason: 'all-cached', cached: alreadyCached.size });
      prefetchRunning = false;
      return;
    }

    void logFrontendEvent('INFO', 'Prefetch starting', {
      count: toPrefetch.length,
      maxPrefetch: MAX_PREFETCH,
      firstFew: toPrefetch.slice(0, 5),
      recentCandidates: recent.length,
      rankedCandidates: ranked.length,
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
