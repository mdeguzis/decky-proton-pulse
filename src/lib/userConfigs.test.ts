import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn().mockResolvedValue(true),
}));

vi.mock('./voting', () => ({
  getVoterId: vi.fn().mockResolvedValue('deadbeef'.repeat(8)),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function validInput() {
  return {
    appId: '20',
    title: 'Team Fortress Classic',
    cpu: 'Intel Core i5-6600K @ 3.50GHz',
    gpu: 'NVIDIA GeForce GTX 980 Ti',
    gpuDriver: 'NVIDIA 396.54',
    gpuVendor: 'nvidia' as const,
    ram: '16 GB',
    os: 'SteamOS 3.6' as const,
    kernel: '4.15.0-33-generic',
    protonVersion: 'Proton 9.0-4',
    duration: 'unreported',
    rating: 'gold' as const,
    notes: '',
    launchOptions: 'DXVK_ASYNC=1 %command%',
    enabledVars: { DXVK_ASYNC: '1' },
    confidenceScore: 85,
    source: 'user' as const,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.resetModules();
});

describe('validateUserConfig', () => {
  it('returns null for valid input', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig(validInput())).toBeNull();
  });

  it('rejects missing required fields', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), appId: '' })).toMatch(/required/);
  });

  it('rejects invalid rating', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), rating: 'pending' as any })).toMatch(/rating/i);
  });

  it('rejects invalid OS', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), os: 'Windows 11' as any })).toMatch(/OS/i);
  });

  it('rejects bad protonVersion format', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), protonVersion: 'wine-9.0' })).toMatch(/protonVersion/i);
  });

  it('accepts GE-Proton format', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), protonVersion: 'GE-Proton9-20' })).toBeNull();
  });

  it('rejects bad ram format', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), ram: '16GB' })).toMatch(/ram/i);
  });

  it('rejects invalid gpuVendor', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), gpuVendor: 'qualcomm' as any })).toMatch(/gpuVendor/i);
  });

  it('rejects invalid source', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), source: 'steam' as any })).toMatch(/source/i);
  });

  it('rejects out-of-range confidenceScore', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), confidenceScore: 999 })).toMatch(/confidenceScore/i);
  });
});

describe('submitUserConfig', () => {
  it('posts to user_configs with upsert headers', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));

    const { submitUserConfig } = await import('./userConfigs');
    const result = await submitUserConfig(validInput());

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/user_configs?');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('on_conflict=client_id%2Capp_id');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      client_id: 'deadbeef'.repeat(8),
      app_id: '20',
      rating: 'gold',
      os: 'SteamOS 3.6',
      proton_version: 'Proton 9.0-4',
      ram: '16 GB',
      gpu_vendor: 'nvidia',
      launch_options: 'DXVK_ASYNC=1 %command%',
      enabled_vars: { DXVK_ASYNC: '1' },
      confidence_score: 85,
      source: 'user',
    });
  });

  it('returns error on validation failure without fetching', async () => {
    const { submitUserConfig } = await import('./userConfigs');
    const result = await submitUserConfig({ ...validInput(), rating: 'bad' as any });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rating/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns error on server failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'constraint violation' }, { status: 400 }));

    const { submitUserConfig } = await import('./userConfigs');
    const result = await submitUserConfig(validInput());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('constraint violation');
  });
});

describe('getUserConfigs', () => {
  it('fetches configs for an app_id', async () => {
    const row = { id: 1, app_id: '20', rating: 'gold', os: 'Arch Linux' };
    fetchMock.mockResolvedValueOnce(jsonResponse([row]));

    const { getUserConfigs } = await import('./userConfigs');
    const configs = await getUserConfigs('20');

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ app_id: '20', rating: 'gold' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('app_id=eq.20');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('order=created_at.desc');
  });

  it('returns empty array on failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'err' }, { status: 500 }));

    const { getUserConfigs } = await import('./userConfigs');
    await expect(getUserConfigs('20')).resolves.toEqual([]);
  });
});

describe('getMyConfig', () => {
  it('returns the row when it exists', async () => {
    const row = { id: 1, client_id: 'deadbeef'.repeat(8), app_id: '20', rating: 'gold' };
    fetchMock.mockResolvedValueOnce(jsonResponse(row));

    const { getMyConfig } = await import('./userConfigs');
    const config = await getMyConfig('20');

    expect(config).toMatchObject({ app_id: '20', rating: 'gold' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('client_id=eq.');
  });

  it('returns null on 406 (no rows)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'no rows' }, { status: 406 }));

    const { getMyConfig } = await import('./userConfigs');
    await expect(getMyConfig('20')).resolves.toBeNull();
  });
});
