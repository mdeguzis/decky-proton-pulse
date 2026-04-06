// src/lib/protondb.ts
//
// Fetches ProtonDB reports and summary data from the CDN (proton-pulse-data
// GitHub Pages site) with a fallback to the live ProtonDB API when the CDN
// doesn't have data for a game yet. Also handles upvote submission via
// GitHub repository/workflow dispatch.
import { fetchNoCors } from "@decky/api";
import type { ProtonDBSummary, CdnReport, ProtonRating } from "../types";
import { logFrontendEvent } from "./logger";
import { cachedFetchJson } from "./cdnCache";

const SUMMARY_URL =
  "https://www.protondb.com/api/v1/reports/summaries/{id}.json";
const APP_INDEX_URL =
  "https://mdeguzis.github.io/proton-pulse-data/data/{id}/index.json";
const YEAR_URL =
  "https://mdeguzis.github.io/proton-pulse-data/data/{id}/{year}.json";
const VOTES_URL =
  "https://mdeguzis.github.io/proton-pulse-data/data/{id}/votes.json";
const REPOSITORY_DISPATCH_URL =
  "https://api.github.com/repos/mdeguzis/proton-pulse-data/dispatches";
const WORKFLOW_DISPATCH_URL =
  "https://api.github.com/repos/mdeguzis/proton-pulse-data/actions/workflows/upvote.yml/dispatches";
const WORKFLOW_REF = "main";

export interface ReportFetchDiagnostics {
  source: "cdn" | "live-summary" | "none";
  indexUrl: string;
  indexStatus: number | null;
  years: string[];
  yearStatuses: Record<string, number | null>;
  liveSummaryUrl: string;
  liveSummaryStatus: number | null;
  liveSummaryTotal: number | null;
  liveSummaryTier: ProtonRating | null;
}

export interface VotesFetchDiagnostics {
  url: string;
  status: number | null;
}
export async function getProtonDBSummary(
  appId: string,
): Promise<ProtonDBSummary | null> {
  const url = SUMMARY_URL.replace("{id}", appId);
  try {
    await logFrontendEvent("DEBUG", "Fetching ProtonDB summary", {
      appId,
      url,
    });
    const resp = await fetchNoCors(url);
    await logFrontendEvent("DEBUG", "ProtonDB summary response received", {
      appId,
      url,
      status: resp.status,
    });
    if (resp.status !== 200) {
      await logFrontendEvent(
        "WARNING",
        "ProtonDB summary request returned non-200",
        { appId, url, status: resp.status },
      );
      return null;
    }
    const summary = (await resp.json()) as ProtonDBSummary;
    await logFrontendEvent("DEBUG", "Fetched ProtonDB summary", {
      appId,
      url,
      total: summary.total,
      tier: summary.tier,
    });
    return summary;
  } catch (error) {
    await logFrontendEvent("ERROR", "Failed to fetch ProtonDB summary", {
      appId,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
const VALID_RATINGS = new Set<string>([
  "platinum",
  "gold",
  "silver",
  "bronze",
  "borked",
  "pending",
]);

function normalizeReports(
  raw: Array<CdnReport & { rating: string }>,
): CdnReport[] {
  return raw.map((r) => {
    const normalized = r.rating.toLowerCase();
    const rating = VALID_RATINGS.has(normalized)
      ? (normalized as ProtonRating)
      : "pending";
    return { ...r, rating };
  });
}

export async function getProtonDBReports(appId: string): Promise<CdnReport[]> {
  const result = await getProtonDBReportsWithDiagnostics(appId);
  return result.reports;
}

export async function getProtonDBReportsWithDiagnostics(
  appId: string,
): Promise<{
  reports: CdnReport[];
  diagnostics: ReportFetchDiagnostics;
}> {
  const indexUrl = APP_INDEX_URL.replace("{id}", appId);
  const diagnostics: ReportFetchDiagnostics = {
    source: "none",
    indexUrl,
    indexStatus: null,
    years: [],
    yearStatuses: {},
    liveSummaryUrl: SUMMARY_URL.replace("{id}", appId),
    liveSummaryStatus: null,
    liveSummaryTotal: null,
    liveSummaryTier: null,
  };
  try {
    await logFrontendEvent("INFO", "Fetching Proton Pulse report index", {
      appId,
      indexUrl,
    });
    // Fetch index to discover available year files (cache-aware)
    const indexResult = await cachedFetchJson<string[]>(indexUrl, appId, "index.json");
    diagnostics.indexStatus = indexResult.data !== null ? 200 : null;
    await logFrontendEvent(
      "DEBUG",
      "Proton Pulse report index response received",
      {
        appId,
        indexUrl,
        fromCache: indexResult.fromCache,
      },
    );
    if (indexResult.data === null) {
      await logFrontendEvent(
        "WARNING",
        "Proton Pulse report index not available",
        {
          appId,
          indexUrl,
        },
      );
      return await fallbackToLiveSummary(appId, diagnostics, "cdn-index-miss");
    }
    const years = indexResult.data;
    diagnostics.years = years;
    await logFrontendEvent("INFO", "Proton Pulse report index loaded", {
      appId,
      years,
    });
    if (!years.length) {
      await logFrontendEvent("WARNING", "Proton Pulse report index was empty", {
        appId,
        indexUrl,
      });
      return await fallbackToLiveSummary(appId, diagnostics, "cdn-index-empty");
    }

    // Fetch all year files in parallel (cache-aware)
    const yearResults = await Promise.all(
      years.map(async (year) => {
        const yearUrl = YEAR_URL.replace("{id}", appId).replace("{year}", year);
        try {
          await logFrontendEvent("DEBUG", "Fetching report year file", {
            appId,
            year,
            yearUrl,
          });
          const result = await cachedFetchJson<Array<CdnReport & { rating: string }>>(
            yearUrl,
            appId,
            `${year}.json`,
          );
          diagnostics.yearStatuses[year] = result.data !== null ? 200 : null;
          await logFrontendEvent(
            "DEBUG",
            "Report year file response received",
            {
              appId,
              year,
              yearUrl,
              fromCache: result.fromCache,
            },
          );
          if (result.data === null) {
            await logFrontendEvent(
              "WARNING",
              "Report year file not available",
              {
                appId,
                year,
                yearUrl,
              },
            );
            return [];
          }
          const reports = normalizeReports(result.data);
          await logFrontendEvent("DEBUG", "Loaded report year file", {
            appId,
            year,
            yearUrl,
            count: reports.length,
          });
          return reports;
        } catch (error) {
          diagnostics.yearStatuses[year] = null;
          await logFrontendEvent("ERROR", "Failed to fetch report year file", {
            appId,
            year,
            yearUrl,
            error: error instanceof Error ? error.message : String(error),
          });
          return [];
        }
      }),
    );

    const reports = yearResults.flat();
    if (!reports.length) {
      await logFrontendEvent(
        "WARNING",
        "CDN returned no report rows after year fetches",
        {
          appId,
          years: years.length,
        },
      );
      return await fallbackToLiveSummary(appId, diagnostics, "cdn-years-empty");
    }
    diagnostics.source = "cdn";
    await logFrontendEvent("INFO", "Finished Proton Pulse report fetch", {
      appId,
      source: diagnostics.source,
      years: years.length,
      reports: reports.length,
    });
    return { reports, diagnostics };
  } catch (error) {
    await logFrontendEvent(
      "ERROR",
      "Failed to fetch Proton Pulse report index",
      {
        appId,
        indexUrl,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return await fallbackToLiveSummary(appId, diagnostics, "cdn-index-error");
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
    await logFrontendEvent("INFO", "Falling back to live ProtonDB summary", {
      appId,
      reason,
      url,
    });
    const resp = await fetchNoCors(url);
    diagnostics.liveSummaryStatus = resp.status;
    await logFrontendEvent("DEBUG", "Live ProtonDB summary response received", {
      appId,
      reason,
      url,
      status: resp.status,
    });
    if (resp.status !== 200) {
      await logFrontendEvent(
        "WARNING",
        "Live ProtonDB summary returned non-200",
        {
          appId,
          reason,
          url,
          status: resp.status,
        },
      );
      return { reports: [], diagnostics };
    }

    const summary = (await resp.json()) as ProtonDBSummary;
    diagnostics.source = "live-summary";
    diagnostics.liveSummaryTotal = summary.total;
    diagnostics.liveSummaryTier = summary.tier;
    await logFrontendEvent("INFO", "Live ProtonDB summary fallback succeeded", {
      appId,
      reason,
      url,
      total: summary.total,
      tier: summary.tier,
    });
    return { reports: [], diagnostics };
  } catch (error) {
    await logFrontendEvent("ERROR", "Live ProtonDB summary fallback failed", {
      appId,
      reason,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return { reports: [], diagnostics };
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
  const url = VOTES_URL.replace("{id}", appId);
  const diagnostics: VotesFetchDiagnostics = { url, status: null };
  try {
    await logFrontendEvent("DEBUG", "Fetching votes", { appId, url });
    const result = await cachedFetchJson<Record<string, number>>(url, appId, "votes.json");
    diagnostics.status = result.data !== null ? 200 : null;
    await logFrontendEvent("DEBUG", "Votes response received", {
      appId,
      url,
      fromCache: result.fromCache,
    });
    if (result.data === null) {
      await logFrontendEvent("WARNING", "Votes not available", {
        appId,
        url,
      });
      return { votes: {}, diagnostics };
    }
    await logFrontendEvent("DEBUG", "Fetched votes", {
      appId,
      url,
      count: Object.keys(result.data).length,
    });
    return { votes: result.data, diagnostics };
  } catch (error) {
    await logFrontendEvent("ERROR", "Failed to fetch votes", {
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
    await logFrontendEvent(
      "WARNING",
      "Upvote aborted because token was empty after trimming",
      { appId, reportKey },
    );
    return false;
  }

  const headers = {
    Authorization: `Bearer ${trimmedToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  try {
    await logFrontendEvent(
      "INFO",
      "Submitting repository dispatch upvote request",
      { appId, reportKey },
    );
    const repositoryDispatchResp = await fetchNoCors(REPOSITORY_DISPATCH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event_type: "upvote",
        client_payload: { appId, reportKey },
      }),
    });
    await logFrontendEvent(
      "DEBUG",
      "Repository dispatch upvote response received",
      {
        appId,
        reportKey,
        status: repositoryDispatchResp.status,
      },
    );

    if (repositoryDispatchResp.status === 204) return true;

    // Some installations expose only workflow_dispatch for the upvote workflow.
    await logFrontendEvent(
      "INFO",
      "Falling back to workflow dispatch for upvote request",
      { appId, reportKey },
    );
    const workflowDispatchResp = await fetchNoCors(WORKFLOW_DISPATCH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref: WORKFLOW_REF,
        inputs: { appId, reportKey },
      }),
    });
    await logFrontendEvent(
      "DEBUG",
      "Workflow dispatch upvote response received",
      {
        appId,
        reportKey,
        status: workflowDispatchResp.status,
      },
    );
    return workflowDispatchResp.status === 204;
  } catch (error) {
    await logFrontendEvent("ERROR", "Upvote request threw an exception", {
      appId,
      reportKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
