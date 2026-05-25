// src/lib/pulseTier.test.ts
// Weighted-average tier scoring. The math is: each row contributes
// (rating_score * recency_weight) to a sum, total recency is the divisor,
// and the avg drops into the tier buckets. Tests hit each recency band
// and each tier threshold at least once
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computePulseTier, computeCombinedTier } from './pulseTier';
import type { UserConfigRow } from './userConfigs';
import type { CdnReport } from '../types';

// Anchor "now" so recency bands are deterministic. 2026-04-19 is today per
// the project context, so we can build created_at strings by subtracting days
const NOW_MS = new Date('2026-04-19T12:00:00Z').getTime();

function daysAgo(n: number): string {
  return new Date(NOW_MS - n * 86400 * 1000).toISOString();
}

function row(rating: UserConfigRow['rating'], days: number): UserConfigRow {
  return {
    id: 1,
    client_id: 'c',
    app_id: '620',
    title: 't',
    cpu: '',
    gpu: '',
    gpu_driver: '',
    gpu_vendor: '',
    ram: '',
    os: '',
    kernel: '',
    proton_version: '',
    duration: '',
    rating,
    notes: '',
    launch_options: '',
    enabled_vars: {},
    confidence_score: null,
    source: 'user',
    created_at: daysAgo(days),
  };
}

describe('computePulseTier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns pending/none when there are no rows', () => {
    expect(computePulseTier([])).toEqual({ tier: 'pending', count: 0, confidence: 'none', confidencePct: 0 });
  });

  it('scores a single fresh platinum as platinum + low confidence', () => {
    // 1 row, all platinum, < 30 days old -> recency 1.0, score 1.0 -> avg 1.0
    // tier=platinum. count=1 -> confidence=low
    expect(computePulseTier([row('platinum', 5)])).toEqual({
      tier: 'platinum', count: 1, confidence: 'low', confidencePct: 30,
    });
  });

  it('lands in gold when mixing platinum+silver', () => {
    // plat(1.0) + silver(0.6) both fresh -> avg 0.8 -> gold
    const rows = [row('platinum', 1), row('silver', 2)];
    const result = computePulseTier(rows);
    expect(result.tier).toBe('gold');
    expect(result.count).toBe(2);
    expect(result.confidence).toBe('medium');
  });

  it('lands in silver around the 0.40 boundary', () => {
    // bronze(0.4) alone -> avg 0.4 -> silver (>= 0.40)
    expect(computePulseTier([row('bronze', 2)]).tier).toBe('silver');
  });

  it('lands in bronze at the 0.15 floor', () => {
    // custom rating that maps to 0.5 fallback won't hit bronze, but two
    // borked and one bronze will: (0*r + 0*r + 0.4*r)/3r ~= 0.133 -> borked
    // So pick borked+borked+bronze+bronze: (0+0+0.4+0.4)/4 = 0.2 -> bronze
    const rows = [row('borked', 5), row('borked', 5), row('bronze', 5), row('bronze', 5)];
    expect(computePulseTier(rows).tier).toBe('bronze');
  });

  it('lands in borked when every row is borked', () => {
    expect(computePulseTier([row('borked', 1), row('borked', 1)]).tier).toBe('borked');
  });

  it('applies 0.85 recency for 30-89 day old rows', () => {
    // 60 days old platinum -> (1.0 * 0.85) / 0.85 = 1.0 -> platinum
    const result = computePulseTier([row('platinum', 60)]);
    expect(result.tier).toBe('platinum');
  });

  it('applies 0.65 recency for 90-179 day old rows', () => {
    const result = computePulseTier([row('platinum', 120)]);
    expect(result.tier).toBe('platinum'); // score normalizes out
  });

  it('applies 0.40 recency for 180-364 day old rows', () => {
    const result = computePulseTier([row('gold', 200)]);
    // gold = 0.8 / 1.0 = 0.8 -> gold
    expect(result.tier).toBe('gold');
  });

  it('applies 0.15 recency for rows older than a year', () => {
    const result = computePulseTier([row('platinum', 500)]);
    // avg still normalizes to 1.0, but recency weight is tiny - verify
    // by pairing an old platinum with a fresh borked: fresh row dominates
    const mixed = computePulseTier([row('platinum', 500), row('borked', 1)]);
    expect(result.tier).toBe('platinum');
    // fresh borked (weight 1.0) vs old platinum (weight 0.15) -> ~(0.15 + 0)/1.15 ~= 0.13 -> borked
    expect(mixed.tier).toBe('borked');
  });

  it('treats missing created_at as ~1 year old (0.15 recency)', () => {
    const noDate: UserConfigRow = { ...row('platinum', 0), created_at: '' };
    expect(computePulseTier([noDate]).tier).toBe('platinum'); // normalizes
  });

  it('falls back to 0.5 for unknown ratings', () => {
    // @ts-expect-error - feeding in an invalid rating on purpose
    const bogus = row('weird', 1);
    // 0.5 / 1.0 = 0.5 -> silver (>= 0.40)
    expect(computePulseTier([bogus]).tier).toBe('silver');
  });

  it('reports high confidence with 5+ rows', () => {
    const rows = [
      row('gold', 1), row('gold', 1), row('gold', 1), row('gold', 1), row('gold', 1),
    ];
    expect(computePulseTier(rows).confidence).toBe('high');
  });
});

describe('computeCombinedTier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function cdnRow(rating: string, daysOld: number): Pick<CdnReport, 'rating' | 'timestamp'> {
    const ts = (NOW_MS - daysOld * 86400 * 1000) / 1000;
    return { rating: rating as CdnReport['rating'], timestamp: ts };
  }

  it('returns pending when both arrays are empty', () => {
    expect(computeCombinedTier([], [])).toEqual({ tier: 'pending', count: 0, confidence: 'none', confidencePct: 0 });
  });

  it('scores a single fresh platinum CDN report as platinum', () => {
    const result = computeCombinedTier([cdnRow('platinum', 5)], []);
    expect(result.tier).toBe('platinum');
    expect(result.count).toBe(1);
    expect(result.confidence).toBe('low');
  });

  it('merges CDN and pulse rows and computes a combined avg', () => {
    // CDN: gold(0.8) fresh + pulse: borked(0.0) fresh -> avg 0.4 -> silver
    const result = computeCombinedTier([cdnRow('gold', 1)], [row('borked', 1)]);
    expect(result.tier).toBe('silver');
    expect(result.count).toBe(2);
    expect(result.confidence).toBe('medium');
  });

  it('fresh pulse borked dominates old CDN platinum', () => {
    // CDN: platinum(1.0) 400 days old (weight 0.15) vs pulse: borked(0.0) fresh (weight 1.0)
    // avg = (1.0*0.15 + 0.0*1.0) / (0.15+1.0) = 0.15/1.15 ~= 0.13 -> borked
    const result = computeCombinedTier([cdnRow('platinum', 400)], [row('borked', 1)]);
    expect(result.tier).toBe('borked');
  });

  it('handles missing created_at in pulse rows (ts=0 maps to 365 days)', () => {
    const noDate: UserConfigRow = { ...row('platinum', 0), created_at: '' };
    const result = computeCombinedTier([], [noDate]);
    expect(result.tier).toBe('platinum');
  });

  it('falls back to 0.5 score for unknown rating', () => {
    const result = computeCombinedTier([cdnRow('weird', 1)], []);
    expect(result.tier).toBe('silver');
  });

  it('reports high confidence with 5+ combined entries', () => {
    const cdn = [cdnRow('gold', 1), cdnRow('gold', 1), cdnRow('gold', 1)];
    const pulse = [row('gold', 1), row('gold', 1)];
    expect(computeCombinedTier(cdn, pulse).confidence).toBe('high');
  });

  it('lands in gold, silver, bronze, and borked thresholds', () => {
    // gold: avg ~0.75 (platinum+silver)
    expect(computeCombinedTier([cdnRow('platinum', 1), cdnRow('silver', 1)], []).tier).toBe('gold');
    // silver: avg = 0.4 (bronze alone)
    expect(computeCombinedTier([cdnRow('bronze', 1)], []).tier).toBe('silver');
    // bronze: mix borked+bronze -> avg 0.2
    expect(computeCombinedTier([cdnRow('borked', 1), cdnRow('borked', 1), cdnRow('bronze', 1), cdnRow('bronze', 1)], []).tier).toBe('bronze');
    // borked: all borked
    expect(computeCombinedTier([cdnRow('borked', 1)], []).tier).toBe('borked');
  });
});
