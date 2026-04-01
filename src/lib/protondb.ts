// src/lib/protondb.ts
import { fetchNoCors } from '@decky/api';
import type { ProtonDBSummary, CdnReport, ProtonRating } from '../types';

const SUMMARY_URL  = 'https://www.protondb.com/api/v1/reports/summaries/{id}.json';
const REPORTS_URL  = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}.json';
const VOTES_URL    = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/votes.json';
const DISPATCH_URL = 'https://api.github.com/repos/mdeguzis/proton-pulse-data/dispatches';

export async function getProtonDBSummary(appId: string): Promise<ProtonDBSummary | null> {
  try {
    const resp = await fetchNoCors(SUMMARY_URL.replace('{id}', appId));
    if (resp.status !== 200) return null;
    return await resp.json() as ProtonDBSummary;
  } catch {
    return null;
  }
}

export async function getProtonDBReports(appId: string): Promise<CdnReport[]> {
  try {
    const resp = await fetchNoCors(REPORTS_URL.replace('{id}', appId));
    if (resp.status !== 200) return [];
    const raw = await resp.json() as Array<CdnReport & { rating: string }>;
    return raw.map(r => ({ ...r, rating: r.rating.toLowerCase() as ProtonRating }));
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
