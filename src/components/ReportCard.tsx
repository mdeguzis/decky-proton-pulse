// src/components/ReportCard.tsx
import { Focusable } from '@decky/ui';
import type { ScoredReport } from '../types';

export interface DisplayReportCard extends ScoredReport {
  displayKey: string;
  isEdited?: boolean;
  editLabel?: string;
}

interface Props {
  report: DisplayReportCard;
  selected: boolean;
  focused?: boolean;
  onSelect: (report: DisplayReportCard) => void;
  onFocus?: (report: DisplayReportCard) => void;
}

const RATING_COLORS: Record<string, string> = {
  platinum: '#b0e0e6',
  gold: '#ffd700',
  silver: '#c0c0c0',
  bronze: '#cd7f32',
  borked: '#ff4444',
  pending: '#888888',
};

function confidenceColor(score: number): string {
  if (score >= 80) return '#4caf50';
  if (score >= 60) return '#ffeb3b';
  if (score >= 40) return '#ff9800';
  return '#f44336';
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
}

export function ReportCard({ report, selected, focused = false, onSelect, onFocus }: Props) {
  const ratingColor = RATING_COLORS[report.rating] ?? '#888';
  const cappedScore = Math.min(100, report.score);
  const confScore = (cappedScore / 10).toFixed(1);
  const confColor = confidenceColor(cappedScore);
  const highlighted = selected || focused;

  return (
    <Focusable
      onClick={() => onSelect(report)}
      onOKButton={() => onSelect(report)}
      onGamepadFocus={() => onFocus?.(report)}
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
            ? '0 0 0 1px rgba(255,255,255,0.2) inset, 0 0 18px rgba(255,255,255,0.18), 0 0 34px rgba(149,191,255,0.2)'
            : '0 0 0 1px rgba(255,255,255,0.04) inset',
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          gap: 14,
          animation: highlighted ? 'proton-pulse-card-glow 1.8s ease-in-out infinite' : 'none',
        }}
      >
        <style>
          {'@keyframes proton-pulse-card-glow { 0% { box-shadow: 0 0 0 1px rgba(255,255,255,0.24) inset, 0 0 12px rgba(255,255,255,0.12), 0 0 22px rgba(149,191,255,0.16); } 50% { box-shadow: 0 0 0 1px rgba(255,255,255,0.34) inset, 0 0 22px rgba(255,255,255,0.2), 0 0 40px rgba(149,191,255,0.28); } 100% { box-shadow: 0 0 0 1px rgba(255,255,255,0.24) inset, 0 0 12px rgba(255,255,255,0.12), 0 0 22px rgba(149,191,255,0.16); } }'}
        </style>

        <div style={{ flex: 1, minWidth: 0 }}>
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
                Edited*
              </span>
              {report.editLabel ? (
                <span style={{ marginLeft: 8, fontSize: 10, color: '#b7d4ee' }}>
                  {report.editLabel}
                </span>
              ) : null}
            </div>
          )}

          <div style={{ fontSize: 15, fontWeight: 700, color: '#f4fbff', marginBottom: 4 }}>
            {report.protonVersion}
          </div>
          <div style={{ fontSize: 11, color: '#8fb4d5', marginBottom: 8 }}>
            {[report.gpu, report.os].filter(Boolean).join(' · ') || 'Hardware details unavailable'}
          </div>
          <div style={{ fontSize: 10, color: '#9cb3c7', marginBottom: 8 }}>
            {report.recencyDays}d ago · {report.upvotes} votes
          </div>
          {report.notes && (
            <div style={{ fontSize: 11, color: '#cad7e4', lineHeight: 1.45 }}>
              {truncate(report.notes, 150)}
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
          <span
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
            {report.rating}
          </span>
          <span style={{ fontSize: 11, color: '#d9e8f4' }}>
            {report.gpuTier.toUpperCase()}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: confColor }}>
            {confScore}/10
          </span>
        </div>
      </div>
    </Focusable>
  );
}
