import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn().mockResolvedValue(true),
}));

const lsStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => lsStore[key] ?? null,
  setItem: (key: string, value: string) => { lsStore[key] = value; },
  removeItem: (key: string) => { delete lsStore[key]; },
  clear: () => { Object.keys(lsStore).forEach(key => delete lsStore[key]); },
};

const fetchMock = vi.fn();

vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('crypto', {
  getRandomValues: (buf: Uint8Array) => {
    for (let i = 0; i < buf.length; i++) {
      buf[i] = (i % 255) + 1;
    }
    return buf;
  },
  randomUUID: vi.fn(() => '123e4567-e89b-12d3-a456-426614174000'),
  subtle: {
    digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xab).buffer),
  },
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  localStorageMock.clear();
  fetchMock.mockReset();
  vi.resetModules();
});

describe('bytesToHex', () => {
  it('converts empty array to empty string', async () => {
    const { bytesToHex } = await import('./voting');
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });

  it('pads values correctly', async () => {
    const { bytesToHex } = await import('./voting');
    expect(bytesToHex(new Uint8Array([0x01, 0x10, 0xff]))).toBe('0110ff');
  });
});

describe('getVoterId', () => {
  it('returns a stable local UUID string', async () => {
    const { getVoterId } = await import('./voting');
    const first = await getVoterId();
    const second = await getVoterId();
    expect(first).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(second).toBe(first);
  });

  it('reuses a previously stored voter id', async () => {
    localStorage.setItem('proton-pulse-voter-id', 'existing-voter-id');
    const { getVoterId } = await import('./voting');
    const voterId = await getVoterId();
    expect(voterId).toBe('existing-voter-id');
  });
});

describe('submitVote', () => {
  it('casts the vote through client_cast_vote with the install secret', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'no rows' }, { status: 406 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { submitVote } = await import('./voting');
    const ok = await submitVote('123', 'report-1', 1);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/\/rest\/v1\/rpc\/client_cast_vote$/);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    const body = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(body).toMatchObject({ p_app_id: '123', p_report_key: 'report-1', p_vote: 1 });
    expect(body.p_client_id).toEqual(expect.any(String));
    // the secret is the installation secret the link edge functions use
    expect(body.p_secret).toBe(lsStore['proton-pulse:installation-secret']);
  });

  it('returns false when the insert fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'no rows' }, { status: 406 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'bad insert' }, { status: 400 }));

    const { submitVote } = await import('./voting');
    await expect(submitVote('123', 'report-1', -1)).resolves.toBe(false);
  });

  it('changes an existing vote through the same RPC, never a table PATCH', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ vote: -1 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { submitVote } = await import('./voting');
    await expect(submitVote('123', 'report-1', 1)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/\/rpc\/client_cast_vote$/);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({ p_vote: 1 });
  });

  it('returns false when the server refuses the secret or a ban', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'no rows' }, { status: 406 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'client secret mismatch' }, { status: 403 }));

    const { submitVote } = await import('./voting');
    await expect(submitVote('124', 'report-2', 1)).resolves.toBe(false);
  });

  it('treats the same existing vote as a no-op success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ vote: 1 }));

    const { submitVote } = await import('./voting');
    await expect(submitVote('123', 'report-1', 1)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns false while the cooldown is active', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'no rows' }, { status: 406 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const { submitVote } = await import('./voting');
    expect(await submitVote('123', 'report-1', 1)).toBe(true);
    expect(await submitVote('123', 'report-1', -1)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns false when the request throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { submitVote } = await import('./voting');
    await expect(submitVote('123', 'report-1', 1)).resolves.toBe(false);
  });
});

describe('getVoteTotals', () => {
  it('maps rows into the keyed vote totals object', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([
      { report_key: 'r1', upvotes: 2, downvotes: 1 },
      { report_key: 'r2', upvotes: null, downvotes: 4 },
    ]));

    const { getVoteTotals } = await import('./voting');
    await expect(getVoteTotals('999')).resolves.toEqual({
      r1: { upvotes: 2, downvotes: 1 },
      r2: { upvotes: 0, downvotes: 4 },
    });
  });

  it('returns an empty object on request failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'broken' }, { status: 500 }));

    const { getVoteTotals } = await import('./voting');
    await expect(getVoteTotals('999')).resolves.toEqual({});
  });

  it('returns an empty object when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const { getVoteTotals } = await import('./voting');
    await expect(getVoteTotals('999')).resolves.toEqual({});
  });
});

describe('getUserVote', () => {
  it('returns the stored vote when present', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ vote: -1 }));

    const { getUserVote } = await import('./voting');
    await expect(getUserVote('42', 'report-2')).resolves.toBe(-1);
  });

  it('returns null on 406 no-row responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'no rows' }, { status: 406 }));

    const { getUserVote } = await import('./voting');
    await expect(getUserVote('42', 'report-2')).resolves.toBeNull();
  });

  it('returns null when voter lookup throws', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: () => { throw new Error('no crypto'); },
      subtle: {
        digest: vi.fn(),
      },
    });

    const { getUserVote } = await import('./voting');
    await expect(getUserVote('42', 'report-2')).resolves.toBeNull();
  });
});

describe('restRequest edge cases', () => {
  it('returns a string error message from a text response body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('something went wrong', { status: 400 }),
    );

    const { restRequest } = await import('./voting');
    const result = await restRequest('test_path', { method: 'GET' });
    expect(result.error).toBe('something went wrong');
    expect(result.status).toBe(400);
  });

  it('falls back to HTTP status when body is empty on error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 502 }),
    );

    const { restRequest } = await import('./voting');
    const result = await restRequest('test_path', { method: 'GET' });
    expect(result.error).toBe('HTTP 502');
  });

  it('handles non-JSON text body on successful response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );

    const { restRequest } = await import('./voting');
    const result = await restRequest('test_path');
    // the text that cant be parsed comes back as the raw string
    expect(result.data).toBe('not json');
    expect(result.error).toBeNull();
  });
});

describe('fetchExistingVote error path', () => {
  it('returns null for getUserVote when fetch returns an error', async () => {
    // return a non-406 error so it goes to the error/!data branch
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: 'server error' }, { status: 500 }),
    );

    const { getUserVote } = await import('./voting');
    await expect(getUserVote('42', 'report-x')).resolves.toBeNull();
  });

  it('returns null when response is 200 but data is null (empty body)', async () => {
    // 200 with empty body -> payload=null -> data=null -> !result.data branch
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));

    const { getUserVote } = await import('./voting');
    await expect(getUserVote('42', 'report-x')).resolves.toBeNull();
  });
});

describe('isVoteCooldownActive', () => {
  it('is false before a vote is submitted', async () => {
    const { isVoteCooldownActive } = await import('./voting');
    expect(isVoteCooldownActive()).toBe(false);
  });
});

describe('deleteVote', () => {
  // earlier tests may have replaced crypto.subtle.digest with a thrower - put
  // the working stub back before each delete test so getVoterId resolves
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      getRandomValues: (buf: Uint8Array) => {
        for (let i = 0; i < buf.length; i++) buf[i] = (i % 255) + 1;
        return buf;
      },
      randomUUID: vi.fn(() => '123e4567-e89b-12d3-a456-426614174000'),
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xab).buffer),
      },
    });
  });

  it('clears the vote with client_cast_vote(0) and returns true on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { deleteVote } = await import('./voting');
    await expect(deleteVote('123', 'report-1')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/rpc\/client_cast_vote$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      p_app_id: '123', p_report_key: 'report-1', p_vote: 0,
    });
  });

  it('returns false when the DELETE returns a server error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: 'forbidden' }, { status: 403 }),
    );

    const { deleteVote } = await import('./voting');
    await expect(deleteVote('123', 'report-1')).resolves.toBe(false);
  });

  it('returns false when the voter lookup throws', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => { throw new Error('no crypto'); },
      getRandomValues: vi.fn(),
      subtle: { digest: vi.fn() },
    });

    const { deleteVote } = await import('./voting');
    await expect(deleteVote('123', 'report-1')).resolves.toBe(false);
  });
});
