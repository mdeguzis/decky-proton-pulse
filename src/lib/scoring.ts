// src/lib/scoring.ts
import type { CdnReport, ScoredReport, SystemInfo, TieredReports, GpuTier } from '../types';

// ─── Weights — edit these to tune ranking ─────────────────────────────────────
export const WEIGHTS = {
  BASE_MAX: 60,
  RECENCY_RECENT: 15,
  RECENCY_MID: 5,
  RECENCY_OLD: -5,
  CUSTOM_PROTON: 10,
  GPU_MATCH: 1.0,
  GPU_MISMATCH: 0.5,
  GPU_UNKNOWN: 0.75,
  GPU_DRIVER_EXACT: 1.3,
  GPU_DRIVER_CLOSE: 1.1,
  BORKED_DECAY_DAYS: 365,
  NOTES_MAX: 10,
} as const;

const RATING_SCORES: Record<string, number> = {
  platinum: 1.0,
  gold: 0.8,
  silver: 0.6,
  bronze: 0.4,
  borked: 0.0,
};

const CUSTOM_PROTON_MARKERS = ['ge', 'cachyos', 'tkg', 'protonplus', 'experimental'];

const NEGATIVE_KEYWORDS = [
  'crash', 'broken', 'freeze', 'black screen', 'hang', 'softlock',
  'corrupted', "doesn't work", 'unplayable', "won't launch",
];

const POSITIVE_KEYWORDS = [
  'perfect', 'flawless', 'works great', 'no issues', 'out of the box',
  'excellent', 'runs perfectly', 'zero issues', 'works flawlessly',
];

export function parseNotesSentiment(notes: string): number {
  if (!notes) return 0;
  const lower = notes.toLowerCase();
  let score = 0;
  for (const kw of NEGATIVE_KEYWORDS) {
    if (lower.includes(kw)) score -= 3;
  }
  for (const kw of POSITIVE_KEYWORDS) {
    if (lower.includes(kw)) score += 2;
  }
  return Math.max(-WEIGHTS.NOTES_MAX, Math.min(WEIGHTS.NOTES_MAX, score));
}

function detectReportGpuTier(report: CdnReport): GpuTier {
  const gpu = (report.gpu ?? '').toLowerCase();
  if (!gpu) return 'unknown';
  if (/nvidia|geforce|rtx|gtx|quadro/.test(gpu)) return 'nvidia';
  if (/amd|radeon|rx \d|vega/.test(gpu)) return 'amd';
  if (/intel|arc|iris|uhd/.test(gpu)) return 'intel';
  return 'unknown';
}

function isCustomProton(version: string): boolean {
  const lower = version.toLowerCase();
  return CUSTOM_PROTON_MARKERS.some(m => lower.includes(m));
}

function parseDriverMajor(driverStr: string): number | null {
  // "NVIDIA 545.29.06" → 545, "Mesa 23.1.0" → 23, "NVIDIA 410.93" → 410
  const match = driverStr.match(/(\d+)\.\d+/);
  return match ? parseInt(match[1], 10) : null;
}

function gpuDriverMultiplier(report: CdnReport, sysInfo: SystemInfo): number {
  const reportTier = detectReportGpuTier(report);
  const sysVendor = sysInfo.gpu_vendor;

  if (!sysVendor || reportTier === 'unknown') return WEIGHTS.GPU_UNKNOWN;
  if (reportTier !== sysVendor) return WEIGHTS.GPU_MISMATCH;

  // Same GPU vendor — compare driver major versions
  const reportMajor = parseDriverMajor(report.gpuDriver ?? '');
  const sysMajor    = parseDriverMajor(sysInfo.driver_version ?? '');

  if (reportMajor === null || sysMajor === null) return WEIGHTS.GPU_MATCH;
  if (reportMajor === sysMajor) return WEIGHTS.GPU_DRIVER_EXACT;
  if (Math.abs(reportMajor - sysMajor) <= 2) return WEIGHTS.GPU_DRIVER_CLOSE;
  return WEIGHTS.GPU_MATCH;
}

export function scoreReport(report: CdnReport, sysInfo: SystemInfo): ScoredReport {
  const gpuTier = detectReportGpuTier(report);
  const mult = gpuDriverMultiplier(report, sysInfo);

  const recencyDays = Math.round((Date.now() / 1000 - report.timestamp) / 86400);

  // Borked decay: old borked reports treated as bronze instead of fully penalized
  const effectiveRating =
    report.rating === 'borked' && recencyDays > WEIGHTS.BORKED_DECAY_DAYS
      ? 'bronze'
      : report.rating;

  const ratingScore = (RATING_SCORES[effectiveRating] ?? 0) * WEIGHTS.BASE_MAX;
  const recencyBonus =
    recencyDays < 90  ? WEIGHTS.RECENCY_RECENT :
    recencyDays < 365 ? WEIGHTS.RECENCY_MID :
                        WEIGHTS.RECENCY_OLD;
  const customBonus = isCustomProton(report.protonVersion) ? WEIGHTS.CUSTOM_PROTON : 0;
  const notesModifier = parseNotesSentiment(report.notes);

  const raw = (ratingScore + recencyBonus + customBonus) * mult + notesModifier;

  return {
    ...report,
    score: Math.max(0, Math.round(raw)),
    gpuTier,
    recencyDays,
    notesModifier,
    upvotes: 0,
  };
}

export function bucketByGpuTier(reports: ScoredReport[]): TieredReports {
  const buckets: TieredReports = { nvidia: [], amd: [], other: [] };
  for (const r of reports) {
    if (r.gpuTier === 'nvidia') buckets.nvidia.push(r);
    else if (r.gpuTier === 'amd') buckets.amd.push(r);
    else buckets.other.push(r);
  }
  const byScore = (a: ScoredReport, b: ScoredReport) => b.score - a.score;
  buckets.nvidia.sort(byScore);
  buckets.amd.sort(byScore);
  buckets.other.sort(byScore);
  return buckets;
}
