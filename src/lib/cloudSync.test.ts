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
}));

import { restRequest } from './voting';
import type { TrackedConfig } from './trackedConfigs';

const mockRestRequest = vi.mocked(restRequest);

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pushConfig', () => {
  it('upserts a config to Supabase', async () => {
    mockRestRequest.mockResolvedValueOnce({ data: null, error: null, status: 201 });

    const { pushConfig } = await import('./cloudSync');
    const ok = await pushConfig(makeConfig());

    expect(ok).toBe(true);
    expect(mockRestRequest).toHaveBeenCalledTimes(1);

    const [path, init, query] = mockRestRequest.mock.calls[0];
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
