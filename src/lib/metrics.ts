// src/lib/metrics.ts
//
// Lightweight perf metrics collector. Tracks timing spans (fetch durations,
// cache lookups), counters (cache hits/misses), and provides summary stats
// for debugging bottlenecks. Data lives in a ring buffer so memory stays
// bounded. The frontend can dump metrics to the Python backend for file
// export via the export_metrics callable.

import { callable } from '@decky/api';
import { logFrontendEvent } from './logger';

// how many individual timing entries we keep before evicting oldest
const MAX_ENTRIES = 2000;

// flush metrics to backend every N seconds (0 = manual only)
const AUTO_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 min

export type MetricCategory =
  | 'cache-read'
  | 'cache-write'
  | 'fetch-cdn-index'
  | 'fetch-cdn-year'
  | 'fetch-cdn-votes'
  | 'fetch-live-summary'
  | 'fetch-steam-title'
  | 'prefetch-game'
  | 'prefetch-batch';

export interface TimingEntry {
  category: MetricCategory;
  label: string;         // e.g. appId or url slug
  startedAt: number;     // Date.now() when span started
  durationMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface CounterSnapshot {
  cacheHits: number;
  cacheMisses: number;
  cacheEvictions: number;
  fetchErrors: number;
  localNonSteamGames: number;
  prefetchedGames: number;
  totalFetches: number;
}

export interface CategoryStats {
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  errorCount: number;
}

export interface PrefetchFailureSummary {
  total: number;
  byReason: Record<string, number>;
}

export interface MetricsSummary {
  counters: CounterSnapshot;
  // per-category aggregates
  categories: Record<string, CategoryStats>;
  uptimeMs: number;
  collectedAt: string; // ISO timestamp
  entryCount: number;
}

// ── ring buffer + counters ──────────────────────────────────────────────────

const entries: TimingEntry[] = [];
let writeIdx = 0;
let totalRecorded = 0;
const startedAt = Date.now();

const counters: CounterSnapshot = {
  cacheHits: 0,
  cacheMisses: 0,
  cacheEvictions: 0,
  fetchErrors: 0,
  localNonSteamGames: 0,
  prefetchedGames: 0,
  totalFetches: 0,
};

// ── timing API ──────────────────────────────────────────────────────────────

export function startSpan(category: MetricCategory, label: string): () => void {
  const t0 = Date.now();
  let finished = false;

  return () => {
    if (finished) return;
    finished = true;
    const durationMs = Date.now() - t0;
    recordTiming({ category, label, startedAt: t0, durationMs, success: true });
  };
}

// for when you want to record success/failure and attach metadata
export function startDetailedSpan(category: MetricCategory, label: string) {
  const t0 = Date.now();
  let finished = false;

  return {
    end(success: boolean, metadata?: Record<string, unknown>) {
      if (finished) return;
      finished = true;
      const durationMs = Date.now() - t0;
      recordTiming({ category, label, startedAt: t0, durationMs, success, metadata });
      if (!success) counters.fetchErrors++;
    },
  };
}

function recordTiming(entry: TimingEntry) {
  if (entries.length < MAX_ENTRIES) {
    entries.push(entry);
  } else {
    entries[writeIdx] = entry;
  }
  writeIdx = (writeIdx + 1) % MAX_ENTRIES;
  totalRecorded++;
}

// ── counters API ────────────────────────────────────────────────────────────

export function countCacheHit() { counters.cacheHits++; }
export function countCacheMiss() { counters.cacheMisses++; }
export function countCacheEviction() { counters.cacheEvictions++; }
export function countFetchError() { counters.fetchErrors++; }
export function countLocalNonSteamGame(count = 1) { counters.localNonSteamGames += count; }
export function countPrefetchedGame() { counters.prefetchedGames++; }
export function countFetch() { counters.totalFetches++; }

export function getCounters(): CounterSnapshot {
  return { ...counters };
}

// ── summary / aggregation ───────────────────────────────────────────────────

function percentile(sorted: number[], pct: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil(sorted.length * pct / 100) - 1;
  return sorted[Math.max(0, idx)];
}

export function getSummary(): MetricsSummary {
  const byCategory: Record<string, TimingEntry[]> = {};
  for (const entry of entries) {
    if (!entry) continue;
    const cat = entry.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(entry);
  }

  const categories: MetricsSummary['categories'] = {};
  for (const [cat, catEntries] of Object.entries(byCategory)) {
    const durations = catEntries.map(e => e.durationMs).sort((a, b) => a - b);
    const total = durations.reduce((s, d) => s + d, 0);
    const errorCount = catEntries.filter(e => !e.success).length;
    categories[cat] = {
      count: catEntries.length,
      totalMs: total,
      avgMs: Math.round(total / catEntries.length),
      minMs: durations[0] ?? 0,
      maxMs: durations[durations.length - 1] ?? 0,
      p95Ms: percentile(durations, 95),
      errorCount,
    };
  }

  return {
    counters: { ...counters },
    categories,
    uptimeMs: Date.now() - startedAt,
    collectedAt: new Date().toISOString(),
    entryCount: entries.filter(Boolean).length,
  };
}

export function getCombinedCategoryStats(categoriesToCombine: MetricCategory[]): CategoryStats | null {
  const matchingEntries = entries.filter((entry) => entry && categoriesToCombine.includes(entry.category));
  if (!matchingEntries.length) return null;

  const durations = matchingEntries.map((entry) => entry.durationMs).sort((a, b) => a - b);
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  const errorCount = matchingEntries.filter((entry) => !entry.success).length;

  return {
    count: matchingEntries.length,
    totalMs: total,
    avgMs: Math.round(total / matchingEntries.length),
    minMs: durations[0] ?? 0,
    maxMs: durations[durations.length - 1] ?? 0,
    p95Ms: percentile(durations, 95),
    errorCount,
  };
}

export function getPrefetchFailureSummary(): PrefetchFailureSummary {
  const byReason: Record<string, number> = {};

  for (const entry of entries) {
    if (!entry || entry.category !== 'prefetch-game' || entry.success) continue;
    const reason = typeof entry.metadata?.reason === 'string'
      ? entry.metadata.reason
      : typeof entry.metadata?.status === 'number'
        ? `status-${entry.metadata.status}`
        : 'unknown';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }

  return {
    total: Object.values(byReason).reduce((sum, count) => sum + count, 0),
    byReason,
  };
}

// human-readable text block for the Logs tab
export function getSummaryText(): string {
  const s = getSummary();
  const lines: string[] = [];
  const upMin = Math.floor(s.uptimeMs / 60000);

  lines.push(`=== Proton Pulse Metrics (uptime ${upMin}m) ===`);
  lines.push('');
  lines.push('Counters:');
  lines.push(`  Cache hits:       ${s.counters.cacheHits}`);
  lines.push(`  Cache misses:     ${s.counters.cacheMisses}`);
  lines.push(`  Cache evictions:  ${s.counters.cacheEvictions}`);
  lines.push(`  Fetch errors:     ${s.counters.fetchErrors}`);
  lines.push(`  Non-Steam local:  ${s.counters.localNonSteamGames}`);
  lines.push(`  Prefetched games: ${s.counters.prefetchedGames}`);
  lines.push(`  Total fetches:    ${s.counters.totalFetches}`);

  const hitRate = s.counters.cacheHits + s.counters.cacheMisses > 0
    ? ((s.counters.cacheHits / (s.counters.cacheHits + s.counters.cacheMisses)) * 100).toFixed(1)
    : 'n/a';
  lines.push(`  Cache hit rate:   ${hitRate}%`);
  lines.push('');
  lines.push('Timing by category:');
  for (const [cat, stats] of Object.entries(s.categories)) {
    lines.push(`  ${cat}: ${stats.count} calls, avg ${stats.avgMs}ms, p95 ${stats.p95Ms}ms, max ${stats.maxMs}ms${stats.errorCount ? ` (${stats.errorCount} errors)` : ''}`);
  }

  return lines.join('\n');
}

// ── raw entries for JSON export ─────────────────────────────────────────────

export function getRawEntries(): TimingEntry[] {
  return entries.filter(Boolean);
}

// ── export to backend ───────────────────────────────────────────────────────

const exportMetricsCallable = callable<[data: string], boolean>('export_metrics');

export async function flushMetricsToDisk(): Promise<boolean> {
  try {
    const payload = JSON.stringify({
      summary: getSummary(),
      entries: getRawEntries(),
    });
    const ok = await exportMetricsCallable(payload);
    await logFrontendEvent('DEBUG', 'Metrics flushed to disk', {
      entryCount: entries.filter(Boolean).length,
      success: ok,
    });
    return ok;
  } catch (err) {
    await logFrontendEvent('ERROR', 'Failed to flush metrics to disk', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ── auto-flush timer ────────────────────────────────────────────────────────

let flushTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushMetricsToDisk();
  }, AUTO_FLUSH_INTERVAL_MS);
}

export function stopAutoFlush() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

// ── reset (for testing) ────────────────────────────────────────────────────

export function resetMetrics() {
  entries.length = 0;
  writeIdx = 0;
  totalRecorded = 0;
  counters.cacheHits = 0;
  counters.cacheMisses = 0;
  counters.cacheEvictions = 0;
  counters.fetchErrors = 0;
  counters.localNonSteamGames = 0;
  counters.prefetchedGames = 0;
  counters.totalFetches = 0;
}
