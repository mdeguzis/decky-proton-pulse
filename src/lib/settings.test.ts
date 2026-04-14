// src/lib/settings.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSetting,
  setSetting,
  getAllPrefixedSettingsRaw,
  replaceAllPrefixedSettingsRaw,
  replacePrefixedSettingsSubsetRaw,
  onSettingsChanged,
} from './settings';

const localStorageStore: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); },
  key: (index: number) => Object.keys(localStorageStore)[index] ?? null,
  get length() { return Object.keys(localStorageStore).length; },
};

vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
});

describe('getSetting', () => {
  it('returns defaultValue when key is absent', () => {
    expect(getSetting('missing', 42)).toBe(42);
  });

  it('returns defaultValue for string when key is absent', () => {
    expect(getSetting('nope', 'hello')).toBe('hello');
  });

  it('returns parsed value when key exists', () => {
    localStorageMock.setItem('proton-pulse:myKey', JSON.stringify(99));
    expect(getSetting('myKey', 0)).toBe(99);
  });

  it('parses stored boolean correctly', () => {
    localStorageMock.setItem('proton-pulse:flag', JSON.stringify(true));
    expect(getSetting('flag', false)).toBe(true);
  });

  it('parses stored object correctly', () => {
    const obj = { a: 1, b: 'two' };
    localStorageMock.setItem('proton-pulse:obj', JSON.stringify(obj));
    expect(getSetting('obj', {})).toEqual(obj);
  });

  it('returns defaultValue on corrupt JSON', () => {
    localStorageMock.setItem('proton-pulse:bad', '{not valid json}}}');
    expect(getSetting('bad', 'fallback')).toBe('fallback');
  });
});

describe('setSetting', () => {
  it('stores value under prefixed key', () => {
    setSetting('volume', 75);
    expect(localStorageMock.getItem('proton-pulse:volume')).toBe('75');
  });

  it('stores string values as JSON', () => {
    setSetting('name', 'proton-pulse');
    expect(localStorageMock.getItem('proton-pulse:name')).toBe('"proton-pulse"');
  });

  it('round-trips through getSetting', () => {
    setSetting('roundtrip', { x: 10 });
    expect(getSetting('roundtrip', null)).toEqual({ x: 10 });
  });

  it('overwrites an existing value', () => {
    setSetting('count', 1);
    setSetting('count', 2);
    expect(getSetting('count', 0)).toBe(2);
  });

  it('notifies listeners when a setting changes', () => {
    const listener = vi.fn();
    const unsubscribe = onSettingsChanged(listener);

    setSetting('count', 2);

    expect(listener).toHaveBeenCalledWith('count');
    unsubscribe();
  });
});

describe('prefixed raw helpers', () => {
  it('exports all prefixed settings without the prefix', () => {
    setSetting('count', 2);
    setSetting('name', 'pulse');

    expect(getAllPrefixedSettingsRaw()).toEqual({
      count: '2',
      name: '"pulse"',
    });
  });

  it('replaces all prefixed settings and emits a bulk-change event', () => {
    setSetting('count', 1);
    localStorageMock.setItem('proton-pulse:stale', '"old"');
    const listener = vi.fn();
    const unsubscribe = onSettingsChanged(listener);

    replaceAllPrefixedSettingsRaw({
      fresh: '"new"',
    });

    expect(getAllPrefixedSettingsRaw()).toEqual({
      fresh: '"new"',
    });
    expect(listener).toHaveBeenCalledWith(null);
    unsubscribe();
  });

  it('replaces only the matching subset of prefixed settings', () => {
    localStorageMock.setItem('proton-pulse:language', '"en"');
    localStorageMock.setItem('proton-pulse:tracked-configs', '[{"appId":1}]');

    replacePrefixedSettingsSubsetRaw(
      {
        language: '"fr"',
      },
      (key) => key === 'language',
    );

    expect(localStorageMock.getItem('proton-pulse:language')).toBe('"fr"');
    expect(localStorageMock.getItem('proton-pulse:tracked-configs')).toBe('[{"appId":1}]');
  });
});
