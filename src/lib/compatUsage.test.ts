// src/lib/compatUsage.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => ({
  useSyncExternalStore: (_s: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

vi.mock('./steamApps', () => ({
  resolveAppName: vi.fn((appId: number) => ({
    257510: 'The Talos Principle',
    4092442637: 'Planet of Lana',
    32380: 'Alpha Protocol',
  } as Record<number, string>)[appId] ?? ''),
}));

import { compatPendingRestartLabel, compatUsageGameNames, compatUsageLabel, sortRollingSlotsFirst } from './compatUsage';

describe('compatUsageLabel', () => {
  it('shows the game count, singular and plural', () => {
    expect(compatUsageLabel({ used_by_app_ids: ['257510'] })).toBe('used by 1 game');
    expect(compatUsageLabel({ used_by_app_ids: ['257510', '32380'] })).toBe('used by 2 games');
  });

  it('shows zero for a tool no game uses', () => {
    expect(compatUsageLabel({ used_by_app_ids: [] })).toBe('used by 0 games');
  });

  it('shows nothing when usage is unknown (config.vdf unreadable)', () => {
    // null must not render as "used by 0 games": that would invite deleting
    // a tool we could not actually check.
    expect(compatUsageLabel({ used_by_app_ids: null })).toBeNull();
    expect(compatUsageLabel({})).toBeNull();
    expect(compatUsageLabel(undefined)).toBeNull();
  });

  it('calls out the Steam default tool', () => {
    expect(compatUsageLabel({ used_by_app_ids: [], is_steam_default: true })).toBe('Steam default');
    expect(compatUsageLabel({ used_by_app_ids: ['257510'], is_steam_default: true }))
      .toBe('Steam default, used by 1 game');
  });
});

describe('compatUsageGameNames', () => {
  it('resolves names and sorts them', () => {
    expect(compatUsageGameNames(['4092442637', '257510', '32380']))
      .toEqual(['Alpha Protocol', 'Planet of Lana', 'The Talos Principle']);
  });

  it('falls back to the app id for games no longer in the library', () => {
    expect(compatUsageGameNames(['601360', '257510'])).toEqual(['AppID 601360', 'The Talos Principle']);
  });
});

describe('sortRollingSlotsFirst', () => {
  it('moves the rolling slot to the top and keeps the rest in order', () => {
    const rows = [
      { key: '11-7', tool: { managed_slot: 'versioned' } },
      { key: '11-5', tool: { managed_slot: 'versioned' } },
      { key: 'latest', tool: { managed_slot: 'latest' } },
      { key: 'custom', tool: null },
    ];
    expect(sortRollingSlotsFirst(rows).map((r) => r.key)).toEqual(['latest', '11-7', '11-5', 'custom']);
  });

  it('does not mutate the input', () => {
    const rows = [{ key: 'a', tool: { managed_slot: 'versioned' } }, { key: 'b', tool: { managed_slot: 'latest' } }];
    sortRollingSlotsFirst(rows);
    expect(rows.map((r) => r.key)).toEqual(['a', 'b']);
  });
});

describe('compatPendingRestartLabel (#137)', () => {
  it('labels a build Steam has not loaded yet', () => {
    expect(compatPendingRestartLabel({ pending_restart: true })).toBe('pending restart');
  });

  it('shows nothing when loaded, unknown or missing', () => {
    expect(compatPendingRestartLabel({ pending_restart: false })).toBeNull();
    expect(compatPendingRestartLabel({ pending_restart: null })).toBeNull();
    expect(compatPendingRestartLabel({})).toBeNull();
    expect(compatPendingRestartLabel(null)).toBeNull();
  });
});

