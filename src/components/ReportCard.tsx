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

const GPU_TIER_LABELS: Record<string, string> = {
  nvidia: 'NVIDIA',
  amd:    'AMD',
  intel:  'Intel',
  unknown: '?',
};

function formatRecency(days: number): string {
  if (days < 30)  return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}yr ago`;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

export function ReportCard({ report, selected, onSelect }: Props) {
  const color = RATING_COLORS[report.rating] ?? '#888';
  const gpuLabel = GPU_TIER_LABELS[report.gpuTier] ?? '?';

  return (
    <div
      style={{
        border: `2px solid ${selected ? '#4c9eff' : '#333'}`,
        borderRadius: 6,
        padding: '8px 10px',
        marginBottom: 8,
        background: selected ? 'rgba(76,158,255,0.1)' : 'rgba(255,255,255,0.04)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => onSelect(report)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{
          background: color, color: '#111', borderRadius: 4,
          padding: '1px 6px', fontWeight: 700, fontSize: 12, minWidth: 28, textAlign: 'center'
        }}>
          {report.score}
        </span>
        <span style={{
          background: '#333', color: '#ccc', borderRadius: 4,
          padding: '1px 5px', fontSize: 11
        }}>
          {gpuLabel}
        </span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#ddd' }}>
          {report.protonVersion}
        </span>
        <span style={{ fontSize: 16, color: selected ? '#4c9eff' : '#555' }}>
          {selected ? '☑' : '☐'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 3 }}>
        {formatRecency(report.recencyDays)}
        {report.responses?.gpu ? ` · ${report.responses.gpu}` : ''}
      </div>
      {report.notes && (
        <div style={{
          fontSize: 11, color: '#bbb', fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.3)', borderRadius: 3, padding: '2px 5px'
        }}>
          {truncate(report.notes, 80)}
        </div>
      )}
    </div>
  );
}
