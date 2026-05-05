// Talks to Steam's internal SteamClient.Apps API to look up app details
// like launch options. Uses RegisterForAppDetails which is callback-based,
// so everything here wraps it in a promise with a timeout fallback.
import { logFrontendEvent } from './logger';

interface SteamAppDetailsResult {
  details: any | null;
  timedOut?: boolean;
}

export function getSteamAppOverview(appId: number): any | null {
  const steamApps = (globalThis as any).SteamClient?.Apps;
  const overview = steamApps?.GetAppOverviewByAppID?.(appId) ?? null;
  return overview && typeof overview === 'object' ? overview : null;
}

// Non-Steam shortcut IDs are CRC32-based with the high bit set, always >= 2^31.
// Real Steam app IDs are currently in the low millions.
export const NON_STEAM_ID_THRESHOLD = 2_000_000_000;

export function isSteamShortcutApp(appId: number | null | undefined): boolean {
  if (!appId) return false;
  const overview = getSteamAppOverview(appId);
  if (!overview) {
    // GetAppOverviewByAppID can return null for non-Steam shortcuts --
    // fall back to the numeric threshold which is always reliable.
    return appId >= NON_STEAM_ID_THRESHOLD;
  }

  if (typeof overview.BIsShortcut === 'function') {
    try {
      return !!overview.BIsShortcut();
    } catch {
      // ignore helper failures and fall back below
    }
  }

  const shortcutFlags = [
    overview.is_shortcut,
    overview.isShortcut,
    overview.bIsShortcut,
  ];
  return shortcutFlags.some((value) => value === true);
}

export async function getSteamAppDetails(appId: number, timeoutMs = 1000): Promise<SteamAppDetailsResult> {
  const steamApps = (globalThis as any).SteamClient?.Apps;
  if (!steamApps?.RegisterForAppDetails) {
    await logFrontendEvent('DEBUG', 'Steam app details lookup unavailable', { appId });
    return { details: null };
  }

  return await new Promise<SteamAppDetailsResult>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let unregister = () => {};

    const finish = (result: SteamAppDetailsResult) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      try {
        unregister();
      } catch {
        // ignore unregister failures
      }
      resolve(result);
    };

    try {
      const registration = steamApps.RegisterForAppDetails(appId, (details: any) => {
        finish({ details });
      });
      unregister = registration?.unregister ?? (() => {});
      timeoutId = setTimeout(() => {
        finish({ details: null, timedOut: true });
      }, timeoutMs);
    } catch (error) {
      void logFrontendEvent('ERROR', 'Steam app details lookup failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      finish({ details: null });
    }
  });
}

export function getLaunchOptionsFromDetails(details: any): string {
  if (!details || typeof details !== 'object') return '';
  return typeof details.strLaunchOptions === 'string' ? details.strLaunchOptions : '';
}

// Lifetime playtime in minutes as Steam knows it for this account.
// Matches the "PLAY TIME" value shown on the Steam library page for the game.
// Returns 0 when the overview isn't available or the field is missing.
// Tries SteamClient.Apps first, then window.appStore as a fallback since
// different Steam client versions expose the field under different names.
export function getSteamPlaytimeForeverMinutes(appId: number): number {
  const sources: any[] = [];

  const steamAppsOverview = getSteamAppOverview(appId);
  if (steamAppsOverview) sources.push(steamAppsOverview);

  // window.appStore is the MobX store the Steam library page reads from -
  // it often has playtime even when SteamClient.Apps.GetAppOverviewByAppID doesn't
  const appStoreOverview = (globalThis as any).appStore?.GetAppOverviewByAppID?.(appId);
  if (appStoreOverview && appStoreOverview !== steamAppsOverview) sources.push(appStoreOverview);

  for (const src of sources) {
    const candidates = [
      src.minutes_playtime_forever,
      src.nPlaytimeForever,
      src.minutesPlaytimeForever,
      src.playtime_forever,
    ];
    for (const v of candidates) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }
  }
  return 0;
}
