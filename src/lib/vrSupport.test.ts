import { afterEach, describe, expect, it, vi } from 'vitest';

const { logFrontendEventMock } = vi.hoisted(() => ({
  logFrontendEventMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('./logger', () => ({ logFrontendEvent: logFrontendEventMock }));

// vrSupport -> steamApps -> @decky/api. Stub the callable so the test env does
// not try to load the plugin manifest, which only exists inside Steam.
vi.mock('@decky/api', () => ({
  callable: vi.fn(() => vi.fn().mockResolvedValue({ dataUrl: null })),
}));

import {
  VR_ONLY_CATEGORY_ID,
  VR_SUPPORTED_CATEGORY_IDS,
  defaultPlayModeForCapability,
  getVrCapability,
  vrCapabilityFromCategoryIds,
} from './vrSupport';

const STEAM_APP_ID = 620;

function stubOverview(overview: unknown) {
  (globalThis as any).SteamClient = {
    Apps: { GetAppOverviewByAppID: () => overview },
  };
}

afterEach(() => {
  delete (globalThis as any).SteamClient;
  delete (globalThis as any).appStore;
  logFrontendEventMock.mockClear();
});

describe('vrCapabilityFromCategoryIds', () => {
  it('reads 54 as VR only', () => {
    expect(vrCapabilityFromCategoryIds([2, VR_ONLY_CATEGORY_ID])).toBe('only');
  });

  it('reads 53 and 31 as VR supported', () => {
    for (const id of VR_SUPPORTED_CATEGORY_IDS) {
      expect(vrCapabilityFromCategoryIds([2, id])).toBe('supported');
    }
  });

  it('prefers VR only when both are present', () => {
    expect(vrCapabilityFromCategoryIds([53, VR_ONLY_CATEGORY_ID])).toBe('only');
  });

  it('returns null for a game with no VR category', () => {
    expect(vrCapabilityFromCategoryIds([1, 2, 9])).toBeNull();
  });

  it('returns null for an empty or missing list rather than claiming not-VR', () => {
    // Every source here can fail to populate. Treating a failed read as a
    // definitive "no VR" would force VR-only games onto the flat default.
    expect(vrCapabilityFromCategoryIds([])).toBeNull();
    expect(vrCapabilityFromCategoryIds(null)).toBeNull();
    expect(vrCapabilityFromCategoryIds(undefined)).toBeNull();
  });
});

describe('defaultPlayModeForCapability', () => {
  it('defaults a VR-only game to VR', () => {
    expect(defaultPlayModeForCapability('only')).toBe('vr');
  });

  it('defaults a VR-supported game to flatscreen', () => {
    // Deliberate divergence from the web form, which leaves the both-ways case
    // blank. This is a Deck plugin: a report filed from the Deck's own screen
    // is overwhelmingly the flat one.
    expect(defaultPlayModeForCapability('supported')).toBe('flat');
  });

  it('defaults an unknown game to flatscreen', () => {
    expect(defaultPlayModeForCapability(null)).toBe('flat');
  });
});

describe('getVrCapability', () => {
  it('reads a plain store_category array', () => {
    stubOverview({ store_category: [2, VR_ONLY_CATEGORY_ID] });
    expect(getVrCapability(STEAM_APP_ID)).toBe('only');
  });

  it('reads a Set of categories', () => {
    stubOverview({ m_setStoreCategories: new Set([2, 53]) });
    expect(getVrCapability(STEAM_APP_ID)).toBe('supported');
  });

  it('reads a list of { id } objects, the appdetails payload shape', () => {
    stubOverview({ store_categories: [{ id: 2 }, { id: VR_ONLY_CATEGORY_ID }] });
    expect(getVrCapability(STEAM_APP_ID)).toBe('only');
  });

  it('falls back to the BHasStoreCategory predicate when no list is readable', () => {
    stubOverview({
      store_category: [],
      BHasStoreCategory: (id: number) => id === VR_ONLY_CATEGORY_ID,
    });
    expect(getVrCapability(STEAM_APP_ID)).toBe('only');
  });

  it('survives a BHasStoreCategory that throws', () => {
    stubOverview({
      BHasStoreCategory: () => { throw new Error('not implemented on this build'); },
    });
    expect(getVrCapability(STEAM_APP_ID)).toBeNull();
    expect(logFrontendEventMock).toHaveBeenCalledWith(
      'WARNING',
      expect.stringContaining('BHasStoreCategory threw'),
      expect.objectContaining({ appId: STEAM_APP_ID }),
    );
  });

  it('falls back to the coarse vr_supported flag as supported, never only', () => {
    // The flag cannot distinguish the two, and guessing "only" would put a
    // flat-playable game on the VR default.
    stubOverview({ vr_supported: true });
    expect(getVrCapability(STEAM_APP_ID)).toBe('supported');
  });

  it('falls back to appStore when SteamClient has no overview', () => {
    (globalThis as any).SteamClient = { Apps: { GetAppOverviewByAppID: () => null } };
    (globalThis as any).appStore = {
      GetAppOverviewByAppID: () => ({ store_category: [VR_ONLY_CATEGORY_ID] }),
    };
    expect(getVrCapability(STEAM_APP_ID)).toBe('only');
  });

  it('returns null for a non-Steam shortcut, which has no store page', () => {
    expect(getVrCapability(3_000_000_000)).toBeNull();
  });

  it('returns null for no app id', () => {
    expect(getVrCapability(0)).toBeNull();
  });

  it('returns null when nothing answered', () => {
    stubOverview({});
    expect(getVrCapability(STEAM_APP_ID)).toBeNull();
  });

  it('logs which source and field produced the answer', () => {
    stubOverview({ store_category: [VR_ONLY_CATEGORY_ID] });
    getVrCapability(STEAM_APP_ID);
    expect(logFrontendEventMock).toHaveBeenCalledWith(
      'DEBUG',
      expect.stringContaining('resolved from overview categories'),
      expect.objectContaining({
        appId: STEAM_APP_ID,
        capability: 'only',
        source: 'GetAppOverviewByAppID',
        field: 'store_category',
      }),
    );
  });
});
