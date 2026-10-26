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

import { COMPAT_AUTO_TRIM_KEY, cleanupUnusedCompatTools, getCompatCleanupCandidates, installCompatTool, planCompatCleanup } from './compatTools';

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

describe('Clean up unused (#138)', () => {
  it('lists candidates from the backend', async () => {
    const rows = [{ directory_name: 'GE-Proton11-5-x86_64', display_name: 'GE-Proton11-5' }];
    const fn = callableMocks.get('get_compat_cleanup_candidates')!;
    fn.mockResolvedValueOnce(rows);
    await expect(getCompatCleanupCandidates('proton-ge', true)).resolves.toEqual(rows);
    expect(fn).toHaveBeenLastCalledWith('proton-ge', true);
  });

  it('throws on a malformed candidate list instead of returning empty', async () => {
    callableMocks.get('get_compat_cleanup_candidates')!.mockResolvedValueOnce({ nope: true });
    await expect(getCompatCleanupCandidates('proton-ge', false)).rejects.toThrow('non-array');
  });

  it('sends the confirmed names to the backend', async () => {
    const result = { removed: ['GE-Proton11-5-x86_64'], failed: [], skipped: [] };
    const fn = callableMocks.get('cleanup_unused_compat_tools')!;
    fn.mockResolvedValueOnce(result);
    await expect(cleanupUnusedCompatTools(['GE-Proton11-5-x86_64'], 'proton-ge', false)).resolves.toEqual(result);
    expect(fn).toHaveBeenCalledWith(['GE-Proton11-5-x86_64'], 'proton-ge', false);
  });
});

describe('planCompatCleanup (#138)', () => {
  const candidates = [
    { directory_name: 'Proton-CachyOS-Latest', display_name: 'Proton-CachyOS-Latest', family: 'Proton-CachyOS', family_tool_id: 'proton-cachyos' as const, is_slot: true },
    { directory_name: 'proton-cachyos-11.0', display_name: 'proton-cachyos-11.0', family: 'Proton-CachyOS', family_tool_id: 'proton-cachyos' as const },
    { directory_name: 'GE-Proton11-5-x86_64', display_name: 'GE-Proton11-5', family: null, family_tool_id: null },
  ];
  const label = (f: string) => `${f} (all versions)`;

  it('shows a whole unused family as one line but removes every member', () => {
    const plan = planCompatCleanup(candidates, () => false, label);
    expect(plan.lines).toEqual(['Proton-CachyOS (all versions)', 'GE-Proton11-5']);
    expect(plan.names).toEqual(['Proton-CachyOS-Latest', 'proton-cachyos-11.0', 'GE-Proton11-5-x86_64']);
    expect(plan.kept).toEqual([]);
  });

  it('leaves out a family whose auto-update is on', () => {
    const plan = planCompatCleanup(candidates, (id) => id === 'proton-cachyos', label);
    expect(plan.names).toEqual(['GE-Proton11-5-x86_64']);
    expect(plan.lines).toEqual(['GE-Proton11-5']);
    expect(plan.kept).toEqual(['Proton-CachyOS']);
  });

  it('falls back to the directory name when there is no display name', () => {
    const plan = planCompatCleanup([{ directory_name: 'X', display_name: '' }], () => false, label);
    expect(plan.lines).toEqual(['X']);
  });
});

