// src/lib/cloudSync.ts
import { logFrontendEvent } from './logger';
import { getVoterId, restRequest } from './voting';
import { getSetting, setSetting } from './settings';
import { getTrackedConfigs, type TrackedConfig } from './trackedConfigs';

const AUTO_SYNC_KEY = 'cloud-auto-sync';

export function isAutoSyncEnabled(): boolean {
  return getSetting<boolean>(AUTO_SYNC_KEY, true);
}

export function setAutoSyncEnabled(enabled: boolean): void {
  setSetting(AUTO_SYNC_KEY, enabled);
}

export async function pushConfig(config: TrackedConfig): Promise<boolean> {
  try {
    const voterId = await getVoterId();
    void logFrontendEvent('DEBUG', 'Cloud sync: pushing config', {
      appId: config.appId, voterIdPrefix: voterId.slice(0, 8),
    });

    const { error } = await restRequest<null>('user_proton_configs', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        voter_id: voterId,
        app_id: config.appId,
        app_name: config.appName,
        config,
        updated_at: new Date().toISOString(),
      }),
    }, {
      on_conflict: 'voter_id,app_id',
    });

    if (error) {
      void logFrontendEvent('ERROR', 'Cloud sync: push failed', {
        appId: config.appId, error,
      });
      return false;
    }

    void logFrontendEvent('INFO', 'Cloud sync: config pushed', { appId: config.appId });
    return true;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Cloud sync: push threw', {
      appId: config.appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export interface PushAllResult {
  total: number;
  succeeded: number;
  failed: number;
}

export interface CloudConfigRow {
  voter_id: string;
  app_id: number;
  app_name: string;
  config: TrackedConfig;
  updated_at: string;
}

export type SyncStatus = 'synced' | 'not-synced';

export async function fetchCloudConfigs(): Promise<CloudConfigRow[]> {
  try {
    const voterId = await getVoterId();
    const { data, error } = await restRequest<CloudConfigRow[]>('user_proton_configs', {
      method: 'GET',
    }, {
      select: 'voter_id,app_id,app_name,config,updated_at',
      voter_id: `eq.${voterId}`,
    });

    if (error || !data) {
      void logFrontendEvent('ERROR', 'Cloud sync: fetch failed', { error });
      return [];
    }

    void logFrontendEvent('DEBUG', 'Cloud sync: fetched configs', { count: data.length });
    return data;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Cloud sync: fetch threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function checkHasCloudBackup(): Promise<boolean> {
  try {
    const voterId = await getVoterId();
    const { data, error } = await restRequest<{ app_id: number }[]>('user_proton_configs', {
      method: 'GET',
      headers: { Range: '0-0' },
    }, {
      select: 'app_id',
      voter_id: `eq.${voterId}`,
      limit: '1',
    });

    if (error || !data) return false;
    return data.length > 0;
  } catch {
    return false;
  }
}

export function getCloudSyncStatus(
  appId: number,
  cloudConfigs: CloudConfigRow[],
): SyncStatus {
  const cloudRow = cloudConfigs.find((r) => r.app_id === appId);
  if (!cloudRow) return 'not-synced';
  return 'synced';
}

export async function pushAllConfigs(): Promise<PushAllResult> {
  const configs = getTrackedConfigs();
  let succeeded = 0;
  let failed = 0;

  for (const config of configs) {
    const ok = await pushConfig(config);
    if (ok) succeeded++;
    else failed++;
  }

  void logFrontendEvent('INFO', 'Cloud sync: push all complete', {
    total: configs.length, succeeded, failed,
  });
  return { total: configs.length, succeeded, failed };
}
