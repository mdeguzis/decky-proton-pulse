// Public entry point for per-game aggregate stats inside the plugin.
//
// Wraps the synced JS module from proton-pulse-data with TypeScript types
// so callers get autocomplete + compile-time checks against the plugin's
// own CdnReport / ScoredReport / UserConfigRow types.
//
// IMPORTANT: do not edit anything under _synced/ directly. That directory
// is overwritten by `make sync-scoring`. All scoring math edits go in the
// canonical source: proton-pulse-data/lib/scoring/. The CI staleness check
// (scripts/check-scoring-sync.mjs) fails the build if _synced/ drifts.

// Rollup's @rollup/plugin-commonjs (already wired via @decky/rollup) lets
// us import the CommonJS module.exports as a default-style object
import * as syncedRaw from './_synced/gameStats.js';
import type { CdnReport, ScoredReport } from '../../types';
import type { UserConfigRow } from '../userConfigs';

// rollup-plugin-commonjs hoists module.exports into the default export when
// the original module isnt an ES module. Some plugin chains expose it on
// .default, others on the namespace itself -- normalise both shapes here
// so the shim doesnt break on a future rollup version bump
const synced: SyncedScoring = ((syncedRaw as any).default ?? syncedRaw) as SyncedScoring;

// ---------- Synced module shape ----------
// These mirror the runtime shape of proton-pulse-data/lib/scoring/gameStats.js.
// Loose `any` for the report/config params is intentional -- the synced JS
// reads a small set of fields (rating, timestamp, protonVersion,
// launchOptions) and doesn't care whether you pass it a CdnReport from the
// plugin or a webui-shaped report. The plugin's typed wrappers below
// constrain the call sites where we DO know the shape

export type Tier = 'platinum' | 'gold' | 'silver' | 'bronze' | 'borked';
export type WorkingStatus = 'working' | 'partial' | 'broken' | 'unknown';
export type TrendDirection = 'improving' | 'declining' | 'stable' | 'insufficient';

export interface VersionStat { ver: string; total: number; pct: number }
export interface LaunchFlag { flag: string; cnt: number; pct: number }
export interface ConfFactor { label: string; value: number; detail: string }
export interface MonthlyBucket { month: string; positive: number; negative: number; total: number }

export interface GameStats {
  confidencePct: number;
  confFactors: ConfFactor[];
  trendDir: TrendDirection;
  trendDiff: number;
  recentCount: number;
  priorCount: number;
  versionStats: VersionStat[];
  launchFlags: LaunchFlag[];
  ratingCounts: Record<Tier, number>;
  totalReports: number;
}

export interface WorkingStatusResult {
  status: WorkingStatus;
  recentlyBroken: boolean;
  lastPositiveAge: number | null;
  stale: boolean;
}

export interface SettingsTip { text: string; evidenceCount: number }

interface SyncedScoring {
  computeGameStats: (allReports: any[], configs: any[]) => GameStats;
  computeMonthlyReports: (allReports: any[]) => MonthlyBucket[];
  computeWorkingStatus: (allReports: any[], nowSec: number) => WorkingStatusResult;
  computeFreshness: (allReports: any[], nowSec: number) => number;
  computeSettingsTips: (allReports: any[], configs: any[]) => SettingsTip[];
  isPositive: (rating: string) => boolean;
  isNegative: (rating: string) => boolean;
}

// ---------- Typed wrappers ----------
// Plugin call sites pass CdnReport / ScoredReport / UserConfigRow. The synced
// JS only needs the fields these types already carry, so this is just a
// type-narrowed surface, no runtime conversion

export function computeGameStats(
  allReports: Array<CdnReport | ScoredReport>,
  configs: UserConfigRow[],
): GameStats {
  return synced.computeGameStats(allReports, configs);
}

export function computeMonthlyReports(
  allReports: Array<CdnReport | ScoredReport>,
): MonthlyBucket[] {
  return synced.computeMonthlyReports(allReports);
}

export function computeWorkingStatus(
  allReports: Array<CdnReport | ScoredReport>,
  nowSec: number = Math.floor(Date.now() / 1000),
): WorkingStatusResult {
  return synced.computeWorkingStatus(allReports, nowSec);
}

export function computeFreshness(
  allReports: Array<CdnReport | ScoredReport>,
  nowSec: number = Math.floor(Date.now() / 1000),
): number {
  return synced.computeFreshness(allReports, nowSec);
}

export function computeSettingsTips(
  allReports: Array<CdnReport | ScoredReport>,
  configs: UserConfigRow[],
): SettingsTip[] {
  return synced.computeSettingsTips(allReports, configs);
}

export function isPositive(rating: string): boolean { return synced.isPositive(rating); }
export function isNegative(rating: string): boolean { return synced.isNegative(rating); }
