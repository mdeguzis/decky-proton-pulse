// Per-report analysis modal. Opens when the user presses Y on a focused
// report card in ConfigureTab. Answers the question "what does THIS
// specific report contribute to the aggregate confidence shown at the
// top of the screen?"
//
// Computes contribution by running computeGameStats() twice -- once with
// the full report list and once with this report removed -- and showing
// the delta. Also surfaces the per-report facts that influence the
// aggregate (recency weight, tier vs majority, hardware match)

import { ModalRoot, Focusable, DialogButton, showModal } from '@decky/ui';
import { computeGameStats } from '../lib/gameStats';
import { useFocusableScroll } from '../lib/useFocusableScroll';
import { RATING_COLORS } from '../lib/reportFormatters';
import { formatProtonLabel } from '../lib/reportFormatters';
import { t } from '../lib/i18n';
import type { DisplayReportCard } from './ReportCard';
import type { UserConfigRow } from '../lib/userConfigs';
import type { SystemInfo } from '../types';

const PpDialogButton = DialogButton as React.ComponentType<
  React.ComponentProps<typeof DialogButton> & {
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur?: () => void;
  }
>;

const ROW: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr',
  alignItems: 'center',
  width: '100%',
  minHeight: 36,
  padding: '8px 18px',
  fontSize: 12,
  color: '#e8f4ff',
  gap: 12,
  background: 'transparent',
  textAlign: 'left',
};

const SECTION_HDR: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: '#7a9bb5',
  padding: '14px 18px 2px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

interface Props {
  report: DisplayReportCard;
  // The full list of reports the aggregate stats are computed from. We
  // pass the DisplayReportCard[] directly because computeGameStats only
  // reads .rating / .timestamp / .protonVersion / .launchOptions which
  // are present on both DisplayReportCard and CdnReport shapes
  allReports: DisplayReportCard[];
  configs: UserConfigRow[];
  sysInfo: SystemInfo | null;
  closeModal?: () => void;
}

function PerReportAnalysisModal({ report, allReports, configs, sysInfo, closeModal }: Props) {
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll();

  // Contribution math: how does this report change aggregate confidence?
  // Run computeGameStats twice and diff the percent
  const withAll = computeGameStats(allReports, configs);
  const withoutThis = computeGameStats(
    allReports.filter((r) => r.displayKey !== report.displayKey),
    configs,
  );
  const contributionDelta = withAll.confidencePct - withoutThis.confidencePct;

  // Recency bucket. Numbers mirror gameStats.js freshness weights:
  //   < 90d  -> 1.00x weight (recent)
  //   90-365 -> 0.60x weight (prior)
  //   > 365  -> 0.20x weight (historic)
  const ageDays = report.recencyDays;
  const recencyKind: 'recent' | 'prior' | 'historic' =
    ageDays < 90 ? 'recent' : ageDays < 365 ? 'prior' : 'historic';
  const recencyLabel =
    recencyKind === 'recent' ? t().extras!.perReportRecencyRecent!()
    : recencyKind === 'prior' ? t().extras!.perReportRecencyPrior!()
    : t().extras!.perReportRecencyHistoric!();

  // Tier agreement: does this rating match the most-common tier in the
  // aggregate? Pick the highest-count tier from ratingCounts
  const tierEntries = Object.entries(withAll.ratingCounts) as Array<[string, number]>;
  tierEntries.sort((a, b) => b[1] - a[1]);
  const dominantTier = tierEntries[0]?.[0] ?? null;
  const agreesWithDominant = !!dominantTier && report.rating === dominantTier;

  // Hardware match: report's GPU vendor vs detected system GPU vendor
  const sysGpu = (sysInfo?.gpu_vendor ?? '').toLowerCase();
  const reportGpu = report.gpuTier.toLowerCase();
  const hardwareMatches = !!sysGpu && reportGpu !== 'unknown' && sysGpu === reportGpu;

  const ratingColor = RATING_COLORS[report.rating] ?? '#888';
  const contributionColor = contributionDelta > 0 ? '#4caf50' : contributionDelta < 0 ? '#e57373' : '#9bb5cc';

  return (
    <ModalRoot onCancel={closeModal}>
      <Focusable
        onCancelButton={closeModal}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 640,
          maxHeight: '85vh',
          background: '#0f1822',
          border: '1px solid rgba(102, 192, 244, 0.18)',
          borderRadius: 6,
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
              {formatProtonLabel(report.protonVersion)} . {t().common.daysAgo(ageDays)}
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0 6px' }}>

          {/* Contribution */}
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
          </PpDialogButton>

          {/* Recency */}
          <div style={SECTION_HDR}>{t().extras!.perReportRecency!()}</div>
          <PpDialogButton onClick={() => {}}
            onFocus={onRowFocus('recency')} onBlur={onRowBlur}
            style={{ ...ROW, borderRight: focusBorder('recency') }}
          >
            <span style={{ color: '#c8dcea', fontWeight: 600 }}>
              {t().common.daysAgo(ageDays)}
            </span>
            <span style={{ color: '#dbe7ef' }}>{recencyLabel}</span>
          </PpDialogButton>

          {/* Tier agreement */}
          <div style={SECTION_HDR}>{t().extras!.perReportTierAgreement!()}</div>
          <PpDialogButton onClick={() => {}}
            onFocus={onRowFocus('tier')} onBlur={onRowBlur}
            style={{ ...ROW, borderRight: focusBorder('tier') }}
          >
            <span style={{ color: '#c8dcea', fontWeight: 600 }}>
              {dominantTier
                ? `${(t().ratings as Record<string, string>)[dominantTier] ?? dominantTier} (${withAll.ratingCounts[dominantTier as keyof typeof withAll.ratingCounts] ?? 0})`
                : '-'}
            </span>
            <span style={{
              color: agreesWithDominant ? '#4caf50' : '#f6b347',
              fontWeight: 700,
            }}>
              {agreesWithDominant
                ? t().extras!.perReportTierAgrees!()
                : t().extras!.perReportTierDisagrees!()}
            </span>
          </PpDialogButton>

          {/* Hardware match */}
          <div style={SECTION_HDR}>{t().extras!.perReportHardwareMatch!()}</div>
          <PpDialogButton onClick={() => {}}
            onFocus={onRowFocus('hw')} onBlur={onRowBlur}
            style={{ ...ROW, borderRight: focusBorder('hw') }}
          >
            <span style={{ color: '#c8dcea', fontWeight: 600 }}>
              {`${report.gpuTier.toUpperCase()} vs ${(sysGpu || '?').toUpperCase()}`}
            </span>
            <span style={{
              color: hardwareMatches ? '#4caf50' : '#f6b347',
              fontWeight: 700,
            }}>
              {hardwareMatches
                ? t().extras!.perReportHardwareMatches!()
                : t().extras!.perReportHardwareMismatch!()}
            </span>
          </PpDialogButton>

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
