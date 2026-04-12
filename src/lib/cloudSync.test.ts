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
  return {
    getSetting: <T>(key: string, fallback: T): T => (store[key] as T) ?? fallback,
    setSetting: (key: string, value: unknown) => { store[key] = value; },
  };
});

vi.mock('./trackedConfigs', () => ({
  getTrackedConfigs: vi.fn().mockReturnValue([]),
  addTrackedConfig: vi.fn(),
  onConfigSaved: vi.fn(),
}));

import { restRequest } from './voting';
import type { TrackedConfig } from './trackedConfigs';
import { getTrackedConfigs, addTrackedConfig, onConfigSaved } from './trackedConfigs';

const mockRestRequest = vi.mocked(restRequest);
const mockGetTrackedConfigs = vi.mocked(getTrackedConfigs);
const mockAddTrackedConfig = vi.mocked(addTrackedConfig);
const mockOnConfigSaved = vi.mocked(onConfigSaved);

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
        { voter_id: 'abc123voterId', app_id: 12345, app_name: 'Test Game', config: cfg, updated_at: '2026-04-11T00:00:00Z' },
      ],
      error: null,
      status: 200,
    });

    const { fetchCloudConfigs } = await import('./cloudSync');
    const result = await fetchCloudConfigs();

    expect(result).toHaveLength(1);
    expect(result[0].app_id).toBe(12345);
    expect(result[0].config.appId).toBe(12345);
  });

  it('returns empty array on error', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: 'broken', status: 500 });

    const { fetchCloudConfigs } = await import('./cloudSync');
    expect(await fetchCloudConfigs()).toEqual([]);
  });

  it('returns empty array when fetch throws', async () => {
    mockRestRequest.mockRejectedValueOnce(new Error('offline'));

    const { fetchCloudConfigs } = await import('./cloudSync');
    expect(await fetchCloudConfigs()).toEqual([]);
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
  it('restores cloud configs that dont exist locally', async () => {
    mockGetTrackedConfigs.mockReturnValue([]);
    const cloudCfg = makeConfig({ appId: 500, appName: 'Cloud Game' });
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

  it('skips configs that already exist locally', async () => {
    const localCfg = makeConfig({ appId: 100, appName: 'Local Game' });
    mockGetTrackedConfigs.mockReturnValue([localCfg]);

    mockRestRequest.mockResolvedValueOnce({
      data: [
        { voter_id: 'abc123voterId', app_id: 100, app_name: 'Local Game', config: localCfg, updated_at: '2026-04-11T00:00:00Z' },
      ],
      error: null,
      status: 200,
    });

    const { restoreCloudConfigs } = await import('./cloudSync');
    const result = await restoreCloudConfigs();

    expect(result).toEqual({ restored: 0, skipped: 1, failed: 0 });
    expect(mockAddTrackedConfig).not.toHaveBeenCalled();
  });

  it('returns zeros when cloud fetch fails', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: 'offline', status: 500 });

    const { restoreCloudConfigs } = await import('./cloudSync');
    const result = await restoreCloudConfigs();

    expect(result).toEqual({ restored: 0, skipped: 0, failed: 0 });
  });

  it('counts failed restores when a local insert throws', async () => {
    mockGetTrackedConfigs.mockReturnValue([]);
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
});
