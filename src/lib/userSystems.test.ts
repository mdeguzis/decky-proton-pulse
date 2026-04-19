// src/lib/userSystems.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn(),
}));

// vitest env is node for this repo, so stub localStorage the same way voting.test.ts does
const lsStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => lsStore[key] ?? null,
  setItem: (key: string, value: string) => { lsStore[key] = value; },
  removeItem: (key: string) => { delete lsStore[key]; },
  clear: () => { Object.keys(lsStore).forEach(k => delete lsStore[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

describe('getDeviceId', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('generates and persists a device id on first call', async () => {
    const { getDeviceId } = await import('./userSystems');
    const id = getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(localStorage.getItem('proton-pulse:device-id')).toBe(id);
  });

  it('reuses the stored id on subsequent calls', async () => {
    localStorage.setItem('proton-pulse:device-id', 'abc-123');
    const { getDeviceId } = await import('./userSystems');
    expect(getDeviceId()).toBe('abc-123');
  });
});

describe('getSteamId', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).SteamClient;
  });

  it('returns the string steam id from SteamClient', async () => {
    (globalThis as any).SteamClient = {
      User: { GetCurrentUser: () => ({ strSteamID: '76561198000000000' }) },
    };
    const { getSteamId } = await import('./userSystems');
    expect(getSteamId()).toBe('76561198000000000');
  });

  it('returns null when SteamClient is missing', async () => {
    const { getSteamId } = await import('./userSystems');
    expect(getSteamId()).toBeNull();
  });

  it('returns null when GetCurrentUser throws', async () => {
    (globalThis as any).SteamClient = {
      User: { GetCurrentUser: () => { throw new Error('boom'); } },
    };
    const { getSteamId } = await import('./userSystems');
    expect(getSteamId()).toBeNull();
  });
});

describe('generateLabel', () => {
  it('combines os name and stripped gpu model', async () => {
    const { generateLabel } = await import('./userSystems');
    const blob = [
      'Operating System Version:',
      '    "Arch Linux" (64 bit)',
      'Video Card:',
      '    Driver:  NVIDIA Corporation NVIDIA GeForce RTX 4070',
    ].join('\n');
    expect(generateLabel(blob)).toBe('Arch Linux · GeForce RTX 4070');
  });

  it('falls back to "Unknown" when fields are missing', async () => {
    const { generateLabel } = await import('./userSystems');
    expect(generateLabel('blah blah')).toBe('Unknown system');
  });

  it('uses only os when gpu is missing', async () => {
    const { generateLabel } = await import('./userSystems');
    const blob = 'Operating System Version:\n    "SteamOS 3.6" (64 bit)';
    expect(generateLabel(blob)).toBe('SteamOS 3.6');
  });

  // The Deck plugin writes the OS line without the wrapping quotes that
  // Windows Steam uses. This is the format produced by our Python
  // generate_system_info() — keep both shapes supported
  it('handles the plugin-generated unquoted os line', async () => {
    const { generateLabel } = await import('./userSystems');
    const blob = [
      'Operating System Version:',
      '    SteamOS Holo 3.7 (64 bit)',
      '    Kernel Name:  Linux',
      'Video Card:',
      '    Driver:  AMD Custom GPU 0405',
    ].join('\n');
    expect(generateLabel(blob)).toBe('SteamOS Holo 3.7 · Custom GPU 0405');
  });

  // When glxinfo can't probe in game mode the backend can still end up
  // with a literal "Unknown" in the Driver line. Treat that as "no gpu"
  // so the label falls through to OS-only instead of "· Unknown"
  it('ignores a literal "Unknown" driver line', async () => {
    const { generateLabel } = await import('./userSystems');
    const blob = [
      'Operating System Version:',
      '    SteamOS Holo 3.7 (64 bit)',
      'Video Card:',
      '    Driver:  Unknown',
    ].join('\n');
    expect(generateLabel(blob)).toBe('SteamOS Holo 3.7');
  });
});

describe('uploadSystem', () => {
  beforeEach(() => {
    // vi.unstubAllGlobals in afterEach strips the top-level localStorage stub,
    // so re-stub it here for each test in this block
    vi.stubGlobal('localStorage', localStorageMock);
    localStorage.clear();
    localStorage.setItem('proton-pulse:device-id', 'dev-1');
    (globalThis as any).SteamClient = {
      User: { GetCurrentUser: () => ({ strSteamID: '76561198000000000' }) },
    };
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).SteamClient;
  });

  it('returns ok:false when not signed in to Steam', async () => {
    // @ts-expect-error - test shim
    delete globalThis.SteamClient;
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('irrelevant blob');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not signed in/i);
  });

  it('POSTs a new row when GET finds nothing', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    // First GET: check if our (steam_id, device_id) row exists -> nope
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] });
    // Second GET: any rows for this steam_id? -> nope, so is_default=true
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] });
    // POST
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201 });
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('Operating System Version:\n    "Arch Linux" (64 bit)');
    expect(result.ok).toBe(true);
    const postCall = fetchMock.mock.calls[2];
    expect(postCall[0]).toMatch(/user_systems\?on_conflict=/);
    const body = JSON.parse(postCall[1].body);
    expect(body.steam_id).toBe('76561198000000000');
    expect(body.device_id).toBe('dev-1');
    expect(body.label).toBe('Arch Linux');
    expect(body.is_default).toBe(true); // first row for this steam id
  });

  it('PATCHes only sysinfo_text when the row exists', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ device_id: 'dev-1' }],
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('blah');
    expect(result.ok).toBe(true);
    const patchCall = fetchMock.mock.calls[1];
    expect(patchCall[0]).toMatch(/steam_id=eq\.76561198000000000&device_id=eq\.dev-1/);
    expect(patchCall[1].method).toBe('PATCH');
    const body = JSON.parse(patchCall[1].body);
    expect(body.sysinfo_text).toBe('blah');
    expect(body.label).toBeUndefined();
    expect(body.is_default).toBeUndefined();
  });

  it('returns ok:false when POST fails', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] });
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({ message: 'db down' }),
    });
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('blob');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/db down|500/);
  });
});
