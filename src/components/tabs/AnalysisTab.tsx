// Aggregate per-game stats. Reads the same reports + configs ConfigureTab
// loads, runs them through the shared scoring engine (synced from
// proton-pulse-data/lib/scoring/), and renders a condensed breakdown so
// the user can see at a glance: how confident the data is, whether the
// game is trending up or down, which Proton version is winning, and which
// launch flags the community is using.
//
// Heavy charts stay on the webui (proton-pulse.com/game-stats.html). This
// tab is the "should I bother trying this game RIGHT NOW" surface

import { useEffect, useState } from 'react';
import { Focusable, SteamSpinner } from '@decky/ui';
import { getProtonDBReportsWithDiagnostics } from '../../lib/protondb';
import { getUserConfigs, type UserConfigRow } from '../../lib/userConfigs';
import { computeGameStats, type GameStats, type Tier } from '../../lib/gameStats';
import { RATING_COLORS } from '../../lib/reportFormatters';
import { logFrontendEvent } from '../../lib/logger';
import { t } from '../../lib/i18n';
import type { CdnReport } from '../../types';

interface Props {
  appId: number | null;
  appName: string;
}

const TIER_LABELS: Record<Tier, string> = {
  platinum: 'PLAT',
  gold: 'GOLD',
  silver: 'SILV',
  bronze: 'BRNZ',
  borked: 'BORK',
};

const TREND_ARROW: Record<string, string> = {
  improving: '↑',
  declining: '↓',
  stable: '→',
  insufficient: '·',
};

const TREND_COLOR: Record<string, string> = {
  improving: '#4caf50',
  declining: '#e57373',
  stable: '#90a4ae',
  insufficient: '#556a7a',
};

const SECTION_HDR: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#7a9bb5',
  padding: '14px 16px 4px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const ROW: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  width: '100%',
  minHeight: 36,
  padding: '6px 16px',
  fontSize: 12,
  color: '#e8f4ff',
  gap: 8,
};

// Coloured bar that fills `pct`% of a flexible track. Used for confidence
// factor breakdown and per-Proton-version success rates
function MiniBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{
      width: 120,
      height: 6,
      borderRadius: 3,
      background: 'rgba(255,255,255,0.08)',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{ width: `${clamped}%`, height: '100%', background: color }} />
    </div>
  );
}

function confidenceColor(pct: number): string {
  if (pct >= 75) return '#4caf50';
  if (pct >= 45) return '#e0a030';
  return '#e57373';
}

export function AnalysisTab({ appId }: Props) {
  const [reports, setReports] = useState<CdnReport[]>([]);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appId) { setLoading(false); return; }
    setLoading(true);
    setStats(null);
    const t0 = Date.now();
    void Promise.all([
      getProtonDBReportsWithDiagnostics(String(appId)).then((r) => r.reports).catch(() => [] as CdnReport[]),
      getUserConfigs(String(appId)).catch(() => [] as UserConfigRow[]),
    ]).then(([r, c]) => {
      setReports(r);
      const s = computeGameStats(r, c);
      setStats(s);
      void logFrontendEvent('INFO', 'Analysis tab: loaded', {
        appId,
        reportCount: r.length,
        configCount: c.length,
        confidencePct: s.confidencePct,
        trendDir: s.trendDir,
        durationMs: Date.now() - t0,
      });
    }).finally(() => setLoading(false));
  }, [appId]);

  if (loading) {
    return (
      <Focusable style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
        <SteamSpinner />
      </Focusable>
    );
  }

  if (!stats || reports.length === 0) {
    return (
      <Focusable style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 16px', color: '#9db0c4', fontSize: 12, textAlign: 'center' }}>
          {t().extras!.analysisNoReports!()}
        </div>
      </Focusable>
    );
  }

  const { confidencePct, confFactors, trendDir, trendDiff, recentCount, priorCount, versionStats, ratingCounts, totalReports } = stats;
  const confColor = confidenceColor(confidencePct);
  const tierOrder: Tier[] = ['platinum', 'gold', 'silver', 'bronze', 'borked'];

  return (
    <Focusable style={{ display: 'flex', flexDirection: 'column' }}>

      {/* --- Confidence --- */}
      <div style={SECTION_HDR}>{t().extras!.analysisConfidence!()}</div>
      <div style={{ ...ROW, padding: '4px 16px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            background: confColor,
            color: confColor === '#e0a030' ? '#1a1410' : '#fff',
            fontWeight: 700,
            fontSize: 13,
            padding: '3px 10px',
            borderRadius: 999,
            letterSpacing: '0.03em',
          }}>{confidencePct}%</span>
          <span style={{ fontSize: 11, color: '#9db0c4' }}>
            {t().extras!.analysisAcrossReports!(totalReports)}
          </span>
        </div>
      </div>
      {confFactors.map((f) => (
        <div key={f.label} style={ROW}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ color: '#c8dcea', fontWeight: 600 }}>{f.label}</span>
            <span style={{ fontSize: 10, color: '#6a7d8e' }}>{f.detail}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MiniBar pct={f.value} color={confColor} />
            <span style={{ fontSize: 11, color: '#9db0c4', minWidth: 32, textAlign: 'right' }}>{f.value}%</span>
          </div>
        </div>
      ))}

      {/* --- Trend --- */}
      <div style={SECTION_HDR}>{t().extras!.analysisTrend!()}</div>
      <div style={ROW}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: TREND_COLOR[trendDir] ?? '#90a4ae', fontSize: 22, fontWeight: 700, width: 24, textAlign: 'center' }}>
            {TREND_ARROW[trendDir] ?? '·'}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#c8dcea', fontWeight: 600 }}>
              {trendDir === 'improving' ? t().extras!.analysisTrend_improving!()
                : trendDir === 'declining' ? t().extras!.analysisTrend_declining!()
                : trendDir === 'stable' ? t().extras!.analysisTrend_stable!()
                : t().extras!.analysisTrend_insufficient!()}
            </span>
            <span style={{ fontSize: 10, color: '#6a7d8e' }}>
              {t().extras!.analysisTrendDetail!(recentCount, priorCount)}
            </span>
          </div>
        </div>
        {trendDir !== 'insufficient' && (
          <span style={{ fontSize: 11, color: '#9db0c4' }}>
            {trendDiff >= 0 ? '+' : ''}{trendDiff.toFixed(2)}
          </span>
        )}
      </div>

      {/* --- Rating distribution --- */}
      <div style={SECTION_HDR}>{t().extras!.analysisRatingMix!()}</div>
      {tierOrder.map((tier) => {
        const cnt = ratingCounts[tier] ?? 0;
        if (cnt === 0) return null;
        const pct = totalReports > 0 ? Math.round((cnt / totalReports) * 100) : 0;
        return (
          <div key={tier} style={ROW}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: RATING_COLORS[tier] ?? '#888',
                color: tier === 'gold' || tier === 'silver' ? '#1a1410' : '#fff',
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 3,
                letterSpacing: '0.04em',
                minWidth: 44,
                textAlign: 'center',
              }}>{TIER_LABELS[tier]}</span>
              <span style={{ fontSize: 11, color: '#9db0c4' }}>{cnt}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MiniBar pct={pct} color={RATING_COLORS[tier] ?? '#888'} />
              <span style={{ fontSize: 11, color: '#9db0c4', minWidth: 32, textAlign: 'right' }}>{pct}%</span>
            </div>
          </div>
        );
      })}

      {/* --- Top Proton versions --- */}
      <div style={SECTION_HDR}>{t().extras!.analysisTopProtonVersions!()}</div>
      {versionStats.length === 0 ? (
        <div style={{ padding: '8px 16px', color: '#9db0c4', fontSize: 11 }}>
          {t().extras!.analysisNoVersionData!()}
        </div>
      ) : versionStats.slice(0, 5).map((v) => (
        <div key={v.ver} style={ROW}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ color: '#c8dcea', fontWeight: 600 }}>{v.ver}</span>
            <span style={{ fontSize: 10, color: '#6a7d8e' }}>
              {t().extras!.analysisVersionTotal!(v.total)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MiniBar pct={v.pct} color={v.pct >= 70 ? '#4caf50' : v.pct >= 45 ? '#e0a030' : '#e57373'} />
            <span style={{ fontSize: 11, color: '#9db0c4', minWidth: 32, textAlign: 'right' }}>{v.pct}%</span>
          </div>
        </div>
      ))}

      <div style={{ padding: '12px 16px 16px', fontSize: 10, color: '#4a6070', textAlign: 'left' }}>
        {t().extras!.analysisDeepDiveHint!()}
      </div>
    </Focusable>
  );
}
