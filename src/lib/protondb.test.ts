// src/lib/protondb.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@decky/api', () => ({
  fetchNoCors: vi.fn(),
  callable: vi.fn(() => vi.fn().mockResolvedValue(true)),
}));

// bypass cache so every test hits the mock fetch
vi.mock('./cache', () => ({
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
}));

// stub metrics so they dont break in test env
vi.mock('./metrics', () => ({
  startDetailedSpan: vi.fn(() => ({ end: vi.fn() })),
  countFetch: vi.fn(),
}));

import { fetchNoCors } from '@decky/api';
import { getCached } from './cache';
import { getProtonDBSummary, getProtonDBReports, getProtonDBReportsWithDiagnostics } from './protondb';
import type { ProtonDBSummary } from '../types';

const mockFetch = fetchNoCors as ReturnType<typeof vi.fn>;
const mockGetCached = getCached as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockReset();
  mockGetCached.mockReset();
  mockGetCached.mockReturnValue(null);
});

function makeResponse(status: number, body: unknown) {
  return { status, json: () => Promise.resolve(body) };
}

const fakeSummary: ProtonDBSummary = {
  score: 0.85, tier: 'gold', total: 123,
  trendingTier: 'platinum', bestReportedTier: 'platinum', confidence: 'good',
};

const fakeLiveDetailedPayload = {
  reports: [
    {
      timestamp: 1710000000,
      responses: {
        verdict: 'yes',
        triedOob: 'yes',
        protonVersion: 'GE-Proton10-1',
        notes: {
          concludingNotes: 'Runs great on Deck',
        },
      },
      device: {
        inferred: {
          steam: {
            cpu: 'AMD Custom APU',
            gpu: 'AMD Custom GPU 0405',
            gpuDriver: 'Mesa',
            kernel: '6.1.1-valve',
            os: 'SteamOS',
            ram: '14 GB',
          },
        },
      },
      contributor: {
        steam: {
          playtimeLinux: 300,
        },
      },
    },
  ],
};

// CDN returns capitalized ratings -- the fetch layer must lowercase them
const fakeCdnRaw = [
  {
    appId: '730', cpu: 'Intel i7', duration: 'severalHours',
    gpu: 'NVIDIA GeForce RTX 3080', gpuDriver: 'NVIDIA 545.29.06',
    kernel: '6.1.0', notes: 'Works great', os: 'Arch Linux',
    protonVersion: 'GE-Proton9-7', ram: '32 GB', rating: 'Gold',
    timestamp: 1700000000, title: 'Test Game',
  },
  {
    appId: '730', cpu: 'AMD Ryzen 5', duration: 'allTheTime',
    gpu: 'AMD Radeon RX 7900 XT', gpuDriver: 'Mesa 23.1.0',
    kernel: '6.2.0', notes: 'Minor issues', os: 'Ubuntu 22.04',
    protonVersion: 'Proton 9.0', ram: '16 GB', rating: 'Silver',
    timestamp: 1690000000, title: 'Test Game',
  },
];

// ─── getProtonDBSummary ────────────────────────────────────────────────────────

describe('getProtonDBSummary', () => {
  it('returns the cached summary without fetching', async () => {
    mockGetCached.mockReturnValue({
      cachedAt: Date.now(),
      reports: [],
      summary: fakeSummary,
      source: 'cdn',
      appId: '12345',
      lastAccessedAt: Date.now(),
      votes: {},
    });
    expect(await getProtonDBSummary('12345')).toEqual(fakeSummary);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns parsed summary on 200', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeSummary));
    expect(await getProtonDBSummary('12345')).toEqual(fakeSummary);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.protondb.com/api/v1/reports/summaries/12345.json'
    );
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse(404, null));
    expect(await getProtonDBSummary('99999')).toBeNull();
  });

  it('returns null when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    expect(await getProtonDBSummary('1')).toBeNull();
  });
});

// ─── getProtonDBReports ────────────────────────────────────────────────────────

describe('getProtonDBReports', () => {
  it('returns cached reports with diagnostics immediately', async () => {
    mockGetCached.mockReturnValue({
      cachedAt: Date.now(),
      reports: fakeCdnRaw.map(report => ({ ...report, rating: report.rating.toLowerCase() as 'gold' | 'silver' })),
      summary: fakeSummary,
      source: 'cdn',
      appId: '730',
      lastAccessedAt: Date.now(),
      votes: {},
    });

    const result = await getProtonDBReportsWithDiagnostics('730');
    expect(result.reports).toHaveLength(2);
    expect(result.diagnostics.liveSummaryTotal).toBe(fakeSummary.total);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches index then year files', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, ['2023']))
      .mockResolvedValueOnce(makeResponse(200, fakeCdnRaw));
    await getProtonDBReports('730');
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://mdeguzis.github.io/proton-pulse-data/data/730/index.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://mdeguzis.github.io/proton-pulse-data/data/730/2023.json'
    );
  });

  it('merges reports from multiple year files', async () => {
    const year2022 = [fakeCdnRaw[0]];
    const year2023 = [fakeCdnRaw[1]];
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, ['2022', '2023']))
      .mockResolvedValueOnce(makeResponse(200, year2022))
      .mockResolvedValueOnce(makeResponse(200, year2023));
    const result = await getProtonDBReports('730');
    expect(result).toHaveLength(2);
  });

  it('normalizes rating to lowercase', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, ['2023']))
      .mockResolvedValueOnce(makeResponse(200, fakeCdnRaw));
    const result = await getProtonDBReports('730');
    expect(result[0].rating).toBe('gold');
    expect(result[1].rating).toBe('silver');
  });

  it('returns parsed array on 200', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, ['2023']))
      .mockResolvedValueOnce(makeResponse(200, fakeCdnRaw));
    const result = await getProtonDBReports('730');
    expect(result).toHaveLength(2);
    expect(result[0].protonVersion).toBe('GE-Proton9-7');
  });

  it('returns empty array when index 404s', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(404, null));
    expect(await getProtonDBReports('0')).toEqual([]);
  });

  it('falls back to live ProtonDB summary when CDN index 404s', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, { reports: 416416, timestamp: 1775704890 }))
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, fakeSummary));
    const result = await getProtonDBReportsWithDiagnostics('1145350');
    expect(result.reports).toEqual([]);
    expect(result.diagnostics.source).toBe('live-summary');
    expect(result.diagnostics.liveSummaryStatus).toBe(200);
    expect(result.diagnostics.liveSummaryTotal).toBe(fakeSummary.total);
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://mdeguzis.github.io/proton-pulse-data/data/1145350/index.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://www.protondb.com/data/counts.json'
    );
    expect(mockFetch.mock.calls[2]?.[0]).toMatch(
      /^https:\/\/www\.protondb\.com\/data\/reports\/all-devices\/app\/\d+\.json$/
    );
    expect(mockFetch.mock.calls[3]?.[0]).toMatch(
      /^https:\/\/www\.protondb\.com\/data\/reports\/all-devices\/app\/\d+\.json$/
    );
    expect(mockFetch).toHaveBeenNthCalledWith(5,
      'https://www.protondb.com/api/v1/reports/summaries/1145350.json'
    );
  });

  it('falls back to live ProtonDB detailed reports when CDN index 404s', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, { reports: 416416, timestamp: 1775704890 }))
      .mockResolvedValueOnce(makeResponse(200, fakeLiveDetailedPayload));

    const result = await getProtonDBReportsWithDiagnostics('2358720');

    expect(result.diagnostics.source).toBe('live-detailed');
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      appId: '2358720',
      rating: 'platinum',
      protonVersion: 'GE-Proton10-1',
      notes: 'Runs great on Deck',
    });
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://mdeguzis.github.io/proton-pulse-data/data/2358720/index.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://www.protondb.com/data/counts.json'
    );
    expect(mockFetch.mock.calls[2]?.[0]).toMatch(
      /^https:\/\/www\.protondb\.com\/data\/reports\/all-devices\/app\/\d+\.json$/
    );
  });

  it('tries the legacy live detailed URL before falling back to summary', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, { reports: 416416, timestamp: 1775704890 }))
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, fakeLiveDetailedPayload));

    const result = await getProtonDBReportsWithDiagnostics('2358720');

    expect(result.diagnostics.source).toBe('live-detailed');
    expect(result.reports).toHaveLength(1);
    expect(mockFetch.mock.calls[2]?.[0]).toMatch(
      /^https:\/\/www\.protondb\.com\/data\/reports\/all-devices\/app\/\d+\.json$/
    );
    expect(mockFetch.mock.calls[3]?.[0]).toMatch(
      /^https:\/\/www\.protondb\.com\/data\/reports\/all-devices\/app\/\d+\.json$/
    );
  });

  it('falls back to live ProtonDB summary when CDN years are empty', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, ['2023']))
      .mockResolvedValueOnce(makeResponse(200, []))
      .mockResolvedValueOnce(makeResponse(200, { reports: 416416, timestamp: 1775704890 }))
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, fakeSummary));

    const result = await getProtonDBReportsWithDiagnostics('2561580');

    expect(result.diagnostics.source).toBe('live-summary');
    expect(result.reports).toHaveLength(0);
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://mdeguzis.github.io/proton-pulse-data/data/2561580/index.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://mdeguzis.github.io/proton-pulse-data/data/2561580/2023.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(3,
      'https://www.protondb.com/data/counts.json'
    );
    expect(mockFetch.mock.calls[3]?.[0]).toMatch(
      /^https:\/\/www\.protondb\.com\/data\/reports\/all-devices\/app\/\d+\.json$/
    );
    expect(mockFetch.mock.calls[4]?.[0]).toMatch(
      /^https:\/\/www\.protondb\.com\/data\/reports\/all-devices\/app\/\d+\.json$/
    );
    expect(mockFetch).toHaveBeenNthCalledWith(6,
      'https://www.protondb.com/api/v1/reports/summaries/2561580.json'
    );
  });

  it('keeps CDN as source when year files return report rows', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, ['2023']))
      .mockResolvedValueOnce(makeResponse(200, fakeCdnRaw));
    const result = await getProtonDBReportsWithDiagnostics('730');
    expect(result.diagnostics.source).toBe('cdn');
    expect(result.diagnostics.liveSummaryStatus).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    expect(await getProtonDBReports('1')).toEqual([]);
  });

  it('returns empty array when index is empty', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, []));
    expect(await getProtonDBReports('730')).toEqual([]);
  });

  it('skips year files that 404 and returns the rest', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, ['2022', '2023']))
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, fakeCdnRaw));
    const result = await getProtonDBReports('730');
    expect(result).toHaveLength(2);
  });

  it('keeps going when a year file fetch throws and later years still succeed', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, ['2022', '2023']))
      .mockRejectedValueOnce(new Error('year timeout'))
      .mockResolvedValueOnce(makeResponse(200, fakeCdnRaw));

    const result = await getProtonDBReportsWithDiagnostics('730');

    expect(result.reports).toHaveLength(2);
    expect(result.diagnostics.source).toBe('cdn');
    expect(result.diagnostics.yearStatuses).toEqual({
      '2022': null,
      '2023': 200,
    });
  });

  it('returns empty reports when live counts payload is unusable', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, { reports: 0, timestamp: 0 }))
      .mockResolvedValueOnce(makeResponse(200, fakeSummary));

    const result = await getProtonDBReportsWithDiagnostics('730');
    expect(result.reports).toEqual([]);
    expect(result.diagnostics.source).toBe('live-summary');
  });

  it('skips malformed live detailed payloads until a valid one is found', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, { reports: 2, timestamp: 1775704890 }))
      .mockResolvedValueOnce(makeResponse(200, { reports: [{ timestamp: -1 }] }))
      .mockResolvedValueOnce(makeResponse(200, {
        title: 'Deck Game',
        reports: [
          {
            timestamp: 1710000000,
            responses: { verdict: 'yes', graphicalFaults: 'yes', protonVersion: '', notes: 'Pretty good' },
            device: { inferred: { steam: { cpu: 'AMD', gpu: 'RDNA', gpuDriver: 'Mesa', kernel: '6.1', os: 'SteamOS', ram: '16 GB' } } },
            contributor: { steam: { playtime: 90 } },
          },
        ],
      }));

    const result = await getProtonDBReportsWithDiagnostics('730');
    expect(result.diagnostics.source).toBe('live-detailed');
    expect(result.reports[0]).toMatchObject({
      title: 'Deck Game',
      duration: 'oneToFourHours',
      protonVersion: 'Unknown',
      rating: 'gold',
    });
  });

  it('handles additional live detailed report normalization branches', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, { reports: 4, timestamp: 1775704890 }))
      .mockResolvedValueOnce(makeResponse(200, {
        title: 'Fallback Cases',
        reports: [
          null,
          { timestamp: 0 },
          {
            timestamp: 1710000001,
            responses: {
              verdict: 'no',
              notes: { verdict: 'Bad time' },
              protonVersion: '  ',
            },
            device: { inferred: { steam: { cpu: 'AMD', gpu: 'APU', gpuDriver: 'Mesa', kernel: '6.1', os: 'SteamOS', ram: '16 GB' } } },
            contributor: { steam: { playtimeLinux: 30 } },
          },
          {
            timestamp: 1710000002,
            responses: {
              verdict: 'yes',
              audioFaults: 'yes',
              graphicalFaults: 'yes',
              inputFaults: 'yes',
              notes: 'Needs tweaks',
              protonVersion: 'GE-Proton10-1',
            },
            device: { inferred: { steam: { cpu: 'AMD', gpu: 'APU', gpuDriver: 'Mesa', kernel: '6.1', os: 'SteamOS', ram: '16 GB' } } },
            contributor: { steam: { playtimeLinux: 10 } },
          },
        ],
      }));

    const result = await getProtonDBReportsWithDiagnostics('730');
    expect(result.diagnostics.source).toBe('live-detailed');
    expect(result.reports).toHaveLength(2);
    expect(result.reports[0]).toMatchObject({
      rating: 'borked',
      duration: 'underOneHour',
      notes: 'Bad time',
      protonVersion: 'Unknown',
    });
    expect(result.reports[1]).toMatchObject({
      rating: 'bronze',
      duration: 'underOneHour',
      notes: 'Needs tweaks',
      protonVersion: 'GE-Proton10-1',
    });
  });

  it('skips live detailed payloads that do not contain a reports array', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, { reports: 2, timestamp: 1775704890 }))
      .mockResolvedValueOnce(makeResponse(200, { title: 'Malformed payload' }))
      .mockResolvedValueOnce(makeResponse(200, fakeLiveDetailedPayload));

    const result = await getProtonDBReportsWithDiagnostics('2358720');

    expect(result.diagnostics.source).toBe('live-detailed');
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].notes).toBe('Runs great on Deck');
  });

  it('returns empty reports when live counts return non-200 and summary fallback also misses', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(500, null))
      .mockResolvedValueOnce(makeResponse(404, null));

    const result = await getProtonDBReportsWithDiagnostics('730');
    expect(result.reports).toEqual([]);
    expect(result.diagnostics.source).toBe('none');
    expect(result.diagnostics.liveSummaryStatus).toBe(404);
  });
});
