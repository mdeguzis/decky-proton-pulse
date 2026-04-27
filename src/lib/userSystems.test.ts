import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLinkedProtonPulseUserId } from './protonPulseAccount';

vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn(),
}));

vi.mock('./protonPulseAccount', () => ({
  getInstallationId: vi.fn(() => 'install-123'),
  getInstallationSecret: vi.fn(() => 'secret-123'),
  getLinkedProtonPulseUserId: vi.fn(() => 'pp-user-1'),
}));

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

  it('falls back to "Uploaded system" when absolutely nothing parses', async () => {
    const { generateLabel } = await import('./userSystems');
    expect(generateLabel('blah blah')).toBe('Uploaded system');
  });

  it('names a Steam Deck OLED by board model (Galileo)', async () => {
    const { generateLabel } = await import('./userSystems');
    const blob = [
      'Computer Information:',
      '    Manufacturer:  Valve',
      '    Model:  Galileo',
    ].join('\n');
    expect(generateLabel(blob)).toBe('Steam Deck OLED');
  });

  it('names a Steam Deck LCD by board model (Jupiter)', async () => {
    const { generateLabel } = await import('./userSystems');
    const blob = [
      'Computer Information:',
      '    Manufacturer:  Valve',
      '    Model:  Jupiter',
    ].join('\n');
    expect(generateLabel(blob)).toBe('Steam Deck LCD');
  });

  it('names a Deck from the VanGogh chipset in the text', async () => {
    const { generateLabel } = await import('./userSystems');
    const blob = [
      'Processor Information:',
      '    CPU Brand:  AMD Custom APU 0405',
      'Operating System Version:',
      '    Unknown',
      'Video Card:',
      '    Driver:  Unknown',
    ].join('\n');
    expect(generateLabel(blob)).toBe('Steam Deck');
  });

  it('uses {os}-{vendor}-{gpu_model} as a final fallback when shape is weird', async () => {
    const { generateLabel } = await import('./userSystems');
    const blob = 'Driver:  Advanced Micro Devices, Inc. Radeon RX 7900 XT';
    expect(generateLabel(blob)).toBe('AMD-Radeon RX 7900 XT');
  });

  it('uses only os when gpu is missing', async () => {
    const { generateLabel } = await import('./userSystems');
    const blob = 'Operating System Version:\n    "SteamOS 3.6" (64 bit)';
    expect(generateLabel(blob)).toBe('SteamOS 3.6');
  });

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
    vi.stubGlobal('localStorage', localStorageMock);
    localStorage.clear();
    localStorage.setItem('proton-pulse:device-id', 'dev-1');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok:false when no Proton Pulse account is linked', async () => {
    vi.mocked(getLinkedProtonPulseUserId).mockReturnValueOnce(null);
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('irrelevant blob');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/link your proton pulse account/i);
  });

  it('uploads the system through the linked-install Edge Function', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, inserted: true, isDefault: true }),
    });
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('Operating System Version:\n    "Arch Linux" (64 bit)');
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const postCall = fetchMock.mock.calls[0];
    expect(postCall[0]).toBe('https://ilsgdshkaocrmibwdezk.supabase.co/functions/v1/user-system-upload');
    expect(postCall[1].method).toBe('POST');
    expect(postCall[1].headers.Authorization).toBeUndefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.installationId).toBe('install-123');
    expect(body.installationSecret).toBe('secret-123');
    expect(body.deviceId).toBe('dev-1');
    expect(body.label).toBe('Arch Linux');
    expect(body.sysinfoText).toBe('Operating System Version:\n    "Arch Linux" (64 bit)');
  });

  it('returns ok:false when the upload function fails', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 500, text: async () => JSON.stringify({ message: 'db down' }),
    });
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('blob');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/db down|500/);
  });

  it('returns ok:false with the server error message', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 409, text: async () => JSON.stringify({ message: 'conflict on is_default' }),
    });
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('blob');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/conflict on is_default/);
  });

  it('formats object-shaped server errors without [object Object]', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({
        error: {
          message: 'insert failed',
          details: 'violates row-level security policy',
          code: '42501',
        },
      }),
    });
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('blob');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('insert failed');
      expect(result.error).toContain('violates row-level security policy');
      expect(result.error).toContain('42501');
      expect(result.error).not.toContain('[object Object]');
    }
  });

  it('returns the response text when the function error body is not json', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 418, text: async () => 'teapot says no',
    });
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('blob');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/teapot says no/);
  });

  it('returns ok:false when the upload request throws', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('blob');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/offline/);
  });

  it('returns ok:false when the upload response is not ok', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => '' });
    const { uploadSystem } = await import('./userSystems');
    const result = await uploadSystem('blob');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/HTTP 500/);
  });
});
