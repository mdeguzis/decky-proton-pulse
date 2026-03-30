// src/lib/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { scoreReport, bucketByGpuTier, WEIGHTS } from './scoring';
import type { ProtonDBReport, SystemInfo } from '../types';

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

const platinumNvidiaRecent: ProtonDBReport = {
  timestamp: now - 30 * 86400,
  rating: 'platinum',
  protonVersion: 'GE-Proton9-7',
  notes: 'Perfect',
  responses: { gpu: 'NVIDIA GeForce RTX 3080', gpuDriver: '545.29.06' },
};

const goldAmdOld: ProtonDBReport = {
  timestamp: now - 400 * 86400,
  rating: 'gold',
  protonVersion: 'Proton 9.0',
  notes: 'Minor issues',
  responses: { gpu: 'AMD Radeon RX 7900 XTX' },
};

const bronzeUnknownMid: ProtonDBReport = {
  timestamp: now - 180 * 86400,
  rating: 'bronze',
  protonVersion: 'Proton 8.0',
  notes: 'Playable',
  responses: {},
};

describe('scoreReport', () => {
  it('gives higher score to NVIDIA report on NVIDIA system than AMD report', () => {
    const nvidiaScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const amdScore = scoreReport(goldAmdOld, nvidiaSystem).score;
    expect(nvidiaScore).toBeGreaterThan(amdScore);
  });

  it('applies GPU match multiplier 1.0 for same vendor', () => {
    const scored = scoreReport(platinumNvidiaRecent, nvidiaSystem);
    expect(scored.gpuTier).toBe('nvidia');
    expect(scored.score).toBeGreaterThan(0);
  });

  it('applies GPU mismatch multiplier 0.5 for different vendor', () => {
    const nvidiaScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const amdSysScore = scoreReport(platinumNvidiaRecent, {
      ...nvidiaSystem, gpu_vendor: 'amd'
    }).score;
    expect(nvidiaScore).toBeGreaterThan(amdSysScore);
    expect(amdSysScore).toBeGreaterThan(0);
  });

  it('gives recency bonus for reports under 90 days', () => {
    const recentScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const oldReport: ProtonDBReport = { ...platinumNvidiaRecent, timestamp: now - 400 * 86400 };
    const oldScore = scoreReport(oldReport, nvidiaSystem).score;
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('gives custom proton bonus', () => {
    const geScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const vanillaReport: ProtonDBReport = { ...platinumNvidiaRecent, protonVersion: 'Proton 9.0' };
    const vanillaScore = scoreReport(vanillaReport, nvidiaSystem).score;
    expect(geScore).toBeGreaterThan(vanillaScore);
  });

  it('score is never negative', () => {
    const scored = scoreReport(bronzeUnknownMid, nvidiaSystem);
    expect(scored.score).toBeGreaterThanOrEqual(0);
  });

  it('attaches recencyDays to scored report', () => {
    const scored = scoreReport(platinumNvidiaRecent, nvidiaSystem);
    expect(scored.recencyDays).toBeGreaterThan(25);
    expect(scored.recencyDays).toBeLessThan(35);
  });
});

describe('bucketByGpuTier', () => {
  it('separates nvidia and amd reports into correct buckets', () => {
    const scored = [platinumNvidiaRecent, goldAmdOld].map(r => scoreReport(r, nvidiaSystem));
    const buckets = bucketByGpuTier(scored);
    expect(buckets.nvidia).toHaveLength(1);
    expect(buckets.amd).toHaveLength(1);
    expect(buckets.other).toHaveLength(0);
  });

  it('sorts each bucket by score descending', () => {
    const r1: ProtonDBReport = { ...platinumNvidiaRecent };
    const r2: ProtonDBReport = { ...platinumNvidiaRecent, rating: 'silver', timestamp: now - 500 * 86400 };
    const scored = [r1, r2].map(r => scoreReport(r, nvidiaSystem));
    const buckets = bucketByGpuTier(scored);
    expect(buckets.nvidia[0].score).toBeGreaterThanOrEqual(buckets.nvidia[1].score);
  });
});
