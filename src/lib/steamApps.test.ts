import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn().mockResolvedValue(true),
}));

import { getSteamAppOverview, isSteamShortcutApp } from './steamApps';

const originalSteamClient = (globalThis as any).SteamClient;

afterEach(() => {
  (globalThis as any).SteamClient = originalSteamClient;
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
});
