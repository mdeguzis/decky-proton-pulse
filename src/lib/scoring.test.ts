// src/lib/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { scoreReport, bucketByGpuTier, parseNotesSentiment } from './scoring';
import type { CdnReport, SystemInfo } from '../types';

const nvidiaSystem: SystemInfo = {
  cpu: 'AMD Ryzen 9 9950X3D',
  ram_gb: 64,
  gpu: 'NVIDIA GeForce RTX 5080',
  gpu_vendor: 'nvidia',
  driver_version: '595.45.04',
  kernel: '6.19.8-1-cachyos',
  distro: 'CachyOS',
  proton_custom: 'cachyos-10.0-202603012',
};

const now = Math.floor(Date.now() / 1000);

function makeCdnReport(overrides: Partial<CdnReport> = {}): CdnReport {
  return {
    appId: '12345',
    cpu: 'Intel Core i7',
    duration: 'severalHours',
    gpu: 'NVIDIA GeForce RTX 3080',
    gpuDriver: 'NVIDIA 545.29.06',
    kernel: '6.1.0',
    notes: '',
    os: 'Arch Linux',
    protonVersion: 'GE-Proton9-7',
    ram: '32 GB',
    rating: 'platinum',
    timestamp: now - 30 * 86400,
    title: 'Test Game',
    ...overrides,
  };
}

const platinumNvidiaRecent = makeCdnReport();
const goldAmdOld = makeCdnReport({
  gpu: 'AMD Radeon RX 7900 XTX', gpuDriver: 'Mesa 23.1.0',
  rating: 'gold', timestamp: now - 400 * 86400,
});

// ─── scoreReport ──────────────────────────────────────────────────────────────

describe('scoreReport', () => {
  it('attaches gpuTier, recencyDays, notesModifier, upvotes to result', () => {
    const scored = scoreReport(platinumNvidiaRecent, nvidiaSystem);
    expect(scored.gpuTier).toBe('nvidia');
    expect(scored.recencyDays).toBeGreaterThan(25);
    expect(scored.recencyDays).toBeLessThan(35);
    expect(typeof scored.notesModifier).toBe('number');
    expect(scored.upvotes).toBe(0);
  });

  it('score is never negative', () => {
    const r = makeCdnReport({ rating: 'borked', gpu: '' });
    expect(scoreReport(r, nvidiaSystem).score).toBeGreaterThanOrEqual(0);
  });

  it('gives higher score to matching GPU vendor report', () => {
    const nvidiaScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const amdScore = scoreReport(goldAmdOld, nvidiaSystem).score;
    expect(nvidiaScore).toBeGreaterThan(amdScore);
  });

  it('gives recency bonus for reports under 90 days', () => {
    const recentScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const oldScore = scoreReport(makeCdnReport({ timestamp: now - 400 * 86400 }), nvidiaSystem).score;
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('gives custom proton bonus', () => {
    const geScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const vanillaScore = scoreReport(makeCdnReport({ protonVersion: 'Proton 9.0' }), nvidiaSystem).score;
    expect(geScore).toBeGreaterThan(vanillaScore);
  });

  // ── driver matching ──────────────────────────────────────────────────────────

  it('exact driver version gives higher score than close version', () => {
    const exactDriver = makeCdnReport({ gpuDriver: 'NVIDIA 595.45.04' }); // matches nvidiaSystem
    const closeDriver = makeCdnReport({ gpuDriver: 'NVIDIA 593.10.00' }); // within 2 major
    expect(scoreReport(exactDriver, nvidiaSystem).score).toBeGreaterThan(
      scoreReport(closeDriver, nvidiaSystem).score
    );
  });

  it('close driver version gives higher score than far version', () => {
    const closeDriver = makeCdnReport({ gpuDriver: 'NVIDIA 593.10.00' });
    const farDriver   = makeCdnReport({ gpuDriver: 'NVIDIA 410.93' });
    expect(scoreReport(closeDriver, nvidiaSystem).score).toBeGreaterThan(
      scoreReport(farDriver, nvidiaSystem).score
    );
  });

  it('different vendor driver gives mismatch multiplier', () => {
    const amdDriverReport = makeCdnReport({ gpu: 'AMD Radeon RX 6800', gpuDriver: 'Mesa 23.1.0' });
    expect(scoreReport(platinumNvidiaRecent, nvidiaSystem).score).toBeGreaterThan(
      scoreReport(amdDriverReport, nvidiaSystem).score
    );
  });

  // ── borked decay ─────────────────────────────────────────────────────────────

  it('fresh borked report scores lower than old borked (decay raises old score)', () => {
    const freshBorked = makeCdnReport({ rating: 'borked', timestamp: now - 30 * 86400 });
    const oldBorked   = makeCdnReport({ rating: 'borked', timestamp: now - 400 * 86400 });
    expect(scoreReport(oldBorked, nvidiaSystem).score).toBeGreaterThan(
      scoreReport(freshBorked, nvidiaSystem).score
    );
  });
});

// ─── parseNotesSentiment ──────────────────────────────────────────────────────

describe('parseNotesSentiment', () => {
  it('returns 0 for empty notes', () => {
    expect(parseNotesSentiment('')).toBe(0);
  });

  it('returns negative value for crash keyword', () => {
    expect(parseNotesSentiment('the game crash on launch')).toBeLessThan(0);
  });

  it('returns negative value for multiple negative keywords', () => {
    const single = parseNotesSentiment('crash');
    const multi  = parseNotesSentiment('crash freeze black screen');
    expect(multi).toBeLessThan(single);
  });

  it('returns positive value for positive keywords', () => {
    expect(parseNotesSentiment('works great out of the box')).toBeGreaterThan(0);
  });

  it('is capped at +10', () => {
    const heavy = 'perfect flawless works great no issues out of the box excellent runs perfectly zero issues works flawlessly';
    expect(parseNotesSentiment(heavy)).toBeLessThanOrEqual(10);
  });

  it('is capped at -10', () => {
    const heavy = "crash broken freeze black screen hang softlock corrupted doesn't work unplayable won't launch";
    expect(parseNotesSentiment(heavy)).toBeGreaterThanOrEqual(-10);
  });

  it('is case-insensitive', () => {
    expect(parseNotesSentiment('CRASH')).toBe(parseNotesSentiment('crash'));
  });
});

// ─── bucketByGpuTier ──────────────────────────────────────────────────────────

describe('bucketByGpuTier', () => {
  it('separates nvidia and amd into correct buckets', () => {
    const scored = [platinumNvidiaRecent, goldAmdOld].map(r => scoreReport(r, nvidiaSystem));
    const buckets = bucketByGpuTier(scored);
    expect(buckets.nvidia).toHaveLength(1);
    expect(buckets.amd).toHaveLength(1);
    expect(buckets.other).toHaveLength(0);
  });

  it('sorts each bucket by score descending', () => {
    const r1 = makeCdnReport();
    const r2 = makeCdnReport({ rating: 'silver', timestamp: now - 500 * 86400 });
    const buckets = bucketByGpuTier([r1, r2].map(r => scoreReport(r, nvidiaSystem)));
    expect(buckets.nvidia[0].score).toBeGreaterThanOrEqual(buckets.nvidia[1].score);
  });
});
