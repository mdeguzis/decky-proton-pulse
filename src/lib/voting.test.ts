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
  subtle: {
    digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xab).buffer),
  },
});
vi.stubGlobal('SteamClient', {
  User: {
    GetCurrentUser: () => ({ strAccountName: 'testuser' }),
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
  it('returns a stable 64-char hex string', async () => {
    const { getVoterId } = await import('./voting');
    const first = await getVoterId();
    const second = await getVoterId();
    expect(first).toHaveLength(64);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });
});

describe('submitVote', () => {
  it('upserts the vote in one request', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'no rows' }, { status: 406 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const { submitVote } = await import('./voting');
    const ok = await submitVote('123', 'report-1', 1);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/report_votes?');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('on_conflict=voter_id%2Capp_id%2Creport_key');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Prefer: 'resolution=merge-duplicates,return=minimal',
    });

    const insertBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(typeof insertBody).toBe('string');
    expect(JSON.parse(insertBody as string)).toMatchObject({
      app_id: '123',
      report_key: 'report-1',
      vote: 1,
    });
  });

  it('returns false when the insert fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'no rows' }, { status: 406 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'bad insert' }, { status: 400 }));

    const { submitVote } = await import('./voting');
    await expect(submitVote('123', 'report-1', -1)).resolves.toBe(false);
  });

  it('patches an existing vote instead of trying to reinsert it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ vote: -1 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { submitVote } = await import('./voting');
    await expect(submitVote('123', 'report-1', 1)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' });
    expect(fetchMock.mock.calls[1]?.[0]).toContain('voter_id=eq.');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('app_id=eq.123');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('report_key=eq.report-1');
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ vote: 1 }));
  });

  it('treats the same existing vote as a no-op success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ vote: 1 }));

    const { submitVote } = await import('./voting');
    await expect(submitVote('123', 'report-1', 1)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
});

describe('isVoteCooldownActive', () => {
  it('is false before a vote is submitted', async () => {
    const { isVoteCooldownActive } = await import('./voting');
    expect(isVoteCooldownActive()).toBe(false);
  });
});
