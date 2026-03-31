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

// ─── ProtonDB API ─────────────────────────────────────────────────────────────
// Field names verified against https://www.protondb.com/api/v1/reports/app/2358720
// Note: ProtonDB API is unofficial — field names may drift. Verify before coding.

export type ProtonRating = 'platinum' | 'gold' | 'silver' | 'bronze' | 'borked' | 'pending';

export interface ProtonDBReportResponses {
  gpu?: string;
  gpuDriver?: string;
  os?: string;
  ram?: number;
  kernel?: string;
  cpu?: string;
}

export interface ProtonDBReport {
  timestamp: number;           // Unix seconds
  rating: ProtonRating;
  protonVersion: string;       // e.g. "GE-Proton9-7", "Proton 9.0"
  notes: string;
  responses: ProtonDBReportResponses;
}

export interface ProtonDBSummary {
  score: number;              // 0.0–1.0 float (e.g. 0.82)
  tier: ProtonRating;         // e.g. "platinum"
  total: number;
  trendingTier: ProtonRating; // e.g. "platinum"
  bestReportedTier: ProtonRating; // renamed from bestReported in live API
  confidence: string;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export type GpuTier = 'nvidia' | 'amd' | 'intel' | 'unknown';

export interface ScoredReport extends ProtonDBReport {
  score: number;
  gpuTier: GpuTier;
  recencyDays: number;
}

export interface TieredReports {
  nvidia: ScoredReport[];
  amd: ScoredReport[];
  other: ScoredReport[];   // intel + unknown combined for display
}

// ─── Steam CEF ───────────────────────────────────────────────────────────────
// SteamClient global is provided by @decky/ui — no redeclaration needed.
// Types are available via node_modules/@decky/ui/dist/globals/SteamClient.d.ts
