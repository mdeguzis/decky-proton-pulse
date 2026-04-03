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
  score: number;              // 0.0–1.0 float (e.g. 0.82)
  tier: ProtonRating;         // e.g. "platinum"
  total: number;
  trendingTier: ProtonRating; // e.g. "platinum"
  bestReportedTier: ProtonRating; // renamed from bestReported in live API
  confidence: string;
}

// ─── CDN Report ───────────────────────────────────────────────────────────────
// Shape served by the Proton Pulse CDN year files under
// https://mdeguzis.github.io/proton-pulse-data/data/{appId}/{year}.json
// rating is normalized to lowercase at fetch time ("Silver" -> "silver")

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
  ram: string;          // raw string from CDN, e.g. "16 GB" — not a number
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

// ─── Compatibility Tools ─────────────────────────────────────────────────────

export interface CompatToolRelease {
  tag_name: string;
  name: string;
  published_at: string | null;
  prerelease: boolean;
  asset_name: string;
  download_url: string;
}

export interface InstalledCompatTool {
  directory_name: string;
  display_name: string;
  internal_name: string;
  path: string;
  source?: 'custom' | 'valve';
}

export interface ProtonGeManagerState {
  current_release: CompatToolRelease | null;
  current_installed: boolean;
  installed_tools: InstalledCompatTool[];
  releases: CompatToolRelease[];
}

export interface ProtonVersionAvailability {
  managed: boolean;
  installed: boolean;
  normalized_version: string | null;
  matched_tool_name: string | null;
  release: CompatToolRelease | null;
  message: string;
}

// ─── Steam CEF ───────────────────────────────────────────────────────────────
// SteamClient global is provided by @decky/ui — no redeclaration needed.
