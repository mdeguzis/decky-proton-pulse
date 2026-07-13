// src/lib/gameSource.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callableMocks } = vi.hoisted(() => ({
  callableMocks: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock('@decky/api', () => ({
  callable: vi.fn((name: string) => {
    const fn = vi.fn();
    callableMocks.set(name, fn);
    return fn;
  }),
}));

import {
  appTypeFromSource,
  nativeAppIdFromSource,
  getGameSource,
  getShortcutName,
  type GameSourceInfo,
} from './gameSource';

function info(overrides: Partial<GameSourceInfo> = {}): GameSourceInfo {
  return {
    is_steam: false,
    source: 'Non-Steam',
    steam_app_id_match: null,
    full_game_app_id: null,
    full_game_name: null,
    gog_product_id: null,
    epic_game_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  callableMocks.forEach((fn) => fn.mockReset());
});

describe('appTypeFromSource', () => {
  it('returns steam when is_steam', () => {
    expect(appTypeFromSource(info({ is_steam: true }))).toBe('steam');
  });
  it('returns gog when a gog product id is present', () => {
    expect(appTypeFromSource(info({ gog_product_id: '123' }))).toBe('gog');
  });
  it('returns epic when an epic game id is present', () => {
    expect(appTypeFromSource(info({ epic_game_id: 'abc' }))).toBe('epic');
  });
  it('falls back to source label GOG', () => {
    expect(appTypeFromSource(info({ source: 'GOG' }))).toBe('gog');
  });
  it('falls back to source label Epic', () => {
    expect(appTypeFromSource(info({ source: 'Epic' }))).toBe('epic');
  });
  it('returns nonsteam otherwise', () => {
    expect(appTypeFromSource(info())).toBe('nonsteam');
  });
});

describe('nativeAppIdFromSource', () => {
  it('prefixes gog ids', () => {
    expect(nativeAppIdFromSource(info({ gog_product_id: '55' }), 7)).toBe('gog:55');
  });
  it('prefixes epic ids', () => {
    expect(nativeAppIdFromSource(info({ epic_game_id: 'xx' }), 7)).toBe('epic:xx');
  });
  it('uses a steam app id match when present', () => {
    expect(nativeAppIdFromSource(info({ steam_app_id_match: '620' }), 7)).toBe('620');
  });
  it('falls back to the numeric app id', () => {
    expect(nativeAppIdFromSource(info(), 7)).toBe('7');
  });
});

describe('getGameSource', () => {
  it('returns the backend result', async () => {
    const expected = info({ is_steam: true });
    callableMocks.get('get_game_source')!.mockResolvedValue(expected);
    const result = await getGameSource(620, 'Portal 2');
    expect(callableMocks.get('get_game_source')).toHaveBeenCalledWith('620', 'Portal 2');
    expect(result).toBe(expected);
  });

  it('returns null when the call throws', async () => {
    callableMocks.get('get_game_source')!.mockRejectedValue(new Error('offline'));
    expect(await getGameSource(620, 'Portal 2')).toBeNull();
  });
});

describe('getShortcutName', () => {
  it('returns the backend name', async () => {
    callableMocks.get('get_shortcut_name')!.mockResolvedValue('My Game');
    expect(await getShortcutName(99)).toBe('My Game');
    expect(callableMocks.get('get_shortcut_name')).toHaveBeenCalledWith('99');
  });

  it('returns an empty string when the call throws', async () => {
    callableMocks.get('get_shortcut_name')!.mockRejectedValue(new Error('offline'));
    expect(await getShortcutName(99)).toBe('');
  });
});
