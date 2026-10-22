// src/lib/antiCheat.ts
//
// Anti-cheat compatibility per Steam app (#129), from the AreWeAntiCheatYet
// mirror the web app publishes nightly:
//   https://www.proton-pulse.com/anti-cheat.json
//   { "<steamAppId>": { "status": "supported"|"running"|"broken"|"denied"|"planned"|null,
//                       "vendors": ["Easy Anti-Cheat", ...] } }
//
// This is a separate signal from the tier. A game can be Gold for single
// player while its anti-cheat blocks Linux, so online play fails. The tier
// math in scoring.ts does not read this file.
//
// One fetch per session, memoized, persisted the same way as the report
// cache (setSetting + the user's cache TTL) so a warm restart or an offline
// Deck still has the last copy. A failed fetch falls back to that stale copy
// and logs; with no copy at all the map is empty and no badge renders.

import { fetchNoCors } from '@decky/api';
import { getSetting, setSetting } from './settings';
import { getCacheTtlMs } from './cache';
import { logFrontendEvent } from './logger';

export const ANTI_CHEAT_URL = 'https://www.proton-pulse.com/anti-cheat.json';
const STORAGE_KEY = 'anti-cheat-cache';

export interface AntiCheatEntry {
  status: string | null;
  vendors: string[] | null;
}

export type AntiCheatMap = Record<string, AntiCheatEntry>;

interface StoredMap {
  fetchedAt: number;
  map: AntiCheatMap;
}

let _map: AntiCheatMap | null = null;
let _pending: Promise<AntiCheatMap> | null = null;

function isMap(data: unknown): data is AntiCheatMap {
  return !!data && typeof data === 'object' && !Array.isArray(data);
}

function readStored(): StoredMap | null {
  const stored = getSetting<StoredMap | null>(STORAGE_KEY, null);
  if (!stored || typeof stored.fetchedAt !== 'number' || !isMap(stored.map)) return null;
  return stored;
}

async function fetchMap(): Promise<AntiCheatMap> {
  const stored = readStored();
  const ageMs = stored ? Date.now() - stored.fetchedAt : null;
  if (stored && ageMs !== null && ageMs < getCacheTtlMs()) {
    void logFrontendEvent('DEBUG', 'antiCheat: using stored map', {
      source: 'settings:' + STORAGE_KEY, entries: Object.keys(stored.map).length, ageMs,
    });
    return stored.map;
  }
  try {
    const resp = await fetchNoCors(ANTI_CHEAT_URL);
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    const data: unknown = await resp.json();
    // Cloudflare answers a missing file with 200 + the HTML shell; json()
    // throws on that, and an array or scalar is just as wrong.
    if (!isMap(data)) throw new Error('payload is not an object map');
    try {
      setSetting<StoredMap>(STORAGE_KEY, { fetchedAt: Date.now(), map: data });
    } catch (err) {
      void logFrontendEvent('WARNING', 'antiCheat: could not persist map', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    void logFrontendEvent('DEBUG', 'antiCheat: fetched map', {
      source: ANTI_CHEAT_URL, entries: Object.keys(data).length,
    });
    return data;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (stored) {
      void logFrontendEvent('WARNING', 'antiCheat: fetch failed, using stale stored map', {
        source: ANTI_CHEAT_URL, error, ageMs, entries: Object.keys(stored.map).length,
      });
      return stored.map;
    }
    void logFrontendEvent('WARNING', 'antiCheat: fetch failed and no stored map, badges disabled this session', {
      source: ANTI_CHEAT_URL, error,
    });
    return {};
  }
}

/** Load + memoize the map. Never throws; see the module comment for fallbacks. */
export function loadAntiCheatMap(): Promise<AntiCheatMap> {
  if (_map) return Promise.resolve(_map);
  if (!_pending) {
    _pending = fetchMap().then((m) => { _map = m; _pending = null; return m; });
  }
  return _pending;
}

/** Entry for one Steam appid from the loaded map, or null (not loaded / not listed). */
export function antiCheatForAppSync(appId: string | number | null | undefined): AntiCheatEntry | null {
  if (!_map || appId === null || appId === undefined) return null;
  return _map[String(appId)] ?? null;
}

export async function getAntiCheatForApp(appId: string | number): Promise<AntiCheatEntry | null> {
  await loadAntiCheatMap();
  return antiCheatForAppSync(appId);
}

/**
 * Which badge to show, or null for none. Per #129: a clear warning for
 * Blocked/Denied, a softer note for Running (unofficial) and Planned, and
 * nothing for Supported or for games with no entry. Supported needs no
 * badge because the tier already tells the truth for online play there.
 */
export type AntiCheatBadgeKind = 'blocked' | 'denied' | 'unofficial' | 'planned';

export function antiCheatBadgeKind(entry: AntiCheatEntry | null): AntiCheatBadgeKind | null {
  switch (entry?.status) {
    case 'broken': return 'blocked';
    case 'denied': return 'denied';
    case 'running': return 'unofficial';
    case 'planned': return 'planned';
    default: return null;
  }
}

/** Warning badges (red); the rest are the softer amber note. */
export function isAntiCheatWarning(kind: AntiCheatBadgeKind | null): boolean {
  return kind === 'blocked' || kind === 'denied';
}

export const ANTI_CHEAT_COLORS: Record<'warning' | 'note', { bg: string; color: string; border: string }> = {
  warning: { bg: '#3a1418', color: '#ff8a8a', border: '#d0505a' },
  note: { bg: '#3a2a10', color: '#f2c26b', border: '#e8a33d' },
};

/** Test hook: forget the memoized map so each test starts cold. */
export function _resetAntiCheatForTests(): void {
  _map = null;
  _pending = null;
}
