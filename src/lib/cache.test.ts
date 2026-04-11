// src/lib/cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@decky/api', () => ({
  callable: vi.fn(() => vi.fn().mockResolvedValue(true)),
}));

// stub metrics so cache doesn't blow up
vi.mock('./metrics', () => ({
  startSpan: vi.fn(() => vi.fn()),
  countCacheHit: vi.fn(),
  countCacheMiss: vi.fn(),
  countCacheEviction: vi.fn(),
  getCombinedCategoryStats: vi.fn(() => ({
    count: 2,
    totalMs: 180,
    avgMs: 90,
    minMs: 70,
    maxMs: 110,
    p95Ms: 110,
    errorCount: 0,
  })),
}));

import {
  getCached,
  getCacheTtlMs,
  setCache,
  setCacheTtlHours,
  invalidate,
  invalidateAll,
  getCacheStats,
  getCachedAppIds,
  updateCachedVotes,
} from './cache';
import type { CdnReport, ProtonDBSummary } from '../types';

// localStorage mock (vitest provides it via jsdom but let's be safe)
const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
});

const fakeReport: CdnReport = {
  appId: '730',
  cpu: 'i7',
  duration: 'severalHours',
  gpu: 'RTX 3080',
  gpuDriver: '545',
  kernel: '6.1',
  notes: 'works great',
  os: 'Arch',
  protonVersion: 'GE-Proton9-7',
  ram: '32 GB',
  rating: 'gold',
  timestamp: 1700000000,
  title: 'CS2',
};

const fakeSummary: ProtonDBSummary = {
  score: 0.85,
  tier: 'gold',
  total: 123,
  trendingTier: 'platinum',
  bestReportedTier: 'platinum',
  confidence: 'good',
};

beforeEach(() => {
  // clear localStorage and the in-memory cache between tests
  localStorage.clear();
  invalidateAll();
});

describe('cache', () => {
  it('uses a configurable TTL in hours', () => {
    expect(getCacheTtlMs()).toBe(24 * 60 * 60 * 1000);
    setCacheTtlHours(12);
    expect(getCacheTtlMs()).toBe(12 * 60 * 60 * 1000);
  });

  it('returns null on cache miss', () => {
    expect(getCached('999')).toBeNull();
  });

  it('stores and retrieves a cache entry', () => {
    setCache('730', [fakeReport], fakeSummary, { key1: { upvotes: 3, downvotes: 0 } }, 'cdn');
    const entry = getCached('730');
    expect(entry).not.toBeNull();
    expect(entry!.appId).toBe('730');
    expect(entry!.reports).toHaveLength(1);
    expect(entry!.reports[0].title).toBe('CS2');
    expect(entry!.summary?.tier).toBe('gold');
    expect(entry!.votes).toEqual({ key1: { upvotes: 3, downvotes: 0 } });
    expect(entry!.source).toBe('cdn');
  });

  it('invalidates a single entry', () => {
    setCache('730', [fakeReport], null, {});
    expect(getCached('730')).not.toBeNull();
    invalidate('730');
    expect(getCached('730')).toBeNull();
  });

  it('invalidateAll clears everything', () => {
    setCache('730', [fakeReport], null, {});
    setCache('440', [fakeReport], null, {});
    invalidateAll();
    expect(getCached('730')).toBeNull();
    expect(getCached('440')).toBeNull();
  });

  it('returns correct cache stats', () => {
    setCache('730', [fakeReport], null, {});
    setCache('440', [fakeReport], null, {});
    const stats = getCacheStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(200);
    expect(stats.oldestMs).not.toBeNull();
    expect(stats.newestMs).not.toBeNull();
    expect(stats.networkFetchAvgMs).toBe(90);
    expect(stats.networkFetchP95Ms).toBe(110);
    expect(stats.networkFetchMaxMs).toBe(110);
  });

  it('getCachedAppIds returns all cached IDs', () => {
    setCache('730', [fakeReport], null, {});
    setCache('440', [fakeReport], null, {});
    const ids = getCachedAppIds();
    expect(ids.has('730')).toBe(true);
    expect(ids.has('440')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('updateCachedVotes merges votes into existing entry', () => {
    setCache('730', [fakeReport], null, {});
    updateCachedVotes('730', { key1: { upvotes: 5, downvotes: 0 }, key2: { upvotes: 2, downvotes: 1 } });
    const entry = getCached('730');
    expect(entry!.votes).toEqual({ key1: { upvotes: 5, downvotes: 0 }, key2: { upvotes: 2, downvotes: 1 } });
  });

  it('updateCachedVotes is a no-op when entry doesnt exist', () => {
    // should not throw
    updateCachedVotes('999', { key1: { upvotes: 1, downvotes: 0 } });
    expect(getCached('999')).toBeNull();
  });

  it('updateCachedVotes stores upvotes and downvotes', () => {
    setCache('999', [], null, {}, 'cdn');
    updateCachedVotes('999', { 'rk1': { upvotes: 3, downvotes: 1 } });
    const c = getCached('999');
    expect(c?.votes).toEqual({ 'rk1': { upvotes: 3, downvotes: 1 } });
  });

  it('expires stale entries on read', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00Z'));
    setCacheTtlHours(1);
    setCache('730', [fakeReport], null, {});

    vi.setSystemTime(new Date('2026-04-10T02:30:00Z'));
    expect(getCached('730')).toBeNull();
    expect(getCacheStats().size).toBe(0);
    vi.useRealTimers();
  });

  it('loads only fresh entries from storage during initialization', async () => {
    vi.resetModules();
    localStorage.clear();
    const now = new Date('2026-04-10T12:00:00Z').getTime();
    localStorage.setItem('proton-pulse:data-cache', JSON.stringify([
      {
        appId: '730',
        reports: [fakeReport],
        summary: fakeSummary,
        votes: {},
        cachedAt: now - (30 * 60 * 1000),
        lastAccessedAt: now - (30 * 60 * 1000),
        source: 'cdn',
      },
      {
        appId: '440',
        reports: [fakeReport],
        summary: null,
        votes: {},
        cachedAt: now - (48 * 60 * 60 * 1000),
        lastAccessedAt: now - (48 * 60 * 60 * 1000),
        source: 'cdn',
      },
    ]));

    vi.useFakeTimers();
    vi.setSystemTime(now);
    const freshCache = await import('./cache');
    const loaded = freshCache.getCached('730');
    const expired = freshCache.getCached('440');

    expect(loaded?.appId).toBe('730');
    expect(expired).toBeNull();
    vi.useRealTimers();
  });

  it('returns null network stats when no fetch timings are present', async () => {
    vi.resetModules();
    vi.doMock('./metrics', () => ({
      startSpan: vi.fn(() => vi.fn()),
      countCacheHit: vi.fn(),
      countCacheMiss: vi.fn(),
      countCacheEviction: vi.fn(),
      getCombinedCategoryStats: vi.fn(() => null),
    }));

    const freshCache = await import('./cache');
    const stats = freshCache.getCacheStats();
    expect(stats.networkFetchAvgMs).toBeNull();
    expect(stats.networkFetchP95Ms).toBeNull();
    expect(stats.networkFetchMaxMs).toBeNull();
  });
});
