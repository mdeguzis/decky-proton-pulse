// src/lib/trackedConfigs.ts
import { getSetting, setSetting } from './settings';

const STORAGE_KEY = 'tracked-configs';

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
}

export function getTrackedConfigs(): TrackedConfig[] {
  return getSetting<TrackedConfig[]>(STORAGE_KEY, []);
}

export function addTrackedConfig(config: TrackedConfig): void {
  const configs = getTrackedConfigs();
  const index = configs.findIndex((c) => c.appId === config.appId);
  if (index >= 0) {
    configs[index] = config;
  } else {
    configs.push(config);
  }
  setSetting(STORAGE_KEY, configs);

  for (const cb of configSavedCallbacks) {
    try { cb(config); } catch { /* don't block save on callback errors */ }
  }
}

export function removeTrackedConfig(appId: number): void {
  const configs = getTrackedConfigs().filter((c) => c.appId !== appId);
  setSetting(STORAGE_KEY, configs);
}

export function getTrackedConfig(appId: number): TrackedConfig | null {
  return getTrackedConfigs().find((c) => c.appId === appId) ?? null;
}
