import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCustomToggles,
  getScopedCustomToggles,
  inferCustomToggleValueType,
  normalizeCustomToggleValue,
  setCustomToggles,
  syncScopedCustomToggles,
  type StoredCustomToggle,
} from './customToggles';

const localStorageStore: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach((key) => delete localStorageStore[key]); },
};

vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
});

describe('custom toggle storage', () => {
  it('trims stored values and filters invalid toggles', () => {
    setCustomToggles([
      { id: 'a', title: '  MangoHud  ', key: '  MANGOHUD  ', scope: 'global', valueType: 'string', value: '  1  ' },
      { id: 'b', title: '   ', key: 'BROKEN', scope: 'global', valueType: 'string', value: 'x' },
      { id: 'c', title: 'Raw arg', key: '   ', scope: 'global', valueType: 'string', value: '  mangohud  ' },
      { id: 'd', title: 'Missing payload', key: '   ', scope: 'global', valueType: 'string', value: '   ' },
    ]);

    expect(getCustomToggles()).toEqual([
      { id: 'a', title: 'MangoHud', key: 'MANGOHUD', scope: 'global', valueType: 'string', value: '1' },
      { id: 'c', title: 'Raw arg', key: '', scope: 'global', valueType: 'string', value: 'mangohud' },
    ]);
  });

  it('returns only scoped toggles for the requested app', () => {
    const toggles: StoredCustomToggle[] = [
      { id: 'g', title: 'Global', key: 'DXVK_ASYNC', scope: 'global', valueType: 'bool', value: '1' },
      { id: 'a', title: 'Game', key: 'MY_GAME_FLAG', scope: 'game', appId: 10, valueType: 'string', value: 'abc' },
      { id: 'b', title: 'Other Game', key: 'OTHER_FLAG', scope: 'game', appId: 20, valueType: 'string', value: 'xyz' },
    ];
    setCustomToggles(toggles);

    expect(getScopedCustomToggles(10)).toEqual([toggles[0], toggles[1]]);
  });

  it('syncs current app toggles without deleting other app entries', () => {
    const existing: StoredCustomToggle[] = [
      { id: 'g', title: 'Global', key: 'GLOBAL_FLAG', scope: 'global', valueType: 'bool', value: '1' },
      { id: 'old', title: 'Old game', key: 'OLD_FLAG', scope: 'game', appId: 10, valueType: 'string', value: 'old' },
      { id: 'other', title: 'Other game', key: 'OTHER_FLAG', scope: 'game', appId: 20, valueType: 'string', value: 'other' },
    ];
    setCustomToggles(existing);

    syncScopedCustomToggles(10, [
      { id: 'g2', title: 'Global 2', key: 'NEW_GLOBAL', scope: 'global', valueType: 'bool', value: '1' },
      { id: 'new', title: 'New game', key: 'NEW_FLAG', scope: 'game', appId: 10, valueType: 'int', value: '2' },
    ]);

    expect(getCustomToggles()).toEqual([
      existing[2],
      { id: 'g2', title: 'Global 2', key: 'NEW_GLOBAL', scope: 'global', valueType: 'bool', value: '1' },
      { id: 'new', title: 'New game', key: 'NEW_FLAG', scope: 'game', appId: 10, valueType: 'int', value: '2' },
    ]);
  });
});

describe('custom toggle values', () => {
  it('normalizes booleans to proton-friendly values', () => {
    expect(normalizeCustomToggleValue('bool', 'true')).toBe('1');
    expect(normalizeCustomToggleValue('bool', 'off')).toBe('0');
    expect(normalizeCustomToggleValue('bool', '')).toBe('0');
  });

  it('infers value types from raw values', () => {
    expect(inferCustomToggleValueType('1')).toBe('bool');
    expect(inferCustomToggleValueType('42')).toBe('int');
    expect(inferCustomToggleValueType('3.5')).toBe('float');
    expect(inferCustomToggleValueType('mangohud')).toBe('string');
  });

  it('normalizes integer and float values when they parse cleanly', () => {
    expect(normalizeCustomToggleValue('int', ' 42.9 ')).toBe('42');
    expect(normalizeCustomToggleValue('int', 'abc')).toBe('abc');
    expect(normalizeCustomToggleValue('float', ' 3.50 ')).toBe('3.5');
    expect(normalizeCustomToggleValue('float', 'abc')).toBe('abc');
  });
});
