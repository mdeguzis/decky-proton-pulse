// src/components/ReportCard.tsx
import type { ScoredReport } from '../types';

interface Props {
  report: ScoredReport;
  selected: boolean;
  onSelect: (report: ScoredReport) => void;
}

const RATING_COLORS: Record<string, string> = {
  platinum: '#b0e0e6',
  gold:     '#ffd700',
  silver:   '#c0c0c0',
  bronze:   '#cd7f32',
  borked:   '#ff4444',
  pending:  '#888888',
};

function confidenceColor(score: number): string {
  if (score >= 80) return '#4caf50';
  if (score >= 60) return '#ffeb3b';
  if (score >= 40) return '#ff9800';
  return '#f44336';
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

export function ReportCard({ report, selected, onSelect }: Props) {
  const ratingColor = RATING_COLORS[report.rating] ?? '#888';
  const cappedScore = Math.min(100, report.score);
  const confScore = (cappedScore / 10).toFixed(1);
  const confColor = confidenceColor(cappedScore);

  return (
    <div
      style={{
        border: `2px solid ${selected ? '#4c9eff' : '#2a3a4a'}`,
        borderRadius: 4,
        padding: '10px 14px',
        marginBottom: 6,
        background: selected ? 'rgba(76,158,255,0.08)' : 'rgba(255,255,255,0.03)',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'flex',
        gap: 12,
      }}
      onClick={() => onSelect(report)}
    >
      {/* Left: main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff', marginBottom: 2 }}>
          {report.protonVersion}
        </div>
        <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 6 }}>
          {[report.gpu, report.os].filter(Boolean).join(' · ')}
        </div>
        {report.notes && (
          <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.4 }}>
            {truncate(report.notes, 160)}
          </div>
        )}
      </div>

      {/* Right: stats */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        justifyContent: 'space-between', minWidth: 90, flexShrink: 0,
      }}>
        <span style={{
          background: ratingColor, color: '#111', borderRadius: 3,
          padding: '1px 7px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
          {report.rating}
        </span>
        <span style={{ fontSize: 11, color: '#aaa' }}>
          Votes: {report.upvotes}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: confColor }}>
          ⚡ {confScore}/10
        </span>
      </div>
    </div>
  );
}
