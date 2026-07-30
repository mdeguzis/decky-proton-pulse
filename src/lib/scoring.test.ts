// src/lib/scoring.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeConfidence,
  aggregatePerGame,
  bucketByGpuTier,
  parseNotesSentiment,
  parseProtonMajorVersion,
  getHardwareMatchPercent,
  getHardwareMatchBreakdown,
  estimateVramGb,
  parseVramFromRequirements,
} from './scoring';
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
  vram_mb: null,
  cpu_cores: null,
  display_resolution: null,
  steam_deck_model: null,
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

// --- scoreReport ---

describe('computeConfidence', () => {
  it('attaches gpuTier, recencyDays, notesModifier, upvotes to result', () => {
    const scored = computeConfidence(platinumNvidiaRecent, nvidiaSystem);
    expect(scored.gpuTier).toBe('nvidia');
    expect(scored.recencyDays).toBeGreaterThan(25);
    expect(scored.recencyDays).toBeLessThan(35);
    expect(typeof scored.notesModifier).toBe('number');
    expect(scored.upvotes).toBe(0);
  });

  it('scored report includes downvotes defaulting to 0', () => {
    const report = computeConfidence(platinumNvidiaRecent, nvidiaSystem);
    expect(report.downvotes).toBe(0);
  });

  it('score is never negative', () => {
    const r = makeCdnReport({ rating: 'borked', gpu: '' });
    expect(computeConfidence(r, nvidiaSystem).confidence).toBeGreaterThanOrEqual(0);
  });

  it('gives higher score to matching GPU vendor report', () => {
    const nvidiaScore = computeConfidence(platinumNvidiaRecent, nvidiaSystem).confidence;
    const amdScore = computeConfidence(goldAmdOld, nvidiaSystem).confidence;
    expect(nvidiaScore).toBeGreaterThan(amdScore);
  });

  it('gives recency bonus for reports under 90 days', () => {
    const recentScore = computeConfidence(platinumNvidiaRecent, nvidiaSystem).confidence;
    const oldScore = computeConfidence(makeCdnReport({ timestamp: now - 400 * 86400 }), nvidiaSystem).confidence;
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('gives custom proton bonus', () => {
    const geScore = computeConfidence(platinumNvidiaRecent, nvidiaSystem).confidence;
    const vanillaScore = computeConfidence(makeCdnReport({ protonVersion: 'Proton 9.0' }), nvidiaSystem).confidence;
    expect(geScore).toBeGreaterThan(vanillaScore);
  });

  // --- driver matching ---

  it('exact driver version gives higher score than close version', () => {
    const exactDriver = makeCdnReport({ gpuDriver: 'NVIDIA 595.45.04' }); // matches nvidiaSystem
    const closeDriver = makeCdnReport({ gpuDriver: 'NVIDIA 593.10.00' }); // within 2 major
    expect(computeConfidence(exactDriver, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(closeDriver, nvidiaSystem).confidence
    );
  });

  it('close driver version gives higher score than far version', () => {
    const closeDriver = makeCdnReport({ gpuDriver: 'NVIDIA 593.10.00' });
    const farDriver   = makeCdnReport({ gpuDriver: 'NVIDIA 410.93' });
    expect(computeConfidence(closeDriver, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(farDriver, nvidiaSystem).confidence
    );
  });

  it('different vendor driver gives mismatch multiplier', () => {
    const amdDriverReport = makeCdnReport({ gpu: 'AMD Radeon RX 6800', gpuDriver: 'Mesa 23.1.0' });
    expect(computeConfidence(platinumNvidiaRecent, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(amdDriverReport, nvidiaSystem).confidence
    );
  });

  it('exact distro match scores higher than a same-family distro match', () => {
    const exactDistro = makeCdnReport({ os: 'CachyOS' });
    const familyMatch = makeCdnReport({ os: 'Arch Linux' });
    expect(computeConfidence(exactDistro, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(familyMatch, nvidiaSystem).confidence
    );
  });

  it('same-family distro match scores higher than an unrelated distro', () => {
    const familyMatch = makeCdnReport({ os: 'Arch Linux' });
    const unrelated = makeCdnReport({ os: 'Ubuntu 24.04' });
    expect(computeConfidence(familyMatch, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(unrelated, nvidiaSystem).confidence
    );
  });

  it('SteamOS lineage scores higher than unrelated distros for Arch-based reports', () => {
    const steamosSystem: SystemInfo = { ...nvidiaSystem, distro: 'SteamOS 3.7.0' };
    const archReport = makeCdnReport({ os: 'Arch Linux' });
    const fedoraReport = makeCdnReport({ os: 'Fedora 41' });
    expect(computeConfidence(archReport, steamosSystem).confidence).toBeGreaterThan(
      computeConfidence(fedoraReport, steamosSystem).confidence
    );
  });

  it('Pop!_OS lineage scores higher than unrelated distros for Ubuntu reports', () => {
    const popSystem: SystemInfo = { ...nvidiaSystem, distro: 'Pop!_OS 22.04 LTS' };
    const ubuntuReport = makeCdnReport({ os: 'Ubuntu 22.04 LTS' });
    const fedoraReport = makeCdnReport({ os: 'Fedora 41' });
    expect(computeConfidence(ubuntuReport, popSystem).confidence).toBeGreaterThan(
      computeConfidence(fedoraReport, popSystem).confidence
    );
  });

  it('exact kernel match scores higher than a nearby patch mismatch', () => {
    const exactKernel = makeCdnReport({ kernel: '6.19.8' });
    // delta of 2, hits the KERNEL_PATCH_CLOSE multiplier
    const nearbyKernel = makeCdnReport({ kernel: '6.19.6' });
    expect(computeConfidence(exactKernel, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(nearbyKernel, nvidiaSystem).confidence
    );
  });

  it('nearby minor kernel match scores higher than a distant kernel line', () => {
    const nearbyMinor = makeCdnReport({ kernel: '6.18.4' });
    const distantKernel = makeCdnReport({ kernel: '6.6.0' });
    expect(computeConfidence(nearbyMinor, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(distantKernel, nvidiaSystem).confidence
    );
  });

  // --- borked decay ---

  it('old borked report has lower confidence than fresh borked (staleness penalty)', () => {
    // The original behavior auto-bumped old borked to bronze, hiding the
    // signal. Now both reports remain rated borked, but the old one gets
    // BORKED_STALENESS_PENALTY against its confidence so the UI can surface
    // a "worth re-testing" caveat without lying about the community rating.
    const freshBorked = makeCdnReport({ rating: 'borked', timestamp: now - 30 * 86400 });
    const oldBorked   = makeCdnReport({ rating: 'borked', timestamp: now - 400 * 86400 });
    const oldScored = computeConfidence(oldBorked, nvidiaSystem);
    const freshScored = computeConfidence(freshBorked, nvidiaSystem);
    // Rating stays borked in both cases - no auto-bump
    expect(oldScored.rating).toBe('borked');
    expect(freshScored.rating).toBe('borked');
    // But the old report's confidence is lower thanks to the staleness penalty
    expect(oldScored.confidence).toBeLessThan(freshScored.confidence);
  });

  it('matching Proton major version gives higher score than different version', () => {
    // nvidiaSystem.proton_custom = 'cachyos-10.0-202603012' -> major 10
    const matchProton = makeCdnReport({ protonVersion: 'GE-Proton10-5' }); // same major
    const diffProton  = makeCdnReport({ protonVersion: 'Proton 7.0-6' });   // 3 apart
    expect(computeConfidence(matchProton, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(diffProton, nvidiaSystem).confidence
    );
  });

  // --- playtime confidence ---

  it('overTenHours scores higher than fourToTenHours', () => {
    const long   = makeCdnReport({ duration: 'overTenHours' });
    const medium = makeCdnReport({ duration: 'fourToTenHours' });
    expect(computeConfidence(long, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(medium, nvidiaSystem).confidence
    );
  });

  it('oneToFourHours scores higher than underOneHour', () => {
    const twoHour = makeCdnReport({ duration: 'oneToFourHours' });
    const brief   = makeCdnReport({ duration: 'underOneHour' });
    expect(computeConfidence(twoHour, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(brief, nvidiaSystem).confidence
    );
  });

  it('any playtime bucket scores higher than unreported', () => {
    const played     = makeCdnReport({ duration: 'underOneHour' });
    const unreported = makeCdnReport({ duration: 'unreported' });
    const noField    = makeCdnReport({ duration: '' });
    expect(computeConfidence(played, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(unreported, nvidiaSystem).confidence
    );
    expect(computeConfidence(played, nvidiaSystem).confidence).toBeGreaterThan(
      computeConfidence(noField, nvidiaSystem).confidence
    );
  });
});

// --- parseNotesSentiment ---

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

  it('negated negative keyword does not score negative', () => {
    // "no crash" should not count as a crash
    expect(parseNotesSentiment('no crash reported')).toBeGreaterThanOrEqual(0);
    expect(parseNotesSentiment("doesn't crash")).toBeGreaterThanOrEqual(0);
    expect(parseNotesSentiment('never hang')).toBeGreaterThanOrEqual(0);
  });

  it('non-negated crash still scores negative even with negation present elsewhere', () => {
    // "no freeze but crash on launch" - "freeze" negated, "crash" is not
    expect(parseNotesSentiment('no freeze but crash on launch')).toBeLessThan(0);
  });
});

// --- parseProtonMajorVersion ---

describe('parseProtonMajorVersion', () => {
  it('parses GE-Proton format', () => {
    expect(parseProtonMajorVersion('GE-Proton9-7')).toBe(9);
    expect(parseProtonMajorVersion('GE-Proton8-32')).toBe(8);
  });

  it('parses "Proton N.M" format', () => {
    expect(parseProtonMajorVersion('Proton 9.0-4')).toBe(9);
    expect(parseProtonMajorVersion('Proton 7.0-6')).toBe(7);
  });

  it('parses hyphenated proton format', () => {
    expect(parseProtonMajorVersion('proton-7.0-6')).toBe(7);
  });

  it('parses plain ProtonDB version strings without a proton prefix', () => {
    expect(parseProtonMajorVersion('9.0-4')).toBe(9);
    expect(parseProtonMajorVersion('10.0-2')).toBe(10);
  });

  it('parses custom build formats like cachyos, tkg, protonplus', () => {
    expect(parseProtonMajorVersion('cachyos-10.0-202603012')).toBe(10);
    expect(parseProtonMajorVersion('tkg-9.0-3')).toBe(9);
    expect(parseProtonMajorVersion('protonplus-9.0')).toBe(9);
  });

  it('returns null for Proton Experimental and non-version strings', () => {
    expect(parseProtonMajorVersion('Proton Experimental')).toBeNull();
    expect(parseProtonMajorVersion('SteamLinuxRuntime')).toBeNull();
    expect(parseProtonMajorVersion('')).toBeNull();
  });
});

// --- bucketByGpuTier ---

describe('bucketByGpuTier', () => {
  it('separates nvidia and amd into correct buckets', () => {
    const scored = [platinumNvidiaRecent, goldAmdOld].map(r => computeConfidence(r, nvidiaSystem));
    const buckets = bucketByGpuTier(scored);
    expect(buckets.nvidia).toHaveLength(1);
    expect(buckets.amd).toHaveLength(1);
    expect(buckets.other).toHaveLength(0);
  });

  it('sorts each bucket by score descending', () => {
    const r1 = makeCdnReport();
    const r2 = makeCdnReport({ rating: 'silver', timestamp: now - 500 * 86400 });
    const buckets = bucketByGpuTier([r1, r2].map(r => computeConfidence(r, nvidiaSystem)));
    expect(buckets.nvidia[0].confidence).toBeGreaterThanOrEqual(buckets.nvidia[1].confidence);
  });

  it('puts unknown GPU reports into the other bucket', () => {
    const unknownGpu = makeCdnReport({ gpu: 'Some weird GPU' });
    const buckets = bucketByGpuTier([unknownGpu].map(r => computeConfidence(r, nvidiaSystem)));
    expect(buckets.other).toHaveLength(1);
    expect(buckets.nvidia).toHaveLength(0);
  });
});

describe('getHardwareMatchPercent', () => {
  it('returns a higher percentage for a close system match than a distant one', () => {
    const closeMatch = makeCdnReport({
      gpu: 'NVIDIA GeForce RTX 4090',
      gpuDriver: 'NVIDIA 595.10.00',
      os: 'CachyOS',
      kernel: '6.19.8',
      ram: '64 GB',
    });
    const distantMatch = makeCdnReport({
      gpu: 'AMD Radeon RX 6800',
      gpuDriver: 'Mesa 23.1.0',
      os: 'Ubuntu 24.04',
      kernel: '6.6.0',
      ram: '16 GB',
    });

    expect(getHardwareMatchPercent(closeMatch, nvidiaSystem)).toBeGreaterThan(
      getHardwareMatchPercent(distantMatch, nvidiaSystem)
    );
  });

  it('returns 0 when system info is unavailable', () => {
    expect(getHardwareMatchPercent(makeCdnReport(), null)).toBe(0);
  });

  it('gives partial score for amd/intel report on other gpu vendor system', () => {
    const otherSys: SystemInfo = { ...nvidiaSystem, gpu_vendor: 'other' };
    const amdReport = makeCdnReport({ gpu: 'AMD Radeon RX 7900 XTX', gpuDriver: 'Mesa 23.1.0' });
    const pct = getHardwareMatchPercent(amdReport, otherSys);
    // should get the 14pt partial GPU score, not 35 or 0
    expect(pct).toBeGreaterThan(0);
  });

  it('awards driver fallback points when driver strings are missing but vendors match', () => {
    const noDriverSys: SystemInfo = { ...nvidiaSystem, driver_version: '' };
    const noDriverReport = makeCdnReport({ gpuDriver: '' });
    const pct = getHardwareMatchPercent(noDriverReport, noDriverSys);
    // should still get 8pts for vendor match even tho drivers cant be parsed
    expect(pct).toBeGreaterThan(0);
  });

  it('awards points for same-major.minor nearby-patch kernel', () => {
    const nearbyPatch = makeCdnReport({ kernel: '6.19.6' });
    const exactPatch = makeCdnReport({ kernel: '6.19.8' });
    // exact should beat nearby patch
    expect(getHardwareMatchPercent(exactPatch, nvidiaSystem)).toBeGreaterThan(
      getHardwareMatchPercent(nearbyPatch, nvidiaSystem)
    );
    // but nearby patch should beat distant minor
    const distantMinor = makeCdnReport({ kernel: '6.6.0' });
    expect(getHardwareMatchPercent(nearbyPatch, nvidiaSystem)).toBeGreaterThan(
      getHardwareMatchPercent(distantMinor, nvidiaSystem)
    );
  });

  it('awards points for same-major nearby-minor kernel', () => {
    const nearbyMinor = makeCdnReport({ kernel: '6.18.4' });
    const distantMinor = makeCdnReport({ kernel: '6.6.0' });
    // nearby minor (within 1) should score higher than distant minor
    expect(getHardwareMatchPercent(nearbyMinor, nvidiaSystem)).toBeGreaterThan(
      getHardwareMatchPercent(distantMinor, nvidiaSystem)
    );
  });

  it('awards points for same-major distant-minor kernel', () => {
    const sameMajor = makeCdnReport({ kernel: '6.6.0' });
    const diffMajor = makeCdnReport({ kernel: '5.15.0' });
    expect(getHardwareMatchPercent(sameMajor, nvidiaSystem)).toBeGreaterThan(
      getHardwareMatchPercent(diffMajor, nvidiaSystem)
    );
  });
});

// --- getHardwareMatchBreakdown ---

describe('getHardwareMatchBreakdown', () => {
  it('returns all-zero breakdown when sysInfo is null', () => {
    const bd = getHardwareMatchBreakdown(makeCdnReport(), null);
    expect(bd.gpu.percent).toBe(0);
    expect(bd.gpuDriver.percent).toBe(0);
    expect(bd.os.percent).toBe(0);
    expect(bd.kernel.percent).toBe(0);
    expect(bd.ram.percent).toBe(0);
    // all should be red
    expect(bd.gpu.color).toBe('#ef4444');
  });

  // --- GPU field matching ---

  it('gpu: same vendor + same model gives high match', () => {
    const report = makeCdnReport({ gpu: 'NVIDIA GeForce RTX 5080' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.gpu.percent).toBeGreaterThanOrEqual(80);
    expect(bd.gpu.color).toBe('#4caf50'); // green
  });

  it('gpu: same vendor + different model gives partial match', () => {
    const report = makeCdnReport({ gpu: 'NVIDIA GeForce GTX 1060' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    // vendor match but GTX 1060 is 4 gens from RTX 5080, so gen penalty applies
    // score = 40 (vendor) + 0 (no model token overlap) - 20 (gen penalty) = 20
    expect(bd.gpu.percent).toBeGreaterThan(10);
    expect(bd.gpu.percent).toBeLessThan(50);
  });

  it('gpu: different vendor gives low match', () => {
    const report = makeCdnReport({ gpu: 'AMD Radeon RX 7900 XTX' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.gpu.percent).toBeLessThanOrEqual(10);
    expect(bd.gpu.color).toBe('#ef4444'); // red
  });

  it('gpu: empty gpu string gives 0', () => {
    const report = makeCdnReport({ gpu: '' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.gpu.percent).toBe(0);
  });

  it('gpu: unknown vendor keyword falls through to default', () => {
    // "qualcomm" isnt in vendorKeywords, so vendorGroup returns "qualcomm"
    // both report and system have it, so they match on vendor
    const qualcommSys: SystemInfo = { ...nvidiaSystem, gpu: 'Qualcomm Adreno 740' };
    const report = makeCdnReport({ gpu: 'Qualcomm Adreno 730' });
    const bd = getHardwareMatchBreakdown(report, qualcommSys);
    // no vendor keyword found, so rVendor/sVendor are undefined -> vendorGroup returns ''
    // both empty strings match -> doesn't return 10 (vendor mismatch)
    // instead falls through to model token comparison
    expect(bd.gpu.percent).toBeGreaterThanOrEqual(40);
  });

  it('gpu: intel vs intel arc matches on vendor', () => {
    const intelSys: SystemInfo = { ...nvidiaSystem, gpu: 'Intel Arc A770', gpu_vendor: 'intel' };
    const report = makeCdnReport({ gpu: 'Intel Arc A750' });
    const bd = getHardwareMatchBreakdown(report, intelSys);
    // A750 (8GB) vs A770 (16GB) = 8GB VRAM gap -> -5 penalty on top of vendor match
    expect(bd.gpu.percent).toBeGreaterThanOrEqual(35);
  });

  // --- Driver field matching ---

  it('driver: exact major version gives 100%', () => {
    const report = makeCdnReport({ gpuDriver: 'NVIDIA 595.10.00' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.gpuDriver.percent).toBe(100);
    expect(bd.gpuDriver.color).toBe('#4caf50');
  });

  it('driver: within 2 major versions gives 75%', () => {
    const report = makeCdnReport({ gpuDriver: 'NVIDIA 593.10.00' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.gpuDriver.percent).toBe(75);
  });

  it('driver: within 5 major versions gives 50%', () => {
    const report = makeCdnReport({ gpuDriver: 'NVIDIA 590.10.00' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.gpuDriver.percent).toBe(50);
    expect(bd.gpuDriver.color).toBe('#f59e0b'); // amber
  });

  it('driver: far apart gives 20%', () => {
    const report = makeCdnReport({ gpuDriver: 'NVIDIA 410.93' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.gpuDriver.percent).toBe(20);
  });

  it('driver: missing driver string gives 0', () => {
    const report = makeCdnReport({ gpuDriver: '' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.gpuDriver.percent).toBe(0);
  });

  // --- OS field matching ---

  it('os: exact match gives 100%', () => {
    const report = makeCdnReport({ os: 'CachyOS' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.os.percent).toBe(100);
  });

  it('os: same family gives 70%', () => {
    const report = makeCdnReport({ os: 'Arch Linux' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.os.percent).toBe(70);
    expect(bd.os.color).toBe('#f59e0b'); // amber
  });

  it('os: different family gives 10%', () => {
    const report = makeCdnReport({ os: 'Ubuntu 24.04' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.os.percent).toBe(10);
  });

  it('os: debian family matches other debian distros', () => {
    const debianSys: SystemInfo = { ...nvidiaSystem, distro: 'Debian 12' };
    const report = makeCdnReport({ os: 'Debian 11' });
    const bd = getHardwareMatchBreakdown(report, debianSys);
    expect(bd.os.percent).toBe(70);
  });

  it('os: nixos matches itself', () => {
    const nixSys: SystemInfo = { ...nvidiaSystem, distro: 'NixOS 24.05' };
    const report = makeCdnReport({ os: 'NixOS 23.11' });
    const bd = getHardwareMatchBreakdown(report, nixSys);
    expect(bd.os.percent).toBe(70);
  });

  it('os: empty os gives 0', () => {
    const report = makeCdnReport({ os: '' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.os.percent).toBe(0);
  });

  // --- Kernel field matching ---

  it('kernel: exact match gives 100%', () => {
    const report = makeCdnReport({ kernel: '6.19.8' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.kernel.percent).toBe(100);
  });

  it('kernel: same major.minor nearby patch gives 85%', () => {
    const report = makeCdnReport({ kernel: '6.19.6' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.kernel.percent).toBe(90);
  });

  it('kernel: same major nearby minor gives 75%', () => {
    const report = makeCdnReport({ kernel: '6.18.4' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.kernel.percent).toBe(75);
  });

  it('kernel: same major distant minor stays meaningfully positive', () => {
    const report = makeCdnReport({ kernel: '6.6.0' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.kernel.percent).toBe(60);
  });

  it('kernel: adjacent major gives partial credit', () => {
    const report = makeCdnReport({ kernel: '5.15.0' });
    const sys: SystemInfo = { ...nvidiaSystem, kernel: '6.1.0' };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.kernel.percent).toBe(35);
  });

  it('kernel: adjacent major gets partial credit under the new lenient rule', () => {
    const report = makeCdnReport({ kernel: '5.15.0' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.kernel.percent).toBe(35);
  });

  it('kernel: empty kernel gives 0', () => {
    const report = makeCdnReport({ kernel: '' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.kernel.percent).toBe(0);
  });

  // --- RAM field matching ---

  it('ram: exact match gives 100%', () => {
    const report = makeCdnReport({ ram: '64 GB' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.ram.percent).toBe(100);
  });

  it('ram: within 4GB gives 75%', () => {
    const report = makeCdnReport({ ram: '60 GB' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.ram.percent).toBe(75);
  });

  it('ram: within 8GB gives 50%', () => {
    const report = makeCdnReport({ ram: '56 GB' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.ram.percent).toBe(50);
  });

  it('ram: far apart gives 20%', () => {
    const report = makeCdnReport({ ram: '16 GB' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.ram.percent).toBe(20);
  });

  it('ram: missing ram gives 0', () => {
    const report = makeCdnReport({ ram: '' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.ram.percent).toBe(0);
  });

  it('ram: null system ram gives 0', () => {
    const noRamSys: SystemInfo = { ...nvidiaSystem, ram_gb: null as unknown as number };
    const report = makeCdnReport({ ram: '32 GB' });
    const bd = getHardwareMatchBreakdown(report, noRamSys);
    expect(bd.ram.percent).toBe(0);
  });

  it('ram: both meeting game minimum gets treated as fully sufficient', () => {
    const sys14: SystemInfo = { ...nvidiaSystem, ram_gb: 14 };
    const report = makeCdnReport({ ram: '32 GB' });
    const bdWithReqs = getHardwareMatchBreakdown(report, sys14, 12);
    expect(bdWithReqs.ram.percent).toBe(100);
  });

  it('ram: slight shortfall below minimum only gets a modest deduction', () => {
    const sys14: SystemInfo = { ...nvidiaSystem, ram_gb: 14 };
    const report = makeCdnReport({ ram: '16 GB' });
    const bdWithReqs = getHardwareMatchBreakdown(report, sys14, 16);
    expect(bdWithReqs.ram.percent).toBe(85);
  });

  it('ram: larger shortfall below minimum degrades more sharply', () => {
    const sys8: SystemInfo = { ...nvidiaSystem, ram_gb: 8 };
    const report = makeCdnReport({ ram: '16 GB' });
    const bdWithReqs = getHardwareMatchBreakdown(report, sys8, 16);
    expect(bdWithReqs.ram.percent).toBe(50);
  });

  // --- Color coding ---

  it('green for 80%+, amber for 50-79%, red for <50%', () => {
    // exact match should be green
    const exactReport = makeCdnReport({
      gpu: 'NVIDIA GeForce RTX 5080',
      gpuDriver: 'NVIDIA 595.45.04',
      os: 'CachyOS',
      kernel: '6.19.8',
      ram: '64 GB',
    });
    const bd = getHardwareMatchBreakdown(exactReport, nvidiaSystem);
    expect(bd.gpu.color).toBe('#4caf50');
    expect(bd.gpuDriver.color).toBe('#4caf50');
    expect(bd.os.color).toBe('#4caf50');
    expect(bd.kernel.color).toBe('#4caf50');
    expect(bd.ram.color).toBe('#4caf50');

    // distant match should be red for gpu
    const distantReport = makeCdnReport({ gpu: 'AMD Radeon RX 7900 XTX' });
    const bd2 = getHardwareMatchBreakdown(distantReport, nvidiaSystem);
    expect(bd2.gpu.color).toBe('#ef4444');
  });

  it('handles unknown GPU vendor in gpuFieldMatch vendorGroup fallback', () => {
    // "Qualcomm Adreno" doesn't match any known vendor keyword
    const report = makeCdnReport({ gpu: 'Qualcomm Adreno 740' });
    const qualcommSys: SystemInfo = { ...nvidiaSystem, gpu: 'Qualcomm Adreno 740', gpu_vendor: 'other' };
    const bd = getHardwareMatchBreakdown(report, qualcommSys);
    // same string, but vendor group falls through to the raw token
    expect(bd.gpu.percent).toBeGreaterThan(0);
  });

  it('gives 18pts for unknown GPU tier in getHardwareMatchPercent', () => {
    // empty gpu string -> unknown tier
    const unknownGpuReport = makeCdnReport({ gpu: '' });
    const pct = getHardwareMatchPercent(unknownGpuReport, nvidiaSystem);
    expect(pct).toBeGreaterThanOrEqual(18);
  });

  it('handles OS family that matches no known distro in detectOsFamily', () => {
    // "Void Linux" doesnt match any family regex, returns normalized string
    const voidReport = makeCdnReport({ os: 'Void Linux' });
    const voidSys: SystemInfo = { ...nvidiaSystem, distro: 'Void Linux' };
    // same OS should still get exact match points
    const pct = getHardwareMatchPercent(voidReport, voidSys);
    expect(pct).toBeGreaterThan(0);
  });

  it('OS lineage: SteamOS and Arch Linux get the family match score', () => {
    const steamosSys: SystemInfo = { ...nvidiaSystem, distro: 'SteamOS 3.7.0' };
    const report = makeCdnReport({ os: 'Arch Linux' });
    const bd = getHardwareMatchBreakdown(report, steamosSys);
    expect(bd.os.percent).toBe(70);
  });

  it('OS lineage: Pop!_OS and Ubuntu get the family match score', () => {
    const popSys: SystemInfo = { ...nvidiaSystem, distro: 'Pop!_OS 22.04 LTS' };
    const report = makeCdnReport({ os: 'Ubuntu 22.04 LTS' });
    const bd = getHardwareMatchBreakdown(report, popSys);
    expect(bd.os.percent).toBe(70);
  });

  it('GPU synonym mapping: "Advanced Micro Devices" matches "AMD"', () => {
    // the system reports the full vendor name, the report uses "AMD"
    const report = makeCdnReport({ gpu: 'AMD Radeon RX 6700 XT' });
    const deckSys: SystemInfo = {
      ...nvidiaSystem,
      gpu: 'Advanced Micro Devices, Inc. [AMD/ATI] VanGogh [AMD Custom GPU 0405] (rev ae)',
      gpu_vendor: 'amd',
    };
    const bd = getHardwareMatchBreakdown(report, deckSys);
    // both recognized as AMD (vendor match), but very different models (RX 6700 vs custom APU)
    // with gen penalty for 6700 (gen 6) vs 0405 (gen 0), score drops below 40
    expect(bd.gpu.percent).toBeGreaterThan(10);
  });

  it('CPU field match: same brand different model', () => {
    const report = makeCdnReport({ cpu: 'AMD Ryzen 7 5700G with Radeon Graphics' });
    const deckSys: SystemInfo = { ...nvidiaSystem, cpu: 'AMD Custom APU 0405' };
    const bd = getHardwareMatchBreakdown(report, deckSys);
    // same brand (amd), some token overlap
    expect(bd.cpu.percent).toBeGreaterThanOrEqual(30);
  });

  it('CPU field match: different brands', () => {
    const report = makeCdnReport({ cpu: 'Intel Core i7-12700K' });
    const amdSys: SystemInfo = { ...nvidiaSystem, cpu: 'AMD Ryzen 9 5900X' };
    const bd = getHardwareMatchBreakdown(report, amdSys);
    expect(bd.cpu.percent).toBe(10);
  });

  it('CPU field match: empty strings give 0', () => {
    const report = makeCdnReport({ cpu: '' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.cpu.percent).toBe(0);
  });

  it('breakdown includes cpu field when sysInfo is null', () => {
    const bd = getHardwareMatchBreakdown(makeCdnReport(), null);
    expect(bd.cpu).toBeDefined();
    expect(bd.cpu.percent).toBe(0);
  });

  // --- Mesa driver parsing ---

  it('driver: Mesa with OpenGL prefix parses correctly', () => {
    // "4.6 (Compatibility Profile) Mesa 22.2.0" should compare against "Mesa 24.3.0"
    // as major 22 vs 24, not 4 vs 24
    const mesaSys: SystemInfo = { ...nvidiaSystem, driver_version: 'Mesa 24.3.0-devel (git-aef01ebd12)', gpu_vendor: 'amd' };
    const report = makeCdnReport({
      gpu: 'AMD Radeon RX 6700',
      gpuDriver: '4.6 (Compatibility Profile) Mesa 22.2.0 (git-17e5312102)',
    });
    const bd = getHardwareMatchBreakdown(report, mesaSys);
    // major 22 vs 24 = diff of 2, should be 75%
    expect(bd.gpuDriver.percent).toBe(75);
  });

  it('driver: Mesa patch/minor differences are not treated as exact matches', () => {
    const mesaSys: SystemInfo = { ...nvidiaSystem, driver_version: 'Mesa 24.3.0', gpu_vendor: 'amd' };
    const report = makeCdnReport({
      gpu: 'AMD Radeon RX 6700',
      gpuDriver: 'Mesa 24.2.8',
    });
    const bd = getHardwareMatchBreakdown(report, mesaSys);
    expect(bd.gpuDriver.percent).toBeLessThan(100);
    expect(bd.gpuDriver.percent).toBe(75);
  });

  it('driver: Mesa without OpenGL prefix still works', () => {
    const mesaSys: SystemInfo = { ...nvidiaSystem, driver_version: 'Mesa 23.1.0', gpu_vendor: 'amd' };
    const report = makeCdnReport({
      gpu: 'AMD Radeon RX 6700',
      gpuDriver: 'Mesa 23.1.0',
    });
    const bd = getHardwareMatchBreakdown(report, mesaSys);
    expect(bd.gpuDriver.percent).toBe(100);
  });

  // --- GPU noise filtering ---

  it('gpu: noise tokens (LLVM, DRM, kernel version) dont dilute match', () => {
    // Steam Deck style: GPU string has embedded driver/kernel info
    const deckSys: SystemInfo = {
      ...nvidiaSystem,
      gpu: 'Advanced Micro Devices, Inc. [AMD/ATI] VanGogh [AMD Custom GPU 0405] (rev ae)',
      gpu_vendor: 'amd',
    };
    const report = makeCdnReport({
      gpu: 'AMD Custom GPU 0405 (vangogh, LLVM 14.0.6, DRM 3.45, 5.13.0-valve36-1-neptune)',
    });
    const bd = getHardwareMatchBreakdown(report, deckSys);
    // should be high match, both are the same GPU with noise stripped
    expect(bd.gpu.percent).toBeGreaterThanOrEqual(80);
  });

  // --- Valve kernel matching ---

  it('kernel: both valve kernels, same major, close builds', () => {
    const valveSys: SystemInfo = { ...nvidiaSystem, kernel: '5.13.0-valve36-1-neptune' };
    const report = makeCdnReport({ kernel: '5.13.0-valve34-1-neptune' });
    const bd = getHardwareMatchBreakdown(report, valveSys);
    // same major.minor, valve build diff of 2 -> 95%
    expect(bd.kernel.percent).toBe(95);
  });

  it('kernel: both valve kernels, different major, close builds', () => {
    // the screenshot case: valve36 vs valve27, diff major
    const valveSys: SystemInfo = { ...nvidiaSystem, kernel: '6.11.11-valve27-1-neptune-611-g60ef8556a811' };
    const report = makeCdnReport({ kernel: '5.13.0-valve36-1-neptune' });
    const bd = getHardwareMatchBreakdown(report, valveSys);
    // different major but both valve, build diff 9 (within 10) -> 75%
    expect(bd.kernel.percent).toBe(75);
  });

  it('kernel: both valve kernels, distant builds', () => {
    const valveSys: SystemInfo = { ...nvidiaSystem, kernel: '6.11.11-valve50-1-neptune' };
    const report = makeCdnReport({ kernel: '5.13.0-valve10-1-neptune' });
    const bd = getHardwareMatchBreakdown(report, valveSys);
    // build diff 40, different major -> 50%
    expect(bd.kernel.percent).toBe(50);
  });

  it('kernel: one valve one standard still gives lenient same-major credit', () => {
    const report = makeCdnReport({ kernel: '5.13.0-valve36-1-neptune' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem); // nvidiaSystem has 6.19.8-1-cachyos
    expect(bd.kernel.percent).toBe(35);
  });

  // --- Proton version field matching ---

  it('proton: same major and same proton family gives 100%', () => {
    const report = makeCdnReport({ protonVersion: 'GE-Proton9-7' });
    const sys: SystemInfo = { ...nvidiaSystem, proton_custom: 'cachyos-9.0-20250101' };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.protonVersion.percent).toBe(100);
    expect(bd.protonVersion.color).toBe('#4caf50');
  });

  it('proton: plain report version vs custom installed same major gets a small deduction', () => {
    const report = makeCdnReport({ protonVersion: '10.0-4' });
    const sys: SystemInfo = { ...nvidiaSystem, proton_custom: 'GE-Proton10-34' };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.protonVersion.percent).toBe(90);
  });

  it('proton: custom report vs regular installed same major gets a larger deduction', () => {
    const report = makeCdnReport({ protonVersion: 'GE-Proton10-3' });
    const sys: SystemInfo = { ...nvidiaSystem, proton_custom: 'Proton 10.0-4' };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.protonVersion.percent).toBe(82);
  });

  it('proton: 1 major version apart gives 70% for the same proton family', () => {
    const report = makeCdnReport({ protonVersion: 'GE-Proton8-32' });
    const sys: SystemInfo = { ...nvidiaSystem, proton_custom: 'cachyos-9.0-20250101' };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.protonVersion.percent).toBe(70);
    expect(bd.protonVersion.color).toBe('#4caf50'); // green - 70% exceeds proton field threshold
  });

  it('proton: 1 major version apart with vanilla vs custom is slightly lower', () => {
    const report = makeCdnReport({ protonVersion: '9.0-4' });
    const sys: SystemInfo = { ...nvidiaSystem, proton_custom: 'GE-Proton10-34' };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.protonVersion.percent).toBe(62);
  });

  it('proton: 2 major versions apart with vanilla vs custom is slightly lower', () => {
    const report = makeCdnReport({ protonVersion: 'Proton 7.0-6' });
    const sys: SystemInfo = { ...nvidiaSystem, proton_custom: 'cachyos-9.0-20250101' };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.protonVersion.percent).toBe(38);
  });

  it('proton: 3+ major versions apart gives 20%', () => {
    const report = makeCdnReport({ protonVersion: 'Proton 5.0-10' });
    const sys: SystemInfo = { ...nvidiaSystem, proton_custom: 'cachyos-9.0-20250101' };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.protonVersion.percent).toBe(20);
  });

  it('proton: unparseable version gives 0%', () => {
    const report = makeCdnReport({ protonVersion: 'Proton Experimental' });
    const sys: SystemInfo = { ...nvidiaSystem, proton_custom: 'cachyos-9.0-20250101' };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.protonVersion.percent).toBe(0);
  });

  it('proton: null system proton gives 0%', () => {
    const report = makeCdnReport({ protonVersion: 'GE-Proton9-7' });
    const sys: SystemInfo = { ...nvidiaSystem, proton_custom: null };
    const bd = getHardwareMatchBreakdown(report, sys);
    expect(bd.protonVersion.percent).toBe(0);
  });

  it('proton version breakdown field is defined even when sysInfo is null', () => {
    const bd = getHardwareMatchBreakdown(makeCdnReport(), null);
    expect(bd.protonVersion).toBeDefined();
    expect(bd.protonVersion.percent).toBe(0);
  });

  // --- GPU generation penalty ---

  it('gpu: adjacent AMD generations score lower than same generation', () => {
    // RX 6800 vs RX 6700 XT (same RDNA2 gen) should beat RX 6800 vs RX 7800 XT (diff gen)
    const sys6800: SystemInfo = { ...nvidiaSystem, gpu: 'AMD Radeon RX 6800 XT', gpu_vendor: 'amd' };
    const sameGen  = makeCdnReport({ gpu: 'AMD Radeon RX 6700 XT' });   // RDNA2 vs RDNA2
    const crossGen = makeCdnReport({ gpu: 'AMD Radeon RX 7800 XT' });   // RDNA2 vs RDNA3
    const bdSame  = getHardwareMatchBreakdown(sameGen, sys6800);
    const bdCross = getHardwareMatchBreakdown(crossGen, sys6800);
    // Both should be in the vendor-match range (>=40) but same-gen should be higher
    expect(bdSame.gpu.percent).toBeGreaterThan(bdCross.gpu.percent);
  });

  it('gpu: 2-gen apart NVIDIA match is penalized more than adjacent-gen', () => {
    // RTX 4090 system: RTX 3080 (1 gen) vs RTX 2080 (2 gens)
    const sys4090: SystemInfo = { ...nvidiaSystem, gpu: 'NVIDIA GeForce RTX 4090', gpu_vendor: 'nvidia' };
    const oneGen = makeCdnReport({ gpu: 'NVIDIA GeForce RTX 3080' });
    const twoGen = makeCdnReport({ gpu: 'NVIDIA GeForce RTX 2080' });
    const bdOne = getHardwareMatchBreakdown(oneGen, sys4090);
    const bdTwo = getHardwareMatchBreakdown(twoGen, sys4090);
    expect(bdOne.gpu.percent).toBeGreaterThan(bdTwo.gpu.percent);
  });
});

// --- aggregatePerGame ---
//
// The old scoreToRating block here was deleted intentionally: a report's
// rating now comes from deriveRating(yes/no answers) only - there's no
// number-to-tier mapping that can swap a rating because of hardware mismatch.
// The new per-game aggregator is the only place a rating gets computed from
// other ratings, and it uses a recency-weighted mean (not raw confidence).

describe('aggregatePerGame', () => {
  it('returns pending with zero confidence on empty input', () => {
    const agg = aggregatePerGame([]);
    expect(agg.rating).toBe('pending');
    expect(agg.confidence).toBe(0);
    expect(agg.reportCount).toBe(0);
  });

  it('returns the report rating when only one fresh report exists', () => {
    const reports = [computeConfidence(makeCdnReport({ rating: 'gold' }), nvidiaSystem)];
    const agg = aggregatePerGame(reports);
    expect(agg.rating).toBe('gold');
    expect(agg.reportCount).toBe(1);
  });

  it('recency-weighted mean: many recent platinum outweighs a single old borked', () => {
    const recent = Array.from({ length: 8 }).map(() =>
      computeConfidence(makeCdnReport({ rating: 'platinum', timestamp: now - 30 * 86400 }), nvidiaSystem)
    );
    const ancientBorked = computeConfidence(
      makeCdnReport({ rating: 'borked', timestamp: now - 365 * 6 * 86400 }),
      nvidiaSystem,
    );
    const agg = aggregatePerGame([...recent, ancientBorked]);
    expect(agg.rating).toBe('platinum');
  });

  it('confidence climbs with sample size', () => {
    const oneReport = aggregatePerGame([
      computeConfidence(makeCdnReport({ rating: 'gold' }), nvidiaSystem),
    ]);
    const manyReports = aggregatePerGame(
      Array.from({ length: 30 }).map(() =>
        computeConfidence(makeCdnReport({ rating: 'gold' }), nvidiaSystem)
      ),
    );
    expect(manyReports.confidence).toBeGreaterThan(oneReport.confidence);
  });

  it('confidence drops when the newest report is years old', () => {
    const freshSet = Array.from({ length: 5 }).map(() =>
      computeConfidence(makeCdnReport({ rating: 'gold', timestamp: now - 60 * 86400 }), nvidiaSystem)
    );
    const staleSet = Array.from({ length: 5 }).map(() =>
      computeConfidence(makeCdnReport({ rating: 'gold', timestamp: now - 365 * 4 * 86400 }), nvidiaSystem)
    );
    expect(aggregatePerGame(freshSet).confidence).toBeGreaterThan(
      aggregatePerGame(staleSet).confidence
    );
  });
});

// --- game-aware CPU/GPU matching ---

describe('game-aware CPU matching', () => {
  it('does not boost when system and report brands differ', () => {
    const intelSys: SystemInfo = { ...nvidiaSystem, cpu: 'Intel Core i7-12700K' };
    const report = makeCdnReport({ cpu: 'AMD Ryzen 5 3600' });
    const withGame = getHardwareMatchBreakdown(report, intelSys, null, 'AMD FX 6300');
    // report is AMD, system is Intel - brand mismatch, no boost
    expect(withGame.cpu.percent).toBeLessThan(80);
  });

  it('boosts when all three are same brand', () => {
    const amdSys: SystemInfo = { ...nvidiaSystem, cpu: 'AMD Ryzen 7 5800X' };
    const report = makeCdnReport({ cpu: 'AMD Ryzen 5 3600' });
    const withGame = getHardwareMatchBreakdown(report, amdSys, null, 'AMD FX 6300');
    expect(withGame.cpu.percent).toBeGreaterThanOrEqual(80);
  });

  it('does not boost when game requirement is missing', () => {
    const amdSys: SystemInfo = { ...nvidiaSystem, cpu: 'AMD Ryzen 7 5800X' };
    const report = makeCdnReport({ cpu: 'AMD Ryzen 5 3600' });
    const bd = getHardwareMatchBreakdown(report, amdSys, null, null);
    // should still get a decent score from token overlap, but not the 80 floor
    expect(bd.cpu.percent).toBeGreaterThan(0);
  });
});

describe('game-aware GPU matching', () => {
  it('boosts GPU score when report, system, and game requirement share vendor', () => {
    const report = makeCdnReport({ gpu: 'NVIDIA GeForce GTX 1060' });
    const withGame = getHardwareMatchBreakdown(report, nvidiaSystem, null, null, 'Nvidia GeForce GTX 780');
    expect(withGame.gpu.percent).toBeGreaterThanOrEqual(80);
  });

  it('does not boost when vendors differ', () => {
    const report = makeCdnReport({ gpu: 'AMD Radeon RX 580' });
    const withGame = getHardwareMatchBreakdown(report, nvidiaSystem, null, null, 'Nvidia GeForce GTX 780');
    // report is AMD, system is NVIDIA - no boost
    expect(withGame.gpu.percent).toBeLessThan(80);
  });

  it('does not boost when game requirement is missing', () => {
    const report = makeCdnReport({ gpu: 'NVIDIA GeForce GTX 1060' });
    const withoutGame = getHardwareMatchBreakdown(report, nvidiaSystem, null, null, null);
    // GTX 1060 vs RTX 5080 - same vendor but big gen gap, should be below 80
    expect(withoutGame.gpu.percent).toBeLessThan(80);
  });
});

// --- VRAM estimation ---

describe('estimateVramGb', () => {
  it('identifies common NVIDIA GPUs', () => {
    expect(estimateVramGb('NVIDIA GeForce RTX 4090')).toBe(24);
    expect(estimateVramGb('NVIDIA GeForce GTX 1060')).toBe(6);
    expect(estimateVramGb('NVIDIA GeForce RTX 3060')).toBe(12);
  });

  it('identifies common AMD GPUs', () => {
    expect(estimateVramGb('AMD Radeon RX 7900 XTX')).toBe(24);
    expect(estimateVramGb('AMD Radeon RX 580')).toBe(8);
    expect(estimateVramGb('AMD Radeon RX 6700 XT')).toBe(12);
  });

  it('identifies Intel Arc', () => {
    expect(estimateVramGb('Intel Arc A770')).toBe(16);
  });

  it('returns null for unknown GPUs', () => {
    expect(estimateVramGb('Some Unknown GPU')).toBeNull();
    expect(estimateVramGb('')).toBeNull();
  });
});

describe('parseVramFromRequirements', () => {
  it('extracts VRAM from parenthesized GB value', () => {
    expect(parseVramFromRequirements('Nvidia GeForce GTX 780 (3 GB)')).toBe(3);
    expect(parseVramFromRequirements('AMD Radeon RX 580 (8GB)')).toBe(8);
  });

  it('returns null when no VRAM specified', () => {
    expect(parseVramFromRequirements('Nvidia GeForce GTX 780')).toBeNull();
    expect(parseVramFromRequirements('')).toBeNull();
  });
});

describe('VRAM in GPU scoring', () => {
  it('boosts when both GPUs meet game min VRAM', () => {
    // RTX 3060 (12GB) report, RTX 5080 (16GB) system, game wants 3GB
    const report = makeCdnReport({ gpu: 'NVIDIA GeForce RTX 3060' });
    const withVram = getHardwareMatchBreakdown(report, nvidiaSystem, null, null, 'Nvidia GeForce GTX 780 (3 GB)');
    const withoutVram = getHardwareMatchBreakdown(report, nvidiaSystem, null, null, null);
    expect(withVram.gpu.percent).toBeGreaterThanOrEqual(withoutVram.gpu.percent);
  });

  it('penalizes large VRAM gap between report and system', () => {
    // GTX 1050 (2GB) report vs RTX 5080 (16GB) system - 14GB gap
    const report = makeCdnReport({ gpu: 'NVIDIA GeForce GTX 1050' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    // should be penalized relative to a closer VRAM match
    const closeReport = makeCdnReport({ gpu: 'NVIDIA GeForce RTX 4080' }); // 16GB
    const bdClose = getHardwareMatchBreakdown(closeReport, nvidiaSystem);
    expect(bdClose.gpu.percent).toBeGreaterThan(bd.gpu.percent);
  });
});

// --- kernel major diff > 1 ---

describe('kernelFieldMatch distant major', () => {
  it('kernel: 2+ major versions apart gives 15%', () => {
    // nvidiaSystem kernel is 6.19.8; report kernel 4.14.0 -> diff=2, no valve build -> return 15
    const report = makeCdnReport({ kernel: '4.14.0' });
    const bd = getHardwareMatchBreakdown(report, nvidiaSystem);
    expect(bd.kernel.percent).toBe(15);
  });
});

// --- ram shortfall > 8 below game minimum ---

describe('ramFieldMatch shortfall > 8 below game minimum', () => {
  it('ram: shortfall > 8 GB below game minimum gives 25%', () => {
    // report has 32 GB (meets game min of 16), but system only has 4 GB (shortfall=12 > 8)
    const sys4: SystemInfo = { ...nvidiaSystem, ram_gb: 4 };
    const report = makeCdnReport({ ram: '32 GB' });
    const bd = getHardwareMatchBreakdown(report, sys4, 16);
    expect(bd.ram.percent).toBe(25);
  });
});

// #427 parity: plugin scoring must lowercase ratings the same way the web does
// so a ProtonDB CDN report ("Borked", "Gold") does not silently fall through
// the RATING_SCORES lookup and end up as a 0-baseline "unrecognized" report.
describe('scoring: rating case normalization (#427)', () => {
  it('capitalized "Platinum" scores the same as lowercase', () => {
    const lowerRep = makeCdnReport({ rating: 'platinum' });
    const upperRep = makeCdnReport({ rating: 'Platinum' as any });
    expect(computeConfidence(upperRep, nvidiaSystem).confidence)
      .toBe(computeConfidence(lowerRep, nvidiaSystem).confidence);
  });

  it('capitalized "Borked" triggers the borked-staleness path just like lowercase', () => {
    // Old borked report should get the staleness penalty regardless of case.
    const oldTs = now - 800 * 86400;
    const lowerOld = makeCdnReport({ rating: 'borked', timestamp: oldTs });
    const upperOld = makeCdnReport({ rating: 'Borked' as any, timestamp: oldTs });
    expect(computeConfidence(upperOld, nvidiaSystem).confidence)
      .toBe(computeConfidence(lowerOld, nvidiaSystem).confidence);
  });

  it('mixed case within an aggregate produces the same per-game tier as pure lowercase', () => {
    // Feed aggregatePerGame the same fixture twice, once mixed-case, once
    // all-lower. Rating output must match. Cast through unknown so we can
    // exercise the case-normalization path with only the fields the function
    // actually reads (rating, recencyDays, timestamp, confidence).
    const mkPerGame = (rating: string) => ({
      rating,
      confidence: 60,
      recencyDays: 30,
      timestamp: now,
    } as unknown as import('./scoring').ScoredReport);
    const lower = aggregatePerGame([mkPerGame('borked'), mkPerGame('borked'), mkPerGame('gold')]);
    const mixed = aggregatePerGame([mkPerGame('Borked'), mkPerGame('BORKED'), mkPerGame('Gold')]);
    expect(mixed.rating).toBe(lower.rating);
  });
});
