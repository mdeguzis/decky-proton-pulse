// src/lib/protondb.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@decky/api', () => ({
  fetchNoCors: vi.fn(),
  callable: vi.fn(() => vi.fn().mockResolvedValue(true)),
}));

import { fetchNoCors } from '@decky/api';
import { getProtonDBSummary, getProtonDBReports, getProtonDBReportsWithDiagnostics, getVotes, postUpvote } from './protondb';
import type { ProtonDBSummary } from '../types';

const mockFetch = fetchNoCors as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockReset();
});

function makeResponse(status: number, body: unknown) {
  return { status, json: () => Promise.resolve(body) };
}

const fakeSummary: ProtonDBSummary = {
  score: 0.85, tier: 'gold', total: 123,
  trendingTier: 'platinum', bestReportedTier: 'platinum', confidence: 'good',
};

const fakeCounts = {
  reports: 415099,
  timestamp: 1775051127,
};

const fakeLiveDetailed = {
  reports: [
    {
      timestamp: 1774621739,
      responses: {
        verdict: 'yes',
        triedOob: 'yes',
        verdictOob: 'yes',
        protonVersion: '10.0-3',
        notes: { concludingNotes: 'Runs great.' },
        audioFaults: 'no',
        graphicalFaults: 'no',
        inputFaults: 'no',
        performanceFaults: 'no',
        saveGameFaults: 'no',
        significantBugs: 'no',
        stabilityFaults: 'no',
        windowingFaults: 'no',
      },
      device: {
        inferred: {
          steam: {
            cpu: 'AMD Ryzen 5 7600 6-Core',
            gpu: 'NVIDIA GeForce RTX 5060 Ti',
            gpuDriver: 'NVIDIA 580.105.08',
            kernel: '6.12.60-1-lts',
            os: 'Arch Linux',
            ram: '31 GB',
          },
        },
      },
      contributor: {
        steam: {
          playtime: 625,
        },
      },
    },
    {
      timestamp: 1730388057,
      responses: {
        verdict: 'no',
        protonVersion: '9.0-3',
        notes: { verdict: 'PSN requirement was a mistake' },
      },
      device: {
        inferred: {
          steam: {
            cpu: 'AMD Ryzen 7 5800X3D 8-Core',
            gpu: 'AMD Radeon RX 6700 XT',
            gpuDriver: 'Mesa 24.2.4',
            kernel: '6.11.4',
            os: 'NixOS 24.11',
            ram: '32 GB',
          },
        },
      },
      contributor: {
        steam: {
          playtime: 1,
        },
      },
    },
  ],
};

// CDN returns capitalized ratings — the fetch layer must lowercase them
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
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, fakeSummary));
    expect(await getProtonDBReports('0')).toEqual([]);
  });

  it('falls back to live ProtonDB summary when mirror index 404s', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, fakeCounts))
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, fakeSummary));
    const result = await getProtonDBReportsWithDiagnostics('1145350');
    expect(result.reports).toEqual([]);
    expect(result.diagnostics.source).toBe('live-summary');
    expect(result.diagnostics.countsStatus).toBe(200);
    expect(result.diagnostics.liveDetailedStatus).toBe(404);
    expect(result.diagnostics.liveSummaryStatus).toBe(200);
    expect(result.diagnostics.liveSummaryTotal).toBe(fakeSummary.total);
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://mdeguzis.github.io/proton-pulse-data/data/1145350/index.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://www.protondb.com/data/counts.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(3,
      'https://www.protondb.com/data/reports/all-devices/app/1070226472.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(4,
      'https://www.protondb.com/api/v1/reports/summaries/1145350.json'
    );
  });

  it('falls back to live ProtonDB detailed reports when mirror misses', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(200, fakeCounts))
      .mockResolvedValueOnce(makeResponse(200, fakeLiveDetailed));

    const result = await getProtonDBReportsWithDiagnostics('2561580');

    expect(result.diagnostics.source).toBe('live-detailed');
    expect(result.diagnostics.countsStatus).toBe(200);
    expect(result.diagnostics.liveDetailedStatus).toBe(200);
    expect(result.diagnostics.liveDetailedCount).toBe(2);
    expect(result.reports).toHaveLength(2);
    expect(result.reports[0].protonVersion).toBe('10.0-3');
    expect(result.reports[0].rating).toBe('platinum');
    expect(result.reports[0].notes).toBe('Runs great.');
    expect(result.reports[1].rating).toBe('borked');
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://mdeguzis.github.io/proton-pulse-data/data/2561580/index.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://www.protondb.com/data/counts.json'
    );
    expect(mockFetch).toHaveBeenNthCalledWith(3,
      'https://www.protondb.com/data/reports/all-devices/app/2043109714.json'
    );
  });

  it('keeps mirror as source when year files return report rows', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, ['2023']))
      .mockResolvedValueOnce(makeResponse(200, fakeCdnRaw));
    const result = await getProtonDBReportsWithDiagnostics('730');
    expect(result.diagnostics.source).toBe('mirror');
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
});

// ─── getVotes ─────────────────────────────────────────────────────────────────

describe('getVotes', () => {
  it('fetches from correct votes URL', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, {}));
    await getVotes('730');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://mdeguzis.github.io/proton-pulse-data/data/730/votes.json'
    );
  });

  it('returns parsed vote map on 200', async () => {
    const voteData = { '1700000000_GE-Proton9-7': 5 };
    mockFetch.mockResolvedValue(makeResponse(200, voteData));
    expect(await getVotes('730')).toEqual(voteData);
  });

  it('returns empty object on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse(404, null));
    expect(await getVotes('730')).toEqual({});
  });

  it('returns empty object when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    expect(await getVotes('730')).toEqual({});
  });
});

// ─── postUpvote ───────────────────────────────────────────────────────────────

describe('postUpvote', () => {
  it('returns false immediately when token is empty', async () => {
    expect(await postUpvote('730', '1700000000_GE-Proton9-7', '')).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('posts to GitHub dispatches endpoint with correct payload', async () => {
    mockFetch.mockResolvedValue(makeResponse(204, null));
    await postUpvote('730', '1700000000_GE-Proton9-7', 'mytoken');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/mdeguzis/proton-pulse-data/dispatches',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer mytoken',
          'X-GitHub-Api-Version': '2022-11-28',
        }),
        body: JSON.stringify({
          event_type: 'upvote',
          client_payload: { appId: '730', reportKey: '1700000000_GE-Proton9-7' },
        }),
      })
    );
  });

  it('returns true on 204', async () => {
    mockFetch.mockResolvedValue(makeResponse(204, null));
    expect(await postUpvote('730', 'key', 'token')).toBe(true);
  });

  it('falls back to workflow dispatch when repository dispatch is rejected', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(404, null))
      .mockResolvedValueOnce(makeResponse(204, null));

    expect(await postUpvote('730', 'key', 'token')).toBe(true);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/mdeguzis/proton-pulse-data/actions/workflows/upvote.yml/dispatches',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ref: 'main',
          inputs: { appId: '730', reportKey: 'key' },
        }),
      })
    );
  });

  it('trims token before dispatching', async () => {
    mockFetch.mockResolvedValue(makeResponse(204, null));
    await postUpvote('730', 'key', ' token-with-space ');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/mdeguzis/proton-pulse-data/dispatches',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer token-with-space',
        }),
      })
    );
  });

  it('returns false on non-204', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(422, null))
      .mockResolvedValueOnce(makeResponse(422, null));
    expect(await postUpvote('730', 'key', 'token')).toBe(false);
  });

  it('returns false when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    expect(await postUpvote('730', 'key', 'token')).toBe(false);
  });
});
