// src/lib/protondb.ts
import { fetchNoCors } from '@decky/api';
import type { ProtonDBSummary, CdnReport, ProtonRating } from '../types';
import { logFrontendEvent } from './logger';

const SUMMARY_URL   = 'https://www.protondb.com/api/v1/reports/summaries/{id}.json';
const APP_INDEX_URL = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/index.json';
const YEAR_URL      = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/{year}.json';
const VOTES_URL     = 'https://mdeguzis.github.io/proton-pulse-data/data/{id}/votes.json';
const COUNTS_URL    = 'https://www.protondb.com/data/counts.json';
const LIVE_REPORTS_URL = 'https://www.protondb.com/data/reports/{device}/app/{hash}.json';
const REPOSITORY_DISPATCH_URL = 'https://api.github.com/repos/mdeguzis/proton-pulse-data/dispatches';
const WORKFLOW_DISPATCH_URL   = 'https://api.github.com/repos/mdeguzis/proton-pulse-data/actions/workflows/upvote.yml/dispatches';
const WORKFLOW_REF            = 'main';

export interface ReportFetchDiagnostics {
  source: 'mirror' | 'live-detailed' | 'live-summary' | 'none';
  indexUrl: string;
  indexStatus: number | null;
  years: string[];
  yearStatuses: Record<string, number | null>;
  countsUrl: string;
  countsStatus: number | null;
  liveDetailedUrl: string | null;
  liveDetailedStatus: number | null;
  liveDetailedCount: number | null;
  liveSummaryUrl: string;
  liveSummaryStatus: number | null;
  liveSummaryTotal: number | null;
  liveSummaryTier: ProtonRating | null;
}

export interface VotesFetchDiagnostics {
  url: string;
  status: number | null;
}
export async function getProtonDBSummary(appId: string): Promise<ProtonDBSummary | null> {
  const url = SUMMARY_URL.replace('{id}', appId);
  try {
    await logFrontendEvent('DEBUG', 'Fetching ProtonDB summary', { appId, url });
    const resp = await fetchNoCors(url);
    await logFrontendEvent('DEBUG', 'ProtonDB summary response received', { appId, url, status: resp.status });
    if (resp.status !== 200) {
      await logFrontendEvent('WARNING', 'ProtonDB summary request returned non-200', { appId, url, status: resp.status });
      return null;
    }
    const summary = await resp.json() as ProtonDBSummary;
    await logFrontendEvent('DEBUG', 'Fetched ProtonDB summary', { appId, url, total: summary.total, tier: summary.tier });
    return summary;
  } catch (error) {
    await logFrontendEvent('ERROR', 'Failed to fetch ProtonDB summary', {
      appId,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const VALID_RATINGS = new Set<string>(['platinum', 'gold', 'silver', 'bronze', 'borked', 'pending']);
const LIVE_REPORT_DEVICE = 'all-devices';
const LIVE_REPORT_FAULT_KEYS = [
  'audioFaults',
  'graphicalFaults',
  'inputFaults',
  'performanceFaults',
  'saveGameFaults',
  'significantBugs',
  'stabilityFaults',
  'windowingFaults',
] as const;

interface ProtonCountsResponse {
  reports: number;
  timestamp: number;
}

interface LiveReportSteamInfo {
  cpu?: string;
  gpu?: string;
  gpuDriver?: string;
  kernel?: string;
  os?: string;
  ram?: string;
}

interface LiveReportResponsePayload {
  verdict?: string;
  verdictOob?: string;
  protonVersion?: string;
  notes?: {
    concludingNotes?: string;
    verdict?: string;
  };
  tinkerOverride?: string;
  triedOob?: string;
  [key: string]: unknown;
}

interface LiveDetailedReport {
  timestamp?: number;
  responses?: LiveReportResponsePayload;
  device?: {
    inferred?: {
      steam?: LiveReportSteamInfo;
    };
  };
  contributor?: {
    steam?: {
      playtime?: number;
      playtimeLinux?: number;
    };
  };
}

interface LiveDetailedReportPage {
  reports?: LiveDetailedReport[];
}

function computeJsHash(seed: string): number {
  let hash = 0;
  for (const ch of `${seed}m`) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

function computeLiveReportHash(appId: number, reportCount: number, timestamp: number, page: string | number): number {
  const left = `${reportCount}p${appId * (reportCount % timestamp)}`;
  const right = `${appId}p${Number(page) * (appId % timestamp)}`;
  return computeJsHash(`p${left}*vRT${right}${String(undefined)}`);
}

function normalizeWhitespace(value: string | undefined): string {
  return value?.trim() ?? '';
}

function inferDuration(playtimeMinutes?: number): string {
  if (!playtimeMinutes || playtimeMinutes <= 0) return 'unreported';
  if (playtimeMinutes < 60) return 'underOneHour';
  if (playtimeMinutes < 240) return 'oneToFourHours';
  if (playtimeMinutes < 900) return 'severalHours';
  return 'allTheTime';
}

function inferLiveRating(responses: LiveReportResponsePayload | undefined): ProtonRating {
  const verdict = normalizeWhitespace(responses?.verdict).toLowerCase();
  if (!verdict) return 'pending';
  if (verdict === 'no') return 'borked';
  if (verdict !== 'yes') return 'pending';

  const faultCount = LIVE_REPORT_FAULT_KEYS.reduce((count, key) => (
    responses?.[key] === 'yes' ? count + 1 : count
  ), 0);

  if (faultCount >= 3) return 'bronze';
  if (faultCount === 2) return 'silver';
  if (faultCount === 1) return 'gold';
  return responses?.triedOob === 'yes' || responses?.verdictOob === 'yes' ? 'platinum' : 'gold';
}

function normalizeLiveDetailedReports(appId: string, raw: LiveDetailedReport[]): CdnReport[] {
  return raw
    .map((report) => {
      const responses = report.responses;
      const steam = report.device?.inferred?.steam;
      const playtime = report.contributor?.steam?.playtimeLinux ?? report.contributor?.steam?.playtime;
      const notes = normalizeWhitespace(
        responses?.notes?.concludingNotes
        ?? responses?.notes?.verdict
        ?? (typeof responses?.notes === 'string' ? responses.notes : undefined)
      );
      return {
        appId,
        cpu: normalizeWhitespace(steam?.cpu),
        duration: inferDuration(playtime),
        gpu: normalizeWhitespace(steam?.gpu),
        gpuDriver: normalizeWhitespace(steam?.gpuDriver),
        kernel: normalizeWhitespace(steam?.kernel),
        notes,
        os: normalizeWhitespace(steam?.os),
        protonVersion: normalizeWhitespace(responses?.protonVersion) || 'Unknown',
        ram: normalizeWhitespace(steam?.ram),
        rating: inferLiveRating(responses),
        timestamp: typeof report.timestamp === 'number' ? report.timestamp : 0,
        title: '',
      } satisfies CdnReport;
    })
    .filter((report) => report.timestamp > 0);
}

function normalizeReports(raw: Array<CdnReport & { rating: string }>): CdnReport[] {
  return raw.map(r => {
    const normalized = r.rating.toLowerCase();
    const rating = VALID_RATINGS.has(normalized) ? normalized as ProtonRating : 'pending';
    return { ...r, rating };
  });
}

export async function getProtonDBReports(appId: string): Promise<CdnReport[]> {
  const result = await getProtonDBReportsWithDiagnostics(appId);
  return result.reports;
}

export async function getProtonDBReportsWithDiagnostics(appId: string): Promise<{
  reports: CdnReport[];
  diagnostics: ReportFetchDiagnostics;
}> {
  const indexUrl = APP_INDEX_URL.replace('{id}', appId);
  const diagnostics: ReportFetchDiagnostics = {
    source: 'none',
    indexUrl,
    indexStatus: null,
    years: [],
    yearStatuses: {},
    countsUrl: COUNTS_URL,
    countsStatus: null,
    liveDetailedUrl: null,
    liveDetailedStatus: null,
    liveDetailedCount: null,
    liveSummaryUrl: SUMMARY_URL.replace('{id}', appId),
    liveSummaryStatus: null,
    liveSummaryTotal: null,
    liveSummaryTier: null,
  };
  try {
    await logFrontendEvent('INFO', 'Fetching Proton Pulse report index', { appId, indexUrl });
    // Fetch index to discover available year files
    const indexResp = await fetchNoCors(indexUrl);
    diagnostics.indexStatus = indexResp.status;
    await logFrontendEvent('DEBUG', 'Proton Pulse report index response received', {
      appId,
      indexUrl,
      status: indexResp.status,
    });
    if (indexResp.status !== 200) {
      await logFrontendEvent('WARNING', 'Proton Pulse report index returned non-200', {
        appId,
        indexUrl,
        status: indexResp.status,
      });
      return await fallbackToLiveDetailed(appId, diagnostics, 'mirror-index-miss');
    }
    const years = await indexResp.json() as string[];
    diagnostics.years = years;
    await logFrontendEvent('INFO', 'Proton Pulse report index loaded', { appId, years });
    if (!years.length) {
      await logFrontendEvent('WARNING', 'Proton Pulse report index was empty', { appId, indexUrl });
      return await fallbackToLiveDetailed(appId, diagnostics, 'mirror-index-empty');
    }

    // Fetch all year files in parallel
    const yearResults = await Promise.all(
      years.map(async (year) => {
        const yearUrl = YEAR_URL.replace('{id}', appId).replace('{year}', year);
        try {
          await logFrontendEvent('DEBUG', 'Fetching report year file', { appId, year, yearUrl });
          const resp = await fetchNoCors(yearUrl);
          diagnostics.yearStatuses[year] = resp.status;
          await logFrontendEvent('DEBUG', 'Report year file response received', {
            appId,
            year,
            yearUrl,
            status: resp.status,
          });
          if (resp.status !== 200) {
            await logFrontendEvent('WARNING', 'Report year file returned non-200', {
              appId,
              year,
              yearUrl,
              status: resp.status,
            });
            return [];
          }
          const reports = normalizeReports(await resp.json() as Array<CdnReport & { rating: string }>);
          await logFrontendEvent('DEBUG', 'Loaded report year file', {
            appId,
            year,
            yearUrl,
            count: reports.length,
          });
          return reports;
        } catch (error) {
          diagnostics.yearStatuses[year] = null;
          await logFrontendEvent('ERROR', 'Failed to fetch report year file', {
            appId,
            year,
            yearUrl,
            error: error instanceof Error ? error.message : String(error),
          });
          return [];
        }
      })
    );

    const reports = yearResults.flat();
    if (!reports.length) {
      await logFrontendEvent('WARNING', 'Mirror returned no report rows after year fetches', {
        appId,
        years: years.length,
      });
      return await fallbackToLiveDetailed(appId, diagnostics, 'mirror-years-empty');
    }
    diagnostics.source = 'mirror';
    await logFrontendEvent('INFO', 'Finished Proton Pulse report fetch', {
      appId,
      source: diagnostics.source,
      years: years.length,
      reports: reports.length,
    });
    return { reports, diagnostics };
  } catch (error) {
    await logFrontendEvent('ERROR', 'Failed to fetch Proton Pulse report index', {
      appId,
      indexUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return await fallbackToLiveDetailed(appId, diagnostics, 'mirror-index-error');
  }
}

async function fallbackToLiveSummary(
  appId: string,
  diagnostics: ReportFetchDiagnostics,
  reason: string,
): Promise<{
  reports: CdnReport[];
  diagnostics: ReportFetchDiagnostics;
}> {
  const url = diagnostics.liveSummaryUrl;
  try {
    await logFrontendEvent('INFO', 'Falling back to live ProtonDB summary', {
      appId,
      reason,
      url,
    });
    const resp = await fetchNoCors(url);
    diagnostics.liveSummaryStatus = resp.status;
    await logFrontendEvent('DEBUG', 'Live ProtonDB summary response received', {
      appId,
      reason,
      url,
      status: resp.status,
    });
    if (resp.status !== 200) {
      await logFrontendEvent('WARNING', 'Live ProtonDB summary returned non-200', {
        appId,
        reason,
        url,
        status: resp.status,
      });
      return { reports: [], diagnostics };
    }

    const summary = await resp.json() as ProtonDBSummary;
    diagnostics.source = 'live-summary';
    diagnostics.liveSummaryTotal = summary.total;
    diagnostics.liveSummaryTier = summary.tier;
    await logFrontendEvent('INFO', 'Live ProtonDB summary fallback succeeded', {
      appId,
      reason,
      url,
      total: summary.total,
      tier: summary.tier,
    });
    return { reports: [], diagnostics };
  } catch (error) {
    await logFrontendEvent('ERROR', 'Live ProtonDB summary fallback failed', {
      appId,
      reason,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return { reports: [], diagnostics };
  }
}

async function fallbackToLiveDetailed(
  appId: string,
  diagnostics: ReportFetchDiagnostics,
  reason: string,
): Promise<{
  reports: CdnReport[];
  diagnostics: ReportFetchDiagnostics;
}> {
  try {
    await logFrontendEvent('INFO', 'Falling back to live ProtonDB detailed reports', {
      appId,
      reason,
      countsUrl: diagnostics.countsUrl,
    });
    const countsResp = await fetchNoCors(diagnostics.countsUrl);
    diagnostics.countsStatus = countsResp.status;
    await logFrontendEvent('DEBUG', 'Live ProtonDB counts response received', {
      appId,
      reason,
      countsUrl: diagnostics.countsUrl,
      status: countsResp.status,
    });
    if (countsResp.status !== 200) {
      await logFrontendEvent('WARNING', 'Live ProtonDB counts returned non-200', {
        appId,
        reason,
        countsUrl: diagnostics.countsUrl,
        status: countsResp.status,
      });
      return await fallbackToLiveSummary(appId, diagnostics, `${reason}-counts-miss`);
    }

    const counts = await countsResp.json() as ProtonCountsResponse;
    const hash = computeLiveReportHash(Number(appId), counts.reports, counts.timestamp, 'all');
    const liveDetailedUrl = LIVE_REPORTS_URL
      .replace('{device}', LIVE_REPORT_DEVICE)
      .replace('{hash}', String(hash));
    diagnostics.liveDetailedUrl = liveDetailedUrl;
    await logFrontendEvent('INFO', 'Fetching live ProtonDB detailed report page', {
      appId,
      reason,
      liveDetailedUrl,
      hash,
      reportCountSeed: counts.reports,
      timestampSeed: counts.timestamp,
    });

    const liveResp = await fetchNoCors(liveDetailedUrl);
    diagnostics.liveDetailedStatus = liveResp.status;
    await logFrontendEvent('DEBUG', 'Live ProtonDB detailed report response received', {
      appId,
      reason,
      liveDetailedUrl,
      status: liveResp.status,
    });
    if (liveResp.status !== 200) {
      await logFrontendEvent('WARNING', 'Live ProtonDB detailed report returned non-200', {
        appId,
        reason,
        liveDetailedUrl,
        status: liveResp.status,
      });
      return await fallbackToLiveSummary(appId, diagnostics, `${reason}-live-detailed-miss`);
    }

    const livePage = await liveResp.json() as LiveDetailedReportPage;
    const reports = normalizeLiveDetailedReports(appId, livePage.reports ?? []);
    diagnostics.liveDetailedCount = reports.length;
    if (!reports.length) {
      await logFrontendEvent('WARNING', 'Live ProtonDB detailed report page returned no usable rows', {
        appId,
        reason,
        liveDetailedUrl,
      });
      return await fallbackToLiveSummary(appId, diagnostics, `${reason}-live-detailed-empty`);
    }

    diagnostics.source = 'live-detailed';
    await logFrontendEvent('INFO', 'Live ProtonDB detailed fallback succeeded', {
      appId,
      reason,
      liveDetailedUrl,
      reports: reports.length,
    });
    return { reports, diagnostics };
  } catch (error) {
    await logFrontendEvent('ERROR', 'Live ProtonDB detailed fallback failed', {
      appId,
      reason,
      countsUrl: diagnostics.countsUrl,
      liveDetailedUrl: diagnostics.liveDetailedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return await fallbackToLiveSummary(appId, diagnostics, `${reason}-live-detailed-error`);
  }
}

export async function getVotes(appId: string): Promise<Record<string, number>> {
  const result = await getVotesWithDiagnostics(appId);
  return result.votes;
}

export async function getVotesWithDiagnostics(appId: string): Promise<{
  votes: Record<string, number>;
  diagnostics: VotesFetchDiagnostics;
}> {
  const url = VOTES_URL.replace('{id}', appId);
  const diagnostics: VotesFetchDiagnostics = { url, status: null };
  try {
    await logFrontendEvent('DEBUG', 'Fetching votes', { appId, url });
    const resp = await fetchNoCors(url);
    diagnostics.status = resp.status;
    await logFrontendEvent('DEBUG', 'Votes response received', { appId, url, status: resp.status });
    if (resp.status !== 200) {
      await logFrontendEvent('WARNING', 'Votes request returned non-200', { appId, url, status: resp.status });
      return { votes: {}, diagnostics };
    }
    const votes = await resp.json() as Record<string, number>;
    await logFrontendEvent('DEBUG', 'Fetched votes', { appId, url, count: Object.keys(votes).length });
    return { votes, diagnostics };
  } catch (error) {
    await logFrontendEvent('ERROR', 'Failed to fetch votes', {
      appId,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return { votes: {}, diagnostics };
  }
}

export async function postUpvote(
  appId: string,
  reportKey: string,
  token: string,
): Promise<boolean> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    await logFrontendEvent('WARNING', 'Upvote aborted because token was empty after trimming', { appId, reportKey });
    return false;
  }

  const headers = {
    'Authorization': `Bearer ${trimmedToken}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  try {
    await logFrontendEvent('INFO', 'Submitting repository dispatch upvote request', { appId, reportKey });
    const repositoryDispatchResp = await fetchNoCors(REPOSITORY_DISPATCH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event_type: 'upvote',
        client_payload: { appId, reportKey },
      }),
    });
    await logFrontendEvent('DEBUG', 'Repository dispatch upvote response received', {
      appId,
      reportKey,
      status: repositoryDispatchResp.status,
    });

    if (repositoryDispatchResp.status === 204) return true;

    // Some installations expose only workflow_dispatch for the upvote workflow.
    await logFrontendEvent('INFO', 'Falling back to workflow dispatch for upvote request', { appId, reportKey });
    const workflowDispatchResp = await fetchNoCors(WORKFLOW_DISPATCH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: WORKFLOW_REF,
        inputs: { appId, reportKey },
      }),
    });
    await logFrontendEvent('DEBUG', 'Workflow dispatch upvote response received', {
      appId,
      reportKey,
      status: workflowDispatchResp.status,
    });
    return workflowDispatchResp.status === 204;
  } catch (error) {
    await logFrontendEvent('ERROR', 'Upvote request threw an exception', {
      appId,
      reportKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
