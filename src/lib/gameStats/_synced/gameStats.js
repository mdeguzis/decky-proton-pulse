// Per-game stats engine. Canonical source for compatibility stats math
// shared between the webui and the decky-proton-pulse plugin.
//
// Used by:
//   - game-stats.html (classic script tag, creates window globals)
//   - tests/gameStats.test.js (CommonJS require, via module.exports shim)
//   - decky-proton-pulse plugin (synced into src/lib/scoring/_synced/
//     by `make sync-scoring`, then wrapped in TypeScript shims)
//
// Inspired by protondb-decky's AnalysisModal (working_status, recently_broken,
// last_positive_age, stale, monthly chart) but our own implementation that
// fits the Pulse data model.
//
// Pure functions, no DOM, no fetch. All consumers pass in
//   allReports: array with .rating, .protonVersion, .timestamp, optional .launchOptions
//   configs:    array with optional .launchOptions / .launch_options

// --- constants ---

const RATING_VAL = { platinum: 5, gold: 4, silver: 3, bronze: 2, borked: 1 };
const POSITIVE_TIERS = ['platinum', 'gold', 'silver'];
const NEGATIVE_TIERS = ['bronze', 'borked'];

// Stale threshold: a game with no recent reports is "stale". We pick 365d
// because Proton itself ships major releases roughly yearly, so anything
// older than a year is suspect for current Proton.
const STALE_DAYS = 365;
const RECENT_DAYS = 90;
const PRIOR_WINDOW_DAYS = 270;  // 90-270d is the prior bucket for trend

// --- helpers ---

function isPositive(rating) {
  return POSITIVE_TIERS.includes(rating);
}

function isNegative(rating) {
  return NEGATIVE_TIERS.includes(rating);
}

function ageDays(ts, now) {
  if (!ts) return null;
  return Math.floor((now - ts) / 86400);
}

// --- per-month report counts for the chart (positive vs negative) ---

function computeMonthlyReports(allReports) {
  // bucket YYYY-MM -> { positive, negative }
  const buckets = {};
  for (const r of allReports) {
    if (!r.timestamp) continue;
    const d = new Date(r.timestamp * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets[key]) buckets[key] = { positive: 0, negative: 0 };
    if (isPositive(r.rating)) buckets[key].positive++;
    else if (isNegative(r.rating)) buckets[key].negative++;
  }
  return Object.entries(buckets)
    .map(([month, counts]) => ({ month, ...counts }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// --- working status (binary: is it working RIGHT NOW based on recent data) ---
// Heuristic: look at last RECENT_DAYS of reports. If >=60% positive => working,
// if >=60% negative => not_working, else unknown.
function computeWorkingStatus(allReports, now) {
  const recent = allReports.filter(r => r.timestamp && now - r.timestamp < RECENT_DAYS * 86400);
  if (recent.length === 0) {
    return {
      status: 'unknown',
      confidence: 'low',
      recently_broken: false,
      timeframe_days: RECENT_DAYS,
      last_positive_report_age: null,
    };
  }

  const pos = recent.filter(r => isPositive(r.rating)).length;
  const neg = recent.filter(r => isNegative(r.rating)).length;
  const posRatio = pos / recent.length;
  const negRatio = neg / recent.length;

  let status, confidence;
  if (posRatio >= 0.6) { status = 'working'; }
  else if (negRatio >= 0.6) { status = 'not_working'; }
  else { status = 'mixed'; }

  // Confidence based on sample size in the recent window
  if (recent.length >= 10) confidence = 'high';
  else if (recent.length >= 4) confidence = 'medium';
  else confidence = 'low';

  // "Recently broken" = trend flipped negative in the last 30d after being
  // mostly positive in the broader RECENT_DAYS window
  const veryRecent = allReports.filter(r => r.timestamp && now - r.timestamp < 30 * 86400);
  const recently_broken = veryRecent.length >= 2
    && veryRecent.filter(r => isNegative(r.rating)).length / veryRecent.length >= 0.6
    && posRatio >= 0.5;  // older window was OK, recent flipped

  // last positive report age (across ALL reports, not just recent window)
  const lastPos = allReports
    .filter(r => isPositive(r.rating) && r.timestamp)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  return {
    status,
    confidence,
    recently_broken,
    timeframe_days: RECENT_DAYS,
    last_positive_report_age: lastPos ? ageDays(lastPos.timestamp, now) : null,
  };
}

// --- freshness (how recent is the latest data) ---
function computeFreshness(allReports, now) {
  const withTs = allReports.filter(r => r.timestamp).sort((a, b) => b.timestamp - a.timestamp);
  if (withTs.length === 0) {
    return { label: 'No data', latest_report_age: null, is_stale: true };
  }
  const latestAge = ageDays(withTs[0].timestamp, now);
  let label;
  if (latestAge < 30) label = 'Very fresh';
  else if (latestAge < 90) label = 'Fresh';
  else if (latestAge < 180) label = 'Aging';
  else if (latestAge < STALE_DAYS) label = 'Old';
  else label = 'Stale';
  return { label, latest_report_age: latestAge, is_stale: latestAge >= STALE_DAYS };
}

// --- settings tips: common launch options from positive reports only ---
// Different from "launch flags frequency" because we only count tokens from
// reports that are platinum/gold/silver. Surfaces the tweaks that actually work
function computeSettingsTips(allReports, configs) {
  const positiveSources = [
    ...allReports.filter(r => isPositive(r.rating)),
    ...configs,
  ];
  const flagMap = {};
  let totalWithLaunch = 0;
  for (const item of positiveSources) {
    const lo = item.launchOptions || item.launch_options || '';
    if (!lo) continue;
    totalWithLaunch++;
    const tokens = lo.split(/\s+/).filter(t => t.startsWith('%') || t.startsWith('-') || /^[A-Z_]+=/.test(t));
    for (const tok of tokens) {
      flagMap[tok] = (flagMap[tok] || 0) + 1;
    }
  }
  return Object.entries(flagMap)
    .map(([flag, cnt]) => ({
      flag,
      cnt,
      pct: totalWithLaunch > 0 ? Math.round((cnt / totalWithLaunch) * 100) : 0,
    }))
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 15);  // top 15
}

// --- main entry point ---
//
// Combines the original per-game stats (confidence, trend, version stats,
// rating distribution) with protondb-decky-inspired metrics (working status,
// freshness, monthly chart, settings tips).
function computeGameStats(allReports, configs) {
  const now = Date.now() / 1000;
  const n = allReports.length;

  // --- Rating distribution ---
  const ratingCounts = { platinum: 0, gold: 0, silver: 0, bronze: 0, borked: 0 };
  for (const r of allReports) {
    if (ratingCounts[r.rating] != null) ratingCounts[r.rating]++;
  }

  // --- Confidence: sample size + tier consistency + freshness ---
  const sampleFactor = n > 0 ? Math.min(1.0, Math.log2(Math.max(1, n)) / Math.log2(50)) : 0;
  let consistencyFactor = 0;
  if (n > 0) {
    const vals = allReports.map(r => RATING_VAL[r.rating] || 3);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    const stdDev = Math.sqrt(variance);
    consistencyFactor = Math.max(0, 1 - stdDev / 2);
  }
  let freshnessSum = 0, freshnessTotal = 0;
  for (const r of allReports) {
    const days = (now - (r.timestamp || 0)) / 86400;
    const w = days < 90 ? 1.0 : days < 365 ? 0.6 : 0.2;
    freshnessSum += w;
    freshnessTotal++;
  }
  const freshnessFactor = freshnessTotal > 0 ? freshnessSum / freshnessTotal : 0;
  const rawConf = n > 0 ? (sampleFactor * 0.45 + consistencyFactor * 0.35 + freshnessFactor * 0.20) : 0;
  const confidencePct = Math.min(95, Math.round(rawConf * 100));
  const confFactors = [
    { label: 'Sample size', value: Math.round(sampleFactor * 100), detail: `${n} report${n !== 1 ? 's' : ''} (log curve, 45% weight)` },
    { label: 'Tier consistency', value: Math.round(consistencyFactor * 100), detail: 'How tightly clustered ratings are (35% weight)' },
    { label: 'Data freshness', value: Math.round(freshnessFactor * 100), detail: 'Recency-weighted freshness (20% weight)' },
  ];

  // --- Trend ---
  const recentReps = allReports.filter(r => r.timestamp && now - r.timestamp < RECENT_DAYS * 86400);
  const priorReps = allReports.filter(r => r.timestamp && now - r.timestamp >= RECENT_DAYS * 86400 && now - r.timestamp < PRIOR_WINDOW_DAYS * 86400);
  let trendDir = 'stable', trendDiff = 0;
  let recentPositiveRatio = null, olderPositiveRatio = null;
  if (recentReps.length >= 2 && priorReps.length >= 2) {
    const avg = arr => arr.reduce((s, r) => s + (RATING_VAL[r.rating] || 3), 0) / arr.length;
    trendDiff = avg(recentReps) - avg(priorReps);
    if (trendDiff > 0.3) trendDir = 'improving';
    else if (trendDiff < -0.3) trendDir = 'declining';
    recentPositiveRatio = recentReps.filter(r => isPositive(r.rating)).length / recentReps.length;
    olderPositiveRatio = priorReps.filter(r => isPositive(r.rating)).length / priorReps.length;
  } else if (recentReps.length < 2 && priorReps.length < 2) {
    trendDir = 'insufficient';
  }

  // --- Per-Proton-version success % ---
  const versionMap = {};
  for (const r of allReports) {
    const ver = r.protonVersion || r.proton_version || 'Unknown';
    if (!versionMap[ver]) versionMap[ver] = { total: 0, positive: 0 };
    versionMap[ver].total++;
    if (isPositive(r.rating)) versionMap[ver].positive++;
  }
  const versionStats = Object.entries(versionMap)
    .map(([ver, s]) => ({ ver, total: s.total, pct: Math.round((s.positive / s.total) * 100) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // --- Launch option flag frequency (all sources) ---
  const flagMap = {};
  const allSources = [...configs, ...allReports];
  for (const item of allSources) {
    const lo = item.launchOptions || item.launch_options || '';
    if (!lo) continue;
    const tokens = lo.split(/\s+/).filter(t => t.startsWith('%') || t.startsWith('-') || /^[A-Z_]+=/.test(t));
    for (const tok of tokens) {
      flagMap[tok] = (flagMap[tok] || 0) + 1;
    }
  }
  const totalSources = allSources.filter(item => (item.launchOptions || item.launch_options)).length;
  const launchFlags = Object.entries(flagMap)
    .map(([flag, cnt]) => ({ flag, cnt, pct: totalSources > 0 ? Math.round((cnt / totalSources) * 100) : 0 }))
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 10);

  // --- new metrics ---
  const monthly = computeMonthlyReports(allReports);
  const workingStatus = computeWorkingStatus(allReports, now);
  const freshness = computeFreshness(allReports, now);
  const settingsTips = computeSettingsTips(allReports, configs);

  return {
    confidencePct,
    confFactors,
    trendDir,
    trendDiff,
    recentPositiveRatio,
    olderPositiveRatio,
    recentCount: recentReps.length,
    priorCount: priorReps.length,
    versionStats,
    launchFlags,
    ratingCounts,
    totalReports: n,
    monthly,
    workingStatus,
    freshness,
    settingsTips,
  };
}

// Tests need access; in the browser these are just window-level globals.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeGameStats,
    computeMonthlyReports,
    computeWorkingStatus,
    computeFreshness,
    computeSettingsTips,
    isPositive,
    isNegative,
  };
}
