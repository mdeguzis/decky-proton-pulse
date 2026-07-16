// src/types.ts

// --- System Info ---

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
  vram_mb: number | null;
  cpu_cores: number | null;
  display_resolution: string | null;
  steam_deck_model: string | null;
}

// --- ProtonDB Summary ---
// Still live: https://www.protondb.com/api/v1/reports/summaries/{appId}.json

export type ProtonRating = 'platinum' | 'gold' | 'silver' | 'bronze' | 'borked' | 'pending';

export interface ProtonDBSummary {
  score: number;              // 0.0-1.0 float (e.g. 0.82)
  tier: ProtonRating;         // e.g. "platinum"
  total: number;
  trendingTier: ProtonRating; // e.g. "platinum"
  bestReportedTier: ProtonRating; // renamed from bestReported in live API
  confidence: string;
}

// --- CDN Report ---
// Shape served by the Proton Pulse CDN year files under
// https://www.proton-pulse.com/data/{appId}/{year}.json
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
  ram: string;          // raw string from CDN, e.g. "16 GB" -- not a number
  rating: ProtonRating;
  timestamp: number;
  title: string;
  reportId?: number | null;
  source?: string | null; // e.g. "Steam", "Heroic", "Epic", "Non-Steam"
  formResponses?: import('./lib/scoring').ReportResponses | null;
  // Client id / voter_id of the person who submitted the report. Only
  // Pulse reports carry this (ProtonDB reports are anonymous upstream).
  // Compared against getVoterId() on the frontend to disable vote
  // buttons on the user's own reports (#114).
  authorId?: string | null;
}

// --- Scoring ---

export type GpuTier = 'nvidia' | 'amd' | 'intel' | 'unknown';

export interface ScoredReport extends CdnReport {
  // Per-report confidence (0-100). NOT a rating - rating still lives on the
  // CdnReport.rating field, derived from yes/no form answers. Confidence tells
  // you how trustworthy this report is for the viewer's situation.
  confidence: number;
  gpuTier: GpuTier;
  gpuArchitecture: string; // e.g. "RDNA2", "Ada", "Polaris", "" if unknown
  recencyDays: number;
  notesModifier: number;
  upvotes: number;
  downvotes: number;
}

export interface TieredReports {
  nvidia: ScoredReport[];
  amd: ScoredReport[];
  other: ScoredReport[];
}

// --- Compatibility Tools ---

export type CompatToolId = 'proton-ge' | 'proton-cachyos';

export const COMPAT_TOOL_OPTIONS: { id: CompatToolId; label: string }[] = [
  { id: 'proton-ge', label: 'Proton-GE' },
  { id: 'proton-cachyos', label: 'Proton-CachyOS' },
];

export interface CompatToolRelease {
  tag_name: string;
  name: string;
  published_at: string | null;
  prerelease: boolean;
  asset_name: string;
  download_url: string;
  asset_size?: number | null;
  body?: string | null;
}

export interface InstalledCompatTool {
  directory_name: string;
  display_name: string;
  internal_name: string;
  path: string;
  source?: 'custom' | 'valve';
  tool_id?: CompatToolId | null;
  managed_slot?: 'latest' | 'versioned' | null;
  latest_tag?: string | null;
}

export interface ProtonGeManagerState {
  current_release: CompatToolRelease | null;
  current_installed: boolean;
  current_latest_slot_installed: boolean;
  installed_tools: InstalledCompatTool[];
  releases: CompatToolRelease[];
  tool_id?: CompatToolId;
  tool_label?: string;
  install_status: {
    state: 'idle' | 'running' | 'success' | 'error';
    tag_name: string | null;
    message: string | null;
    stage: string | null;
    downloaded_bytes: number | null;
    total_bytes: number | null;
    progress_fraction: number | null;
    started_at: number | null;
    finished_at: number | null;
    install_as_latest: boolean;
  };
}

export interface ProtonVersionAvailability {
  managed: boolean;
  installed: boolean;
  normalized_version: string | null;
  matched_tool_name: string | null;
  closest_tool_name: string | null;
  release: CompatToolRelease | null;
  message: string;
}

// --- LSFG-VK Frame Generation ---

export interface LsfgVkRelease {
  tag_name: string;
  name: string;
  published_at: string | null;
  prerelease: boolean;
  asset_name: string;
  download_url: string;
  asset_size?: number | null;
}

export interface LsfgInstalledVersion {
  directory_name: string;
  tag_name: string | null;
  path: string;
  managed_slot: 'latest' | 'versioned' | null;
  latest_tag?: string | null;
}

export interface LsfgVkManagerState {
  current_release: LsfgVkRelease | null;
  current_installed: boolean;
  current_latest_slot_installed: boolean;
  installed_versions: LsfgInstalledVersion[];
  releases: LsfgVkRelease[];
  binary_available: boolean;
  binary_path: string;
  install_status: {
    state: 'idle' | 'running' | 'success' | 'error';
    tag_name: string | null;
    message: string | null;
    stage: string | null;
    downloaded_bytes: number | null;
    total_bytes: number | null;
    progress_fraction: number | null;
    started_at: number | null;
    finished_at: number | null;
    install_as_latest: boolean;
  };
}

// --- Steam CEF ---
// SteamClient global is provided by @decky/ui -- no redeclaration needed.
