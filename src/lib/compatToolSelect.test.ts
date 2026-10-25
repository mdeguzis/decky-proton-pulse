import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { logMock, toastMock } = vi.hoisted(() => ({ logMock: vi.fn(), toastMock: vi.fn() }));
vi.mock('./logger', () => ({ logFrontendEvent: logMock }));
vi.mock('./notify', () => ({ toaster: { toast: toastMock } }));
vi.mock('./i18n', () => ({ t: () => ({ extras: { compatToolNotSet: (v: string) => `not set: ${v}` } }) }));

import {
  matchCompatTool, applyCompatToolForVersion, applyCompatToolAndNotify,
  isSteamDefaultProton, loadSteamDefaultTool, steamDefaultToolSync, _resetSteamDefaultForTests,
} from './compatToolSelect';

const TOOLS = [
  { strToolName: 'proton_9', strDisplayName: 'Proton 9.0-4' },
  { strToolName: 'proton_experimental', strDisplayName: 'Proton Experimental' },
  { strToolName: 'GE-Proton10-1', strDisplayName: 'GE-Proton10-1' },
  { strToolName: 'Proton-GE-Latest', strDisplayName: 'Proton-GE-Latest (GE-Proton10-3)' },
];

let specify: ReturnType<typeof vi.fn>;
let available: ReturnType<typeof vi.fn>;

beforeEach(() => {
  logMock.mockReset();
  toastMock.mockReset();
  specify = vi.fn();
  available = vi.fn().mockResolvedValue(TOOLS);
  (globalThis as any).SteamClient = { Apps: { SpecifyCompatTool: specify, GetAvailableCompatTools: available } };
});
afterEach(() => {
  delete (globalThis as any).SteamClient;
  delete (globalThis as any).settingsStore;
  _resetSteamDefaultForTests();
  vi.useRealTimers();
});

describe('matchCompatTool', () => {
  it('matches the internal name, then the display name, case-insensitively', () => {
    expect(matchCompatTool('ge-proton10-1', TOOLS)?.strToolName).toBe('GE-Proton10-1');
    expect(matchCompatTool('Proton Experimental', TOOLS)?.strToolName).toBe('proton_experimental');
    expect(matchCompatTool('Proton 9.0-4', TOOLS)?.strToolName).toBe('proton_9');
  });

  it('ignores spaces, dashes and underscores as a last resort', () => {
    expect(matchCompatTool('proton experimental', TOOLS)?.strToolName).toBe('proton_experimental');
    expect(matchCompatTool('Proton_9.0_4', TOOLS)?.strToolName).toBe('proton_9');
  });

  it('never prefix-matches a different version', () => {
    expect(matchCompatTool('GE-Proton10', TOOLS)).toBeNull();
    expect(matchCompatTool('Proton 9.0', TOOLS)).toBeNull();
    expect(matchCompatTool('GE-Proton10-3', TOOLS)).toBeNull();
    expect(matchCompatTool('   ', TOOLS)).toBeNull();
  });
});

describe('applyCompatToolForVersion (#92)', () => {
  it('sets the matched tool through SpecifyCompatTool with its internal name', async () => {
    await expect(applyCompatToolForVersion(252490, 'Proton 9.0-4'))
      .resolves.toEqual({ status: 'set', toolName: 'proton_9', displayName: 'Proton 9.0-4' });
    expect(available).toHaveBeenCalledWith(252490);
    expect(specify).toHaveBeenCalledWith(252490, 'proton_9');
    expect(logMock).toHaveBeenCalledWith('INFO', 'compatTool: set Steam compat tool for app', expect.objectContaining({ toolName: 'proton_9' }));
  });

  it('leaves Steam alone when the config has no version', async () => {
    await expect(applyCompatToolForVersion(1, '')).resolves.toEqual({ status: 'no-version' });
    await expect(applyCompatToolForVersion(1, null)).resolves.toEqual({ status: 'no-version' });
    expect(available).not.toHaveBeenCalled();
    expect(specify).not.toHaveBeenCalled();
  });

  it('does not call SpecifyCompatTool when nothing installed matches', async () => {
    await expect(applyCompatToolForVersion(1, 'GE-Proton8-25')).resolves.toEqual({ status: 'no-match', available: 4 });
    expect(specify).not.toHaveBeenCalled();
    expect(logMock).toHaveBeenCalledWith('WARNING', 'compatTool: no installed tool matches the config version',
      expect.objectContaining({ version: 'GE-Proton8-25', available: TOOLS.map((t) => t.strToolName) }));
  });

  it('reports unavailable when the Steam API is missing', async () => {
    (globalThis as any).SteamClient = { Apps: {} };
    await expect(applyCompatToolForVersion(1, 'GE-Proton10-1')).resolves.toEqual({ status: 'unavailable', reason: 'SpecifyCompatTool missing' });
    (globalThis as any).SteamClient = { Apps: { SpecifyCompatTool: specify } };
    await expect(applyCompatToolForVersion(1, 'GE-Proton10-1')).resolves.toEqual({ status: 'unavailable', reason: 'GetAvailableCompatTools missing' });
  });

  it('times out a hung GetAvailableCompatTools', async () => {
    vi.useFakeTimers();
    available.mockReturnValue(new Promise(() => {}));
    const p = applyCompatToolForVersion(1, 'GE-Proton10-1');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual({ status: 'unavailable', reason: 'GetAvailableCompatTools timed out after 5000ms' });
    expect(specify).not.toHaveBeenCalled();
  });

  it('handles a rejected or malformed tool list', async () => {
    available.mockRejectedValueOnce('steam busy');
    await expect(applyCompatToolForVersion(1, 'GE-Proton10-1')).resolves.toEqual({ status: 'unavailable', reason: 'steam busy' });
    available.mockResolvedValueOnce({ nope: true });
    await expect(applyCompatToolForVersion(1, 'GE-Proton10-1')).resolves.toEqual({ status: 'unavailable', reason: 'GetAvailableCompatTools returned a non-array' });
  });

  it('reports unavailable when SpecifyCompatTool throws', async () => {
    specify.mockImplementation(() => { throw new Error('denied'); });
    await expect(applyCompatToolForVersion(1, 'GE-Proton10-1')).resolves.toEqual({ status: 'unavailable', reason: 'denied' });
    specify.mockImplementation(() => { throw 'raw'; });
    await expect(applyCompatToolForVersion(1, 'GE-Proton10-1')).resolves.toEqual({ status: 'unavailable', reason: 'raw' });
  });
});

describe('applyCompatToolAndNotify', () => {
  it('toasts when the tool could not be set', async () => {
    await applyCompatToolAndNotify(1, 'GE-Proton8-25');
    expect(toastMock).toHaveBeenCalledWith({ title: 'Proton Pulse', body: 'not set: GE-Proton8-25' });
  });

  it('stays quiet when the tool was set or there was no version', async () => {
    await applyCompatToolAndNotify(1, 'GE-Proton10-1');
    await applyCompatToolAndNotify(1, '');
    expect(toastMock).not.toHaveBeenCalled();
  });
});

describe('Steam default reports (#115)', () => {
  it('recognises the ways reports and Steam spell default', () => {
    for (const v of ['Default', 'default', ' Proton Default ', 'proton_default', 'steam_default', 'Steam-Default']) {
      expect(isSteamDefaultProton(v)).toBe(true);
    }
    for (const v of ['', null, undefined, 'Proton 9.0-4', 'Default-ish', 'GE-Proton10-1']) {
      expect(isSteamDefaultProton(v as string)).toBe(false);
    }
  });

  it('applying a Default config clears the per-game override, no lookup, no toast', async () => {
    await expect(applyCompatToolAndNotify(10, 'Default')).resolves.toEqual({ status: 'steam-default' });
    expect(specify).toHaveBeenCalledWith(10, '');
    expect(available).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('reports unavailable if clearing the override throws', async () => {
    specify.mockImplementation(() => { throw new Error('nope'); });
    await expect(applyCompatToolForVersion(10, 'default')).resolves.toEqual({ status: 'unavailable', reason: 'nope' });
    specify.mockImplementation(() => { throw 'raw'; });
    await expect(applyCompatToolForVersion(10, 'default')).resolves.toEqual({ status: 'unavailable', reason: 'raw' });
  });

  it('loads the global default once and maps it to a display name', async () => {
    (globalThis as any).settingsStore = { settings: { strCompatTool: 'proton_experimental' } };
    const getGlobal = vi.fn().mockResolvedValue(TOOLS);
    (globalThis as any).SteamClient.Settings = { GetGlobalCompatTools: getGlobal };
    await Promise.all([loadSteamDefaultTool(), loadSteamDefaultTool()]);
    await loadSteamDefaultTool();
    expect(getGlobal).toHaveBeenCalledTimes(1);
    expect(steamDefaultToolSync()).toEqual({ toolName: 'proton_experimental', displayName: 'Proton Experimental' });
  });

  it('falls back to the internal name when the global list is missing, unmatched or fails', async () => {
    (globalThis as any).settingsStore = { settings: { strCompatTool: 'proton_9' } };
    await expect(loadSteamDefaultTool()).resolves.toEqual({ toolName: 'proton_9', displayName: 'proton_9' });

    _resetSteamDefaultForTests();
    (globalThis as any).SteamClient.Settings = { GetGlobalCompatTools: vi.fn().mockResolvedValue({}) };
    await expect(loadSteamDefaultTool()).resolves.toEqual({ toolName: 'proton_9', displayName: 'proton_9' });

    _resetSteamDefaultForTests();
    (globalThis as any).SteamClient.Settings = { GetGlobalCompatTools: vi.fn().mockRejectedValue('busy') };
    await expect(loadSteamDefaultTool()).resolves.toEqual({ toolName: 'proton_9', displayName: 'proton_9' });
    expect(logMock).toHaveBeenCalledWith('WARNING', 'compatTool: GetGlobalCompatTools failed, showing internal name', expect.objectContaining({ reason: 'busy' }));

    _resetSteamDefaultForTests();
    vi.useFakeTimers();
    (globalThis as any).SteamClient.Settings = { GetGlobalCompatTools: vi.fn().mockReturnValue(new Promise(() => {})) };
    const p = loadSteamDefaultTool();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual({ toolName: 'proton_9', displayName: 'proton_9' });
  });

  it('returns null when Steam has no global default set', async () => {
    await expect(loadSteamDefaultTool()).resolves.toBeNull();
    (globalThis as any).settingsStore = { settings: { strCompatTool: '' } };
    _resetSteamDefaultForTests();
    await expect(loadSteamDefaultTool()).resolves.toBeNull();
    expect(steamDefaultToolSync()).toBeNull();
  });
});

