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
  getTrackedConfigsForApp,
  addTrackedConfig,
  removeTrackedConfig,
  getTrackedConfig,
  getActiveConfigForApp,
  setActiveConfig,
  onConfigSaved,
  DEFAULT_PROFILE_NAME,
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
      profileName: '',
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
      profileName: '',
      protonVersion: 'GE-Proton9-1',
      launchOptions: 'PROTON_VERSION="GE-Proton9-1" %command%',
      enabledVars: {},
      appliedAt: 1000,
    };
    const config2: TrackedConfig = {
      appId: 100,
      appName: 'Game A',
      profileName: '',
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
      profileName: '',
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
      profileName: '',
      protonVersion: 'v1',
      launchOptions: 'PROTON_VERSION="v1" %command%',
      enabledVars: {},
      appliedAt: 1000,
    });
    addTrackedConfig({
      appId: 2,
      appName: 'B',
      profileName: '',
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
      profileName: '',
      protonVersion: 'v1',
      launchOptions: 'PROTON_VERSION="v1" %command%',
      enabledVars: {},
      appliedAt: 1000,
    });
    removeTrackedConfig(999);
    expect(getTrackedConfigs()).toHaveLength(1);
  });
});

describe('onConfigSaved hook', () => {
  it('calls registered callbacks after addTrackedConfig', () => {
    const spy = vi.fn();
    const unsub = onConfigSaved(spy);

    const config: TrackedConfig = {
      appId: 777,
      appName: 'Hook Test',
      profileName: '',
      protonVersion: 'GE-Proton10-1',
      launchOptions: '%command%',
      enabledVars: {},
      appliedAt: Date.now(),
    };
    addTrackedConfig(config);

    expect(spy).toHaveBeenCalledTimes(1);
    // Storage normalises empty profileName to 'Default' (multi-config-per-app
    // key), so the callback receives the normalised form.
    expect(spy).toHaveBeenCalledWith({ ...config, profileName: 'Default' });

    unsub();
    addTrackedConfig({ ...config, appId: 888 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not block save when callback throws', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    const unsub1 = onConfigSaved(bad);
    const unsub2 = onConfigSaved(good);

    addTrackedConfig({
      appId: 999,
      appName: 'Error Test',
      profileName: '',
      protonVersion: 'v1',
      launchOptions: '%command%',
      enabledVars: {},
      appliedAt: Date.now(),
    });

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(getTrackedConfig(999)).not.toBeNull();

    unsub1();
    unsub2();
  });
});

describe('multi-config-per-app', () => {
  beforeEach(() => { localStorageMock.clear(); });

  const cfg = (appId: number, profileName: string, appliedAt: number, extra: Partial<TrackedConfig> = {}): TrackedConfig => ({
    appId,
    appName: `App ${appId}`,
    profileName,
    protonVersion: 'GE-Proton10-1',
    launchOptions: '%command%',
    enabledVars: {},
    appliedAt,
    ...extra,
  });

  it('addTrackedConfig with different profileNames coexists (no overwrite)', () => {
    addTrackedConfig(cfg(100, 'Default', 1));
    addTrackedConfig(cfg(100, '60fps low', 2));
    const all = getTrackedConfigsForApp(100);
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.profileName).sort()).toEqual(['60fps low', 'Default']);
  });

  it('addTrackedConfig with the same profileName upserts', () => {
    addTrackedConfig(cfg(100, 'Default', 1, { protonVersion: 'GE-Proton9-1' }));
    addTrackedConfig(cfg(100, 'Default', 5, { protonVersion: 'GE-Proton10-1' }));
    const all = getTrackedConfigsForApp(100);
    expect(all).toHaveLength(1);
    expect(all[0].protonVersion).toBe('GE-Proton10-1');
    expect(all[0].appliedAt).toBe(5);
  });

  it('empty profileName normalises to DEFAULT_PROFILE_NAME on both read + write', () => {
    addTrackedConfig(cfg(100, '', 1));
    const stored = getTrackedConfigsForApp(100);
    expect(stored[0].profileName).toBe(DEFAULT_PROFILE_NAME);
    // Reading the same slot with '' or 'Default' should hit the same row.
    expect(getTrackedConfig(100, '')?.profileName).toBe(DEFAULT_PROFILE_NAME);
    expect(getTrackedConfig(100, DEFAULT_PROFILE_NAME)).toBeTruthy();
  });

  it('getTrackedConfig without profileName returns the first match (legacy shape)', () => {
    addTrackedConfig(cfg(100, 'Default', 1));
    addTrackedConfig(cfg(100, 'Alt', 2));
    const first = getTrackedConfig(100);
    expect(first).not.toBeNull();
    expect(first?.appId).toBe(100);
  });

  it('getTrackedConfig with profileName returns the exact match or null', () => {
    addTrackedConfig(cfg(100, 'Default', 1));
    addTrackedConfig(cfg(100, 'Alt', 2));
    expect(getTrackedConfig(100, 'Alt')?.profileName).toBe('Alt');
    expect(getTrackedConfig(100, 'Ghost')).toBeNull();
  });

  it('removeTrackedConfig without profileName drops every row for the app', () => {
    addTrackedConfig(cfg(100, 'Default', 1));
    addTrackedConfig(cfg(100, 'Alt', 2));
    removeTrackedConfig(100);
    expect(getTrackedConfigsForApp(100)).toEqual([]);
  });

  it('removeTrackedConfig with profileName drops only that row', () => {
    addTrackedConfig(cfg(100, 'Default', 1));
    addTrackedConfig(cfg(100, 'Alt', 2));
    removeTrackedConfig(100, 'Alt');
    const rest = getTrackedConfigsForApp(100);
    expect(rest).toHaveLength(1);
    expect(rest[0].profileName).toBe('Default');
  });

  it('getActiveConfigForApp returns the config with the newest appliedAt', () => {
    addTrackedConfig(cfg(100, 'Default', 1));
    addTrackedConfig(cfg(100, 'Alt', 50));
    addTrackedConfig(cfg(100, 'Other', 25));
    expect(getActiveConfigForApp(100)?.profileName).toBe('Alt');
  });

  it('getActiveConfigForApp returns null when the app is not tracked', () => {
    expect(getActiveConfigForApp(999)).toBeNull();
  });

  it('setActiveConfig bumps appliedAt so the target wins the active lookup', () => {
    addTrackedConfig(cfg(100, 'Default', 1));
    addTrackedConfig(cfg(100, 'Alt', 50));
    // Default is currently older; setActiveConfig should promote it.
    const promoted = setActiveConfig(100, 'Default');
    expect(promoted).not.toBeNull();
    expect(getActiveConfigForApp(100)?.profileName).toBe('Default');
  });

  it('setActiveConfig returns null when the target profile does not exist', () => {
    addTrackedConfig(cfg(100, 'Default', 1));
    expect(setActiveConfig(100, 'Ghost')).toBeNull();
  });
});
