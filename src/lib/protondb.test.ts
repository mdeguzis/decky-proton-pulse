// src/lib/protondb.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @decky/api before importing protondb so the module uses our mock.
vi.mock('@decky/api', () => ({
  fetchNoCors: vi.fn(),
}));

import { fetchNoCors } from '@decky/api';
import { getProtonDBSummary, getProtonDBReports } from './protondb';
import type { ProtonDBSummary, ProtonDBReport } from '../types';

const mockFetch = fetchNoCors as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockReset();
});

const fakeSummary: ProtonDBSummary = {
  score: 0.85,
  tier: 'gold',
  total: 123,
  trendingTier: 'platinum',
  bestReportedTier: 'platinum',
  confidence: 'good',
};

const fakeReports: ProtonDBReport[] = [
  {
    timestamp: 1700000000,
    rating: 'platinum',
    protonVersion: 'GE-Proton9-7',
    notes: 'Works great',
    responses: { gpu: 'NVIDIA GeForce RTX 3080' },
  },
  {
    timestamp: 1690000000,
    rating: 'gold',
    protonVersion: 'Proton 9.0',
    notes: 'Minor stutters',
    responses: {},
  },
];

function makeResponse(status: number, body: unknown) {
  return {
    status,
    json: () => Promise.resolve(body),
  };
}

describe('getProtonDBSummary', () => {
  it('returns parsed summary on 200', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeSummary));
    const result = await getProtonDBSummary('12345');
    expect(result).toEqual(fakeSummary);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.protondb.com/api/v1/reports/summaries/12345.json'
    );
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse(404, null));
    const result = await getProtonDBSummary('99999');
    expect(result).toBeNull();
  });

  it('returns null on non-200 status', async () => {
    mockFetch.mockResolvedValue(makeResponse(500, null));
    expect(await getProtonDBSummary('1')).toBeNull();
  });

  it('returns null when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    expect(await getProtonDBSummary('1')).toBeNull();
  });

  it('interpolates appId correctly into the URL', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeSummary));
    await getProtonDBSummary('2358720');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.protondb.com/api/v1/reports/summaries/2358720.json'
    );
  });
});

describe('getProtonDBReports', () => {
  it('returns parsed reports array on 200', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fakeReports));
    const result = await getProtonDBReports('12345');
    expect(result).toEqual(fakeReports);
    expect(result).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.protondb.com/api/v1/reports/app/12345'
    );
  });

  it('returns empty array on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse(404, null));
    expect(await getProtonDBReports('0')).toEqual([]);
  });

  it('returns empty array on non-200 status', async () => {
    mockFetch.mockResolvedValue(makeResponse(500, null));
    expect(await getProtonDBReports('1')).toEqual([]);
  });

  it('returns empty array when fetchNoCors throws', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    expect(await getProtonDBReports('1')).toEqual([]);
  });

  it('interpolates appId correctly into the URL', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, []));
    await getProtonDBReports('9876543');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.protondb.com/api/v1/reports/app/9876543'
    );
  });
});
