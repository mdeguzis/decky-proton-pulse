// src/lib/trackedConfigs.ts
import { getSetting, setSetting } from './settings';

const STORAGE_KEY = 'tracked-configs';

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
}

export function removeTrackedConfig(appId: number): void {
  const configs = getTrackedConfigs().filter((c) => c.appId !== appId);
  setSetting(STORAGE_KEY, configs);
}

export function getTrackedConfig(appId: number): TrackedConfig | null {
  return getTrackedConfigs().find((c) => c.appId === appId) ?? null;
}
