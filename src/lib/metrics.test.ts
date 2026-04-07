// src/lib/metrics.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@decky/api', () => ({
  callable: vi.fn(() => vi.fn().mockResolvedValue(true)),
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
  getCounters,
  getSummary,
  getSummaryText,
  getRawEntries,
  resetMetrics,
} from './metrics';

beforeEach(() => {
  resetMetrics();
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

    const c = getCounters();
    expect(c.cacheHits).toBe(2);
    expect(c.cacheMisses).toBe(1);
    expect(c.totalFetches).toBe(3);
    expect(c.prefetchedGames).toBe(1);
    expect(c.cacheEvictions).toBe(1);
    expect(c.fetchErrors).toBe(1);
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

describe('getSummaryText', () => {
  it('produces a human-readable string', () => {
    countCacheHit();
    countCacheHit();
    countCacheMiss();
    const text = getSummaryText();
    expect(text).toContain('Cache hits:       2');
    expect(text).toContain('Cache misses:     1');
    expect(text).toContain('Cache hit rate:   66.7%');
  });
});
