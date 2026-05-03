// src/lib/cloudSync.ts
import { logFrontendEvent } from './logger';
import { getVoterId, restRequest } from './voting';
import { getSetting, setSetting, onSettingsChanged } from './settings';
import { getTrackedConfigs, addTrackedConfig, onConfigSaved, type TrackedConfig } from './trackedConfigs';
import { getInstallationId, getLinkedProtonPulseUserId } from './protonPulseAccount';
import {
  applyPluginSettingsBackupPayload,
  buildPluginSettingsBackupPayload,
  type LocalDataBackupPayload,
} from './localDataBackup';

const AUTO_SYNC_KEY = 'cloud-auto-sync';
const AUTO_SYNC_PLUGIN_SETTINGS_KEY = 'cloud-plugin-settings-auto-sync';
const PLUGIN_ID = 'proton-pulse';
let teardownAutoSyncListener: (() => void) | null = null;
let teardownPluginSettingsListener: (() => void) | null = null;
let pendingPluginSettingsPushTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

// Fires every time pushConfig finishes. Components that display sync state
// (ManageTab badges, the "..." context menu) subscribe so their view refreshes
// the moment an auto-sync push completes, instead of waiting for remount.
// The `source` lets subscribers distinguish a manual Upload (which already
// shows its own toast) from a background auto-sync (which is silent until it fails)
export type CloudPushSource = 'manual' | 'auto';
export interface CloudPushResult {
  appId: number;
  ok: boolean;
  source: CloudPushSource;
  error?: string;
}
type CloudPushCallback = (result: CloudPushResult) => void;
const cloudPushCallbacks: Set<CloudPushCallback> = new Set();

export function onCloudConfigPushed(cb: CloudPushCallback): () => void {
  cloudPushCallbacks.add(cb);
  return () => { cloudPushCallbacks.delete(cb); };
}

function notifyCloudConfigPushed(result: CloudPushResult): void {
  for (const cb of cloudPushCallbacks) {
    try { cb(result); } catch { /* don't let a bad subscriber block future pushes */ }
  }
}

export function isAutoSyncEnabled(): boolean {
  return getSetting<boolean>(AUTO_SYNC_KEY, true);
}

export function setAutoSyncEnabled(enabled: boolean): void {
  setSetting(AUTO_SYNC_KEY, enabled);
}

export function isPluginSettingsAutoSyncEnabled(): boolean {
  return getSetting<boolean>(AUTO_SYNC_PLUGIN_SETTINGS_KEY, false);
}

export function setPluginSettingsAutoSyncEnabled(enabled: boolean): void {
  setSetting(AUTO_SYNC_PLUGIN_SETTINGS_KEY, enabled);
}

export async function pushConfig(
  config: TrackedConfig,
  source: CloudPushSource = 'manual',
): Promise<boolean> {
  try {
    const voterId = await getVoterId();
    const protonPulseUserId = getLinkedProtonPulseUserId();
    const installationId = getInstallationId();
    void logFrontendEvent('DEBUG', 'Cloud sync: pushing config', {
      appId: config.appId,
      voterIdPrefix: voterId.slice(0, 8),
      protonPulseLinked: Boolean(protonPulseUserId),
      source,
    });

    const { error } = await restRequest<null>('user_proton_configs', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        voter_id: voterId,
        proton_pulse_user_id: protonPulseUserId,
        installation_id: installationId,
        is_published: false,
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
        appId: config.appId, error, source,
      });
      notifyCloudConfigPushed({ appId: config.appId, ok: false, source, error: String(error) });
      return false;
    }

    void logFrontendEvent('INFO', 'Cloud sync: config pushed', { appId: config.appId, source });
    notifyCloudConfigPushed({ appId: config.appId, ok: true, source });
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    void logFrontendEvent('ERROR', 'Cloud sync: push threw', {
      appId: config.appId, error: errMsg, source,
    });
    notifyCloudConfigPushed({ appId: config.appId, ok: false, source, error: errMsg });
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
  proton_pulse_user_id?: string | null;
  installation_id?: string | null;
  app_id: number;
  app_name: string;
  config: TrackedConfig;
  updated_at: string;
  is_published?: boolean;
  published_at?: string | null;
}

export interface CloudPluginSettingsRow {
  voter_id: string;
  plugin_id: string;
  payload: LocalDataBackupPayload;
  updated_at: string;
}

export type SyncStatus = 'synced' | 'not-synced';

export async function fetchCloudConfigs(): Promise<CloudConfigRow[]> {
  try {
    const voterId = await getVoterId();
    const { data, error } = await restRequest<CloudConfigRow[]>('user_proton_configs', {
      method: 'GET',
    }, {
      select: 'voter_id,proton_pulse_user_id,installation_id,app_id,app_name,config,updated_at,is_published',
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

export async function deleteCloudConfig(appId: number): Promise<boolean> {
  try {
    const voterId = await getVoterId();
    const { error } = await restRequest<null>('user_proton_configs', {
      method: 'DELETE',
      headers: { 'x-client-id': voterId },
    }, {
      voter_id: `eq.${voterId}`,
      app_id: `eq.${appId}`,
    });

    if (error) {
      void logFrontendEvent('ERROR', 'Cloud sync: delete failed', { appId, error });
      return false;
    }

    void logFrontendEvent('INFO', 'Cloud sync: config deleted', { appId });
    return true;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Cloud sync: delete threw', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function pushPluginSettings(
  payload: LocalDataBackupPayload = buildPluginSettingsBackupPayload(),
): Promise<boolean> {
  try {
    const voterId = await getVoterId();
    const { error } = await restRequest<null>('user_plugin_settings', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        voter_id: voterId,
        plugin_id: PLUGIN_ID,
        payload,
        updated_at: new Date().toISOString(),
      }),
    }, {
      on_conflict: 'voter_id,plugin_id',
    });

    if (error) {
      void logFrontendEvent('ERROR', 'Cloud sync: plugin settings push failed', { error });
      return false;
    }

    void logFrontendEvent('INFO', 'Cloud sync: plugin settings pushed', {
      entryCount: Object.keys(payload.entries ?? {}).length,
    });
    return true;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Cloud sync: plugin settings push threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function fetchCloudPluginSettings(): Promise<CloudPluginSettingsRow | null> {
  try {
    const voterId = await getVoterId();
    const { data, error } = await restRequest<CloudPluginSettingsRow[]>('user_plugin_settings', {
      method: 'GET',
      headers: { Range: '0-0' },
    }, {
      select: 'voter_id,plugin_id,payload,updated_at',
      voter_id: `eq.${voterId}`,
      plugin_id: `eq.${PLUGIN_ID}`,
      limit: '1',
    });

    if (error || !data?.length) {
      if (error) {
        void logFrontendEvent('ERROR', 'Cloud sync: plugin settings fetch failed', { error });
      }
      return null;
    }

    return data[0];
  } catch (err) {
    void logFrontendEvent('ERROR', 'Cloud sync: plugin settings fetch threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function restoreCloudPluginSettings(): Promise<number> {
  const row = await fetchCloudPluginSettings();
  if (!row?.payload) return 0;
  return applyPluginSettingsBackupPayload(row.payload);
}

export async function checkHasCloudBackup(): Promise<boolean> {
  try {
    const voterId = await getVoterId();
    const { data, error } = await restRequest<{ app_id: number }[]>('user_proton_configs', {
      method: 'GET',
      headers: { Range: '0-0' }, // just need one row to confirm existence
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

export async function checkHasCloudPluginSettingsBackup(): Promise<boolean> {
  return (await fetchCloudPluginSettings()) !== null;
}

export function getCloudSyncStatus(
  appId: number,
  cloudConfigs: CloudConfigRow[],
): SyncStatus {
  const cloudRow = cloudConfigs.find((r) => r.app_id === appId);
  if (!cloudRow) return 'not-synced';
  return 'synced';
}

export interface RestoreResult {
  restored: number;
  skipped: number;
  failed: number;
}

export async function restoreCloudConfigs(): Promise<RestoreResult> {
  const cloudRows = await fetchCloudConfigs();
  const localConfigs = getTrackedConfigs();
  const localAppIds = new Set(localConfigs.map((c) => c.appId));

  let restored = 0;
  let skipped = 0;

  for (const row of cloudRows) {
    if (!localAppIds.has(row.app_id)) {
      skipped++;
      continue;
    }
    try {
      addTrackedConfig(row.config);
      restored++;
    } catch {
      // failed count handled below
    }
  }

  const failed = cloudRows.length - restored - skipped;
  void logFrontendEvent('INFO', 'Cloud sync: restore complete', { restored, skipped, failed });
  return { restored, skipped, failed };
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

export function initCloudSync(): void {
  if (teardownAutoSyncListener) return;
  teardownAutoSyncListener = onConfigSaved((config) => {
    if (!isAutoSyncEnabled()) return;
    void pushConfig(config, 'auto');
  });
  teardownPluginSettingsListener = onSettingsChanged(() => {
    if (!isPluginSettingsAutoSyncEnabled()) return;
    if (pendingPluginSettingsPushTimer !== null) {
      globalThis.clearTimeout(pendingPluginSettingsPushTimer);
    }
    pendingPluginSettingsPushTimer = globalThis.setTimeout(() => {
      pendingPluginSettingsPushTimer = null;
      void pushPluginSettings();
    }, 500);
  });
  void logFrontendEvent('INFO', 'Cloud sync: auto-sync listener registered');
}

export function teardownCloudSync(): void {
  teardownAutoSyncListener?.();
  teardownAutoSyncListener = null;
  teardownPluginSettingsListener?.();
  teardownPluginSettingsListener = null;
  if (pendingPluginSettingsPushTimer !== null) {
    globalThis.clearTimeout(pendingPluginSettingsPushTimer);
    pendingPluginSettingsPushTimer = null;
  }
}
