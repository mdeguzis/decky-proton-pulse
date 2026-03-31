// src/lib/protondb.ts
// Fetch ProtonDB data directly from the CEF frontend using fetchNoCors,
// matching the pattern used by protondb-decky (github.com/OMGDuke/protondb-decky).
// This avoids Python-side aiohttp which is not bundled in the Decky plugin env.
import { fetchNoCors } from '@decky/api';
import type { ProtonDBSummary, ProtonDBReport } from '../types';

const SUMMARY_URL = 'https://www.protondb.com/api/v1/reports/summaries/{id}.json';
const REPORTS_URL = 'https://www.protondb.com/api/v1/reports/app/{id}';

export async function getProtonDBSummary(appId: string): Promise<ProtonDBSummary | null> {
  try {
    const resp = await fetchNoCors(SUMMARY_URL.replace('{id}', appId));
    if (resp.status !== 200) return null;
    return await resp.json() as ProtonDBSummary;
  } catch {
    return null;
  }
}

export async function getProtonDBReports(appId: string): Promise<ProtonDBReport[]> {
  try {
    const resp = await fetchNoCors(REPORTS_URL.replace('{id}', appId));
    if (resp.status !== 200) return [];
    return await resp.json() as ProtonDBReport[];
  } catch {
    return [];
  }
}
