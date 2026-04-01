// src/lib/protondb.ts
import { fetchNoCors } from '@decky/api';
import type { ProtonDBSummary, CdnReport, ProtonRating } from '../types';

const SUMMARY_URL   = 'https://www.protondb.com/api/v1/reports/summaries/{id}.json';
const APP_INDEX_URL = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/index.json';
const YEAR_URL      = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/{year}.json';
const VOTES_URL     = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/votes.json';
const DISPATCH_URL  = 'https://api.github.com/repos/mdeguzis/proton-pulse-data/dispatches';

export async function getProtonDBSummary(appId: string): Promise<ProtonDBSummary | null> {
  try {
    const resp = await fetchNoCors(SUMMARY_URL.replace('{id}', appId));
    if (resp.status !== 200) return null;
    return await resp.json() as ProtonDBSummary;
  } catch {
    return null;
  }
}

const VALID_RATINGS = new Set<string>(['platinum', 'gold', 'silver', 'bronze', 'borked', 'pending']);

function normalizeReports(raw: Array<CdnReport & { rating: string }>): CdnReport[] {
  return raw.map(r => {
    const normalized = r.rating.toLowerCase();
    const rating = VALID_RATINGS.has(normalized) ? normalized as ProtonRating : 'pending';
    return { ...r, rating };
  });
}

export async function getProtonDBReports(appId: string): Promise<CdnReport[]> {
  try {
    // Fetch index to discover available year files
    const indexResp = await fetchNoCors(APP_INDEX_URL.replace('{id}', appId));
    if (indexResp.status !== 200) return [];
    const years = await indexResp.json() as string[];
    if (!years.length) return [];

    // Fetch all year files in parallel
    const yearResults = await Promise.all(
      years.map(async (year) => {
        try {
          const resp = await fetchNoCors(YEAR_URL.replace('{id}', appId).replace('{year}', year));
          if (resp.status !== 200) return [];
          return normalizeReports(await resp.json() as Array<CdnReport & { rating: string }>);
        } catch {
          return [];
        }
      })
    );

    return yearResults.flat();
  } catch {
    return [];
  }
}

export async function getVotes(appId: string): Promise<Record<string, number>> {
  try {
    const resp = await fetchNoCors(VOTES_URL.replace('{id}', appId));
    if (resp.status !== 200) return {};
    return await resp.json() as Record<string, number>;
  } catch {
    return {};
  }
}

export async function postUpvote(
  appId: string,
  reportKey: string,
  token: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const resp = await fetchNoCors(DISPATCH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'upvote',
        client_payload: { appId, reportKey },
      }),
    });
    return resp.status === 204;
  } catch {
    return false;
  }
}
