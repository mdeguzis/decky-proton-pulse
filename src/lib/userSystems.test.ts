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
    // @ts-expect-error - test shim
    delete globalThis.SteamClient;
  });

  it('returns the string steam id from SteamClient', async () => {
    // @ts-expect-error - test shim
    globalThis.SteamClient = {
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
    // @ts-expect-error - test shim
    globalThis.SteamClient = {
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
});
