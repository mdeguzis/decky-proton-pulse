// src/lib/protondb.ts
//
// Fetches ProtonDB reports and summary data from the CDN (proton-pulse-data
// GitHub Pages site) with a fallback to live ProtonDB detailed data or summary
// data when the CDN doesn't have data for a game yet.
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
import { getUserConfigs } from "./userConfigs";

// TODO: replace GitHub Pages with a proper CDN (CloudFlare R2, Fastly, etc)
// for better reliability, caching headers, and reduced latency
const SUMMARY_URL =
  "https://www.protondb.com/api/v1/reports/summaries/{id}.json";
const APP_INDEX_URL =
  "https://www.proton-pulse.com/data/{id}/index.json";
const YEAR_URL =
  "https://www.proton-pulse.com/data/{id}/{year}.json";
const LIVE_COUNTS_URL = "https://www.protondb.com/data/counts.json";
const LIVE_REPORTS_URL =
  "https://www.protondb.com/data/reports/{device}/app/{hash}.json";
const LIVE_REPORT_DEVICE = "all-devices";
const LIVE_REPORT_HASH_DEVICE = "any";
const LIVE_REPORT_FAULT_KEYS = [
  "audioFaults",
  "graphicalFaults",
  "inputFaults",
  "performanceFaults",
  "saveGameFaults",
  "significantBugs",
  "stabilityFaults",
  "windowingFaults",
] as const;

export interface ReportFetchDiagnostics {
  source: "cdn" | "live-detailed" | "live-summary" | "pulse-live" | "none";
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

function normalizeWhitespace(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function inferDuration(playtimeMinutes: unknown): string {
  if (typeof playtimeMinutes !== "number" || playtimeMinutes <= 0) {
    return "unreported";
  }
  if (playtimeMinutes < 60) {
    return "underOneHour";
  }
  if (playtimeMinutes < 240) {
    return "oneToFourHours";
  }
  if (playtimeMinutes < 900) {
    return "severalHours";
  }
  return "allTheTime";
}

function computeJsHash(seed: string): number {
  let hashValue = 0;
  for (const ch of `${seed}m`) {
    hashValue = ((hashValue << 5) - hashValue + ch.charCodeAt(0)) | 0;
  }
  return Math.abs(hashValue);
}

function buildJsHashFragment(
  multiplier: number | string,
  prefix: number | string,
  modulus: number,
): string {
  const remainder = Number(prefix) % modulus;
  const multiplierValue = Number(multiplier);
  const productRepr = Number.isFinite(multiplierValue * remainder)
    ? String(multiplierValue * remainder)
    : "NaN";
  return `${prefix}p${productRepr}`;
}

function computeLiveReportHash(
  appId: number,
  reportCount: number,
  timestamp: number,
  deviceKey: string,
): number {
  const left = buildJsHashFragment(appId, reportCount, timestamp);
  const right = buildJsHashFragment(deviceKey, appId, timestamp);
  return computeJsHash(`p${left}*vRT${right}undefined`);
}

function computeLiveReportHashLegacy(
  appId: number,
  reportCount: number,
  timestamp: number,
  page: string | number,
): number {
  const left = `${reportCount}p${appId * (reportCount % timestamp)}`;
  const pageValue = Number(page);
  const rightMultiplier = Number.isFinite(pageValue * (appId % timestamp))
    ? String(pageValue * (appId % timestamp))
    : "nan";
  const right = `${appId}p${rightMultiplier}`;
  return computeJsHash(`p${left}*vRT${right}${String(null)}`);
}

function buildLiveReportCandidateUrls(
  appId: string,
  reportCount: number,
  timestamp: number,
): string[] {
  const currentHash = computeLiveReportHash(
    Number(appId),
    reportCount,
    timestamp,
    LIVE_REPORT_HASH_DEVICE,
  );
  const legacyHash = computeLiveReportHashLegacy(
    Number(appId),
    reportCount,
    timestamp,
    "all",
  );
  return [currentHash, legacyHash].map((hash) =>
    LIVE_REPORTS_URL.replace("{device}", LIVE_REPORT_DEVICE).replace(
      "{hash}",
      String(hash),
    ),
  );
}

function inferLiveRating(
  responses: Record<string, unknown> | null,
): ProtonRating {
  const verdict = normalizeWhitespace(responses?.verdict).toLowerCase();
  if (!verdict) {
    return "pending";
  }
  if (verdict === "no") {
    return "borked";
  }
  if (verdict !== "yes") {
    return "pending";
  }

  const faultCount = LIVE_REPORT_FAULT_KEYS.reduce((count, key) => (
    responses?.[key] === "yes" ? count + 1 : count
  ), 0);
  if (faultCount >= 3) {
    return "bronze";
  }
  if (faultCount === 2) {
    return "silver";
  }
  if (faultCount === 1) {
    return "gold";
  }
  if (responses?.triedOob === "yes" || responses?.verdictOob === "yes") {
    return "platinum";
  }
  return "gold";
}

function normalizeLiveDetailedReports(
  appId: string,
  rawReports: unknown[],
  title = "",
): CdnReport[] {
  const normalized: CdnReport[] = [];
  for (const entry of rawReports) {
    const report = asRecord(entry);
    if (!report) {
      continue;
    }
    const responses = asRecord(report.responses);
    const device = asRecord(report.device);
    const inferred = asRecord(device?.inferred);
    const steam = asRecord(inferred?.steam);
    const contributor = asRecord(report.contributor);
    const contributorSteam = asRecord(contributor?.steam);
    const notesSource = responses?.notes;
    const notesRecord = asRecord(notesSource);
    const notes = normalizeWhitespace(
      notesRecord?.concludingNotes
      ?? notesRecord?.verdict
      ?? (typeof notesSource === "string" ? notesSource : ""),
    );
    const playtime =
      typeof contributorSteam?.playtimeLinux === "number"
        ? contributorSteam.playtimeLinux
        : contributorSteam?.playtime;
    const timestamp = report.timestamp;
    if (typeof timestamp !== "number" || timestamp <= 0) {
      continue;
    }

    normalized.push({
      appId,
      cpu: normalizeWhitespace(steam?.cpu),
      duration: inferDuration(playtime),
      gpu: normalizeWhitespace(steam?.gpu),
      gpuDriver: normalizeWhitespace(steam?.gpuDriver),
      kernel: normalizeWhitespace(steam?.kernel),
      notes,
      os: normalizeWhitespace(steam?.os),
      protonVersion: normalizeWhitespace(responses?.protonVersion) || "Unknown",
      ram: normalizeWhitespace(steam?.ram),
      rating: inferLiveRating(responses),
      timestamp,
      title,
    });
  }
  return normalized;
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

async function fetchLivePulseReports(appId: string, reason: string): Promise<CdnReport[]> {
  try {
    const rows = await getUserConfigs(appId);
    if (!rows.length) return [];
    await logFrontendEvent("INFO", `Live Pulse report fetch found ${rows.length} report(s) (${reason})`, { appId, count: rows.length });
    return rows.map((r) => ({
      appId,
      title:         r.title ?? '',
      cpu:           r.cpu ?? '',
      gpu:           r.gpu ?? '',
      gpuDriver:     r.gpu_driver ?? '',
      kernel:        r.kernel ?? '',
      notes:         r.notes ?? '',
      os:            r.os ?? '',
      protonVersion: r.proton_version ?? '',
      ram:           r.ram ?? '',
      duration:      r.duration ?? 'unreported',
      rating:        r.rating as ProtonRating,
      timestamp:     r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      reportId:      r.id ?? null,
    } satisfies CdnReport));
  } catch (err) {
    await logFrontendEvent("WARNING", "Live Pulse report fetch failed", { appId, reason, error: String(err) });
    return [];
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
  // Check our own Supabase first — reports submitted via the plugin are here
  // immediately, before the nightly CDN pipeline picks them up
  const pulseReports = await fetchLivePulseReports(appId, reason);

  const detailedReports = await fetchLiveDetailedReports(appId, diagnostics, reason);
  const combined = [...pulseReports, ...(detailedReports ?? [])];
  if (combined.length > 0) {
    if (pulseReports.length) diagnostics.source = 'pulse-live';
    return { reports: combined, diagnostics };
  }

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

async function fetchLiveDetailedReports(
  appId: string,
  diagnostics: ReportFetchDiagnostics,
  reason: string,
): Promise<CdnReport[] | null> {
  try {
    await logFrontendEvent("INFO", "NET >> live detailed counts request started", {
      appId,
      reason,
      url: LIVE_COUNTS_URL,
    });
    const countsResp = await fetchNoCors(LIVE_COUNTS_URL);
    await logFrontendEvent("INFO", `NET << live detailed counts response ${countsResp.status}`, {
      appId,
      reason,
      url: LIVE_COUNTS_URL,
      status: countsResp.status,
    });
    if (countsResp.status !== 200) {
      return null;
    }

    const countsBody = asRecord(await countsResp.json());
    const reportCount = countsBody?.reports;
    const timestamp = countsBody?.timestamp;
    if (
      typeof reportCount !== "number"
      || typeof timestamp !== "number"
      || reportCount <= 0
      || timestamp <= 0
    ) {
      await logFrontendEvent("WARNING", "Live detailed counts payload was unusable", {
        appId,
        reason,
        reportCount,
        timestamp,
      });
      return null;
    }

    const candidateUrls = buildLiveReportCandidateUrls(appId, reportCount, timestamp);
    for (const candidateUrl of candidateUrls) {
      await logFrontendEvent("INFO", "NET >> live detailed report request started", {
        appId,
        reason,
        url: candidateUrl,
      });
      const response = await fetchNoCors(candidateUrl);
      await logFrontendEvent("INFO", `NET << live detailed report response ${response.status}`, {
        appId,
        reason,
        url: candidateUrl,
        status: response.status,
      });
      if (response.status !== 200) {
        continue;
      }

      const payload = asRecord(await response.json());
      const rawReports = Array.isArray(payload?.reports) ? payload.reports : null;
      if (!rawReports) {
        continue;
      }

      const reports = normalizeLiveDetailedReports(
        appId,
        rawReports,
        normalizeWhitespace(payload?.title),
      );
      if (!reports.length) {
        continue;
      }

      diagnostics.source = "live-detailed";
      setCache(appId, reports, null, {}, "live-detailed");
      await logFrontendEvent("INFO", "Live ProtonDB detailed fallback succeeded", {
        appId,
        reason,
        url: candidateUrl,
        reports: reports.length,
      });
      return reports;
    }
  } catch (error) {
    await logFrontendEvent("ERROR", "Live ProtonDB detailed fallback failed", {
      appId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}
