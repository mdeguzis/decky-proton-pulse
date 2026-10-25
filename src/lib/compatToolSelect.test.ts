import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { logMock, toastMock } = vi.hoisted(() => ({ logMock: vi.fn(), toastMock: vi.fn() }));
vi.mock('./logger', () => ({ logFrontendEvent: logMock }));
vi.mock('./notify', () => ({ toaster: { toast: toastMock } }));
vi.mock('./i18n', () => ({ t: () => ({ extras: { compatToolNotSet: (v: string) => `not set: ${v}` } }) }));

import { matchCompatTool, applyCompatToolForVersion, applyCompatToolAndNotify } from './compatToolSelect';

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
