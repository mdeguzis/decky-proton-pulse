// src/lib/scoring.ts
import type { ProtonDBReport, ScoredReport, SystemInfo, TieredReports, GpuTier } from '../types';

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
} as const;

const RATING_SCORES: Record<string, number> = {
  platinum: 1.0,
  gold: 0.8,
  silver: 0.6,
  bronze: 0.4,
  borked: 0.0,
};

const CUSTOM_PROTON_MARKERS = ['ge', 'cachyos', 'tkg', 'protonplus', 'experimental'];

function detectReportGpuTier(report: ProtonDBReport): GpuTier {
  const gpu = (report.responses?.gpu ?? '').toLowerCase();
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

function gpuMultiplier(reportTier: GpuTier, systemVendor: string | null): number {
  if (!systemVendor || reportTier === 'unknown') return WEIGHTS.GPU_UNKNOWN;
  return reportTier === systemVendor ? WEIGHTS.GPU_MATCH : WEIGHTS.GPU_MISMATCH;
}

export function scoreReport(report: ProtonDBReport, sysInfo: SystemInfo): ScoredReport {
  const gpuTier = detectReportGpuTier(report);
  const mult = gpuMultiplier(gpuTier, sysInfo.gpu_vendor);
  const ratingScore = (RATING_SCORES[report.rating] ?? 0) * WEIGHTS.BASE_MAX;
  const recencyDays = Math.round((Date.now() / 1000 - report.timestamp) / 86400);
  const recencyBonus =
    recencyDays < 90  ? WEIGHTS.RECENCY_RECENT :
    recencyDays < 365 ? WEIGHTS.RECENCY_MID :
                        WEIGHTS.RECENCY_OLD;
  const customBonus = isCustomProton(report.protonVersion) ? WEIGHTS.CUSTOM_PROTON : 0;
  const raw = (ratingScore + recencyBonus + customBonus) * mult;
  return {
    ...report,
    score: Math.max(0, Math.round(raw)),
    gpuTier,
    recencyDays,
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
