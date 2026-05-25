import type { UserConfigRow } from './userConfigs';
import type { CdnReport } from '../types';

export type PulseConfidence = 'none' | 'low' | 'medium' | 'high';

export interface PulseTierResult {
  tier: string;
  count: number;
  confidence: PulseConfidence;
  // Numeric per-game confidence (0-100). Same shape used by scoring.ts
  // aggregatePerGame() so the badge UI can render a percentage chip without
  // doing its own math
  confidencePct: number;
}

// Map sample count to a baseline confidence percentage, then nudge based on
// the qualitative 'none'/'low'/'medium'/'high' bucket so existing tests
// (which assert on the bucket) still hold
function confidencePercentFromCount(count: number): number {
  if (count <= 0) return 0;
  // Log-scale baseline: 1 -> 30, 5 -> 60, 20 -> 85, 50+ -> ~95
  return Math.min(95, Math.round(30 + Math.log2(count) * 18));
}

const RATING_SCORE: Record<string, number> = {
  platinum: 1.0,
  gold:     0.8,
  silver:   0.6,
  bronze:   0.4,
  borked:   0.0,
};

export function computePulseTier(rows: UserConfigRow[]): PulseTierResult {
  if (rows.length === 0) return { tier: 'pending', count: 0, confidence: 'none', confidencePct: 0 };

  const now = Date.now() / 1000;
  let wSum = 0;
  let wTotal = 0;

  for (const row of rows) {
    const ts = row.created_at ? new Date(row.created_at).getTime() / 1000 : 0;
    const days = ts > 0 ? (now - ts) / 86400 : 365;
    const recency =
      days < 30  ? 1.00 :
      days < 90  ? 0.85 :
      days < 180 ? 0.65 :
      days < 365 ? 0.40 : 0.15;
    const score = RATING_SCORE[row.rating] ?? 0.5;
    wSum   += score * recency;
    wTotal += recency;
  }

  const avg = wTotal > 0 ? wSum / wTotal : 0;
  const tier =
    avg >= 0.85 ? 'platinum' :
    avg >= 0.65 ? 'gold'     :
    avg >= 0.40 ? 'silver'   :
    avg >= 0.15 ? 'bronze'   : 'borked';

  const count = rows.length;
  const confidence: PulseConfidence =
    count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low';
  const confidencePct = confidencePercentFromCount(count);

  return { tier, count, confidence, confidencePct };
}

export function computeCombinedTier(
  cdnReports: Pick<CdnReport, 'rating' | 'timestamp'>[],
  pulseReports: UserConfigRow[],
): PulseTierResult {
  const now = Date.now() / 1000;

  const entries: { rating: string; ts: number }[] = [
    ...cdnReports.map(r => ({ rating: r.rating, ts: r.timestamp })),
    ...pulseReports.map(r => ({ rating: r.rating, ts: r.created_at ? new Date(r.created_at).getTime() / 1000 : 0 })),
  ];

  if (entries.length === 0) return { tier: 'pending', count: 0, confidence: 'none', confidencePct: 0 };

  let wSum = 0;
  let wTotal = 0;

  for (const { rating, ts } of entries) {
    const days = ts > 0 ? (now - ts) / 86400 : 365;
    const recency =
      days < 30  ? 1.00 :
      days < 90  ? 0.85 :
      days < 180 ? 0.65 :
      days < 365 ? 0.40 : 0.15;
    const score = RATING_SCORE[rating] ?? 0.5;
    wSum   += score * recency;
    wTotal += recency;
  }

  const avg = wTotal > 0 ? wSum / wTotal : 0;
  const tier =
    avg >= 0.85 ? 'platinum' :
    avg >= 0.65 ? 'gold'     :
    avg >= 0.40 ? 'silver'   :
    avg >= 0.15 ? 'bronze'   : 'borked';

  const count = entries.length;
  const confidence: PulseConfidence =
    count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low';
  const confidencePct = confidencePercentFromCount(count);

  return { tier, count, confidence, confidencePct };
}
