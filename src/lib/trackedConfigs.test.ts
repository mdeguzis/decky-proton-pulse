// src/lib/trackedConfigs.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

import {
  getTrackedConfigs,
  addTrackedConfig,
  removeTrackedConfig,
  getTrackedConfig,
  type TrackedConfig,
} from './trackedConfigs';

describe('trackedConfigs', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns empty array when no configs exist', () => {
    expect(getTrackedConfigs()).toEqual([]);
  });

  it('addTrackedConfig stores a config and getTrackedConfigs retrieves it', () => {
    const config: TrackedConfig = {
      appId: 12345,
      appName: 'Test Game',
      protonVersion: 'GE-Proton9-27',
      launchOptions: 'PROTON_VERSION="GE-Proton9-27" %command%',
      enabledVars: {},
      appliedAt: Date.now(),
    };
    addTrackedConfig(config);
    const all = getTrackedConfigs();
    expect(all).toHaveLength(1);
    expect(all[0].appId).toBe(12345);
  });

  it('addTrackedConfig upserts by appId', () => {
    const config1: TrackedConfig = {
      appId: 100,
      appName: 'Game A',
      protonVersion: 'GE-Proton9-1',
      launchOptions: 'PROTON_VERSION="GE-Proton9-1" %command%',
      enabledVars: {},
      appliedAt: 1000,
    };
    const config2: TrackedConfig = {
      appId: 100,
      appName: 'Game A',
      protonVersion: 'GE-Proton9-5',
      launchOptions: 'PROTON_VERSION="GE-Proton9-5" %command%',
      enabledVars: { MANGOHUD: '1' },
      appliedAt: 2000,
    };
    addTrackedConfig(config1);
    addTrackedConfig(config2);
    const all = getTrackedConfigs();
    expect(all).toHaveLength(1);
    expect(all[0].protonVersion).toBe('GE-Proton9-5');
    expect(all[0].enabledVars).toEqual({ MANGOHUD: '1' });
  });

  it('getTrackedConfig returns null for unknown appId', () => {
    expect(getTrackedConfig(999)).toBeNull();
  });

  it('getTrackedConfig returns the config for a known appId', () => {
    addTrackedConfig({
      appId: 42,
      appName: 'Found',
      protonVersion: 'GE-Proton10-1',
      launchOptions: 'PROTON_VERSION="GE-Proton10-1" %command%',
      enabledVars: {},
      appliedAt: Date.now(),
    });
    const found = getTrackedConfig(42);
    expect(found).not.toBeNull();
    expect(found!.appName).toBe('Found');
  });

  it('removeTrackedConfig removes by appId', () => {
    addTrackedConfig({
      appId: 1,
      appName: 'A',
      protonVersion: 'v1',
      launchOptions: 'PROTON_VERSION="v1" %command%',
      enabledVars: {},
      appliedAt: 1000,
    });
    addTrackedConfig({
      appId: 2,
      appName: 'B',
      protonVersion: 'v2',
      launchOptions: 'PROTON_VERSION="v2" %command%',
      enabledVars: {},
      appliedAt: 2000,
    });
    removeTrackedConfig(2);
    expect(getTrackedConfigs()).toHaveLength(1);
    expect(getTrackedConfigs()[0].appId).toBe(1);
  });

  it('removeTrackedConfig is a no-op for unknown appId', () => {
    addTrackedConfig({
      appId: 1,
      appName: 'A',
      protonVersion: 'v1',
      launchOptions: 'PROTON_VERSION="v1" %command%',
      enabledVars: {},
      appliedAt: 1000,
    });
    removeTrackedConfig(999);
    expect(getTrackedConfigs()).toHaveLength(1);
  });
});
