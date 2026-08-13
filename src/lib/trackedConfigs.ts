// src/lib/trackedConfigs.ts
//
// Storage for tracked launch-option configs. Multi-config-per-app support:
// each config is keyed by (appId, profileName). A game can have any number
// of named profiles ("Default", "60fps low", "framegen", etc.). Legacy
// single-config-per-app entries with no profileName get auto-migrated to
// DEFAULT_PROFILE_NAME on read.
import { getSetting, setSetting } from './settings';

const STORAGE_KEY = 'tracked-configs';

// Legacy single-config-per-app entries had profileName='' -- give them a
// stable name so the multi-config codepath can key them consistently.
// User-facing rename is optional; the string just has to be non-empty.
export const DEFAULT_PROFILE_NAME = 'Default';

type ConfigSavedCallback = (config: TrackedConfig) => void;
const configSavedCallbacks: Set<ConfigSavedCallback> = new Set();

export function onConfigSaved(cb: ConfigSavedCallback): () => void {
  configSavedCallbacks.add(cb);
  return () => { configSavedCallbacks.delete(cb); };
}

export type ConfigSource = 'protondb' | 'protondb-local' | 'user';

export interface TrackedConfig {
  appId: number;
  appName: string;
  profileName: string;
  protonVersion: string;
  launchOptions: string;
  enabledVars: Record<string, string>;
  appliedAt: number;
  isEdited?: boolean;
  source?: ConfigSource;
  // Hardware snapshot captured at apply time
  cpu?: string | null;
  gpu?: string | null;
  gpuVendor?: string | null;
  gpuDriver?: string | null;
  ram?: string | null;
  os?: string | null;
  kernel?: string | null;
  // Game source
  isNonSteam?: boolean;
  // Resolved Steam store app ID for non-Steam shortcuts (e.g. a GOG/EGS copy
  // of a game that also exists on Steam). Reports are fetched and submitted
  // using this ID instead of the shortcut's CRC32 app ID.
  resolvedSteamAppId?: number;
}

// Normalize a stored config: guarantees a non-empty profileName so the
// (appId, profileName) key never collides across legacy + new rows.
function _normalizeProfile(cfg: TrackedConfig): TrackedConfig {
  const name = (cfg.profileName || '').trim();
  return name ? cfg : { ...cfg, profileName: DEFAULT_PROFILE_NAME };
}

export function getTrackedConfigs(): TrackedConfig[] {
  return getSetting<TrackedConfig[]>(STORAGE_KEY, []).map(_normalizeProfile);
}

// Upsert by (appId, profileName). Two configs with the same appId but
// different profile names now coexist -- the multi-config-per-app split.
// A missing profileName on the incoming config is treated as DEFAULT_PROFILE_NAME
// so callers that pre-date the split still land in a well-defined slot.
export function addTrackedConfig(config: TrackedConfig): void {
  const normalized = _normalizeProfile(config);
  const configs = getTrackedConfigs();
  const index = configs.findIndex(
    (c) => c.appId === normalized.appId && c.profileName === normalized.profileName,
  );
  if (index >= 0) {
    configs[index] = normalized;
  } else {
    configs.push(normalized);
  }
  setSetting(STORAGE_KEY, configs);

  for (const cb of configSavedCallbacks) {
    try { cb(normalized); } catch { /* don't block save on callback errors */ }
  }
}

// Remove a single config identified by (appId, profileName). When profileName
// is omitted, removes ALL configs for that appId (legacy call pattern; used by
// the Manage tab's per-game "remove all" flow if it ever reappears). Prefer
// passing profileName for per-row deletes.
export function removeTrackedConfig(appId: number, profileName?: string): void {
  const target = profileName?.trim() || null;
  const configs = getTrackedConfigs().filter((c) => {
    if (c.appId !== appId) return true;
    if (target === null) return false; // no profileName -> drop every row for the app
    return c.profileName !== target;
  });
  setSetting(STORAGE_KEY, configs);
}

// Lookup a specific config. With profileName omitted, returns the first
// matching row for the app (backward-compat for pre-split callers that
// asked "is this app tracked at all"). With profileName, returns the exact
// match or null.
export function getTrackedConfig(appId: number, profileName?: string): TrackedConfig | null {
  const configs = getTrackedConfigs();
  const target = profileName?.trim();
  if (target) {
    return configs.find((c) => c.appId === appId && c.profileName === target) ?? null;
  }
  return configs.find((c) => c.appId === appId) ?? null;
}

// All configs for a given app. Empty array when the app isn't tracked at all.
// Used by the Manage tab to render per-profile rows and by callers that
// want to enumerate saved profiles (e.g. "which config to submit as report").
export function getTrackedConfigsForApp(appId: number): TrackedConfig[] {
  return getTrackedConfigs().filter((c) => c.appId === appId);
}

// "Active" config for a game = the one most recently applied. `appliedAt`
// is bumped by the Config Editor's Save (which calls SteamClient.Apps
// .SetAppLaunchOptions in the same handler) and by any explicit Apply flow
// that calls setActiveConfig. Playtime accrual reads this to attribute
// running time to the currently-applied config rather than an arbitrary one.
// Returns null when the app isn't tracked.
export function getActiveConfigForApp(appId: number): TrackedConfig | null {
  const configs = getTrackedConfigsForApp(appId);
  if (configs.length === 0) return null;
  return configs.reduce((best, c) => (c.appliedAt > best.appliedAt ? c : best), configs[0]);
}

// Explicit "apply this config" without editing: bump appliedAt so the config
// wins the active-config lookup. Used by any UI that re-applies a saved
// profile (a per-profile Apply button on the Manage tab, etc.).
export function setActiveConfig(appId: number, profileName: string): TrackedConfig | null {
  const target = profileName?.trim() || DEFAULT_PROFILE_NAME;
  const configs = getTrackedConfigs();
  const index = configs.findIndex((c) => c.appId === appId && c.profileName === target);
  if (index < 0) return null;
  configs[index] = { ...configs[index], appliedAt: Date.now() };
  setSetting(STORAGE_KEY, configs);
  for (const cb of configSavedCallbacks) {
    try { cb(configs[index]); } catch { /* don't block on callback errors */ }
  }
  return configs[index];
}
