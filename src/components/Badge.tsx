// src/components/Badge.tsx
import type { ProtonDBSummary } from '../types';

interface Props {
  summary: ProtonDBSummary | null;
  gpuVendor: string | null;
  badgeColor?: string;
}

const DEFAULT_COLORS: Record<string, string> = {
  platinum: '#b0e0e6',
  gold:     '#ffd700',
  silver:   '#c0c0c0',
  bronze:   '#cd7f32',
  borked:   '#ff4444',
};

const TIER_LABEL: Record<string, string> = {
  platinum: 'Platinum',
  gold:     'Gold',
  silver:   'Silver',
  bronze:   'Bronze',
  borked:   'Borked',
};

export function ProtonPulseBadge({ summary, gpuVendor, badgeColor }: Props) {
  if (!summary || !summary.score || summary.score === 'pending') return null;

  const color = badgeColor ?? DEFAULT_COLORS[summary.score] ?? '#888';
  const tier = TIER_LABEL[summary.score] ?? summary.score;
  const vendorLabel = gpuVendor ? gpuVendor.toUpperCase() : '';
  const label = vendorLabel ? `PP·${vendorLabel} ${tier}` : `PP ${tier}`;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 6,
        background: color,
        color: '#111',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.03em',
        cursor: 'default',
        userSelect: 'none',
      }}
      title={`Proton Pulse: ${tier} (${summary.total} reports)`}
    >
      ⚡ {label}
    </div>
  );
}
