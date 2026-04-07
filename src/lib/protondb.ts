// src/lib/protondb.ts
//
// Fetches ProtonDB reports and summary data from the CDN (proton-pulse-data
// GitHub Pages site) with a fallback to the live ProtonDB API when the CDN
// doesn't have data for a game yet.
//
// All data reads go through the local cache first. On cache miss, we fetch
// from the network and write the result back into cache. Every fetch is
// timed via the metrics library for perf profiling.
import { fetchNoCors } from "@decky/api";
import type { ProtonDBSummary, CdnReport, ProtonRating } from "../types";
import { logFrontendEvent } from "./logger";
import { getCached, setCache } from "./cache";
import { cachedFetchJson } from "./cdnCache";
import { startDetailedSpan, countFetch } from "./metrics";

// TODO: replace GitHub Pages with a proper CDN (CloudFlare R2, Fastly, etc)
// for better reliability, caching headers, and reduced latency
const SUMMARY_URL =
  "https://www.protondb.com/api/v1/reports/summaries/{id}.json";
const APP_INDEX_URL =
  "https://mdeguzis.github.io/proton-pulse-data/data/{id}/index.json";
const YEAR_URL =
  "https://mdeguzis.github.io/proton-pulse-data/data/{id}/{year}.json";

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

export async function getProtonDBSummary(
  appId: string,
): Promise<ProtonDBSummary | null> {
  // check cache for summary
  const cached = getCached(appId);
  if (cached?.summary) {
    await logFrontendEvent("DEBUG", "Serving summary from cache", { appId });
    return cached.summary;
  }

  const span = startDetailedSpan('fetch-live-summary', appId);
  countFetch();
  const url = SUMMARY_URL.replace("{id}", appId);
  try {
    const st0 = Date.now();
    await logFrontendEvent("INFO", "NET >> summary request started", { appId, url });
    const resp = await fetchNoCors(url);
    await logFrontendEvent("INFO", `NET << summary response ${resp.status} (${Date.now() - st0}ms)`, {
      appId,
      url,
      status: resp.status,
      durationMs: Date.now() - st0,
    });
    if (resp.status !== 200) {
      span.end(false, { status: resp.status });
      await logFrontendEvent(
        "WARNING",
        "ProtonDB summary request returned non-200",
        { appId, url, status: resp.status },
      );
      return null;
    }
    const summary = (await resp.json()) as ProtonDBSummary;
    span.end(true, { total: summary.total, tier: summary.tier });
    await logFrontendEvent("DEBUG", "Fetched ProtonDB summary", {
      appId,
      url,
      total: summary.total,
      tier: summary.tier,
    });
    return summary;
  } catch (error) {
    span.end(false, { error: error instanceof Error ? error.message : String(error) });
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
  // check local cache first
  const cached = getCached(appId);
  if (cached && cached.reports.length > 0) {
    await logFrontendEvent("INFO", "Serving reports from cache", {
      appId,
      reportCount: cached.reports.length,
      cacheAgeMs: Date.now() - cached.cachedAt,
      source: cached.source,
    });
    return {
      reports: cached.reports,
      diagnostics: {
        source: "cdn",
        indexUrl: APP_INDEX_URL.replace("{id}", appId),
        indexStatus: 200,
        years: [],
        yearStatuses: {},
        liveSummaryUrl: SUMMARY_URL.replace("{id}", appId),
        liveSummaryStatus: null,
        liveSummaryTotal: cached.summary?.total ?? null,
        liveSummaryTier: cached.summary?.tier ?? null,
      },
    };
  }

  const fetchSpan = startDetailedSpan('fetch-cdn-index', appId);
  countFetch();
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
    const t0 = Date.now();
    await logFrontendEvent("INFO", "NET >> CDN index request started", {
      appId,
      url: indexUrl,
    });
    // Fetch index to discover available year files (cache-aware)
    const indexResult = await cachedFetchJson<string[]>(indexUrl, appId, "index.json");
    diagnostics.indexStatus = indexResult.data !== null ? 200 : null;
    await logFrontendEvent(
      "INFO",
      `NET << CDN index response (${Date.now() - t0}ms)`,
      {
        appId,
        indexUrl,
        fromCache: indexResult.fromCache,
        durationMs: Date.now() - t0,
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
          const yt0 = Date.now();
          await logFrontendEvent("INFO", `NET >> CDN year ${year} request started`, {
            appId,
            year,
            url: yearUrl,
          });
          const result = await cachedFetchJson<Array<CdnReport & { rating: string }>>(
            yearUrl,
            appId,
            `${year}.json`,
          );
          diagnostics.yearStatuses[year] = result.data !== null ? 200 : null;
          await logFrontendEvent(
            "INFO",
            `NET << CDN year ${year} response (${Date.now() - yt0}ms)`,
            {
              appId,
              year,
              yearUrl,
              fromCache: result.fromCache,
              durationMs: Date.now() - yt0,
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
    // write through to cache for next time
    setCache(appId, reports, null, {}, 'cdn');
    fetchSpan.end(true, { years: years.length, reports: reports.length });
    await logFrontendEvent("INFO", "Finished Proton Pulse report fetch", {
      appId,
      source: diagnostics.source,
      years: years.length,
      reports: reports.length,
    });
    return { reports, diagnostics };
  } catch (error) {
    fetchSpan.end(false, {
      error: error instanceof Error ? error.message : String(error),
    });
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
    const ft0 = Date.now();
    await logFrontendEvent("INFO", `NET >> live summary fallback started (${reason})`, {
      appId,
      reason,
      url,
    });
    const resp = await fetchNoCors(url);
    diagnostics.liveSummaryStatus = resp.status;
    await logFrontendEvent("INFO", `NET << live summary response ${resp.status} (${Date.now() - ft0}ms)`, {
      appId,
      reason,
      url,
      status: resp.status,
      durationMs: Date.now() - ft0,
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

