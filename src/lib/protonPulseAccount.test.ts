import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn().mockResolvedValue(true),
}));

const fetchMock = vi.fn();
const lsStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => lsStore[key] ?? null,
  setItem: (key: string, value: string) => { lsStore[key] = value; },
  removeItem: (key: string) => { delete lsStore[key]; },
  clear: () => { Object.keys(lsStore).forEach((key) => delete lsStore[key]); },
};

vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'install-uuid-1234'),
});

beforeEach(() => {
  fetchMock.mockReset();
  localStorageMock.clear();
  vi.resetModules();
});

describe('getInstallationId', () => {
  it('generates and persists an installation id', async () => {
    const { getInstallationId } = await import('./protonPulseAccount');
    expect(getInstallationId()).toBe('install-uuid-1234');
    expect(localStorage.getItem('proton-pulse:installation-id')).toBe('install-uuid-1234');
  });

  it('reuses an existing installation id', async () => {
    localStorage.setItem('proton-pulse:installation-id', 'existing-install');
    const { getInstallationId } = await import('./protonPulseAccount');
    expect(getInstallationId()).toBe('existing-install');
  });
});

describe('getInstallationSecret', () => {
  it('generates and persists an installation secret', async () => {
    const { getInstallationSecret } = await import('./protonPulseAccount');
    expect(getInstallationSecret()).toBe('install-uuid-1234');
    expect(localStorage.getItem('proton-pulse:installation-secret')).toBe('install-uuid-1234');
  });

  it('reuses an existing installation secret', async () => {
    localStorage.setItem('proton-pulse:installation-secret', 'existing-secret');
    const { getInstallationSecret } = await import('./protonPulseAccount');
    expect(getInstallationSecret()).toBe('existing-secret');
  });
});

describe('startPluginLink', () => {
  it('posts the installation id and caches the linked user when returned', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      linked: true,
      linkedUserId: 'pp-user-77',
      linkedAt: '2026-04-20T00:00:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const { startPluginLink } = await import('./protonPulseAccount');
    const status = await startPluginLink();

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      installationId: 'install-uuid-1234',
      installationSecret: 'install-uuid-1234',
    });
    expect(status.linked).toBe(true);
    expect(localStorage.getItem('proton-pulse:linked-proton-pulse-user-id')).toBe('pp-user-77');
  });
});

describe('fetchPluginLinkStatus', () => {
  it('posts the installation proof when checking status', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      linked: false,
      linkCode: null,
      linkCodeExpiresAt: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const { fetchPluginLinkStatus } = await import('./protonPulseAccount');
    await fetchPluginLinkStatus();

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      installationId: 'install-uuid-1234',
      installationSecret: 'install-uuid-1234',
    });
  });
});

describe('fetchPluginLinkStatus', () => {
  it('clears cached linked user when the install is not linked', async () => {
    localStorage.setItem('proton-pulse:linked-proton-pulse-user-id', 'old-user');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      linked: false,
      linkCode: 'ABCD-1234',
      linkCodeExpiresAt: '2026-04-20T00:10:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const { fetchPluginLinkStatus } = await import('./protonPulseAccount');
    const status = await fetchPluginLinkStatus();

    expect(status.linkCode).toBe('ABCD-1234');
    expect(localStorage.getItem('proton-pulse:linked-proton-pulse-user-id')).toBeNull();
  });
});
