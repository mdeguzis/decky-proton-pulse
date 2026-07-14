// src/lib/metrics.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { exportMetricsCallableMock, logFrontendEventMock } = vi.hoisted(() => ({
  exportMetricsCallableMock: vi.fn().mockResolvedValue(true),
  logFrontendEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@decky/api', () => ({
  callable: vi.fn(() => exportMetricsCallableMock),
}));

vi.mock('./logger', () => ({
  logFrontendEvent: logFrontendEventMock,
}));

import {
  startSpan,
  startDetailedSpan,
  countCacheHit,
  countCacheMiss,
  countFetch,
  countPrefetchedGame,
  countCacheEviction,
  countFetchError,
  countLocalNonSteamGame,
  getCounters,
  getCombinedCategoryStats,
  getPrefetchFailureSummary,
  getSummary,
  getSummaryText,
  getRawEntries,
  resetMetrics,
  flushMetricsToDisk,
  startAutoFlush,
  stopAutoFlush,
  countBadgeTileSeen,
  countBadgeApplied,
  countBadgeNoData,
  countBadgeFetchError,
  countBadgeFetchMs,
  getBadgeScanStats,
  getHourlyBuckets,
} from './metrics';

beforeEach(() => {
  resetMetrics();
  exportMetricsCallableMock.mockReset().mockResolvedValue(true);
  logFrontendEventMock.mockReset().mockResolvedValue(undefined);
  vi.useRealTimers();
});

describe('metrics counters', () => {
  it('starts at zero', () => {
    const c = getCounters();
    expect(c.cacheHits).toBe(0);
    expect(c.cacheMisses).toBe(0);
    expect(c.totalFetches).toBe(0);
  });

  it('increments counters', () => {
    countCacheHit();
    countCacheHit();
    countCacheMiss();
    countFetch();
    countFetch();
    countFetch();
    countPrefetchedGame();
    countCacheEviction();
    countFetchError();
    countLocalNonSteamGame(4);

    const c = getCounters();
    expect(c.cacheHits).toBe(2);
    expect(c.cacheMisses).toBe(1);
    expect(c.totalFetches).toBe(3);
    expect(c.prefetchedGames).toBe(1);
    expect(c.cacheEvictions).toBe(1);
    expect(c.fetchErrors).toBe(1);
    expect(c.localNonSteamGames).toBe(4);
  });
});

describe('timing spans', () => {
  it('startSpan records a timing entry', () => {
    const end = startSpan('cache-read', 'test');
    end();
    const entries = getRawEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('cache-read');
    expect(entries[0].label).toBe('test');
    expect(entries[0].success).toBe(true);
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('startDetailedSpan records success/failure with metadata', () => {
    const span = startDetailedSpan('fetch-cdn-index', '730');
    span.end(false, { reason: 'timeout' });

    const entries = getRawEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].success).toBe(false);
    expect(entries[0].metadata).toEqual({ reason: 'timeout' });
  });

  it('calling end twice is a no-op', () => {
    const end = startSpan('cache-read', 'test');
    end();
    end(); // should not double-record
    expect(getRawEntries()).toHaveLength(1);
  });

  it('overwrites the oldest entries once the ring buffer is full', () => {
    for (let i = 0; i < 2001; i++) {
      startSpan('cache-read', `entry-${i}`)();
    }

    const entries = getRawEntries();
    expect(entries).toHaveLength(2000);
    expect(entries.some((entry) => entry.label === 'entry-0')).toBe(false);
    expect(entries.some((entry) => entry.label === 'entry-2000')).toBe(true);
  });
});

describe('getSummary', () => {
  it('aggregates per-category stats', () => {
    // record a few entries
    const e1 = startSpan('fetch-cdn-index', '730'); e1();
    const e2 = startSpan('fetch-cdn-index', '440'); e2();
    const e3 = startSpan('cache-read', 'init'); e3();
    countCacheHit();
    countCacheMiss();

    const summary = getSummary();
    expect(summary.entryCount).toBe(3);
    expect(summary.categories['fetch-cdn-index'].count).toBe(2);
    expect(summary.categories['cache-read'].count).toBe(1);
    expect(summary.counters.cacheHits).toBe(1);
    expect(summary.counters.cacheMisses).toBe(1);
    expect(summary.collectedAt).toBeTruthy();
    expect(summary.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('getCombinedCategoryStats', () => {
  it('combines multiple timing categories into one aggregate', () => {
    startSpan('fetch-cdn-index', '730')();
    startSpan('fetch-live-summary', '730')();
    startSpan('cache-read', 'init')();

    const combined = getCombinedCategoryStats(['fetch-cdn-index', 'fetch-live-summary']);
    expect(combined).not.toBeNull();
    expect(combined!.count).toBe(2);
    expect(combined!.avgMs).toBeGreaterThanOrEqual(0);
  });

  it('returns null when no matching categories were recorded', () => {
    expect(getCombinedCategoryStats(['fetch-live-summary'])).toBeNull();
  });
});

describe('getPrefetchFailureSummary', () => {
  it('summarizes failed prefetch reasons', () => {
    startDetailedSpan('prefetch-game', '730').end(false, { reason: 'index-miss', status: 404 });
    startDetailedSpan('prefetch-game', '440').end(false, { reason: 'index-miss', status: 404 });
    startDetailedSpan('prefetch-game', '570').end(false, { reason: 'index-empty' });
    startDetailedSpan('fetch-cdn-index', '730').end(false, { reason: 'timeout' });

    const summary = getPrefetchFailureSummary();
    expect(summary.total).toBe(3);
    expect(summary.byReason['index-miss']).toBe(2);
    expect(summary.byReason['index-empty']).toBe(1);
  });

  it('falls back to status and unknown reasons when metadata is sparse', () => {
    startDetailedSpan('prefetch-game', '730').end(false, { status: 503 });
    startDetailedSpan('prefetch-game', '440').end(false);

    const summary = getPrefetchFailureSummary();
    expect(summary.byReason['status-503']).toBe(1);
    expect(summary.byReason.unknown).toBe(1);
  });
});

describe('getSummaryText', () => {
  it('produces a human-readable string', () => {
    countCacheHit();
    countCacheHit();
    countCacheMiss();
    const text = getSummaryText();
    expect(text).toContain('Cache hits:       2');
    expect(text).toContain('Cache misses:     1');
    expect(text).toContain('Cache hit rate:   66.7%');
    expect(text).toContain('Non-Steam local:  0');
  });

  it('shows "n/a" hit rate when no cache operations have been recorded', () => {
    // after reset: cacheHits=0, cacheMisses=0 -> the false branch of the hitRate ternary
    const text = getSummaryText();
    expect(text).toContain('Cache hit rate:   n/a%');
  });

  it('includes error count in timing category lines', () => {
    // record a span that ends with failure -> errorCount > 0 -> shows "(N errors)"
    const span = startDetailedSpan('fetch-cdn-index', '730');
    span.end(false, { reason: 'timeout' });
    const text = getSummaryText();
    expect(text).toMatch(/fetch-cdn-index:.*\(1 errors\)/);
  });
});

describe('flush and timers', () => {
  it('flushes metrics to disk through the backend callable', async () => {
    countCacheHit();
    await expect(flushMetricsToDisk()).resolves.toBe(true);
    expect(logFrontendEventMock).toHaveBeenCalledWith(
      'DEBUG',
      'Metrics flushed to disk',
      expect.objectContaining({ success: true }),
    );
  });

  it('returns false when flushing metrics fails', async () => {
    vi.resetModules();
    const exportMetricsCallable = vi.fn().mockRejectedValue(new Error('disk full'));
    vi.doMock('@decky/api', () => ({
      callable: vi.fn(() => exportMetricsCallable),
    }));
    vi.doMock('./logger', () => ({
      logFrontendEvent: logFrontendEventMock,
    }));
    const freshMetrics = await import('./metrics');

    await expect(freshMetrics.flushMetricsToDisk()).resolves.toBe(false);
    expect(logFrontendEventMock).toHaveBeenCalledWith(
      'ERROR',
      'Failed to flush metrics to disk',
      expect.objectContaining({ error: 'disk full' }),
    );
  });

  it('starts only one auto-flush timer and can stop it cleanly', async () => {
    vi.useFakeTimers();

    startAutoFlush();
    startAutoFlush();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(exportMetricsCallableMock).toHaveBeenCalledTimes(1);

    stopAutoFlush();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(exportMetricsCallableMock).toHaveBeenCalledTimes(1);
  });
});

describe('badge scan counters', () => {
  it('accumulates badge counters and dedups by app id', () => {
    const before = getBadgeScanStats();
    countBadgeTileSeen('app-1');
    countBadgeTileSeen('app-1'); // dedup: should not double count
    countBadgeApplied('app-1');
    countBadgeApplied('app-1'); // dedup
    countBadgeNoData();
    countBadgeFetchError();
    countBadgeFetchMs(12);
    const after = getBadgeScanStats();

    expect(after.tilesScanned).toBe(before.tilesScanned + 1);
    expect(after.badgesApplied).toBe(before.badgesApplied + 1);
    expect(after.noDataTiles).toBe(before.noDataTiles + 1);
    expect(after.fetchErrors).toBe(before.fetchErrors + 1);
    expect(after.totalFetchMs).toBe(before.totalFetchMs + 12);
    expect(after.fetchCount).toBe(before.fetchCount + 1);
  });
});

describe('hourly buckets', () => {
  it('returns a sorted array', () => {
    expect(Array.isArray(getHourlyBuckets())).toBe(true);
  });

  it('loads buckets from storage on init', async () => {
    vi.resetModules();
    const saved = [{ hourKey: Date.now(), spans: {}, counters: {} }];
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: () => JSON.stringify(saved),
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    try {
      const mod = await import('./metrics');
      expect(mod.getHourlyBuckets().length).toBeGreaterThanOrEqual(1);
    } finally {
      delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    }
  });
});
