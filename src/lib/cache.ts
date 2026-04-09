// src/lib/cache.ts
//
// Local data cache for ProtonDB reports, summaries, and votes.
// Two layers: fast in-memory Map for the current session, backed by
// localStorage for warm restarts. LRU eviction keeps us under the cap.
//
// Cache keys are appId strings. Each entry stores reports, summary,
// votes, and a timestamp for TTL checks. Debug logging reveals every
// cache decision (hit/miss/evict/write) so perf issues are visible
// in the Logs tab.

import { getSetting, setSetting } from './settings';
import { logFrontendEvent } from './logger';
import {
  countCacheHit,
  countCacheMiss,
  countCacheEviction,
  startSpan,
  getCombinedCategoryStats,
} from './metrics';
import type { CdnReport, ProtonDBSummary } from '../types';

// ── config ──────────────────────────────────────────────────────────────────

// default TTL used by getCacheTtlMs when no user setting exists
// not referenced directly but documents the 24h default for the setting lookup
const MAX_CACHE_ENTRIES = 200;
const STORAGE_KEY = 'data-cache';
const TTL_SETTING_KEY = 'cache-ttl-hours';

export interface VoteTotals {
  upvotes: number;
  downvotes: number;
}

export interface CacheEntry {
  appId: string;
  reports: CdnReport[];
  summary: ProtonDBSummary | null;
  votes: Record<string, VoteTotals>;
  cachedAt: number;       // Date.now() when cached
  lastAccessedAt: number; // for LRU eviction
  source: 'cdn' | 'live-summary' | 'prefetch';
}

// ── in-memory layer ─────────────────────────────────────────────────────────

const memCache = new Map<string, CacheEntry>();
let initialized = false;

// ── TTL ─────────────────────────────────────────────────────────────────────

export function getCacheTtlMs(): number {
  const hours = getSetting<number>(TTL_SETTING_KEY, 24);
  return hours * 60 * 60 * 1000;
}

export function setCacheTtlHours(hours: number): void {
  setSetting(TTL_SETTING_KEY, hours);
}

function isExpired(entry: CacheEntry): boolean {
  const ttl = getCacheTtlMs();
  return Date.now() - entry.cachedAt > ttl;
}

// ── init: load from localStorage into memory ────────────────────────────────

export function initCache(): void {
  if (initialized) return;
  const endSpan = startSpan('cache-read', 'init-from-storage');
  try {
    const stored = getSetting<CacheEntry[]>(STORAGE_KEY, []);
    let loaded = 0;
    let expired = 0;
    for (const entry of stored) {
      if (isExpired(entry)) {
        expired++;
        continue;
      }
      memCache.set(entry.appId, entry);
      loaded++;
    }
    initialized = true;
    void logFrontendEvent('INFO', 'Cache initialized from localStorage', {
      loaded,
      expired,
      total: stored.length,
    });
  } catch (err) {
    void logFrontendEvent('ERROR', 'Failed to load cache from localStorage', {
      error: err instanceof Error ? err.message : String(err),
    });
    initialized = true; // don't retry on failure, just start fresh
  }
  endSpan();
}

// ── persist to localStorage ─────────────────────────────────────────────────

function persistToStorage(): void {
  const endSpan = startSpan('cache-write', 'persist-to-storage');
  try {
    const all = Array.from(memCache.values());
    setSetting(STORAGE_KEY, all);
  } catch (err) {
    // localStorage might be full, just log it
    void logFrontendEvent('WARNING', 'Cache persist to localStorage failed', {
      error: err instanceof Error ? err.message : String(err),
      entryCount: memCache.size,
    });
  }
  endSpan();
}

// ── eviction ────────────────────────────────────────────────────────────────

function evictIfNeeded(): void {
  if (memCache.size <= MAX_CACHE_ENTRIES) return;

  // sort by lastAccessedAt ascending (oldest first), evict until under cap
  const sorted = Array.from(memCache.entries())
    .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);

  const toEvict = sorted.slice(0, memCache.size - MAX_CACHE_ENTRIES);
  for (const [key] of toEvict) {
    memCache.delete(key);
    countCacheEviction();
  }

  if (toEvict.length > 0) {
    void logFrontendEvent('DEBUG', 'Cache eviction ran', {
      evicted: toEvict.length,
      remaining: memCache.size,
    });
  }
}

// ── public API ──────────────────────────────────────────────────────────────

export function getCached(appId: string): CacheEntry | null {
  if (!initialized) initCache();

  const entry = memCache.get(appId);
  if (!entry) {
    countCacheMiss();
    void logFrontendEvent('DEBUG', 'Cache miss', { appId });
    return null;
  }

  if (isExpired(entry)) {
    memCache.delete(appId);
    countCacheMiss();
    void logFrontendEvent('DEBUG', 'Cache expired', {
      appId,
      cachedAt: entry.cachedAt,
      ageMs: Date.now() - entry.cachedAt,
    });
    return null;
  }

  // update LRU timestamp
  entry.lastAccessedAt = Date.now();
  countCacheHit();
  void logFrontendEvent('DEBUG', 'Cache hit', {
    appId,
    ageMs: Date.now() - entry.cachedAt,
    source: entry.source,
    reportCount: entry.reports.length,
  });
  return entry;
}

export function setCache(
  appId: string,
  reports: CdnReport[],
  summary: ProtonDBSummary | null,
  votes: Record<string, VoteTotals>,
  source: CacheEntry['source'] = 'cdn',
): void {
  const endSpan = startSpan('cache-write', appId);
  const now = Date.now();

  memCache.set(appId, {
    appId,
    reports,
    summary,
    votes,
    cachedAt: now,
    lastAccessedAt: now,
    source,
  });

  evictIfNeeded();
  persistToStorage();
  endSpan();

  void logFrontendEvent('DEBUG', 'Cache write', {
    appId,
    reportCount: reports.length,
    hasSummary: summary !== null,
    voteCount: Object.keys(votes).length,
    source,
    totalEntries: memCache.size,
  });
}

// update just the votes for an already-cached game (after upvote/downvote)
export function updateCachedVotes(appId: string, votes: Record<string, VoteTotals>): void {
  const entry = memCache.get(appId);
  if (!entry) return;
  entry.votes = votes;
  entry.lastAccessedAt = Date.now();
  persistToStorage();
}

export function invalidate(appId: string): void {
  if (memCache.delete(appId)) {
    persistToStorage();
    void logFrontendEvent('DEBUG', 'Cache invalidated', { appId });
  }
}

export function invalidateAll(): void {
  const count = memCache.size;
  memCache.clear();
  persistToStorage();
  void logFrontendEvent('INFO', 'Cache cleared', { evicted: count });
}

// ── stats ───────────────────────────────────────────────────────────────────

export function getCacheStats(): {
  size: number;
  maxSize: number;
  ttlMs: number;
  oldestMs: number | null;
  newestMs: number | null;
  networkFetchAvgMs: number | null;
  networkFetchP95Ms: number | null;
  networkFetchMaxMs: number | null;
} {
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const entry of memCache.values()) {
    if (oldest === null || entry.cachedAt < oldest) oldest = entry.cachedAt;
    if (newest === null || entry.cachedAt > newest) newest = entry.cachedAt;
  }
  const networkFetchStats = getCombinedCategoryStats(['fetch-cdn-index', 'fetch-live-summary']);
  return {
    size: memCache.size,
    maxSize: MAX_CACHE_ENTRIES,
    ttlMs: getCacheTtlMs(),
    oldestMs: oldest ? Date.now() - oldest : null,
    newestMs: newest ? Date.now() - newest : null,
    networkFetchAvgMs: networkFetchStats?.avgMs ?? null,
    networkFetchP95Ms: networkFetchStats?.p95Ms ?? null,
    networkFetchMaxMs: networkFetchStats?.maxMs ?? null,
  };
}

// all cached appIds, for prefetch to know what's already warm
export function getCachedAppIds(): Set<string> {
  if (!initialized) initCache();
  return new Set(memCache.keys());
}
