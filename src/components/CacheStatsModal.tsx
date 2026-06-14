// Cache performance stats modal.
// SVG line charts for hit rate, CDN latency, and fetch volume over the
// last 24h of hourly buckets. Each section is a focusable row so D-pad
// scrolls through them via useFocusableScroll (same as SystemRequirementsTab).

import { Focusable, DialogButton, findSP } from '@decky/ui';
import { getHourlyBuckets, getSummary, getCombinedCategoryStats } from '../lib/metrics';
import type { HourlyBucket } from '../lib/metrics';
import { useFocusableScroll } from '../lib/useFocusableScroll';

// cast DialogButton to accept onFocus/onBlur (same pattern as ReleaseNotesModal)
const PpDialogButton = DialogButton as React.ComponentType<
  React.ComponentProps<typeof DialogButton> & {
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur?: () => void;
  }
>;

function formatHour(hourKey: number): string {
  return `${new Date(hourKey).getHours().toString().padStart(2, '0')}h`;
}

function LineChart({
  buckets,
  getValue,
  color,
  unit = '',
  maxValue,
  emptyNote,
}: {
  buckets: HourlyBucket[];
  getValue: (b: HourlyBucket) => number;
  color: string;
  unit?: string;
  maxValue?: number;
  emptyNote?: string;
}) {
  if (buckets.length === 0) {
    return (
      <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a5060', fontSize: 11 }}>
        {emptyNote ?? 'No data yet this session'}
      </div>
    );
  }

  const W = 400;
  const H = 80;
  const PAD_L = 32;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 18;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const values = buckets.map(getValue);
  const dataMax = Math.max(...values, 1);
  const yMax = maxValue ?? dataMax;

  const n = buckets.length;
  const xOf = (i: number) => n === 1 ? PAD_L + chartW * 0.1 : PAD_L + (i / (n - 1)) * chartW;
  const yOf = (v: number) => PAD_T + chartH - Math.min(Math.max(v, 0) / yMax, 1) * chartH;

  const pts = buckets.map((b, i) => `${xOf(i).toFixed(1)},${yOf(getValue(b)).toFixed(1)}`);
  const areaPath = [
    `M${xOf(0).toFixed(1)},${(PAD_T + chartH).toFixed(1)}`,
    ...buckets.map((b, i) => `L${xOf(i).toFixed(1)},${yOf(getValue(b)).toFixed(1)}`),
    `L${xOf(n - 1).toFixed(1)},${(PAD_T + chartH).toFixed(1)}`,
    'Z',
  ].join(' ');

  const labelStep = n <= 6 ? 1 : n <= 12 ? 2 : 4;
  const gridFracs = [0, 0.5, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
      {/* grid lines + y labels */}
      {gridFracs.map((f, gi) => {
        const y = PAD_T + chartH - f * chartH;
        const label = f === 0 ? '0' : f === 1 ? `${yMax}` : `${Math.round(yMax * f)}`;
        return (
          <g key={gi}>
            <line x1={PAD_L} y1={y.toFixed(1)} x2={W - PAD_R} y2={y.toFixed(1)}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
            <text x={PAD_L - 3} y={(y + 3.5).toFixed(1)} textAnchor="end" fontSize={8} fill="#3a5878">
              {label}{unit}
            </text>
          </g>
        );
      })}

      {/* area */}
      <path d={areaPath} fill={color} fillOpacity={0.13} />

      {/* line */}
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />

      {/* dots */}
      {buckets.map((b, i) => (
        <circle key={i} cx={xOf(i).toFixed(1)} cy={yOf(getValue(b)).toFixed(1)}
          r={2.5} fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth={0.8} />
      ))}

      {/* x-axis hour labels */}
      {buckets.map((b, i) => i % labelStep !== 0 ? null : (
        <text key={i} x={xOf(i).toFixed(1)} y={H - 3} textAnchor="middle" fontSize={8} fill="#3a5878">
          {formatHour(b.hourKey)}
        </text>
      ))}

      {/* value callouts: last point and max */}
      {(() => {
        const shown = new Set<number>();
        const labels: React.ReactNode[] = [];
        const maxIdx = values.indexOf(dataMax);
        [n - 1, maxIdx].forEach((i) => {
          if (i < 0 || shown.has(i)) return;
          shown.add(i);
          const v = values[i];
          if (v === 0) return;
          const cx = xOf(i);
          const cy = yOf(v);
          const anchor = cx > W - PAD_R - 30 ? 'end' : 'start';
          const lx = anchor === 'end' ? cx - 4 : cx + 4;
          labels.push(
            <text key={i} x={lx.toFixed(1)} y={(cy - 4).toFixed(1)}
              textAnchor={anchor} fontSize={9} fill={color} fontWeight="bold">
              {v}{unit}
            </text>,
          );
        });
        return labels;
      })()}
    </svg>
  );
}

function StatRow({ label, value, highlight }: { label: string; value: string | number; highlight?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span style={{ color: '#6a8a9a' }}>{label}</span>
      <span style={{ color: highlight ?? '#c8dcea', fontWeight: highlight ? 700 : 400 }}>{value}</span>
    </div>
  );
}

export function CacheStatsModalContent({ closeModal }: { closeModal?: () => void }) {
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll({ block: 'nearest' });

  const buckets = getHourlyBuckets();
  const summary = getSummary();
  const cdnStats = getCombinedCategoryStats([
    'fetch-cdn-index', 'fetch-cdn-year', 'fetch-cdn-votes', 'fetch-live-summary',
  ]);

  const totalLookups = summary.counters.cacheHits + summary.counters.cacheMisses;
  const hitPct = totalLookups > 0
    ? ((summary.counters.cacheHits / totalLookups) * 100).toFixed(1)
    : 'n/a';
  const hitNum = totalLookups > 0 ? Number(hitPct) : -1;
  const hitColor = hitNum >= 70 ? '#4caf7d' : hitNum >= 40 ? '#f6b347' : hitNum >= 0 ? '#f44336' : undefined;

  const SP = findSP();
  const modalH = SP.innerHeight - 60;

  const sectionStyle = (id: string): React.CSSProperties => ({
    width: '100%', textAlign: 'left',
    background: 'rgba(0,0,0,0.0)', border: 'none', boxShadow: 'none',
    padding: '10px 0 4px',
    borderRight: focusBorder(id),
  });

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: '#5a7a95',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    display: 'block', marginBottom: 4,
  };

  const chartBox: React.CSSProperties = {
    background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '6px 8px', marginBottom: 2,
  };

  return (
    <Focusable
      onCancelButton={closeModal}
      style={{
        margin: 30,
        height: modalH,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgba(24, 27, 34, 0.98)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* header row: title left, small close button right */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e0ebf3', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Cache Performance{' '}
          <span style={{ color: '#3d556a', fontWeight: 400, textTransform: 'none' }}>
            · uptime {Math.floor(summary.uptimeMs / 60000)}m
          </span>
        </span>
        <DialogButton
          onClick={closeModal}
          style={{ width: 60, minWidth: 0, height: 24, fontSize: 10, padding: '0 6px', flex: '0 0 60px' }}
        >
          Close
        </DialogButton>
      </div>

      {/* scrollable body -- each section is a PpDialogButton for D-pad nav */}
      <Focusable style={{ overflowY: 'scroll', flex: 1, padding: '2px 14px' }}>

        <PpDialogButton
          onClick={() => {}}
          onFocus={onRowFocus('hit-rate')}
          onBlur={onRowBlur}
          style={sectionStyle('hit-rate')}
        >
          <span style={labelStyle}>Cache hit rate (% / hour)</span>
          <div style={chartBox}>
            <LineChart buckets={buckets} getValue={(b) => {
              const t = b.hits + b.misses;
              return t > 0 ? Math.round((b.hits / t) * 100) : 0;
            }} color="#4caf7d" unit="%" maxValue={100} />
          </div>
        </PpDialogButton>

        <PpDialogButton
          onClick={() => {}}
          onFocus={onRowFocus('cdn-latency')}
          onBlur={onRowBlur}
          style={sectionStyle('cdn-latency')}
        >
          <span style={labelStyle}>CDN avg latency (ms / hour)</span>
          <div style={chartBox}>
            <LineChart
              buckets={buckets.filter(b => b.fetchCount > 0)}
              getValue={(b) => Math.round(b.totalFetchMs / b.fetchCount)}
              color="#5ec8f4"
              unit="ms"
              emptyNote={
                totalLookups > 0 && summary.counters.cacheHits === totalLookups
                  ? 'All lookups served from cache -- no CDN fetches needed'
                  : 'No CDN fetches recorded yet'
              }
            />
          </div>
        </PpDialogButton>

        <PpDialogButton
          onClick={() => {}}
          onFocus={onRowFocus('fetch-vol')}
          onBlur={onRowBlur}
          style={sectionStyle('fetch-vol')}
        >
          <span style={labelStyle}>Fetch volume (requests / hour)</span>
          <div style={chartBox}>
            <LineChart buckets={buckets} getValue={(b) => b.fetches} color="#f6b347" />
          </div>
        </PpDialogButton>

        <PpDialogButton
          onClick={() => {}}
          onFocus={onRowFocus('counters')}
          onBlur={onRowBlur}
          style={sectionStyle('counters')}
        >
          <span style={labelStyle}>Session totals</span>
          <div style={{ ...chartBox, padding: '6px 10px' }}>
            <StatRow label="Hit rate" value={`${hitPct}%`} highlight={hitColor} />
            <StatRow label="Cache hits" value={summary.counters.cacheHits} />
            <StatRow label="Cache misses" value={summary.counters.cacheMisses} />
            <StatRow label="Total fetches" value={summary.counters.totalFetches} />
            <StatRow label="Fetch errors" value={summary.counters.fetchErrors}
              highlight={summary.counters.fetchErrors > 0 ? '#f44336' : undefined} />
            <StatRow label="No CDN data (404)" value={summary.counters.noDataGames} />
            <StatRow label="Prefetched games" value={summary.counters.prefetchedGames} />
            <StatRow label="Cache evictions" value={summary.counters.cacheEvictions} />
          </div>
        </PpDialogButton>

        {cdnStats && (
          <PpDialogButton
            onClick={() => {}}
            onFocus={onRowFocus('cdn-timing')}
            onBlur={onRowBlur}
            style={sectionStyle('cdn-timing')}
          >
            <span style={labelStyle}>CDN fetch timing (all-time)</span>
            <div style={{ ...chartBox, padding: '6px 10px' }}>
              <StatRow label="Requests" value={cdnStats.count} />
              <StatRow label="Avg" value={`${cdnStats.avgMs}ms`} />
              <StatRow label="p95" value={`${cdnStats.p95Ms}ms`} />
              <StatRow label="Max" value={`${cdnStats.maxMs}ms`} />
              <StatRow label="Errors" value={cdnStats.errorCount} />
            </div>
          </PpDialogButton>
        )}

        <div style={{ height: 12 }} />
      </Focusable>
    </Focusable>
  );
}
