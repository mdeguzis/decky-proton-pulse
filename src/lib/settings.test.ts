// src/lib/settings.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSetting, setSetting } from './settings';

const localStorageStore: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); },
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
});
