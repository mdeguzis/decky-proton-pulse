import { afterEach, describe, expect, it, vi } from 'vitest';

const { logFrontendEventMock } = vi.hoisted(() => ({
  logFrontendEventMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('./logger', () => ({
  logFrontendEvent: logFrontendEventMock,
}));

import {
  getLaunchOptionsFromDetails,
  getSteamAppDetails,
  getSteamAppOverview,
  isSteamShortcutApp,
} from './steamApps';

const originalSteamClient = (globalThis as any).SteamClient;

afterEach(() => {
  (globalThis as any).SteamClient = originalSteamClient;
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

  it('returns launch options only when present on the details payload', () => {
    expect(getLaunchOptionsFromDetails({ strLaunchOptions: 'DXVK=1 %command%' })).toBe('DXVK=1 %command%');
    expect(getLaunchOptionsFromDetails({})).toBe('');
    expect(getLaunchOptionsFromDetails(null)).toBe('');
  });
});
