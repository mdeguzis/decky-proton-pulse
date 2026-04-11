import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCachedCdnMock, putCachedCdnMock, fetchNoCorsMock, logFrontendEventMock } = vi.hoisted(() => ({
  getCachedCdnMock: vi.fn(),
  putCachedCdnMock: vi.fn(),
  fetchNoCorsMock: vi.fn(),
  logFrontendEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@decky/api', () => ({
  callable: (name: string) => {
    if (name === 'get_cached_cdn') return getCachedCdnMock;
    if (name === 'put_cached_cdn') return putCachedCdnMock;
    return vi.fn();
  },
  fetchNoCors: fetchNoCorsMock,
}));

vi.mock('./logger', () => ({
  logFrontendEvent: logFrontendEventMock,
}));

describe('cdnCache', () => {
  beforeEach(() => {
    getCachedCdnMock.mockReset();
    putCachedCdnMock.mockReset();
    fetchNoCorsMock.mockReset();
    logFrontendEventMock.mockReset().mockResolvedValue(undefined);
  });

  it('returns fresh backend cache hits without touching the network', async () => {
    getCachedCdnMock.mockResolvedValue({ fresh: true, data: { reports: 3 } });

    const { cachedFetchJson } = await import('./cdnCache');
    await expect(cachedFetchJson('https://x/index.json', '730', 'index.json')).resolves.toEqual({
      data: { reports: 3 },
      fromCache: true,
    });
    expect(fetchNoCorsMock).not.toHaveBeenCalled();
  });

  it('fetches from the network on cache miss and writes back to cache', async () => {
    getCachedCdnMock.mockResolvedValue({ fresh: false, data: null });
    fetchNoCorsMock.mockResolvedValue({
      status: 200,
      json: async () => ({ reports: 7 }),
    });
    putCachedCdnMock.mockResolvedValue(true);

    const { cachedFetchJson } = await import('./cdnCache');
    await expect(cachedFetchJson('https://x/index.json', '730', 'index.json')).resolves.toEqual({
      data: { reports: 7 },
      fromCache: false,
    });
    expect(putCachedCdnMock).toHaveBeenCalledWith('730', 'index.json', { reports: 7 });
  });

  it('falls back to the network when the backend cache lookup throws', async () => {
    getCachedCdnMock.mockRejectedValue(new Error('backend offline'));
    fetchNoCorsMock.mockResolvedValue({
      status: 404,
      json: async () => null,
    });

    const { cachedFetchJson } = await import('./cdnCache');
    await expect(cachedFetchJson('https://x/index.json', '730', 'index.json')).resolves.toEqual({
      data: null,
      fromCache: false,
    });
    expect(logFrontendEventMock).toHaveBeenCalledWith(
      'DEBUG',
      'CDN cache backend unavailable, falling back to network',
      expect.objectContaining({ appId: '730', filename: 'index.json' }),
    );
  });

  it('returns null and logs when the network fetch throws', async () => {
    getCachedCdnMock.mockResolvedValue({ fresh: false, data: null });
    fetchNoCorsMock.mockRejectedValue(new Error('network down'));

    const { cachedFetchJson } = await import('./cdnCache');
    await expect(cachedFetchJson('https://x/index.json', '730', 'index.json')).resolves.toEqual({
      data: null,
      fromCache: false,
    });
    expect(logFrontendEventMock).toHaveBeenCalledWith(
      'ERROR',
      'CDN network fetch failed',
      expect.objectContaining({ appId: '730', filename: 'index.json' }),
    );
  });
});
