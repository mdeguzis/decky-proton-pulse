// Per-report analysis modal. Opens with Y on a focused report card.
//
// Two views in one modal:
//   1. Aggregate impact: how does THIS report's presence change the
//      whole-game confidence pill at the top of the screen? Computed by
//      running computeGameStats twice (with + without this report) and
//      diffing the percent
//   2. Per-report confidence breakdown: WHY this report has the
//      confidence it does. Renders every factor from
//      computeConfidenceBreakdown(): rating baseline, recency, custom
//      Proton, version proximity, playtime, GPU/OS/kernel multipliers,
//      notes sentiment, source penalty, borked staleness. Same schema
//      and weights the per-game aggregation uses, so the breakdown
//      stays in lockstep with how reports are ranked elsewhere
//
// The breakdown column is the lower half of the modal; the aggregate
// impact + facts are above. Both are focusable rows so the entire modal
// scrolls cleanly with up/down via useFocusableScroll. Mirrors the
// schema on proton-pulse.com/confidence.html so users can cross-reference.

import { ModalRoot, Focusable, DialogButton, showModal } from '@decky/ui';
import scoringInfo from '../data/scoring-info.json';
import { ScoringGuideModal } from './ScoringGuideModal';
import { computeGameStats } from '../lib/gameStats';
import { computeConfidenceBreakdown } from '../lib/scoring';
import { useFocusableScroll } from '../lib/useFocusableScroll';
import { RATING_COLORS, formatProtonLabel } from '../lib/reportFormatters';
import { t } from '../lib/i18n';
import type { DisplayReportCard } from './ReportCard';
import type { UserConfigRow } from '../lib/userConfigs';
import type { SystemInfo, CdnReport } from '../types';

const PpDialogButton = DialogButton as React.ComponentType<
  React.ComponentProps<typeof DialogButton> & {
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur?: () => void;
  }
>;

const ROW: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr auto',
  alignItems: 'center',
  width: '100%',
  minHeight: 32,
  padding: '5px 18px',
  fontSize: 12,
  color: '#e8f4ff',
  gap: 10,
  background: 'transparent',
  textAlign: 'left',
};

const SECTION_HDR: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: '#7a9bb5',
  padding: '14px 18px 4px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

interface Props {
  report: DisplayReportCard;
  // Aggregate stats need the full list. We pass DisplayReportCard[]
  // directly because computeGameStats reads .rating/.timestamp/.protonVersion
  // which are present on both DisplayReportCard and CdnReport
  allReports: DisplayReportCard[];
  configs: UserConfigRow[];
  sysInfo: SystemInfo | null;
  closeModal?: () => void;
}

// Look up the i18n label for a breakdown factor by its key. The factor's
// label field is the suffix after `breakdown` (eg. label='breakdownGpu')
function factorLabel(label: string): string {
  // extras has mixed function signatures (some take args, some don't), so
  // cast through unknown to a permissive shape. The breakdown labels are
  // all no-arg getters so calling fn() with no args is safe
  const extras = t().extras as unknown as Record<string, undefined | ((...a: unknown[]) => string)>;
  const fn = extras[label];
  return typeof fn === 'function' ? fn() : label;
}

// Format an additive factor's value: signed integer for additives, "x N.NN"
// for multipliers, plain number for the final total
function formatFactorValue(kind: string, value: number): string {
  if (kind === 'multiplier') {
    // Show as multiplier (x1.30) so users understand the math compounds
    return `x${value.toFixed(2)}`;
  }
  if (kind === 'final') {
    return `${value}`;
  }
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `${value}`;
}

function valueColor(kind: string, value: number, active: boolean): string {
  if (!active) return '#556a7a';
  if (kind === 'final') return '#e8f4ff';
  if (kind === 'multiplier') {
    if (value > 1.05) return '#4caf50';
    if (value < 0.95) return '#e57373';
    return '#9bb5cc';
  }
  if (value > 0) return '#4caf50';
  if (value < 0) return '#e57373';
  return '#9bb5cc';
}

function PerReportAnalysisModal({ report, allReports, configs, sysInfo, closeModal }: Props) {
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll();

  // Aggregate impact: with vs without this report
  const withAll = computeGameStats(allReports, configs);
  const withoutThis = computeGameStats(
    allReports.filter((r) => r.displayKey !== report.displayKey),
    configs,
  );
  const contributionDelta = withAll.confidencePct - withoutThis.confidencePct;

  // Per-report confidence breakdown -- the SAME factors the per-game
  // aggregation uses. Renders every weight from scoring.ts WEIGHTS
  const breakdown = computeConfidenceBreakdown(
    report as CdnReport,
    sysInfo ?? ({} as SystemInfo),
  );

  const additive = breakdown.factors.filter((f) => f.kind === 'additive');
  const multipliers = breakdown.factors.filter((f) => f.kind === 'multiplier');
  const final = breakdown.factors.filter((f) => f.kind === 'final');

  const ratingColor = RATING_COLORS[report.rating] ?? '#888';
  const contributionColor = contributionDelta > 0 ? '#4caf50' : contributionDelta < 0 ? '#e57373' : '#9bb5cc';

  // Qualitative tier derived from scoring-info.json (shared with web app)
  const scoreTier = [...scoringInfo.reportScoreTiers.tiers]
    .sort((a, b) => b.min - a.min)
    .find((tier) => breakdown.total >= tier.min) ?? scoringInfo.reportScoreTiers.tiers[scoringInfo.reportScoreTiers.tiers.length - 1];
  const scoreLabel = scoreTier.label;
  const scoreLabelColor = scoreTier.color;

  return (
    <ModalRoot onCancel={closeModal}>
      <Focusable
        onCancelButton={closeModal}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxHeight: '85vh',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{
            background: ratingColor,
            color: '#111',
            fontSize: 10, fontWeight: 700,
            padding: '3px 9px', borderRadius: 999,
            textTransform: 'uppercase',
          }}>{(t().ratings as Record<string, string>)[report.rating] ?? report.rating}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff' }}>
              {t().extras!.perReportAnalysisTitle!()}
            </div>
            <div style={{ fontSize: 11, color: '#8aa3b6' }}>
              {formatProtonLabel(report.protonVersion)} . {t().common.daysAgo(report.recencyDays)}
            </div>
          </div>
          {/* Total confidence score + help button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                background: 'rgba(102, 192, 244, 0.18)',
                color: '#e0ebf3',
                fontSize: 13, fontWeight: 700,
                padding: '4px 14px', borderRadius: 999,
                border: '1px solid rgba(102, 192, 244, 0.35)',
              }}>{breakdown.total} pts</span>
              <DialogButton
                style={{ width: 'auto', height: 28, minWidth: 0, padding: '0 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}
                onClick={() => showModal(<ScoringGuideModal />)}
              >What's this?</DialogButton>
            </div>
            <span style={{ fontSize: 9, color: scoreLabelColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{scoreLabel}</span>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0 8px' }}>

          {/* === Aggregate impact === */}
          <div style={SECTION_HDR}>{t().extras!.perReportContribution!()}</div>
          <PpDialogButton onClick={() => {}}
            onFocus={onRowFocus('contrib')} onBlur={onRowBlur}
            style={{ ...ROW, borderRight: focusBorder('contrib') }}
          >
            <span style={{ color: '#9bb5cc', fontWeight: 600 }}>
              {`${withoutThis.confidencePct}% -> ${withAll.confidencePct}%`}
            </span>
            <span style={{ color: contributionColor, fontWeight: 700 }}>
              {contributionDelta === 0
                ? t().extras!.perReportContributionNeutral!()
                : t().extras!.perReportContributionDetail!(contributionDelta)}
            </span>
            <span />
          </PpDialogButton>

          {/* === Additive factors === */}
          <div style={SECTION_HDR}>{t().extras!.perReportAdditiveFactors!()}</div>
          {additive.map((f) => {
            const id = `add-${f.label}`;
            return (
              <PpDialogButton key={id} onClick={() => {}}
                onFocus={onRowFocus(id)} onBlur={onRowBlur}
                style={{ ...ROW, borderRight: focusBorder(id), opacity: f.active ? 1 : 0.55 }}
              >
                <span style={{ color: '#c8dcea', fontWeight: 600 }}>{factorLabel(f.label)}</span>
                <span style={{ color: '#9bb5cc', fontSize: 11 }}>{f.detail}</span>
                <span style={{
                  color: valueColor(f.kind, f.value, f.active),
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  minWidth: 44,
                  textAlign: 'right',
                }}>
                  {formatFactorValue(f.kind, f.value)}
                </span>
              </PpDialogButton>
            );
          })}

          {/* === Multipliers === */}
          <div style={SECTION_HDR}>{t().extras!.perReportMultiplierFactors!()}</div>
          {multipliers.map((f) => {
            const id = `mul-${f.label}`;
            return (
              <PpDialogButton key={id} onClick={() => {}}
                onFocus={onRowFocus(id)} onBlur={onRowBlur}
                style={{ ...ROW, borderRight: focusBorder(id), opacity: f.active ? 1 : 0.55 }}
              >
                <span style={{ color: '#c8dcea', fontWeight: 600 }}>{factorLabel(f.label)}</span>
                <span style={{ color: '#9bb5cc', fontSize: 11 }}>{f.detail}</span>
                <span style={{
                  color: valueColor(f.kind, f.value, f.active),
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  minWidth: 44,
                  textAlign: 'right',
                }}>
                  {formatFactorValue(f.kind, f.value)}
                </span>
              </PpDialogButton>
            );
          })}

          {/* === Final adjustments + total === */}
          <div style={SECTION_HDR}>{t().extras!.perReportFinalAdjustments!()}</div>
          {final.map((f) => {
            const id = `fin-${f.label}`;
            return (
              <PpDialogButton key={id} onClick={() => {}}
                onFocus={onRowFocus(id)} onBlur={onRowBlur}
                style={{
                  ...ROW,
                  borderRight: focusBorder(id),
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  paddingTop: 10,
                  marginTop: 4,
                }}
              >
                <span style={{ color: '#e8f4ff', fontWeight: 700 }}>{factorLabel(f.label)}</span>
                <span style={{ color: '#9bb5cc', fontSize: 11 }}>{f.detail}</span>
                <span style={{
                  color: valueColor(f.kind, f.value, f.active),
                  fontWeight: 800,
                  fontFamily: 'monospace',
                  fontSize: 14,
                  minWidth: 44,
                  textAlign: 'right',
                }}>
                  {formatFactorValue(f.kind, f.value)}
                </span>
              </PpDialogButton>
            );
          })}

          <div style={{ height: 24, flexShrink: 0 }} aria-hidden="true" />
        </div>

        {/* Footer */}
        <Focusable style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '10px 18px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          <DialogButton onClick={closeModal} style={{ minWidth: 140, fontSize: 12 }}>
            {t().common.close}
          </DialogButton>
        </Focusable>
      </Focusable>
    </ModalRoot>
  );
}

export function showPerReportAnalysisModal(
  report: DisplayReportCard,
  allReports: DisplayReportCard[],
  configs: UserConfigRow[],
  sysInfo: SystemInfo | null,
): void {
  const modal = showModal(
    <PerReportAnalysisModal
      report={report}
      allReports={allReports}
      configs={configs}
      sysInfo={sysInfo}
      closeModal={() => modal?.Close()}
    />,
  );
}
