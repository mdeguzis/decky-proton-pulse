import type { UserConfigRow } from './userConfigs';

export type PulseConfidence = 'none' | 'low' | 'medium' | 'high';

export interface PulseTierResult {
  tier: string;
  count: number;
  confidence: PulseConfidence;
}

const RATING_SCORE: Record<string, number> = {
  platinum: 1.0,
  gold:     0.8,
  silver:   0.6,
  bronze:   0.4,
  borked:   0.0,
};

export function computePulseTier(rows: UserConfigRow[]): PulseTierResult {
  if (rows.length === 0) return { tier: 'pending', count: 0, confidence: 'none' };

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

  return { tier, count, confidence };
}
