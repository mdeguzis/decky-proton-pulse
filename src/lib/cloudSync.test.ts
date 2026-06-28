import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn().mockResolvedValue(true),
}));

vi.mock('./voting', () => ({
  getVoterId: vi.fn().mockResolvedValue('abc123voterId'),
  restRequest: vi.fn(),
}));

vi.mock('./settings', () => {
  const store: Record<string, unknown> = {};
  let listeners: Array<(key: string | null) => void> = [];
  return {
    getSetting: <T>(key: string, fallback: T): T => (store[key] as T) ?? fallback,
    setSetting: (key: string, value: unknown) => {
      store[key] = value;
      listeners.forEach((listener) => listener(key));
    },
    onSettingsChanged: (listener: (key: string | null) => void) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((entry) => entry !== listener);
      };
    },
  };
});

vi.mock('./trackedConfigs', () => ({
  getTrackedConfigs: vi.fn().mockReturnValue([]),
  addTrackedConfig: vi.fn(),
  onConfigSaved: vi.fn(),
}));

vi.mock('./protonPulseAccount', () => ({
  getInstallationId: vi.fn(() => 'install-123'),
  getLinkedProtonPulseUserId: vi.fn(() => 'pp-user-123'),
}));

vi.mock('./localDataBackup', () => ({
  buildPluginSettingsBackupPayload: vi.fn(() => ({
    format: 'proton-pulse-local-backup',
    version: 1,
    exportedAt: '2026-04-13T00:00:00Z',
    entries: { theme: '"dark"' },
  })),
  applyPluginSettingsBackupPayload: vi.fn(() => 1),
}));

import { restRequest } from './voting';
import type { TrackedConfig } from './trackedConfigs';
import { getTrackedConfigs, addTrackedConfig, onConfigSaved } from './trackedConfigs';
import { applyPluginSettingsBackupPayload, buildPluginSettingsBackupPayload } from './localDataBackup';

const mockRestRequest = vi.mocked(restRequest);
const mockGetTrackedConfigs = vi.mocked(getTrackedConfigs);
const mockAddTrackedConfig = vi.mocked(addTrackedConfig);
const mockOnConfigSaved = vi.mocked(onConfigSaved);
const mockBuildPluginSettingsBackupPayload = vi.mocked(buildPluginSettingsBackupPayload);
const mockApplyPluginSettingsBackupPayload = vi.mocked(applyPluginSettingsBackupPayload);

function makeConfig(overrides: Partial<TrackedConfig> = {}): TrackedConfig {
  return {
    appId: 12345,
    appName: 'Test Game',
    profileName: 'My Profile',
    protonVersion: 'GE-Proton9-27',
    launchOptions: 'PROTON_VERSION="GE-Proton9-27" %command%',
    enabledVars: { MANGOHUD: '1' },
    appliedAt: 1700000000000,
    ...overrides,
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockOnConfigSaved.mockImplementation(() => () => {});
  const { teardownCloudSync, setAutoSyncEnabled } = await import('./cloudSync');
  teardownCloudSync();
  setAutoSyncEnabled(true);
});

describe('pushConfig', () => {
  it('upserts a config to Supabase', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: null, status: 201 });

    const { pushConfig } = await import('./cloudSync');
    const ok = await pushConfig(makeConfig());

    expect(ok).toBe(true);
    expect(mockRestRequest).toHaveBeenCalledTimes(1);

    const [path, init, query] = mockRestRequest.mock.calls[0];
    if (!init) {
      throw new Error('Expected request init to be defined');
    }
    expect(path).toBe('user_proton_configs');
    expect(init.method).toBe('POST');
    expect(query).toMatchObject({ on_conflict: 'voter_id,app_id' });

    const body = JSON.parse(init.body as string);
    expect(body.voter_id).toBe('abc123voterId');
    expect(body.proton_pulse_user_id).toBe('pp-user-123');
    expect(body.installation_id).toBe('install-123');
    expect(body.is_published).toBe(false);
    expect(body.app_id).toBe(12345);
    expect(body.app_name).toBe('Test Game');
    expect(body.config).toMatchObject({ appId: 12345, protonVersion: 'GE-Proton9-27' });
  });

  it('returns false on Supabase error', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: 'insert failed', status: 400 });

    const { pushConfig } = await import('./cloudSync');
    expect(await pushConfig(makeConfig())).toBe(false);
  });

  it('returns false when request throws', async () => {
    mockRestRequest.mockRejectedValueOnce(new Error('offline'));

    const { pushConfig } = await import('./cloudSync');
    expect(await pushConfig(makeConfig())).toBe(false);
  });
});

describe('deleteCloudConfig', () => {
  it('deletes the cloud row for the local voter and app', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: null, status: 204 });

    const { deleteCloudConfig } = await import('./cloudSync');
    const ok = await deleteCloudConfig(620);

    expect(ok).toBe(true);
    expect(mockRestRequest).toHaveBeenCalledWith(
      'user_proton_configs',
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'x-client-id': 'abc123voterId' },
      }),
      {
        voter_id: 'eq.abc123voterId',
        app_id: 'eq.620',
      },
    );
  });

  it('returns false when deleting the cloud row fails', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: 'delete failed', status: 500 });

    const { deleteCloudConfig } = await import('./cloudSync');
    await expect(deleteCloudConfig(620)).resolves.toBe(false);
  });
});

describe('onCloudConfigPushed', () => {
  it('notifies subscribers on successful manual push with source=manual', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: null, status: 201 });

    const { pushConfig, onCloudConfigPushed } = await import('./cloudSync');
    const spy = vi.fn();
    const unsub = onCloudConfigPushed(spy);

    await pushConfig(makeConfig({ appId: 777 }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ appId: 777, ok: true, source: 'manual' });
    unsub();
  });

  it('tags auto-sync pushes with source=auto so the global listener can toast failures without doubling up manual toasts', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: 'boom', status: 500 });

    const { pushConfig, onCloudConfigPushed } = await import('./cloudSync');
    const spy = vi.fn();
    const unsub = onCloudConfigPushed(spy);

    await pushConfig(makeConfig({ appId: 42 }), 'auto');

    expect(spy).toHaveBeenCalledWith({
      appId: 42, ok: false, source: 'auto', error: 'boom',
    });
    unsub();
  });

  it('unsubscribe stops further callbacks', async () => {
    mockRestRequest.mockResolvedValue({ data: null, error: null, status: 201 });

    const { pushConfig, onCloudConfigPushed } = await import('./cloudSync');
    const spy = vi.fn();
    const unsub = onCloudConfigPushed(spy);

    await pushConfig(makeConfig({ appId: 1 }));
    unsub();
    await pushConfig(makeConfig({ appId: 2 }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ appId: 1 }));
  });
});

describe('plugin settings cloud sync', () => {
  it('upserts plugin settings using the local backup payload', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: null, status: 201 });

    const { pushPluginSettings } = await import('./cloudSync');
    const ok = await pushPluginSettings();

    expect(ok).toBe(true);
    expect(mockBuildPluginSettingsBackupPayload).toHaveBeenCalled();
    const [path, init, query] = mockRestRequest.mock.calls[0];
    if (!init) {
      throw new Error('Expected request init to be defined');
    }
    expect(path).toBe('user_plugin_settings');
    expect(query).toMatchObject({ on_conflict: 'voter_id,plugin_id' });
    const body = JSON.parse(init.body as string);
    expect(body.plugin_id).toBe('proton-pulse');
    expect(body.payload.entries).toEqual({ theme: '"dark"' });
  });

  it('fetches plugin settings from Supabase', async () => {
    mockRestRequest.mockResolvedValueOnce({
      data: [{
        voter_id: 'abc123voterId',
        plugin_id: 'proton-pulse',
        payload: {
          format: 'proton-pulse-local-backup',
          version: 1,
          exportedAt: '2026-04-13T00:00:00Z',
          entries: { theme: '"dark"' },
        },
        updated_at: '2026-04-13T00:00:00Z',
      }],
      error: null,
      status: 200,
    });

    const { fetchCloudPluginSettings } = await import('./cloudSync');
    const result = await fetchCloudPluginSettings();

    expect(result?.plugin_id).toBe('proton-pulse');
    expect(result?.payload.entries).toEqual({ theme: '"dark"' });
  });

  it('returns null when fetching plugin settings throws', async () => {
    mockRestRequest.mockRejectedValueOnce('offline');

    const { fetchCloudPluginSettings } = await import('./cloudSync');
    const result = await fetchCloudPluginSettings();

    expect(result).toBeNull();
  });

  it('restores plugin settings from the cloud payload', async () => {
    mockRestRequest.mockResolvedValueOnce({
      data: [{
        voter_id: 'abc123voterId',
        plugin_id: 'proton-pulse',
        payload: {
          format: 'proton-pulse-local-backup',
          version: 1,
          exportedAt: '2026-04-13T00:00:00Z',
          entries: { theme: '"dark"' },
        },
        updated_at: '2026-04-13T00:00:00Z',
      }],
      error: null,
      status: 200,
    });

    const { restoreCloudPluginSettings } = await import('./cloudSync');
    const restored = await restoreCloudPluginSettings();

    expect(restored).toBe(1);
    expect(mockApplyPluginSettingsBackupPayload).toHaveBeenCalled();
  });

  it('reports whether plugin settings cloud backup exists', async () => {
    mockRestRequest
      .mockResolvedValueOnce({
        data: [{
          voter_id: 'abc123voterId',
          plugin_id: 'proton-pulse',
          payload: {
            format: 'proton-pulse-local-backup',
            version: 1,
            exportedAt: '2026-04-13T00:00:00Z',
            entries: { theme: '"dark"' },
          },
          updated_at: '2026-04-13T00:00:00Z',
        }],
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: null, error: 'boom', status: 500 });

    const { checkHasCloudPluginSettingsBackup } = await import('./cloudSync');
    await expect(checkHasCloudPluginSettingsBackup()).resolves.toBe(true);
    await expect(checkHasCloudPluginSettingsBackup()).resolves.toBe(false);
  });
});

describe('pushAllConfigs', () => {
  it('pushes every local config', async () => {
    const { getTrackedConfigs } = await import('./trackedConfigs');
    vi.mocked(getTrackedConfigs).mockReturnValue([
      makeConfig({ appId: 1, appName: 'A' }),
      makeConfig({ appId: 2, appName: 'B' }),
    ]);
    mockRestRequest.mockResolvedValue({ data: null, error: null, status: 201 });

    const { pushAllConfigs } = await import('./cloudSync');
    const results = await pushAllConfigs();

    expect(results).toEqual({ total: 2, succeeded: 2, failed: 0 });
    expect(mockRestRequest).toHaveBeenCalledTimes(2);
  });
});

describe('fetchCloudConfigs', () => {
  it('returns configs from Supabase', async () => {
    const cfg = makeConfig();
    mockRestRequest.mockResolvedValueOnce({
      data: [
        {
          voter_id: 'abc123voterId',
          proton_pulse_user_id: 'pp-user-123',
          installation_id: 'install-123',
          app_id: 12345,
          app_name: 'Test Game',
          config: cfg,
          updated_at: '2026-04-11T00:00:00Z',
        },
      ],
      error: null,
      status: 200,
    });

    const { fetchCloudConfigs } = await import('./cloudSync');
    const result = await fetchCloudConfigs();

    expect(result).toHaveLength(1);
    expect(result[0].app_id).toBe(12345);
    expect(result[0].proton_pulse_user_id).toBe('pp-user-123');
    expect(result[0].config.appId).toBe(12345);
  });

  it('throws on error response', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: 'broken', status: 500 });

    const { fetchCloudConfigs } = await import('./cloudSync');
    await expect(fetchCloudConfigs()).rejects.toThrow();
  });

  it('throws when fetch throws', async () => {
    mockRestRequest.mockRejectedValueOnce(new Error('offline'));

    const { fetchCloudConfigs } = await import('./cloudSync');
    await expect(fetchCloudConfigs()).rejects.toThrow();
  });
});

describe('checkHasCloudBackup', () => {
  it('returns true when cloud has configs', async () => {
    mockRestRequest.mockResolvedValueOnce({
      data: [{ app_id: 1 }],
      error: null,
      status: 200,
    });

    const { checkHasCloudBackup } = await import('./cloudSync');
    expect(await checkHasCloudBackup()).toBe(true);
  });

  it('returns false when cloud is empty', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: [], error: null, status: 200 });

    const { checkHasCloudBackup } = await import('./cloudSync');
    expect(await checkHasCloudBackup()).toBe(false);
  });

  it('returns false on error', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: 'down', status: 500 });

    const { checkHasCloudBackup } = await import('./cloudSync');
    expect(await checkHasCloudBackup()).toBe(false);
  });

  it('returns false when the existence check throws', async () => {
    mockRestRequest.mockRejectedValueOnce(new Error('offline'));

    const { checkHasCloudBackup } = await import('./cloudSync');
    expect(await checkHasCloudBackup()).toBe(false);
  });
});

describe('getCloudSyncStatus', () => {
  it('returns synced when app exists in cloud configs', async () => {
    const { getCloudSyncStatus } = await import('./cloudSync');
    const cloudConfigs = [
      { voter_id: 'abc', app_id: 100, app_name: 'Game', config: makeConfig({ appId: 100 }), updated_at: '2026-04-11T01:00:00Z' },
    ];
    expect(getCloudSyncStatus(100, cloudConfigs)).toBe('synced');
  });

  it('returns not-synced when app is missing from cloud', async () => {
    const { getCloudSyncStatus } = await import('./cloudSync');
    expect(getCloudSyncStatus(999, [])).toBe('not-synced');
  });
});

describe('restoreCloudConfigs', () => {
  it('overwrites local configs that exist in the cloud', async () => {
    const localCfg = makeConfig({ appId: 500, appName: 'Local Game' });
    const cloudCfg = makeConfig({ appId: 500, appName: 'Cloud Game' });
    mockGetTrackedConfigs.mockReturnValue([localCfg]);
    mockRestRequest.mockResolvedValueOnce({
      data: [
        { voter_id: 'abc123voterId', app_id: 500, app_name: 'Cloud Game', config: cloudCfg, updated_at: '2026-04-11T00:00:00Z' },
      ],
      error: null,
      status: 200,
    });

    const { restoreCloudConfigs } = await import('./cloudSync');
    const result = await restoreCloudConfigs();

    expect(result).toEqual({ restored: 1, skipped: 0, failed: 0 });
    expect(mockAddTrackedConfig).toHaveBeenCalledWith(cloudCfg);
  });

  it('restores cloud configs that have no matching local entry', async () => {
    // The point of restore: pull down games this device does not track yet
    // (new device, reinstall, configs pushed from another linked device).
    mockGetTrackedConfigs.mockReturnValue([]);

    const cloudA = makeConfig({ appId: 100, appName: 'Cloud Only A' });
    const cloudB = makeConfig({ appId: 200, appName: 'Cloud Only B' });
    mockRestRequest.mockResolvedValueOnce({
      data: [
        { voter_id: 'abc123voterId', app_id: 100, app_name: 'Cloud Only A', config: cloudA, updated_at: '2026-04-11T00:00:00Z' },
        { voter_id: 'abc123voterId', app_id: 200, app_name: 'Cloud Only B', config: cloudB, updated_at: '2026-04-11T00:00:00Z' },
      ],
      error: null,
      status: 200,
    });

    const { restoreCloudConfigs } = await import('./cloudSync');
    const result = await restoreCloudConfigs();

    expect(result).toEqual({ restored: 2, skipped: 0, failed: 0 });
    expect(mockAddTrackedConfig).toHaveBeenCalledWith(cloudA);
    expect(mockAddTrackedConfig).toHaveBeenCalledWith(cloudB);
  });

  it('throws when cloud fetch fails', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: 'offline', status: 500 });

    const { restoreCloudConfigs } = await import('./cloudSync');
    await expect(restoreCloudConfigs()).rejects.toThrow();
  });

  it('counts failed restores when a local insert throws', async () => {
    const localCfg = makeConfig({ appId: 600, appName: 'Local Game' });
    mockGetTrackedConfigs.mockReturnValue([localCfg]);
    mockAddTrackedConfig.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    mockRestRequest.mockResolvedValueOnce({
      data: [
        { voter_id: 'abc123voterId', app_id: 600, app_name: 'Cloud Game', config: makeConfig({ appId: 600 }), updated_at: '2026-04-11T00:00:00Z' },
      ],
      error: null,
      status: 200,
    });

    const { restoreCloudConfigs } = await import('./cloudSync');
    const result = await restoreCloudConfigs();

    expect(result).toEqual({ restored: 0, skipped: 0, failed: 1 });
  });
});

describe('cloud auto-sync lifecycle', () => {
  it('registers a save listener once and pushes saved configs when enabled', async () => {
    let savedCallback: ((config: TrackedConfig) => void) | null = null;
    const unsubscribe = vi.fn();
    mockOnConfigSaved.mockImplementation((cb) => {
      savedCallback = cb;
      return unsubscribe;
    });
    mockRestRequest.mockResolvedValue({ data: null, error: null, status: 201 });

    const { initCloudSync } = await import('./cloudSync');
    initCloudSync();
    initCloudSync();

    expect(mockOnConfigSaved).toHaveBeenCalledTimes(1);
    const callback = savedCallback as ((config: TrackedConfig) => void) | null;
    if (!callback) {
      throw new Error('Expected cloud sync save callback to be registered');
    }
    callback(makeConfig({ appId: 77, appName: 'Auto Sync Game' }));
    await flushAsyncWork();
    expect(mockRestRequest).toHaveBeenCalledTimes(1);
  });

  it('counts failed pushes in pushAllConfigs', async () => {
    mockGetTrackedConfigs.mockReturnValue([
      makeConfig({ appId: 1, appName: 'A' }),
      makeConfig({ appId: 2, appName: 'B' }),
    ]);
    mockRestRequest
      .mockResolvedValueOnce({ data: null, error: null, status: 201 })
      .mockResolvedValueOnce({ data: null, error: 'boom', status: 500 });

    const { pushAllConfigs } = await import('./cloudSync');
    const result = await pushAllConfigs();

    expect(result).toEqual({ total: 2, succeeded: 1, failed: 1 });
  });

  it('does not push saved configs when auto-sync is disabled', async () => {
    let savedCallback: ((config: TrackedConfig) => void) | null = null;
    mockOnConfigSaved.mockImplementation((cb) => {
      savedCallback = cb;
      return () => {};
    });

    const { initCloudSync, teardownCloudSync, setAutoSyncEnabled } = await import('./cloudSync');
    setAutoSyncEnabled(false);
    initCloudSync();
    const callback = savedCallback as ((config: TrackedConfig) => void) | null;
    if (!callback) {
      throw new Error('Expected cloud sync save callback to be registered');
    }
    callback(makeConfig({ appId: 88 }));

    expect(mockRestRequest).not.toHaveBeenCalled();
    teardownCloudSync();
    setAutoSyncEnabled(true);
  });

  it('tears down the save listener', async () => {
    const unsubscribe = vi.fn();
    mockOnConfigSaved.mockImplementation(() => unsubscribe);

    const { initCloudSync, teardownCloudSync } = await import('./cloudSync');
    initCloudSync();
    teardownCloudSync();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('pushes plugin settings after settings change when enabled', async () => {
    vi.useFakeTimers();
    mockRestRequest.mockResolvedValue({ data: null, error: null, status: 201 });

    const { initCloudSync, setPluginSettingsAutoSyncEnabled } = await import('./cloudSync');
    const { setSetting } = await import('./settings');
    setPluginSettingsAutoSyncEnabled(true);
    initCloudSync();

    setSetting('language', 'en');
    await vi.advanceTimersByTimeAsync(500);

    expect(mockRestRequest).toHaveBeenCalledWith(
      'user_plugin_settings',
      expect.objectContaining({ method: 'POST' }),
      expect.objectContaining({ on_conflict: 'voter_id,plugin_id' }),
    );
    vi.useRealTimers();
  });

  it('resets the pending plugin settings timer when changes arrive back-to-back', async () => {
    vi.useFakeTimers();
    mockRestRequest.mockResolvedValue({ data: null, error: null, status: 201 });

    const { initCloudSync, setPluginSettingsAutoSyncEnabled } = await import('./cloudSync');
    const { setSetting } = await import('./settings');
    setPluginSettingsAutoSyncEnabled(true);
    initCloudSync();

    setSetting('language', 'en');
    await vi.advanceTimersByTimeAsync(300);
    setSetting('language', 'de');
    await vi.advanceTimersByTimeAsync(499);
    expect(mockRestRequest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockRestRequest).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('clears the pending plugin settings timer during teardown', async () => {
    vi.useFakeTimers();

    const { initCloudSync, teardownCloudSync, setPluginSettingsAutoSyncEnabled } = await import('./cloudSync');
    const { setSetting } = await import('./settings');
    setPluginSettingsAutoSyncEnabled(true);
    initCloudSync();

    setSetting('language', 'en');
    teardownCloudSync();
    await vi.advanceTimersByTimeAsync(500);

    expect(mockRestRequest).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not push plugin settings when auto-sync is disabled', async () => {
    vi.useFakeTimers();

    const { initCloudSync, setPluginSettingsAutoSyncEnabled } = await import('./cloudSync');
    const { setSetting } = await import('./settings');
    setPluginSettingsAutoSyncEnabled(false);
    initCloudSync();

    setSetting('language', 'en');
    await vi.advanceTimersByTimeAsync(500);

    expect(mockRestRequest).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
