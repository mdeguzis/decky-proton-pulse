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
  score: ProtonRating;
  tier: number;
  total: number;
  trendingTier: number;
  bestReported: ProtonRating;
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
// SteamClient is available as a global in the Steam CEF context.
// These are the methods this plugin uses — not exhaustive.

// @ts-ignore - SteamClient is already declared by @decky/ui
declare global {
  const SteamClient: {
    Apps: {
      SetAppLaunchOptions: (appId: number, options: string) => Promise<void>;
      GetLaunchOptions: (appId: number) => Promise<string>;
    };
    GameSessions: {
      GetRunningApps: () => Array<{ nAppID: number }>;
    };
  };
}
