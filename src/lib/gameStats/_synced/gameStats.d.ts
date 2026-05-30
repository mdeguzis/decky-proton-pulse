// Ambient declaration for the synced CommonJS module so TypeScript stops
// warning about the .js import. The real types live in ../index.ts which
// re-exports through typed wrappers -- this just keeps the raw import side
// of things type-safe.
//
// This .d.ts is OUTSIDE the .js file sync pattern (sync-scoring.mjs only
// deletes .js extensions) so it survives `make sync-scoring`. Don't put
// real type changes here; update ../index.ts instead

declare const computeGameStats: (allReports: any[], configs: any[]) => any;
declare const computeMonthlyReports: (allReports: any[]) => any;
declare const computeWorkingStatus: (allReports: any[], nowSec: number) => any;
declare const computeFreshness: (allReports: any[], nowSec: number) => number;
declare const computeSettingsTips: (allReports: any[], configs: any[]) => any;
declare const isPositive: (rating: string) => boolean;
declare const isNegative: (rating: string) => boolean;

export {
  computeGameStats,
  computeMonthlyReports,
  computeWorkingStatus,
  computeFreshness,
  computeSettingsTips,
  isPositive,
  isNegative,
};
