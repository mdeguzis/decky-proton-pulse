// src/lib/compatTools.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callableMocks, settings } = vi.hoisted(() => ({
  callableMocks: new Map<string, ReturnType<typeof vi.fn>>(),
  settings: new Map<string, unknown>(),
}));

vi.mock('@decky/api', () => ({
  callable: vi.fn((name: string) => {
    const fn = vi.fn().mockResolvedValue({ success: true, message: 'queued' });
    callableMocks.set(name, fn);
    return fn;
  }),
}));

vi.mock('./settings', () => ({
  getSetting: vi.fn((key: string, fallback: unknown) => (settings.has(key) ? settings.get(key) : fallback)),
}));

import { COMPAT_AUTO_TRIM_KEY, installCompatTool } from './compatTools';

describe('installCompatTool auto-trim flag (#133)', () => {
  beforeEach(() => {
    settings.clear();
    callableMocks.get('install_compat_tool')!.mockClear();
  });

  it('sends prune_unused=false when the setting was never set', async () => {
    await installCompatTool('proton-ge', 'GE-Proton11-11', true);
    expect(callableMocks.get('install_compat_tool')).toHaveBeenCalledWith('proton-ge', 'GE-Proton11-11', true, false, false);
  });

  it('sends prune_unused=true when auto-trim is on', async () => {
    settings.set(COMPAT_AUTO_TRIM_KEY, true);
    await installCompatTool('proton-cachyos', null, true, false);
    expect(callableMocks.get('install_compat_tool')).toHaveBeenCalledWith('proton-cachyos', null, true, false, true);
  });

  it('treats a non-boolean stored value as off', async () => {
    settings.set(COMPAT_AUTO_TRIM_KEY, 'yes');
    await installCompatTool('proton-ge', 'GE-Proton11-11', true);
    expect(callableMocks.get('install_compat_tool')).toHaveBeenCalledWith('proton-ge', 'GE-Proton11-11', true, false, false);
  });
});

describe('trimmedDirectories', () => {
  it('flattens removed dirs across tools', async () => {
    const { trimmedDirectories } = await import('./compatTools');
    expect(trimmedDirectories({
      'proton-ge': { ok: true, removed: ['GE-Proton11-6-x86_64'], failed: {} },
      'proton-cachyos': { ok: false, removed: [], failed: {}, reason: 'usage-unavailable' },
    })).toEqual(['GE-Proton11-6-x86_64']);
  });
});

describe('trimUnusedCompatVersions', () => {
  it('calls the backend and returns the per-tool outcomes', async () => {
    const { trimUnusedCompatVersions } = await import('./compatTools');
    const tools = { 'proton-ge': { ok: true, removed: [], failed: {} } };
    callableMocks.get('trim_unused_compat_versions')!.mockResolvedValueOnce({ tools });
    expect(await trimUnusedCompatVersions()).toEqual(tools);
  });
});
