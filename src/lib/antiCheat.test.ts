import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchNoCorsMock, store, logMock, ttl } = vi.hoisted(() => ({
  fetchNoCorsMock: vi.fn(),
  store: new Map<string, unknown>(),
  logMock: vi.fn(),
  ttl: { ms: 24 * 3600 * 1000 },
}));

vi.mock('@decky/api', () => ({ fetchNoCors: fetchNoCorsMock }));
vi.mock('./settings', () => ({
  getSetting: (key: string, def: unknown) => (store.has(key) ? store.get(key) : def),
  setSetting: (key: string, value: unknown) => { store.set(key, value); },
}));
vi.mock('./cache', () => ({ getCacheTtlMs: () => ttl.ms }));
vi.mock('./logger', () => ({ logFrontendEvent: logMock }));

import {
  ANTI_CHEAT_URL,
  loadAntiCheatMap,
  antiCheatForAppSync,
  getAntiCheatForApp,
  antiCheatBadgeKind,
  isAntiCheatWarning,
  _resetAntiCheatForTests,
} from './antiCheat';

const MAP = {
  252490: { status: 'denied', vendors: ['Easy Anti-Cheat'] },
  578080: { status: 'broken', vendors: ['BattlEye'] },
  107410: { status: 'supported', vendors: ['BattlEye'] },
};

function ok(data: unknown) {
  return { status: 200, json: async () => data };
}

function logged(level: string, msg: string) {
  return logMock.mock.calls.find((c) => c[0] === level && c[1] === msg);
}

beforeEach(() => {
  _resetAntiCheatForTests();
  fetchNoCorsMock.mockReset();
  logMock.mockReset();
  store.clear();
  ttl.ms = 24 * 3600 * 1000;
});

describe('loadAntiCheatMap', () => {
  it('fetches the web app mirror, persists it, and serves sync lookups', async () => {
    fetchNoCorsMock.mockResolvedValue(ok(MAP));
    expect(antiCheatForAppSync(252490)).toBeNull();
    await loadAntiCheatMap();
    expect(fetchNoCorsMock).toHaveBeenCalledWith(ANTI_CHEAT_URL);
    expect(antiCheatForAppSync(252490)?.status).toBe('denied');
    expect(antiCheatForAppSync('578080')?.status).toBe('broken');
    expect(antiCheatForAppSync(1245620)).toBeNull();
    expect(antiCheatForAppSync(null)).toBeNull();
    expect((store.get('anti-cheat-cache') as { map: object }).map).toEqual(MAP);
  });

  it('fetches once per session even with concurrent callers', async () => {
    fetchNoCorsMock.mockResolvedValue(ok(MAP));
    await Promise.all([loadAntiCheatMap(), loadAntiCheatMap(), getAntiCheatForApp(1)]);
    await loadAntiCheatMap();
    expect(fetchNoCorsMock).toHaveBeenCalledTimes(1);
  });

  it('uses a fresh stored copy without touching the network', async () => {
    store.set('anti-cheat-cache', { fetchedAt: Date.now() - 1000, map: MAP });
    await loadAntiCheatMap();
    expect(fetchNoCorsMock).not.toHaveBeenCalled();
    expect(antiCheatForAppSync(107410)?.status).toBe('supported');
  });

  it('refetches once the stored copy is older than the cache TTL', async () => {
    ttl.ms = 1000;
    store.set('anti-cheat-cache', { fetchedAt: Date.now() - 5000, map: {} });
    fetchNoCorsMock.mockResolvedValue(ok(MAP));
    await loadAntiCheatMap();
    expect(fetchNoCorsMock).toHaveBeenCalledTimes(1);
    expect(antiCheatForAppSync(252490)?.status).toBe('denied');
  });

  it('falls back to the stale stored copy on a network failure and warns', async () => {
    ttl.ms = 1000;
    store.set('anti-cheat-cache', { fetchedAt: Date.now() - 5000, map: MAP });
    fetchNoCorsMock.mockRejectedValue(new Error('offline'));
    await loadAntiCheatMap();
    expect(antiCheatForAppSync(578080)?.status).toBe('broken');
    const warn = logged('WARNING', 'antiCheat: fetch failed, using stale stored map');
    expect(warn?.[2]).toMatchObject({ error: 'offline', source: ANTI_CHEAT_URL });
  });

  it('with no stored copy, a failure leaves an empty map and says badges are off', async () => {
    fetchNoCorsMock.mockResolvedValue({ status: 503, json: async () => ({}) });
    const map = await loadAntiCheatMap();
    expect(map).toEqual({});
    expect(logged('WARNING', 'antiCheat: fetch failed and no stored map, badges disabled this session')?.[2])
      .toMatchObject({ error: 'HTTP 503' });
  });

  it('rejects the HTML shell Cloudflare serves for a missing file', async () => {
    fetchNoCorsMock.mockResolvedValue({ status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    expect(await loadAntiCheatMap()).toEqual({});
    expect(store.has('anti-cheat-cache')).toBe(false);
  });

  it('rejects an array payload as malformed', async () => {
    fetchNoCorsMock.mockResolvedValue(ok([1, 2, 3]));
    expect(await loadAntiCheatMap()).toEqual({});
    expect(logged('WARNING', 'antiCheat: fetch failed and no stored map, badges disabled this session')?.[2])
      .toMatchObject({ error: 'payload is not an object map' });
  });

  it('ignores a corrupt stored copy and fetches', async () => {
    store.set('anti-cheat-cache', { fetchedAt: 'yesterday', map: MAP });
    fetchNoCorsMock.mockResolvedValue(ok(MAP));
    await loadAntiCheatMap();
    expect(fetchNoCorsMock).toHaveBeenCalledTimes(1);
  });

  it('still serves the fetched map when persisting it throws', async () => {
    const settings = await import('./settings');
    const spy = vi.spyOn(settings, 'setSetting').mockImplementation(() => { throw new Error('quota'); });
    fetchNoCorsMock.mockResolvedValue(ok(MAP));
    await loadAntiCheatMap();
    expect(antiCheatForAppSync(252490)?.status).toBe('denied');
    expect(logged('WARNING', 'antiCheat: could not persist map')?.[2]).toMatchObject({ error: 'quota' });
    spy.mockRestore();
  });
});

describe('non-Error throws are logged as strings', () => {
  it('handles a string rejection from the network and from persisting', async () => {
    const settings = await import('./settings');
    const spy = vi.spyOn(settings, 'setSetting').mockImplementation(() => { throw 'disk full'; });
    fetchNoCorsMock.mockResolvedValueOnce(ok(MAP));
    await loadAntiCheatMap();
    expect(logged('WARNING', 'antiCheat: could not persist map')?.[2]).toMatchObject({ error: 'disk full' });
    spy.mockRestore();

    _resetAntiCheatForTests();
    fetchNoCorsMock.mockRejectedValueOnce('socket closed');
    await loadAntiCheatMap();
    expect(logged('WARNING', 'antiCheat: fetch failed and no stored map, badges disabled this session')?.[2])
      .toMatchObject({ error: 'socket closed' });
  });
});

describe('antiCheatBadgeKind', () => {
  it.each([
    ['broken', 'blocked'],
    ['denied', 'denied'],
    ['running', 'unofficial'],
    ['planned', 'planned'],
  ])('%s -> %s', (status, kind) => {
    expect(antiCheatBadgeKind({ status, vendors: [] })).toBe(kind);
  });

  it('shows nothing for supported games, vendor-only entries, or no entry', () => {
    expect(antiCheatBadgeKind({ status: 'supported', vendors: ['EAC'] })).toBeNull();
    expect(antiCheatBadgeKind({ status: null, vendors: ['EAC'] })).toBeNull();
    expect(antiCheatBadgeKind(null)).toBeNull();
  });

  it('only blocked and denied are warnings', () => {
    expect(isAntiCheatWarning('blocked')).toBe(true);
    expect(isAntiCheatWarning('denied')).toBe(true);
    expect(isAntiCheatWarning('unofficial')).toBe(false);
    expect(isAntiCheatWarning('planned')).toBe(false);
    expect(isAntiCheatWarning(null)).toBe(false);
  });
});
