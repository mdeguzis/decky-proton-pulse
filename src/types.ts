// src/types.ts

// ─── System Info ───────────────────────────────────────────────────────────────

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'other';

export interface SystemInfo {
  cpu: string | null;
  ram_gb: number | null;
  gpu: string | null;
  gpu_vendor: GpuVendor | null;
  driver_version: string | null;
  kernel: string | null;
  distro: string | null;
  proton_custom: string | null;
}

// ─── ProtonDB Summary ─────────────────────────────────────────────────────────
// Still live: https://www.protondb.com/api/v1/reports/summaries/{appId}.json

export type ProtonRating = 'platinum' | 'gold' | 'silver' | 'bronze' | 'borked' | 'pending';

export interface ProtonDBSummary {
  score: number;
  tier: ProtonRating;
  total: number;
  trendingTier: ProtonRating;
  bestReportedTier: ProtonRating;
  confidence: string;
}

// ─── CDN Report ───────────────────────────────────────────────────────────────
// Shape served by https://mdeguzis.github.io/proton-pulse-data/data/{appId}.json
// rating is normalized to lowercase at fetch time ("Silver" → "silver")

export interface CdnReport {
  appId: string;
  cpu: string;
  duration: string;
  gpu: string;
  gpuDriver: string;
  kernel: string;
  notes: string;
  os: string;
  protonVersion: string;
  ram: string;
  rating: ProtonRating;
  timestamp: number;
  title: string;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export type GpuTier = 'nvidia' | 'amd' | 'intel' | 'unknown';

export interface ScoredReport extends CdnReport {
  score: number;
  gpuTier: GpuTier;
  recencyDays: number;
  notesModifier: number;
  upvotes: number;
}

export interface TieredReports {
  nvidia: ScoredReport[];
  amd: ScoredReport[];
  other: ScoredReport[];
}

// ─── Steam CEF ───────────────────────────────────────────────────────────────
// SteamClient global is provided by @decky/ui — no redeclaration needed.
