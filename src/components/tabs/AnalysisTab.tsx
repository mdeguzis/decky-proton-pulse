// Aggregate per-game stats. Reads the same reports + configs ConfigureTab
// loads, runs them through the shared scoring engine (synced from
// proton-pulse-data/lib/scoring/), and renders a condensed breakdown so
// the user can see at a glance: how confident the data is, whether the
// game is trending up or down, which Proton version is winning, and which
// launch flags the community is using.
//
// Heavy charts stay on the webui (proton-pulse.com/game-stats.html). This
// tab is the "should I bother trying this game RIGHT NOW" surface.
//
// Scroll/focus model mirrors SystemRequirementsTab: every visible section
// header and row is a focusable DialogButton with onFocus/onBlur state, so
// D-pad up/down moves through the content and Steam scrolls the focused
// item into view. See docs/Decky-UI-Learnings (wiki) for the rationale --
// without focusable rows the scrollbar appears but the user has no way to
// drive it from the gamepad

import { useEffect, useState } from 'react';
import { Focusable, DialogButton, SteamSpinner, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { getProtonDBReportsWithDiagnostics } from '../../lib/protondb';
import { getUserConfigs, type UserConfigRow } from '../../lib/userConfigs';
import { computeGameStats, type GameStats, type Tier } from '../../lib/gameStats';
import { RATING_COLORS } from '../../lib/reportFormatters';
import { logFrontendEvent } from '../../lib/logger';
import { t } from '../../lib/i18n';
import { useFocusableScroll } from '../../lib/useFocusableScroll';
import type { CdnReport } from '../../types';

// Cast lets us pass onFocus/onBlur without TS complaining -- DialogButton's
// public type doesnt expose these but the underlying element accepts them
const PpDialogButton = DialogButton as React.ComponentType<
  React.ComponentProps<typeof DialogButton> & {
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur?: () => void;
  }
>;

interface Props {
  appId: number | null;
  appName: string;
}

const TIER_LABELS: Record<Tier, string> = {
  platinum: 'PLATINUM',
  gold: 'GOLD',
  silver: 'SILVER',
  bronze: 'BRONZE',
  borked: 'BORKED',
};

// Light tier backgrounds (platinum, gold, silver) need dark text or
// nothing reads. Bronze + borked are saturated enough that white reads
const TIER_TEXT: Record<Tier, string> = {
  platinum: '#1a1410',
  gold:     '#1a1410',
  silver:   '#1a1410',
  bronze:   '#fff',
  borked:   '#fff',
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

// Shared row layout: title/label on the left, bar/value on the right. The
// borderRight is the focus indicator (driven by focusedRow state)
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
  background: 'transparent',
  textAlign: 'left',
};

function MiniBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{
      width: 120, height: 6, borderRadius: 3,
      background: 'rgba(255,255,255,0.08)', overflow: 'hidden', flexShrink: 0,
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
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll();

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

  // Prevent left-arrow from leaking back to the sidebar mid-scroll. Same
  // pattern as SystemRequirementsTab
  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) evt.preventDefault();
  };

  if (loading) {
    return (
      <Focusable style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
        <DialogButton
          onClick={() => {}}
          style={{
            position: 'absolute', width: 1, height: 1,
            padding: 0, border: 'none', background: 'transparent',
            clip: 'rect(0 0 0 0)', overflow: 'hidden',
          }}
        >{t().common.loading}</DialogButton>
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
    <Focusable onGamepadDirection={handleRootDirection} style={{ display: 'flex', flexDirection: 'column' }}>

      <div style={{ padding: '6px 16px 2px', fontSize: 10, color: '#4a6070', textAlign: 'left' }}>
        {t().detail.sysReqFocusHint}
      </div>

      {/* --- Confidence header + factor rows --- */}
      <PpDialogButton onClick={() => {}}
        onFocus={onRowFocus('hdr-conf')}
        onBlur={onRowBlur}
        style={{ ...SECTION_HDR, background: 'transparent', border: 'none', boxShadow: 'none', textAlign: 'left', borderRight: focusBorder('hdr-conf'), paddingLeft: 13 }}
      >{t().extras!.analysisConfidence!()}</PpDialogButton>

      <PpDialogButton onClick={() => {}}
        onFocus={onRowFocus('conf-summary')}
        onBlur={onRowBlur}
        style={{ ...ROW, borderRight: focusBorder('conf-summary'), padding: '4px 16px 10px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            background: confColor,
            color: confColor === '#e0a030' ? '#1a1410' : '#fff',
            fontWeight: 700, fontSize: 13, padding: '3px 10px',
            borderRadius: 999, letterSpacing: '0.03em',
          }}>{confidencePct}%</span>
          <span style={{ fontSize: 11, color: '#9db0c4' }}>
            {t().extras!.analysisAcrossReports!(totalReports)}
          </span>
        </div>
      </PpDialogButton>

      {confFactors.map((f) => (
        <PpDialogButton key={f.label} onClick={() => {}}
          onFocus={onRowFocus(`conf-${f.label}`)}
          onBlur={onRowBlur}
          style={{ ...ROW, borderRight: focusBorder(`conf-${f.label}`) }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ color: '#c8dcea', fontWeight: 600 }}>{f.label}</span>
            <span style={{ fontSize: 10, color: '#6a7d8e' }}>{f.detail}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MiniBar pct={f.value} color={confColor} />
            <span style={{ fontSize: 11, color: '#9db0c4', minWidth: 32, textAlign: 'right' }}>{f.value}%</span>
          </div>
        </PpDialogButton>
      ))}

      {/* --- Trend --- */}
      <PpDialogButton onClick={() => {}}
        onFocus={onRowFocus('hdr-trend')}
        onBlur={onRowBlur}
        style={{ ...SECTION_HDR, background: 'transparent', border: 'none', boxShadow: 'none', textAlign: 'left', borderRight: focusBorder('hdr-trend'), paddingLeft: 13 }}
      >{t().extras!.analysisTrend!()}</PpDialogButton>

      <PpDialogButton onClick={() => {}}
        onFocus={onRowFocus('trend-row')}
        onBlur={onRowBlur}
        style={{ ...ROW, borderRight: focusBorder('trend-row') }}
      >
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
      </PpDialogButton>

      {/* --- Rating distribution --- */}
      <PpDialogButton onClick={() => {}}
        onFocus={onRowFocus('hdr-mix')}
        onBlur={onRowBlur}
        style={{ ...SECTION_HDR, background: 'transparent', border: 'none', boxShadow: 'none', textAlign: 'left', borderRight: focusBorder('hdr-mix'), paddingLeft: 13 }}
      >{t().extras!.analysisRatingMix!()}</PpDialogButton>

      {tierOrder.map((tier) => {
        const cnt = ratingCounts[tier] ?? 0;
        if (cnt === 0) return null;
        const pct = totalReports > 0 ? Math.round((cnt / totalReports) * 100) : 0;
        return (
          <PpDialogButton key={tier} onClick={() => {}}
            onFocus={onRowFocus(`mix-${tier}`)}
            onBlur={onRowBlur}
            style={{ ...ROW, borderRight: focusBorder(`mix-${tier}`) }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: RATING_COLORS[tier] ?? '#888',
                color: TIER_TEXT[tier] ?? '#fff',
                fontSize: 10, fontWeight: 700, padding: '2px 10px',
                borderRadius: 3, letterSpacing: '0.04em',
                minWidth: 70, textAlign: 'center',
              }}>{TIER_LABELS[tier]}</span>
              <span style={{ fontSize: 11, color: '#9db0c4' }}>{cnt}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MiniBar pct={pct} color={RATING_COLORS[tier] ?? '#888'} />
              <span style={{ fontSize: 11, color: '#9db0c4', minWidth: 32, textAlign: 'right' }}>{pct}%</span>
            </div>
          </PpDialogButton>
        );
      })}

      {/* --- Top Proton versions --- */}
      <PpDialogButton onClick={() => {}}
        onFocus={onRowFocus('hdr-ver')}
        onBlur={onRowBlur}
        style={{ ...SECTION_HDR, background: 'transparent', border: 'none', boxShadow: 'none', textAlign: 'left', borderRight: focusBorder('hdr-ver'), paddingLeft: 13 }}
      >{t().extras!.analysisTopProtonVersions!()}</PpDialogButton>

      {versionStats.length === 0 ? (
        <div style={{ padding: '8px 16px', color: '#9db0c4', fontSize: 11 }}>
          {t().extras!.analysisNoVersionData!()}
        </div>
      ) : versionStats.slice(0, 5).map((v) => (
        <PpDialogButton key={v.ver} onClick={() => {}}
          onFocus={onRowFocus(`ver-${v.ver}`)}
          onBlur={onRowBlur}
          style={{ ...ROW, borderRight: focusBorder(`ver-${v.ver}`) }}
        >
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
        </PpDialogButton>
      ))}

      <div style={{ padding: '12px 16px 16px', fontSize: 10, color: '#4a6070', textAlign: 'left' }}>
        {t().extras!.analysisDeepDiveHint!()}
      </div>

      {/* Bottom spacer: the Steam BPM footer (STEAM MENU / SELECT BACK) is
          ~64px tall and overlays our content. Without this buffer the last
          row sits behind the footer and scrollIntoView({block:'center'}) on
          it puts it at viewport-center which is still under the footer.
          80px clears the footer with a little breathing room */}
      <div style={{ height: 80, flexShrink: 0 }} aria-hidden="true" />
    </Focusable>
  );
}
