import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn().mockResolvedValue(true),
}));

vi.mock('./voting', () => ({
  getVoterId: vi.fn().mockResolvedValue('deadbeef'.repeat(8)),
}));

vi.mock('./protonPulseAccount', () => ({
  getInstallationId: vi.fn(() => 'install-123'),
  getLinkedProtonPulseUserId: vi.fn(() => 'pp-user-9'),
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

  // Steam pre-fills "Proton - Experimental" for the experimental branch, and
  // also ships Hotfix / Next branches without a numeric version. Make sure the
  // validator accepts the named branches on top of numbered builds
  it('accepts named Proton branches (Experimental, Hotfix, Next)', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), protonVersion: 'Proton - Experimental' })).toBeNull();
    expect(validateUserConfig({ ...validInput(), protonVersion: 'Proton Experimental'   })).toBeNull();
    expect(validateUserConfig({ ...validInput(), protonVersion: 'Proton - Hotfix'       })).toBeNull();
    expect(validateUserConfig({ ...validInput(), protonVersion: 'Proton - Next'         })).toBeNull();
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

  it('rejects invalid appType', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), appType: 'bogus' as any })).toMatch(/appType/i);
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
      proton_pulse_user_id: 'pp-user-9',
      installation_id: 'install-123',
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

  it('returns null when response data is null (200 with empty body)', async () => {
    // 200 response with no body -> payload=null -> data=null -> !data branch
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));

    const { getMyConfig } = await import('./userConfigs');
    await expect(getMyConfig('20')).resolves.toBeNull();
  });

  it('returns null when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { getMyConfig } = await import('./userConfigs');
    await expect(getMyConfig('20')).resolves.toBeNull();
  });
});

describe('validateUserConfig lower bound', () => {
  it('rejects confidenceScore below 0', async () => {
    const { validateUserConfig } = await import('./userConfigs');
    expect(validateUserConfig({ ...validInput(), confidenceScore: -1 })).toMatch(/confidenceScore/i);
  });
});

describe('submitUserConfig optional field fallbacks', () => {
  it('uses defaults when optional fields are omitted', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));

    const { submitUserConfig } = await import('./userConfigs');
    // omit all optional fields - each ?? fallback must be covered
    const result = await submitUserConfig({
      appId: '20',
      title: 'Team Fortress Classic',
      cpu: 'Intel Core i5-6600K',
      gpu: 'NVIDIA GeForce GTX 980 Ti',
      ram: '16 GB',
      os: 'SteamOS 3.6',
      protonVersion: 'Proton 9.0-4',
      rating: 'gold',
    });

    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      gpu_driver: '',
      gpu_vendor: 'other',
      kernel: '',
      duration: 'unreported',
      notes: '',
      launch_options: '',
      enabled_vars: {},
      confidence_score: null,
      source: 'user',
      vram_mb: null,
      cpu_cores: null,
      display_resolution: null,
      steam_deck_model: null,
    });
  });
});

describe('submitUserConfig cooldown', () => {
  it('blocks a second submit within the cooldown window', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));

    const { submitUserConfig } = await import('./userConfigs');
    const first = await submitUserConfig(validInput());
    expect(first.ok).toBe(true);

    // immediate second call hits the SUBMIT_COOLDOWN_MS guard
    const second = await submitUserConfig(validInput());
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/cooldown/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getUserConfigs error paths', () => {
  it('returns empty array when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const { getUserConfigs } = await import('./userConfigs');
    await expect(getUserConfigs('20')).resolves.toEqual([]);
  });
});

describe('restRequest non-object error payload', () => {
  it('returns HTTP status fallback when error body is empty', async () => {
    // empty body on a 400 response -> payload=null -> non-object path -> "HTTP 400"
    fetchMock.mockResolvedValueOnce(new Response('', { status: 400 }));

    const { submitUserConfig } = await import('./userConfigs');
    const result = await submitUserConfig(validInput());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 400/);
  });
});

describe('submitUserConfig fetch throws', () => {
  it('returns error when fetch throws during submit', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));

    const { submitUserConfig } = await import('./userConfigs');
    const result = await submitUserConfig(validInput());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection refused');
  });
});

describe('deleteMyReport', () => {
  it('sends a DELETE with x-client-id and returns ok on 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { deleteMyReport } = await import('./userConfigs');
    const result = await deleteMyReport('620');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toContain('/user_configs?');
    expect(url).toContain('client_id=eq.');
    expect(url).toContain('app_id=eq.620');
    expect(init?.method).toBe('DELETE');
    expect((init?.headers as Record<string, string>)['x-client-id']).toBe('deadbeef'.repeat(8));
  });

  it('returns the backend error when the DELETE fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'row not found' }, { status: 404 }));

    const { deleteMyReport } = await import('./userConfigs');
    const result = await deleteMyReport('620');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/row not found/);
  });

  it('returns the thrown message when fetch itself throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket closed'));

    const { deleteMyReport } = await import('./userConfigs');
    const result = await deleteMyReport('620');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/socket closed/);
  });
});

describe('getMySubmittedAppIds', () => {
  it('returns app IDs from both client_id and proton_pulse_user_id queries', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ app_id: '100' }, { app_id: '200' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ app_id: '200' }, { app_id: '300' }]), { status: 200 }));

    const { getMySubmittedAppIds } = await import('./userConfigs');
    const result = await getMySubmittedAppIds();

    expect(result).toEqual(new Set(['100', '200', '300']));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns only client_id results when no proton_pulse_user_id is linked', async () => {
    const { getLinkedProtonPulseUserId } = await import('./protonPulseAccount');
    vi.mocked(getLinkedProtonPulseUserId).mockReturnValueOnce(null);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ app_id: '42' }]), { status: 200 }));

    const { getMySubmittedAppIds } = await import('./userConfigs');
    const result = await getMySubmittedAppIds();

    expect(result).toEqual(new Set(['42']));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty set when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));

    const { getMySubmittedAppIds } = await import('./userConfigs');
    const result = await getMySubmittedAppIds();

    expect(result).toEqual(new Set());
  });
});
