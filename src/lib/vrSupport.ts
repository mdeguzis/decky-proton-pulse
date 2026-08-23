// src/lib/vrSupport.ts
// What VR support does a GAME have, according to Steam's own store metadata?
//
// Separate axis from how the reporter played it (see src/lib/vr.ts). This
// file only answers "could this be played in a headset", and the Submit Report
// form uses the answer to pick a sensible default Play Mode (#121).
//
// Steam encodes VR support as store category ids, the same ids the web
// pipeline reads off the appdetails payload (scripts/pipeline/common.py):
//
//   54       VR Only        -- there is no flatscreen mode, a headset is required
//   53, 31   VR Supported   -- playable either way
//
// The plugin has no appdetails HTTP client, so the ids come from whatever the
// running Steam client already has in memory. Client builds disagree on where
// they put them (a plain array, a Set, or behind a BHasStoreCategory helper),
// so every known shape is probed and the one that answered is logged.

import { getSteamAppOverview, isSteamShortcutApp } from './steamApps';
import { logFrontendEvent } from './logger';
import type { PlayMode } from './vr';

export const VR_ONLY_CATEGORY_ID = 54;
export const VR_SUPPORTED_CATEGORY_IDS = [53, 31];

/** Game-level VR capability. null means unknown, NOT "no VR". */
export type VrCapability = 'supported' | 'only' | null;

/**
 * Classify a list of Steam store category ids.
 *
 * An empty list is unknown rather than "not VR": every source here can fail to
 * populate, and treating a failed read as a definitive "no VR" would silently
 * force VR-only games onto the flatscreen default.
 */
export function vrCapabilityFromCategoryIds(ids: readonly number[] | null | undefined): VrCapability {
  if (!ids || !ids.length) return null;
  if (ids.includes(VR_ONLY_CATEGORY_ID)) return 'only';
  if (ids.some((id) => VR_SUPPORTED_CATEGORY_IDS.includes(id))) return 'supported';
  return null;
}

/**
 * Default Play Mode for a game's VR capability.
 *
 * VR-only games have no flatscreen mode, so VR is the only honest default.
 * Everything else defaults to Flatscreen, including games that merely SUPPORT
 * VR: this is a Deck plugin, and a report filed from the Deck's own screen is
 * overwhelmingly the flat one. The web form deliberately leaves the both-ways
 * case blank instead, because a desktop reporter is as likely to have a
 * headset attached as not.
 */
export function defaultPlayModeForCapability(capability: VrCapability): PlayMode {
  return capability === 'only' ? 'vr' : 'flat';
}

/** Coerce whatever a client build stored to a clean list of category ids. */
function toCategoryIds(raw: unknown): number[] {
  let values: unknown[];
  if (Array.isArray(raw)) values = raw;
  else if (raw instanceof Set) values = [...raw];
  else if (raw && typeof (raw as any)[Symbol.iterator] === 'function') values = [...(raw as any)];
  else return [];
  return values
    // Some builds store bare ids, others store { id } objects like the web
    // appdetails payload does.
    .map((v) => (typeof v === 'object' && v !== null ? (v as any).id : v))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/**
 * VR capability for one app, read from the running Steam client.
 *
 * Returns null for non-Steam shortcuts (no store page, so no categories) and
 * whenever no source answered. Never throws.
 */
export function getVrCapability(appId: number): VrCapability {
  if (!appId || isSteamShortcutApp(appId)) {
    void logFrontendEvent('DEBUG', 'getVrCapability: skipped, not a Steam app', {
      appId,
      source: 'isSteamShortcutApp',
    });
    return null;
  }

  const overview = getSteamAppOverview(appId)
    ?? (globalThis as any).appStore?.GetAppOverviewByAppID?.(appId)
    ?? null;

  if (overview) {
    const fields: [string, unknown][] = [
      ['store_category',       overview.store_category],
      ['m_setStoreCategories', overview.m_setStoreCategories],
      ['store_categories',     overview.store_categories],
      ['vecStoreCategories',   overview.vecStoreCategories],
    ];
    for (const [field, raw] of fields) {
      const ids = toCategoryIds(raw);
      if (!ids.length) continue;
      const capability = vrCapabilityFromCategoryIds(ids);
      void logFrontendEvent('DEBUG', 'getVrCapability: resolved from overview categories', {
        appId,
        capability,
        source: 'GetAppOverviewByAppID',
        field,
        categoryCount: ids.length,
      });
      return capability;
    }

    // Helper-only builds expose no readable list, just a predicate.
    if (typeof overview.BHasStoreCategory === 'function') {
      try {
        const only = !!overview.BHasStoreCategory(VR_ONLY_CATEGORY_ID);
        const supported = VR_SUPPORTED_CATEGORY_IDS.some((id) => !!overview.BHasStoreCategory(id));
        const capability: VrCapability = only ? 'only' : supported ? 'supported' : null;
        void logFrontendEvent('DEBUG', 'getVrCapability: resolved from BHasStoreCategory', {
          appId,
          capability,
          source: 'GetAppOverviewByAppID',
          field: 'BHasStoreCategory',
        });
        return capability;
      } catch (err) {
        void logFrontendEvent('WARNING', 'getVrCapability: BHasStoreCategory threw', {
          appId,
          source: 'GetAppOverviewByAppID',
          field: 'BHasStoreCategory',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Last resort. Coarser than the category ids -- it cannot tell VR-only
    // from VR-supported -- so it only ever reports 'supported'.
    if (overview.vr_supported === true) {
      void logFrontendEvent('DEBUG', 'getVrCapability: resolved from vr_supported flag', {
        appId,
        capability: 'supported',
        source: 'GetAppOverviewByAppID',
        field: 'vr_supported',
      });
      return 'supported';
    }
  }

  void logFrontendEvent('DEBUG', 'getVrCapability: no VR metadata available', {
    appId,
    capability: null,
    source: overview ? 'GetAppOverviewByAppID' : 'none',
    field: 'none',
  });
  return null;
}
