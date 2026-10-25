import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { logMock, toastMock, backendMock } = vi.hoisted(() => ({
  logMock: vi.fn(), toastMock: vi.fn(), backendMock: vi.fn(),
}));
vi.mock('./logger', () => ({ logFrontendEvent: logMock }));
vi.mock('./notify', () => ({ toaster: { toast: toastMock } }));
vi.mock('./i18n', () => ({ t: () => ({ extras: { compatToolNotSet: (v: string) => `not set: ${v}` } }) }));
vi.mock('@decky/api', () => ({ callable: vi.fn(() => backendMock) }));

import {
  matchCompatTool, applyCompatToolForVersion, applyCompatToolAndNotify, readCompatToolName,
  isSteamDefaultProton, loadSteamDefaultTool, steamDefaultToolSync, _resetSteamDefaultForTests,
} from './compatToolSelect';

const TOOLS = [
  { strToolName: 'proton_9', strDisplayName: 'Proton 9.0-4' },
  { strToolName: 'proton_experimental', strDisplayName: 'Proton Experimental' },
  { strToolName: 'GE-Proton10-1', strDisplayName: 'GE-Proton10-1' },
  { strToolName: 'Proton-GE-Latest', strDisplayName: 'Proton-GE-Latest (GE-Proton10-3)' },
];
// What get_compat_tool_choices returns for the same install.
const BACKEND = TOOLS.map((t) => ({ tool_name: t.strToolName, display_name: t.strDisplayName, directory_name: t.strDisplayName }));

let specify: ReturnType<typeof vi.fn>;
let available: ReturnType<typeof vi.fn>;
// Per-app tool as Steam reports it ('' = Steam default).
let steamTool: Map<number, string>;

// Fake Steam that behaves like the October 2026 client measured on a Deck:
// a known name switches the tool, an unknown name silently clears it to the
// default, and RegisterForAppDetails reports the current tool.
function installSteam({ withList = true, withDetails = true } = {}) {
  const known = new Set(TOOLS.map((t) => t.strToolName));
  specify = vi.fn((appId: number, name: string) => {
    steamTool.set(appId, name === '' || known.has(name) ? name : '');
  });
  const apps: Record<string, unknown> = { SpecifyCompatTool: specify };
  if (withList) apps.GetAvailableCompatTools = available;
  if (withDetails) {
    apps.RegisterForAppDetails = (appId: number, cb: (d: unknown) => void) => {
      cb({ strCompatToolName: steamTool.get(appId) ?? '' });
      return { unregister: vi.fn() };
    };
  }
  (globalThis as any).SteamClient = { Apps: apps };
}

beforeEach(() => {
  logMock.mockReset();
  toastMock.mockReset();
  backendMock.mockReset().mockResolvedValue(BACKEND);
  available = vi.fn().mockResolvedValue(TOOLS);
  steamTool = new Map();
  installSteam();
});
afterEach(() => {
  delete (globalThis as any).SteamClient;
  delete (globalThis as any).settingsStore;
  _resetSteamDefaultForTests();
  vi.useRealTimers();
});

describe('matchCompatTool', () => {
  it('matches the internal name, then the display name, case-insensitively', () => {
    expect(matchCompatTool('proton_9', TOOLS)?.strToolName).toBe('proton_9');
    expect(matchCompatTool('Proton 9.0-4', TOOLS)?.strToolName).toBe('proton_9');
    expect(matchCompatTool('ge-proton10-1', TOOLS)?.strToolName).toBe('GE-Proton10-1');
  });

  it('ignores spaces, dashes and underscores as a last resort', () => {
    expect(matchCompatTool('Proton Experimental', TOOLS)?.strToolName).toBe('proton_experimental');
    expect(matchCompatTool('proton-experimental', TOOLS)?.strToolName).toBe('proton_experimental');
  });

  it('never prefix-matches a different version', () => {
    expect(matchCompatTool('GE-Proton10', TOOLS)).toBeNull();
    expect(matchCompatTool('Proton 9.0', TOOLS)).toBeNull();
    expect(matchCompatTool('  ', TOOLS)).toBeNull();
  });
});

describe('readCompatToolName', () => {
  it('reads strCompatToolName from the app details', async () => {
    steamTool.set(5, 'proton_9');
    await expect(readCompatToolName(5)).resolves.toBe('proton_9');
    await expect(readCompatToolName(6)).resolves.toBe('');
  });

  it('returns null when details are unavailable or never arrive', async () => {
    installSteam({ withDetails: false });
    await expect(readCompatToolName(5)).resolves.toBeNull();
    vi.useFakeTimers();
    (globalThis as any).SteamClient.Apps.RegisterForAppDetails = () => ({ unregister: vi.fn() });
    const p = readCompatToolName(5, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toBeNull();
  });
});

describe('applyCompatToolForVersion (#92)', () => {
  it('sets the matched tool and confirms it through the app details', async () => {
    steamTool.set(252490, 'proton_experimental');
    await expect(applyCompatToolForVersion(252490, 'Proton 9.0-4'))
      .resolves.toEqual({ status: 'set', toolName: 'proton_9', displayName: 'Proton 9.0-4' });
    expect(specify).toHaveBeenCalledWith(252490, 'proton_9');
    expect(steamTool.get(252490)).toBe('proton_9');
    expect(logMock).toHaveBeenCalledWith('INFO', 'compatTool: set Steam compat tool for app', expect.objectContaining({
      toolName: 'proton_9', previous: 'proton_experimental', listSource: 'SteamClient.Apps.GetAvailableCompatTools',
    }));
  });

  it('uses the backend tool list when Steam no longer has GetAvailableCompatTools', async () => {
    // The October 2026 client removed GetAvailableCompatTools; before this
    // fallback the switch never happened at all.
    installSteam({ withList: false });
    await expect(applyCompatToolForVersion(7, 'GE-Proton10-1'))
      .resolves.toEqual({ status: 'set', toolName: 'GE-Proton10-1', displayName: 'GE-Proton10-1' });
    expect(backendMock).toHaveBeenCalled();
    expect(steamTool.get(7)).toBe('GE-Proton10-1');
    expect(logMock).toHaveBeenCalledWith('INFO', 'compatTool: set Steam compat tool for app',
      expect.objectContaining({ listSource: 'get_compat_tool_choices' }));
  });

  it('skips the switch when the game is already on the requested tool', async () => {
    steamTool.set(8, 'GE-Proton10-1');
    await expect(applyCompatToolForVersion(8, 'GE-Proton10-1')).resolves.toMatchObject({ status: 'set' });
    expect(specify).not.toHaveBeenCalled();
  });

  it('rolls back when Steam does not take the tool, instead of leaving the default', async () => {
    vi.useFakeTimers();
    steamTool.set(9, 'proton_experimental');
    // Listed, but Steam does not recognise the name: it silently clears the
    // override, exactly what a stale name does on a real Deck.
    available.mockResolvedValue([...TOOLS, { strToolName: 'GE-Proton9-99', strDisplayName: 'GE-Proton9-99' }]);
    const p = applyCompatToolForVersion(9, 'GE-Proton9-99');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toEqual({ status: 'not-applied', requested: 'GE-Proton9-99', actual: '', restored: true });
    expect(specify).toHaveBeenLastCalledWith(9, 'proton_experimental');
    expect(steamTool.get(9)).toBe('proton_experimental');
    expect(logMock).toHaveBeenCalledWith('ERROR', 'compatTool: Steam did not take the requested tool',
      expect.objectContaining({ requested: 'GE-Proton9-99', actual: '', previous: 'proton_experimental', restored: true }));
  });

  it('trusts the call but warns when the details cannot be read back', async () => {
    installSteam({ withDetails: false });
    await expect(applyCompatToolForVersion(1, 'GE-Proton10-1')).resolves.toMatchObject({ status: 'set' });
    expect(logMock).toHaveBeenCalledWith('WARNING', 'compatTool: could not read back the tool after SpecifyCompatTool',
      expect.objectContaining({ toolName: 'GE-Proton10-1' }));
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

  it('reports unavailable when SpecifyCompatTool is missing or the tool list fails', async () => {
    (globalThis as any).SteamClient = { Apps: {} };
    await expect(applyCompatToolForVersion(1, 'GE-Proton10-1')).resolves.toEqual({ status: 'unavailable', reason: 'SpecifyCompatTool missing' });
    installSteam({ withList: false });
    backendMock.mockRejectedValueOnce(new Error('backend down'));
    await expect(applyCompatToolForVersion(1, 'GE-Proton10-1')).resolves.toEqual({ status: 'unavailable', reason: 'backend down' });
    expect(specify).not.toHaveBeenCalled();
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

  it('toasts when Steam did not take the tool', async () => {
    vi.useFakeTimers();
    available.mockResolvedValue([{ strToolName: 'GE-Proton9-99', strDisplayName: 'GE-Proton9-99' }]);
    const p = applyCompatToolAndNotify(1, 'GE-Proton9-99');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toMatchObject({ status: 'not-applied' });
    expect(toastMock).toHaveBeenCalledWith({ title: 'Proton Pulse', body: 'not set: GE-Proton9-99' });
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
    steamTool.set(10, 'GE-Proton10-1');
    await expect(applyCompatToolAndNotify(10, 'Default')).resolves.toEqual({ status: 'steam-default' });
    expect(specify).toHaveBeenCalledWith(10, '');
    expect(steamTool.get(10)).toBe('');
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

  it('names the default from the backend list when GetGlobalCompatTools is gone', async () => {
    (globalThis as any).settingsStore = { settings: { strCompatTool: 'proton_9' } };
    await expect(loadSteamDefaultTool()).resolves.toEqual({ toolName: 'proton_9', displayName: 'Proton 9.0-4' });
  });

  it('falls back to the internal name when no list can name it', async () => {
    (globalThis as any).settingsStore = { settings: { strCompatTool: 'proton_9' } };
    backendMock.mockRejectedValueOnce(new Error('backend down'));
    await expect(loadSteamDefaultTool()).resolves.toEqual({ toolName: 'proton_9', displayName: 'proton_9' });
    expect(logMock).toHaveBeenCalledWith('WARNING', 'compatTool: backend tool list failed, showing internal name', expect.objectContaining({ reason: 'backend down' }));

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
