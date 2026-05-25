// src/components/ReportCard.tsx
import { Focusable } from '@decky/ui';
import type { ScoredReport } from '../types';
import { RATING_COLORS, buildNotesPreview, formatProtonLabel } from '../lib/reportFormatters';
import { t } from '../lib/i18n';

export interface DisplayReportCard extends ScoredReport {
  displayKey: string;
  isEdited?: boolean;
  editLabel?: string;
  isPulse?: boolean;
  pulseTitle?: string;
}

interface Props {
  report: DisplayReportCard;
  selected: boolean;
  focused?: boolean;
  systemGpuVendor?: string | null;
  onSelect: (report: DisplayReportCard) => void;
  onFocus?: (report: DisplayReportCard) => void;
  onUpvote?: (report: DisplayReportCard) => void;
  onDownvote?: (report: DisplayReportCard) => void;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 80) return '#4caf50';
  if (confidence >= 60) return '#ffeb3b';
  if (confidence >= 40) return '#ff9800';
  return '#f44336';
}

export function ReportCard({ report, selected, focused = false, systemGpuVendor, onSelect, onFocus, onUpvote }: Props) {
  const strings = t();
  // Badge shows the report's actual rating (derived from yes/no answers).
  // Earlier this used scoreToRating(report.score) which re-tier'd a borked
  // report into bronze based on hardware/recency - that hid signal.
  const displayRating = report.rating;
  const ratingColor = RATING_COLORS[displayRating] ?? '#888';
  const cappedConfidence = Math.min(100, report.confidence);
  // Show as a percentage. Earlier this was an X.X/10 score which read like a
  // user-facing rating instead of a relevance qualifier; the percent format
  // tracks better with the new rating/confidence split
  const confLabel = `${Math.round(cappedConfidence)}%`;
  const confColor = confidenceColor(cappedConfidence);
  const highlighted = selected || focused;
  const notesPreview = buildNotesPreview(report.notes);
  const gpuMismatch =
    !!systemGpuVendor &&
    report.gpuTier !== 'unknown' &&
    report.gpuTier !== systemGpuVendor;

  return (
    <Focusable
      onClick={() => onSelect(report)}
      onOKButton={() => onSelect(report)}
      onGamepadFocus={() => onFocus?.(report)}
      onSecondaryButton={onUpvote ? () => onUpvote(report) : undefined}
      onSecondaryActionDescription={onUpvote ? strings.detail.upvote : undefined}
      style={{ width: '100%' }}
    >
      <div
        tabIndex={0}
        style={{
          position: 'relative',
          border: `2px solid ${highlighted ? 'rgba(255,255,255,0.96)' : '#2a3a4a'}`,
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 10,
          background: highlighted
            ? 'linear-gradient(180deg, rgba(72, 104, 142, 0.36), rgba(17, 26, 38, 0.96))'
            : 'linear-gradient(180deg, rgba(26, 36, 49, 0.92), rgba(13, 19, 28, 0.96))',
          boxShadow: highlighted
            ? '0 0 18px rgba(255,255,255,0.18), 0 0 34px rgba(149,191,255,0.2)'
            : '0 0 0 1px rgba(255,255,255,0.04) inset',
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          gap: 14,
          animation: highlighted ? 'proton-pulse-card-glow 1.8s ease-in-out infinite' : 'none',
        }}
      >
        <style>
          {'@keyframes proton-pulse-card-glow { 0% { box-shadow: 0 0 12px rgba(255,255,255,0.12), 0 0 22px rgba(149,191,255,0.16); } 50% { box-shadow: 0 0 22px rgba(255,255,255,0.2), 0 0 40px rgba(149,191,255,0.28); } 100% { box-shadow: 0 0 12px rgba(255,255,255,0.12), 0 0 22px rgba(149,191,255,0.16); } }'}
        </style>

        <div style={{ flex: 1, minWidth: 0 }}>
          {report.isPulse && (
            <div style={{ marginBottom: 8 }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(74,159,208,0.22)',
                  border: '1px solid rgba(74,159,208,0.55)',
                  color: '#7ec8f0',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                }}
              >
                {`⚡ ${t().reports.pulseBadge}`}
              </span>
              {report.pulseTitle ? (
                <span style={{ marginLeft: 8, fontSize: 10, color: '#7ec8f0' }}>
                  {report.pulseTitle}
                </span>
              ) : null}
            </div>
          )}
          {report.isEdited && (
            <div style={{ marginBottom: 8 }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.24)',
                  color: '#f4fbff',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                }}
              >
                  {strings.reports.editedBadge}
              </span>
              {report.editLabel ? (
                <span style={{ marginLeft: 8, fontSize: 10, color: '#b7d4ee' }}>
                  {report.editLabel}
                </span>
              ) : null}
            </div>
          )}

          <div style={{ fontSize: 15, fontWeight: 700, color: '#f4fbff', marginBottom: 4 }}>
            {formatProtonLabel(report.protonVersion)}
          </div>
          <div style={{ fontSize: 11, color: '#8fb4d5', marginBottom: 8 }}>
            {[report.gpu, report.os].filter(Boolean).join(' . ') || strings.reports.hardwareUnavailable}
          </div>
          <div style={{ fontSize: 10, color: '#9cb3c7', marginBottom: 8 }}>
            {strings.common.daysAgo(report.recencyDays)}
          </div>
          {notesPreview && (
            <div style={{ fontSize: 11, color: '#cad7e4', lineHeight: 1.45 }}>
              {notesPreview}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            minWidth: 104,
            flexShrink: 0,
          }}
        >
          {/* Rating badge + per-report confidence pill on the same row so they
              read as a pair: "PLATINUM 100%". GPU tier sits on its own row
              below, votes underneath that */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              title={gpuMismatch ? strings.reports.gpuMismatchBadgeHint(report.gpuTier) : undefined}
              style={{
                background: ratingColor,
                color: '#111',
                borderRadius: 999,
                padding: '2px 9px',
                fontWeight: 700,
                fontSize: 10,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {(strings.ratings as Record<string, string>)[displayRating]}
            </span>
            <span
              title={`Per-report confidence: ${confLabel}`}
              style={{
                background: confColor,
                color: '#111',
                borderRadius: 999,
                padding: '1px 8px',
                fontWeight: 700,
                fontSize: 10,
                whiteSpace: 'nowrap',
                letterSpacing: 0.3,
              }}
            >
              {confLabel}
            </span>
          </div>
          <span style={{ fontSize: 11, color: gpuMismatch ? '#f59e0b' : '#d9e8f4' }}>
            {report.gpuTier.toUpperCase()}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpvote?.(report);
              }}
              style={{
                cursor: onUpvote ? 'pointer' : 'default',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                opacity: onUpvote ? 0.85 : 0.4,
              }}
              title={strings.detail.upvote}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66a4.8 4.8 0 0 0-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84C7 18.95 8.05 20 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z" />
              </svg>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#d9e8f4' }}>{report.upvotes}</span>
            </span>
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, opacity: 0.25 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.5l-.92 4.65c-.05.22-.02.46.08.66.23.45.52.86.88 1.22L10 22l6.41-6.41c.38-.38.59-.89.59-1.42V6.34C17 5.05 15.95 4 14.66 4h-8.1c-.71 0-1.36.37-1.72.97l-2.67 6.15z" />
              </svg>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#d9e8f4' }}>0</span>
            </span>
          </div>
        </div>
      </div>
    </Focusable>
  );
}
