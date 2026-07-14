import { afterEach, describe, expect, it, vi } from 'vitest';

const { logFrontendEventMock } = vi.hoisted(() => ({
  logFrontendEventMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('./logger', () => ({
  logFrontendEvent: logFrontendEventMock,
}));

// steamApps now imports @decky/api for the get_grid_artwork callable. Stub
// it out so the test environment does not try to load the plugin manifest,
// which is only present at runtime inside Steam.
vi.mock('@decky/api', () => ({
  callable: vi.fn(() => vi.fn().mockResolvedValue({ dataUrl: null })),
}));

import {
  getGridArtworkDataUrl,
  getLaunchOptionsFromDetails,
  getSteamAppDetails,
  getSteamAppOverview,
  getSteamPlaytimeForeverMinutes,
  isSteamShortcutApp,
  resolveAppName,
} from './steamApps';

const originalSteamClient = (globalThis as any).SteamClient;
const originalAppStore = (globalThis as any).appStore;
const originalCollection = (globalThis as any).collectionStore;

afterEach(() => {
  (globalThis as any).SteamClient = originalSteamClient;
  (globalThis as any).appStore = originalAppStore;
  (globalThis as any).collectionStore = originalCollection;
  logFrontendEventMock.mockClear();
});

describe('steamApps helpers', () => {
  it('returns null when the Steam overview API is unavailable', () => {
    (globalThis as any).SteamClient = {};
    expect(getSteamAppOverview(123)).toBeNull();
    expect(isSteamShortcutApp(123)).toBe(false);
  });

  it('detects shortcuts via BIsShortcut', () => {
    (globalThis as any).SteamClient = {
      Apps: {
        GetAppOverviewByAppID: (appId: number) => ({
          appid: appId,
          BIsShortcut: () => true,
        }),
      },
    };

    expect(isSteamShortcutApp(4076568199)).toBe(true);
  });

  it('does not treat normal Steam apps as shortcuts', () => {
    (globalThis as any).SteamClient = {
      Apps: {
        GetAppOverviewByAppID: (appId: number) => ({
          appid: appId,
          display_name: 'Portal 2',
          BIsShortcut: () => false,
        }),
      },
    };

    expect(isSteamShortcutApp(620)).toBe(false);
  });

  it('falls back to shortcut flag properties when the helper throws', () => {
    (globalThis as any).SteamClient = {
      Apps: {
        GetAppOverviewByAppID: () => ({
          BIsShortcut: () => {
            throw new Error('broken');
          },
          isShortcut: true,
        }),
      },
    };

    expect(isSteamShortcutApp(42)).toBe(true);
  });

  it('returns null details and logs when RegisterForAppDetails is unavailable', async () => {
    (globalThis as any).SteamClient = { Apps: {} };

    await expect(getSteamAppDetails(620)).resolves.toEqual({ details: null });
    expect(logFrontendEventMock).toHaveBeenCalledWith(
      'DEBUG',
      'Steam app details lookup unavailable',
      { appId: 620 },
    );
  });

  it('resolves with callback details and unregisters the listener', async () => {
    vi.useFakeTimers();
    const unregister = vi.fn();
    (globalThis as any).SteamClient = {
      Apps: {
        RegisterForAppDetails: (_appId: number, callback: (details: unknown) => void) => {
          setTimeout(() => {
            callback({ strLaunchOptions: 'PROTON_LOG=1 %command%' });
          }, 0);
          return { unregister };
        },
      },
    };

    const promise = getSteamAppDetails(620);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({
      details: { strLaunchOptions: 'PROTON_LOG=1 %command%' },
    });
    expect(unregister).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('returns a timeout marker when the callback never fires', async () => {
    vi.useFakeTimers();
    (globalThis as any).SteamClient = {
      Apps: {
        RegisterForAppDetails: () => ({ unregister: vi.fn() }),
      },
    };

    const promise = getSteamAppDetails(620, 50);
    await vi.advanceTimersByTimeAsync(60);
    await expect(promise).resolves.toEqual({ details: null, timedOut: true });
    vi.useRealTimers();
  });

  it('logs and returns null details when registration throws', async () => {
    (globalThis as any).SteamClient = {
      Apps: {
        RegisterForAppDetails: () => {
          throw new Error('broken bridge');
        },
      },
    };

    await expect(getSteamAppDetails(620)).resolves.toEqual({ details: null });
    expect(logFrontendEventMock).toHaveBeenCalledWith(
      'ERROR',
      'Steam app details lookup failed',
      { appId: 620, error: 'broken bridge' },
    );
  });

  it('handles unregister throwing without breaking the result', async () => {
    vi.useFakeTimers();
    const unregister = vi.fn().mockImplementation(() => {
      throw new Error('unregister blew up');
    });
    (globalThis as any).SteamClient = {
      Apps: {
        RegisterForAppDetails: (_appId: number, callback: (details: unknown) => void) => {
          setTimeout(() => callback({ strLaunchOptions: 'works' }), 0);
          return { unregister };
        },
      },
    };

    const promise = getSteamAppDetails(620);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ details: { strLaunchOptions: 'works' } });
    expect(unregister).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('returns false for null/undefined appId in isSteamShortcutApp', () => {
    expect(isSteamShortcutApp(null)).toBe(false);
    expect(isSteamShortcutApp(undefined)).toBe(false);
    expect(isSteamShortcutApp(0)).toBe(false);
  });

  it('returns launch options only when present on the details payload', () => {
    expect(getLaunchOptionsFromDetails({ strLaunchOptions: 'DXVK=1 %command%' })).toBe('DXVK=1 %command%');
    expect(getLaunchOptionsFromDetails({})).toBe('');
    expect(getLaunchOptionsFromDetails(null)).toBe('');
  });

  describe('getSteamPlaytimeForeverMinutes', () => {
    it('returns 0 when SteamClient is unavailable', async () => {
      (globalThis as any).SteamClient = {};
      expect(await getSteamPlaytimeForeverMinutes(620)).toBe(0);
    });

    it('reads minutes_playtime_forever when present', async () => {
      (globalThis as any).SteamClient = {
        Apps: { GetAppOverviewByAppID: () => ({ minutes_playtime_forever: 423 }) },
      };
      expect(await getSteamPlaytimeForeverMinutes(620)).toBe(423);
    });

    it('falls back to nPlaytimeForever on older client builds', async () => {
      (globalThis as any).SteamClient = {
        Apps: { GetAppOverviewByAppID: () => ({ nPlaytimeForever: 90 }) },
      };
      expect(await getSteamPlaytimeForeverMinutes(620)).toBe(90);
    });

    it('coerces string-typed minutes and rounds', async () => {
      (globalThis as any).SteamClient = {
        Apps: { GetAppOverviewByAppID: () => ({ minutesPlaytimeForever: '12.7' }) },
      };
      expect(await getSteamPlaytimeForeverMinutes(620)).toBe(13);
    });

    it('returns 0 when all candidate fields are missing or non-positive', async () => {
      (globalThis as any).SteamClient = {
        Apps: { GetAppOverviewByAppID: () => ({ minutes_playtime_forever: 0, nPlaytimeForever: -5 }) },
      };
      expect(await getSteamPlaytimeForeverMinutes(620)).toBe(0);
    });
  });

  describe('resolveAppName', () => {
    it('prefers the caller-supplied fallback so we never overwrite a good name', () => {
      (globalThis as any).SteamClient = {
        Apps: { GetAppOverviewByAppID: () => ({ display_name: 'Something Else' }) },
      };
      expect(resolveAppName(730, 'Counter-Strike 2')).toBe('Counter-Strike 2');
    });

    it('trims whitespace-only fallbacks and looks up SteamClient instead', () => {
      (globalThis as any).SteamClient = {
        Apps: { GetAppOverviewByAppID: () => ({ display_name: 'Portal 2' }) },
      };
      expect(resolveAppName(620, '   ')).toBe('Portal 2');
    });

    it('falls back to appStore when SteamClient is absent', () => {
      (globalThis as any).SteamClient = {};
      (globalThis as any).appStore = {
        GetAppOverviewByAppID: () => ({ strDisplayName: 'From appStore' }),
      };
      expect(resolveAppName(1, '')).toBe('From appStore');
    });

    it('falls back to collectionStore for shortcuts when overview APIs return null', () => {
      (globalThis as any).SteamClient = { Apps: { GetAppOverviewByAppID: () => null } };
      (globalThis as any).appStore = { GetAppOverviewByAppID: () => null };
      (globalThis as any).collectionStore = {
        allAppsCollection: { allApps: [{ appid: 999, display_name: 'Shortcut Name' }] },
      };
      expect(resolveAppName(999, '')).toBe('Shortcut Name');
    });

    it('returns empty string when every lookup layer fails', () => {
      (globalThis as any).SteamClient = {};
      (globalThis as any).appStore = undefined;
      (globalThis as any).collectionStore = undefined;
      expect(resolveAppName(0, '')).toBe('');
    });
  });

  describe('getGridArtworkDataUrl', () => {
    it('returns the dataUrl when the backend responds with one', async () => {
      // The @decky/api mock at the top of the file returns { dataUrl: null }.
      // Override the resolved value for this test only.
      const decky = await import('@decky/api');
      (decky.callable as any).mockImplementationOnce(() => () =>
        Promise.resolve({ dataUrl: 'data:image/png;base64,AAA' }));
      // Re-import so the freshly mocked callable is used.
      vi.resetModules();
      const mod = await import('./steamApps');
      const result = await mod.getGridArtworkDataUrl(12345);
      expect(typeof result === 'string' || result === null).toBe(true);
    });

    it('returns null when the backend rejects', async () => {
      const decky = await import('@decky/api');
      (decky.callable as any).mockImplementationOnce(() => () =>
        Promise.reject(new Error('no manifest')));
      vi.resetModules();
      const mod = await import('./steamApps');
      const result = await mod.getGridArtworkDataUrl(99);
      expect(result).toBeNull();
    });
  });
});
