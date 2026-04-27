import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn().mockResolvedValue(true),
}));

vi.mock('./voting', () => ({
  getVoterId: vi.fn().mockResolvedValue('abc123voterId'),
  restRequest: vi.fn(),
}));

vi.mock('./trackedConfigs', () => ({
  getTrackedConfig: vi.fn(),
}));

vi.mock('./steamApps', () => ({
  getSteamPlaytimeForeverMinutes: vi.fn().mockReturnValue(0),
}));

import { getVoterId, restRequest } from './voting';
import { getTrackedConfig } from './trackedConfigs';
import { getSteamPlaytimeForeverMinutes } from './steamApps';

const mockGetVoterId = vi.mocked(getVoterId);
const mockRestRequest = vi.mocked(restRequest);
const mockGetTrackedConfig = vi.mocked(getTrackedConfig);
const mockGetSteamPlaytimeForeverMinutes = vi.mocked(getSteamPlaytimeForeverMinutes);

const realDateNow = Date.now;

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    appId: 123,
    appName: 'Test Game',
    profileName: 'Deck Profile',
    protonVersion: 'GE-Proton10-1',
    launchOptions: 'MANGOHUD=1 %command%',
    enabledVars: { MANGOHUD: '1' },
    appliedAt: 1_700_000_000_000,
    source: 'protondb' as const,
    ...overrides,
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('playtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T12:00:00Z'));
    mockGetVoterId.mockResolvedValue('abc123voterId');
    mockGetTrackedConfig.mockReturnValue(null);
    mockRestRequest.mockReset();
    mockGetSteamPlaytimeForeverMinutes.mockReset();
    mockGetSteamPlaytimeForeverMinutes.mockReturnValue(0);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: {
        GetRunningApps: vi.fn().mockReturnValue([]),
      },
    };
  });

  afterEach(async () => {
    try {
      const { stopSessionTracking } = await import('./playtime');
      stopSessionTracking();
      await Promise.resolve();
      await Promise.resolve();
    } catch {
      // module may not have been imported in this test
    }
    vi.useRealTimers();
    Date.now = realDateNow;
    delete (globalThis as unknown as { SteamClient?: unknown }).SteamClient;
  });

  it('tracks a running game and patches the session on stop', async () => {
    const runningApps = vi.fn().mockReturnValue([{ appid: 123 }]);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: {
        GetRunningApps: runningApps,
      },
    };
    mockGetTrackedConfig.mockReturnValue(makeConfig());
    mockRestRequest
      .mockResolvedValueOnce({ data: [{ id: 77 }], error: null, status: 201 })
      .mockResolvedValueOnce({ data: null, error: null, status: 204 });

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');

    startSessionTracking();
    await flushAsyncWork();

    expect(mockRestRequest).toHaveBeenCalledTimes(1);
    const [insertPath, insertInit, insertQuery] = mockRestRequest.mock.calls[0];
    expect(insertPath).toBe('config_playtime');
    expect(insertInit?.method).toBe('POST');
    expect(insertQuery).toEqual({ select: 'id' });
    expect(JSON.parse(String(insertInit?.body))).toMatchObject({
      voter_id: 'abc123voterId',
      app_id: '123',
      config_key: '1700000000000_GE-Proton10-1',
      proton_version: 'GE-Proton10-1',
      source: 'protondb',
      duration_minutes: 0,
    });

    vi.advanceTimersByTime(61_000);
    stopSessionTracking();
    await flushAsyncWork();

    expect(mockRestRequest).toHaveBeenCalledTimes(2);
    const [patchPath, patchInit, patchQuery] = mockRestRequest.mock.calls[1];
    expect(patchPath).toBe('config_playtime');
    expect(patchInit?.method).toBe('PATCH');
    expect(patchQuery).toEqual({ id: 'eq.77' });
    expect(JSON.parse(String(patchInit?.body))).toMatchObject({
      duration_minutes: 1,
    });
  });

  it('falls back to inserting a completed session when the initial insert fails', async () => {
    const runningApps = vi.fn().mockReturnValue([456]);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: {
        GetRunningApps: runningApps,
      },
    };
    mockGetTrackedConfig.mockReturnValue(makeConfig({
      appId: 456,
      appName: 'Fallback Game',
      profileName: 'Custom Profile',
      source: 'user',
    }));
    mockRestRequest
      .mockResolvedValueOnce({ data: null, error: 'insert failed', status: 500 })
      .mockResolvedValueOnce({ data: null, error: null, status: 201 });

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');

    startSessionTracking();
    await flushAsyncWork();

    vi.advanceTimersByTime(61_000);
    stopSessionTracking();
    await flushAsyncWork();

    expect(mockRestRequest).toHaveBeenCalledTimes(2);
    const [completedPath, completedInit] = mockRestRequest.mock.calls[1];
    expect(completedPath).toBe('config_playtime');
    expect(completedInit?.method).toBe('POST');
    expect(JSON.parse(String(completedInit?.body))).toMatchObject({
      voter_id: 'abc123voterId',
      app_id: '456',
      config_key: 'custom:Custom Profile',
      source: 'user',
      duration_minutes: 1,
    });
  });

  it('skips submitting sessions shorter than one minute', async () => {
    const runningApps = vi.fn().mockReturnValue([{ appId: 321 }]);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: {
        GetRunningApps: runningApps,
      },
    };
    mockGetTrackedConfig.mockReturnValue(makeConfig({ appId: 321 }));
    mockRestRequest.mockResolvedValueOnce({ data: [{ id: 11 }], error: null, status: 201 });

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');

    startSessionTracking();
    await flushAsyncWork();

    vi.advanceTimersByTime(20_000);
    stopSessionTracking();
    await flushAsyncWork();

    expect(mockRestRequest).toHaveBeenCalledTimes(1);
  });

  it('handles missing or broken Steam session state without crashing', async () => {
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: {
        GetRunningApps: vi.fn()
          .mockReturnValueOnce('not-an-array')
          .mockImplementationOnce(() => {
            throw new Error('Steam blew up');
          }),
      },
    };

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');

    startSessionTracking();
    await flushAsyncWork();
    vi.advanceTimersByTime(30_000);
    await flushAsyncWork();
    stopSessionTracking();
    await flushAsyncWork();

    expect(mockRestRequest).not.toHaveBeenCalled();
  });

  it('returns aggregated playtime totals by config key', async () => {
    mockRestRequest.mockResolvedValueOnce({
      data: [
        {
          config_key: '1700000000000_GE-Proton10-1',
          total_minutes: 45,
          session_count: 3,
          unique_players: 2,
        },
      ],
      error: null,
      status: 200,
    });

    const { getConfigPlaytimeTotals } = await import('./playtime');
    const result = await getConfigPlaytimeTotals('123');

    expect(result).toEqual({
      '1700000000000_GE-Proton10-1': {
        totalMinutes: 45,
        sessionCount: 3,
        uniquePlayers: 2,
      },
    });
    expect(mockRestRequest).toHaveBeenCalledWith(
      'config_playtime_totals',
      { method: 'GET' },
      {
        select: 'config_key,total_minutes,session_count,unique_players',
        app_id: 'eq.123',
      },
    );
  });

  it('logs error when fallback insert also fails', async () => {
    const runningApps = vi.fn().mockReturnValue([{ appid: 789 }]);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: { GetRunningApps: runningApps },
    };
    mockGetTrackedConfig.mockReturnValue(makeConfig({ appId: 789 }));
    // initial insert fails, then fallback insert also fails
    mockRestRequest
      .mockResolvedValueOnce({ data: null, error: 'insert failed', status: 500 })
      .mockResolvedValueOnce({ data: null, error: 'still broken', status: 500 });

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');

    startSessionTracking();
    await flushAsyncWork();

    vi.advanceTimersByTime(61_000);
    stopSessionTracking();
    await flushAsyncWork();

    // both calls were made, and the second one hit the error branch
    expect(mockRestRequest).toHaveBeenCalledTimes(2);
  });

  it('logs error when PATCH update fails', async () => {
    const runningApps = vi.fn().mockReturnValue([{ appid: 555 }]);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: { GetRunningApps: runningApps },
    };
    mockGetTrackedConfig.mockReturnValue(makeConfig({ appId: 555 }));
    // initial insert succeeds, but PATCH fails
    mockRestRequest
      .mockResolvedValueOnce({ data: [{ id: 42 }], error: null, status: 201 })
      .mockResolvedValueOnce({ data: null, error: 'patch failed', status: 500 });

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');

    startSessionTracking();
    await flushAsyncWork();

    vi.advanceTimersByTime(61_000);
    stopSessionTracking();
    await flushAsyncWork();

    expect(mockRestRequest).toHaveBeenCalledTimes(2);
    expect(mockRestRequest.mock.calls[1][1]?.method).toBe('PATCH');
  });

  it('detects game stop via polling and finalizes session', async () => {
    // game starts running, then stops between polls
    const runningApps = vi.fn()
      .mockReturnValue([{ appid: 333 }]);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: { GetRunningApps: runningApps },
    };
    mockGetTrackedConfig.mockReturnValue(makeConfig({ appId: 333 }));
    mockRestRequest
      .mockResolvedValueOnce({ data: [{ id: 99 }], error: null, status: 201 })
      .mockResolvedValueOnce({ data: null, error: null, status: 204 });

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');

    startSessionTracking();
    await flushAsyncWork();

    // game stops between polls
    vi.advanceTimersByTime(61_000);
    runningApps.mockReturnValue([]);
    vi.advanceTimersByTime(30_000);
    await flushAsyncWork();

    // session should have been finalized by the poll, not stopSessionTracking
    expect(mockRestRequest).toHaveBeenCalledTimes(2);
    expect(mockRestRequest.mock.calls[1][1]?.method).toBe('PATCH');

    stopSessionTracking();
  });

  it('returns an empty object when totals fetch fails or throws', async () => {
    mockRestRequest
      .mockResolvedValueOnce({ data: null, error: 'down', status: 500 })
      .mockRejectedValueOnce(new Error('offline'));

    const { getConfigPlaytimeTotals } = await import('./playtime');

    expect(await getConfigPlaytimeTotals('123')).toEqual({});
    expect(await getConfigPlaytimeTotals('123')).toEqual({});
  });

  it('startSessionTracking is a no-op when already running', async () => {
    const { startSessionTracking, stopSessionTracking } = await import('./playtime');

    startSessionTracking();
    startSessionTracking(); // second call hits "if (pollTimer) return"
    await flushAsyncWork();

    stopSessionTracking();
    // no errors thrown, mockRestRequest not called (no tracked game)
    expect(mockRestRequest).not.toHaveBeenCalled();
  });

  it('getConfigPlaytimeTotals handles non-Error throws in catch', async () => {
    // throw a plain string (not an Error instance) to cover String(err) branch
    mockRestRequest.mockRejectedValueOnce('connection reset');

    const { getConfigPlaytimeTotals } = await import('./playtime');
    await expect(getConfigPlaytimeTotals('123')).resolves.toEqual({});
  });

  it('uses protondb as source fallback when config.source is undefined (initial insert)', async () => {
    const runningApps = vi.fn().mockReturnValue([{ appid: 999 }]);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: { GetRunningApps: runningApps },
    };
    // source=undefined: hits ?? 'protondb' on both initial insert (line 74) and fallback insert (line 129)
    mockGetTrackedConfig.mockReturnValue(makeConfig({ appId: 999, source: undefined }));
    mockRestRequest
      .mockResolvedValueOnce({ data: null, error: 'insert failed', status: 500 }) // initial fails → rowId=null
      .mockResolvedValueOnce({ data: null, error: null, status: 201 }); // fallback insert succeeds

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');
    startSessionTracking();
    await flushAsyncWork();

    // verify initial insert body has source='protondb' (line 74 fallback)
    const [, insertInit] = mockRestRequest.mock.calls[0];
    expect(JSON.parse(String(insertInit?.body))).toMatchObject({ source: 'protondb' });

    vi.advanceTimersByTime(61_000);
    stopSessionTracking();
    await flushAsyncWork();

    // verify fallback insert body also has source='protondb' (line 129 fallback)
    const [, fallbackInit] = mockRestRequest.mock.calls[1];
    expect(JSON.parse(String(fallbackInit?.body))).toMatchObject({ source: 'protondb' });
  });

  it('buildConfigKey uses appName when profileName is empty', async () => {
    const runningApps = vi.fn().mockReturnValue([{ appid: 888 }]);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: { GetRunningApps: runningApps },
    };
    // profileName='' falls back to appName in the || expression (line 30)
    mockGetTrackedConfig.mockReturnValue(makeConfig({ appId: 888, source: 'user' as const, profileName: '' }));
    mockRestRequest.mockResolvedValueOnce({ data: [{ id: 1 }], error: null, status: 201 });

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');
    startSessionTracking();
    await flushAsyncWork();

    const [, init] = mockRestRequest.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    // empty profileName → appName is used → config_key = "custom:Test Game"
    expect(body.config_key).toBe('custom:Test Game');

    stopSessionTracking();
    await flushAsyncWork();
  });

  it('getRunningAppIds handles entries with capital-A appId field', async () => {
    // some Steam builds return { appId: N } (capital A) instead of { appid: N }
    const runningApps = vi.fn().mockReturnValue([{ appId: 777 }]);
    (globalThis as unknown as { SteamClient?: unknown }).SteamClient = {
      GameSessions: { GetRunningApps: runningApps },
    };
    mockGetTrackedConfig.mockReturnValue(makeConfig({ appId: 777 }));
    mockRestRequest.mockResolvedValueOnce({ data: [{ id: 2 }], error: null, status: 201 });

    const { startSessionTracking, stopSessionTracking } = await import('./playtime');
    startSessionTracking();
    await flushAsyncWork();

    // app was detected and session started
    expect(mockRestRequest).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(mockRestRequest.mock.calls[0][1]?.body));
    expect(body.app_id).toBe('777');

    stopSessionTracking();
    await flushAsyncWork();
  });

  describe('getEffectivePlaytimeMinutes', () => {
    it('returns zero tracked minutes when fetching accumulated playtime throws', async () => {
      mockRestRequest.mockRejectedValueOnce('offline');
      mockGetSteamPlaytimeForeverMinutes.mockReturnValue(12);

      const { getEffectivePlaytimeMinutes } = await import('./playtime');
      const result = await getEffectivePlaytimeMinutes(321);

      expect(result).toEqual({ minutes: 12, trackedMinutes: 0, steamMinutes: 12 });
    });

    it('returns the max of plugin-tracked and Steam lifetime minutes', async () => {
      mockRestRequest.mockResolvedValueOnce({
        data: [{ duration_minutes: 5 }, { duration_minutes: 2 }],
        error: null,
        status: 200,
      });
      mockGetSteamPlaytimeForeverMinutes.mockReturnValue(56);

      const { getEffectivePlaytimeMinutes } = await import('./playtime');
      const result = await getEffectivePlaytimeMinutes(1_284_410);

      expect(mockGetSteamPlaytimeForeverMinutes).toHaveBeenCalledWith(1_284_410);
      expect(result).toEqual({ minutes: 56, trackedMinutes: 7, steamMinutes: 56 });
    });

    it('prefers tracked minutes when Steam reports a smaller number', async () => {
      mockRestRequest.mockResolvedValueOnce({
        data: [{ duration_minutes: 120 }],
        error: null,
        status: 200,
      });
      mockGetSteamPlaytimeForeverMinutes.mockReturnValue(45);

      const { getEffectivePlaytimeMinutes } = await import('./playtime');
      const result = await getEffectivePlaytimeMinutes('900');

      expect(result).toEqual({ minutes: 120, trackedMinutes: 120, steamMinutes: 45 });
    });

    it('returns zeros when tracked fails and Steam has no data', async () => {
      mockRestRequest.mockResolvedValueOnce({ data: null, error: 'boom', status: 500 });
      mockGetSteamPlaytimeForeverMinutes.mockReturnValue(0);

      const { getEffectivePlaytimeMinutes } = await import('./playtime');
      const result = await getEffectivePlaytimeMinutes(42);

      expect(result).toEqual({ minutes: 0, trackedMinutes: 0, steamMinutes: 0 });
    });

    it('skips the Steam lookup when appId is not a positive number', async () => {
      mockRestRequest.mockResolvedValueOnce({ data: [], error: null, status: 200 });
      const { getEffectivePlaytimeMinutes } = await import('./playtime');
      const result = await getEffectivePlaytimeMinutes('not-a-number');

      expect(mockGetSteamPlaytimeForeverMinutes).not.toHaveBeenCalled();
      expect(result).toEqual({ minutes: 0, trackedMinutes: 0, steamMinutes: 0 });
    });
  });

  describe('bucketPlaytimeMinutes', () => {
    it('maps non-positive and non-finite values to unreported', async () => {
      const { bucketPlaytimeMinutes } = await import('./playtime');
      expect(bucketPlaytimeMinutes(0)).toBe('unreported');
      expect(bucketPlaytimeMinutes(Number.NaN)).toBe('unreported');
    });

    it('maps sub-hour sessions to underOneHour', async () => {
      const { bucketPlaytimeMinutes } = await import('./playtime');
      expect(bucketPlaytimeMinutes(59)).toBe('underOneHour');
    });

    it('maps 1-4 hour sessions to oneToFourHours', async () => {
      const { bucketPlaytimeMinutes } = await import('./playtime');
      expect(bucketPlaytimeMinutes(60)).toBe('oneToFourHours');
      expect(bucketPlaytimeMinutes(239)).toBe('oneToFourHours');
    });

    it('maps 4-10 hour sessions to fourToTenHours', async () => {
      const { bucketPlaytimeMinutes } = await import('./playtime');
      expect(bucketPlaytimeMinutes(240)).toBe('fourToTenHours');
      expect(bucketPlaytimeMinutes(599)).toBe('fourToTenHours');
    });

    it('maps 10+ hour sessions to overTenHours', async () => {
      const { bucketPlaytimeMinutes } = await import('./playtime');
      expect(bucketPlaytimeMinutes(600)).toBe('overTenHours');
    });
  });
});
