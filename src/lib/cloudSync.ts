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
