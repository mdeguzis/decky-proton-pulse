// src/lib/protondb.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@decky/api', () => ({
  fetchNoCors: vi.fn(),
}));

import { fetchNoCors } from '@decky/api';
import { getProtonDBSummary, getProtonDBReports, getVotes, postUpvote } from './protondb';
import type { ProtonDBSummary, CdnReport } from '../types';

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

const fakeCdnNormalized: CdnReport[] = [
  { ...fakeCdnRaw[0], rating: 'gold' },
  { ...fakeCdnRaw[1], rating: 'silver' },
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
  it('fetches from CDN URL', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeCdnRaw));
    await getProtonDBReports('730');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://mdeguzis.github.io/proton-pulse-data/data/730.json'
    );
  });

  it('normalizes rating to lowercase', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeCdnRaw));
    const result = await getProtonDBReports('730');
    expect(result[0].rating).toBe('gold');
    expect(result[1].rating).toBe('silver');
  });

  it('returns parsed array on 200', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeCdnRaw));
    const result = await getProtonDBReports('730');
    expect(result).toHaveLength(2);
    expect(result[0].protonVersion).toBe('GE-Proton9-7');
  });

  it('returns empty array on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse(404, null));
    expect(await getProtonDBReports('0')).toEqual([]);
  });

  it('returns empty array when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    expect(await getProtonDBReports('1')).toEqual([]);
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

  it('returns false on non-204', async () => {
    mockFetch.mockResolvedValue(makeResponse(422, null));
    expect(await postUpvote('730', 'key', 'token')).toBe(false);
  });

  it('returns false when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    expect(await postUpvote('730', 'key', 'token')).toBe(false);
  });
});
