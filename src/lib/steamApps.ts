// Talks to Steam's internal SteamClient.Apps API to look up app details
// like launch options. Uses RegisterForAppDetails which is callback-based,
// so everything here wraps it in a promise with a timeout fallback.
import { callable } from '@decky/api';
import { logFrontendEvent } from './logger';

const _getGridArtwork = callable<[number], { dataUrl: string | null }>('get_grid_artwork');

// Returns a data URL for the local Steam grid artwork (user-set header) for
// this app id. Non-Steam shortcuts commonly use this to carry Heroic / GOG /
// Epic cover art. Returns null if nothing is set or the backend errors.
export async function getGridArtworkDataUrl(appId: number): Promise<string | null> {
  try {
    const result = await _getGridArtwork(appId);
    return result.dataUrl ?? null;
  } catch (err) {
    void logFrontendEvent('DEBUG', 'getGridArtworkDataUrl failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

interface SteamAppDetailsResult {
  details: any | null;
  timedOut?: boolean;
}

export function getSteamAppOverview(appId: number): any | null {
  const steamApps = (globalThis as any).SteamClient?.Apps;
  const overview = steamApps?.GetAppOverviewByAppID?.(appId) ?? null;
  return overview && typeof overview === 'object' ? overview : null;
}

// Best-effort synchronous display name resolution. Tries SteamClient +
// appStore overviews and collectionStore, matching the multi-tier lookup
// used by the library route observer in index.tsx. Returns the fallback
// (or '') when nothing works. Callers that already carry a name should
// pass it as fallback so we prefer their value.
export function resolveAppName(appId: number, fallback = ''): string {
  const trimmed = fallback ? String(fallback).trim() : '';
  if (trimmed) return trimmed;
  const g = globalThis as any;
  const ov = g.SteamClient?.Apps?.GetAppOverviewByAppID?.(appId)
    ?? g.appStore?.GetAppOverviewByAppID?.(appId)
    ?? null;
  const fromOv = ov?.display_name || ov?.strDisplayName || ov?.app_name || ov?.appname || '';
  if (fromOv) return String(fromOv);
  try {
    const collection = g.collectionStore?.allAppsCollection;
    const allApps = Array.isArray(collection?.allApps)
      ? collection.allApps
      : collection?.apps && Symbol.iterator in collection.apps
        ? Array.from(collection.apps)
        : [];
    const entry = allApps.find((app: any) => Number(app?.appid) === Number(appId));
    const fromEntry = entry?.display_name || entry?.strDisplayName || entry?.app_name || entry?.appname || entry?.name || '';
    if (fromEntry) return String(fromEntry);
  } catch { /* not available */ }
  return '';
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

// Returns the display name of the Proton/compat tool forced for this game via
// Steam game properties (Properties > Compatibility > Force a specific tool).
// Checks the app overview first (fast, synchronous), then falls back to
// RegisterForAppDetails (async). Returns empty string if nothing is set.
export async function getCompatToolForApp(appId: number): Promise<string> {
  // Fast path: app overview often has compat_tool_name or compat_tool_display_name
  const overview = getSteamAppOverview(appId)
    ?? (globalThis as any).appStore?.GetAppOverviewByAppID?.(appId);

  if (overview) {
    const candidates = [
      overview.compat_tool_display_name,
      overview.strCompatToolDisplayName,
      overview.compat_tool_name,
      overview.strCompatToolName,
    ];
    for (const c of candidates) {
      if (c && typeof c === 'string' && c.trim()) {
        void logFrontendEvent('DEBUG', 'getCompatToolForApp: found via overview', { appId, value: c });
        return c.trim();
      }
    }
  }

  // Slow path: RegisterForAppDetails
  const { details } = await getSteamAppDetails(appId, 1500);
  if (details) {
    const candidates = [
      details.strCompatToolDisplayName,
      details.strCompatToolName,
      details.compat_tool_display_name,
      details.compat_tool_name,
    ];
    for (const c of candidates) {
      if (c && typeof c === 'string' && c.trim()) {
        void logFrontendEvent('DEBUG', 'getCompatToolForApp: found via details', { appId, value: c });
        return c.trim();
      }
    }
  }

  void logFrontendEvent('DEBUG', 'getCompatToolForApp: no compat tool found', { appId });
  return '';
}

const PLAYTIME_FIELDS = [
  'minutes_playtime_forever',
  'nPlaytimeForever',
  'minutesPlaytimeForever',
  'playtime_forever',
];

function extractPlaytimeMinutes(src: any): { minutes: number; field: string | null } {
  if (!src || typeof src !== 'object') return { minutes: 0, field: null };
  for (const field of PLAYTIME_FIELDS) {
    const v = src[field];
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n > 0) return { minutes: Math.round(n), field };
  }
  return { minutes: 0, field: null };
}

// Lifetime playtime in minutes from Steam. Fast path reads the in-memory
// overview (synchronous); slow path uses RegisterForAppDetails so we always
// get a value even if the overview cache hasn't loaded the game yet.
export async function getSteamPlaytimeForeverMinutes(appId: number): Promise<number> {
  // Fast path: overview sources. GetAppOverviewByGameID is used by NonSteamPlaytime
  // and some client builds; GetAppOverviewByAppID is the more common name.
  const steamAppsOverview = getSteamAppOverview(appId);
  const appStore = (globalThis as any).appStore;
  const sources = [
    { label: 'SteamClient.Apps.GetAppOverviewByAppID', src: steamAppsOverview },
    { label: 'appStore.GetAppOverviewByAppID',         src: appStore?.GetAppOverviewByAppID?.(appId) },
    { label: 'appStore.GetAppOverviewByGameID',        src: appStore?.GetAppOverviewByGameID?.(appId) },
  ];
  for (const { label, src } of sources) {
    const { minutes, field } = extractPlaytimeMinutes(src);
    if (minutes > 0) {
      void logFrontendEvent('DEBUG', 'getSteamPlaytimeForeverMinutes: found via overview', { appId, minutes, source: label, field });
      return minutes;
    }
  }

  // Slow path: RegisterForAppDetails
  const { details, timedOut } = await getSteamAppDetails(appId, 2000);
  const { minutes, field } = extractPlaytimeMinutes(details);
  void logFrontendEvent('DEBUG', 'getSteamPlaytimeForeverMinutes: details path', { appId, minutes, field, timedOut: timedOut ?? !details });
  return minutes;
}
