// Cache performance stats modal.
// SVG line charts for hit rate, CDN latency, and fetch volume over the
// last 24h of hourly buckets. Opened from the Stats button in Manage Cache.

import { Focusable, DialogButton, findSP } from '@decky/ui';
import { getHourlyBuckets, getSummary, getCombinedCategoryStats } from '../lib/metrics';
import type { HourlyBucket } from '../lib/metrics';

function formatHour(hourKey: number): string {
  return `${new Date(hourKey).getHours().toString().padStart(2, '0')}h`;
}

// SVG line chart with area fill, grid lines, dots, and axis labels.
function LineChart({
  buckets,
  getValue,
  color,
  unit = '',
  maxValue,
}: {
  buckets: HourlyBucket[];
  getValue: (b: HourlyBucket) => number;
  color: string;
  unit?: string;
  maxValue?: number;
}) {
  if (buckets.length === 0) {
    return (
      <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a5060', fontSize: 11 }}>
        No data yet this session
      </div>
    );
  }

  const W = 280;
  const H = 80;
  const PAD_L = 28;
  const PAD_R = 6;
  const PAD_T = 10;
  const PAD_B = 16;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const values = buckets.map(getValue);
  const dataMax = Math.max(...values, 1);
  const yMax = maxValue ?? dataMax;

  const xOf = (i: number) =>
    buckets.length === 1
      ? PAD_L + chartW / 2
      : PAD_L + (i / (buckets.length - 1)) * chartW;
  const yOf = (v: number) => PAD_T + chartH - Math.min(v / yMax, 1) * chartH;

  const pts = buckets.map((b, i) => `${xOf(i).toFixed(1)},${yOf(getValue(b)).toFixed(1)}`);
  const polyline = pts.join(' ');

  // area fill: go down to the baseline at both ends
  const areaPath = [
    `M${xOf(0).toFixed(1)},${(PAD_T + chartH).toFixed(1)}`,
    ...buckets.map((b, i) => `L${xOf(i).toFixed(1)},${yOf(getValue(b)).toFixed(1)}`),
    `L${xOf(buckets.length - 1).toFixed(1)},${(PAD_T + chartH).toFixed(1)}`,
    'Z',
  ].join(' ');

  // pick a subset of x-axis labels so they dont overlap
  const labelStep = buckets.length <= 6 ? 1 : buckets.length <= 12 ? 2 : 4;
  const gridYs = [0, 0.5, 1].map(f => PAD_T + chartH - f * chartH);
  const gridLabels = [0, Math.round(yMax * 0.5), yMax];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
      {/* horizontal grid lines */}
      {gridYs.map((y, gi) => (
        <g key={gi}>
          <line
            x1={PAD_L} y1={y.toFixed(1)}
            x2={W - PAD_R} y2={y.toFixed(1)}
            stroke="rgba(255,255,255,0.06)" strokeWidth={1}
          />
          <text x={PAD_L - 3} y={(y + 3).toFixed(1)} textAnchor="end"
            fontSize={7} fill="#3a5878">
            {gridLabels[gi]}{unit}
          </text>
        </g>
      ))}

      {/* area fill */}
      <path d={areaPath} fill={color} fillOpacity={0.12} />

      {/* line */}
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />

      {/* dots */}
      {buckets.map((b, i) => (
        <circle
          key={i}
          cx={xOf(i).toFixed(1)}
          cy={yOf(getValue(b)).toFixed(1)}
          r={2}
          fill={color}
          stroke="rgba(0,0,0,0.4)"
          strokeWidth={0.5}
        />
      ))}

      {/* x-axis labels */}
      {buckets.map((b, i) =>
        i % labelStep === 0 ? (
          <text
            key={i}
            x={xOf(i).toFixed(1)}
            y={H - 2}
            textAnchor="middle"
            fontSize={7}
            fill="#3a5878"
          >
            {formatHour(b.hourKey)}
          </text>
        ) : null,
      )}

      {/* value labels on dots (show last and max) */}
      {buckets.map((b, i) => {
        const v = getValue(b);
        const isLast = i === buckets.length - 1;
        const isMax = v === dataMax && v > 0;
        if (!isLast && !isMax) return null;
        const x = xOf(i);
        const y = yOf(v);
        const labelX = x > W - PAD_R - 20 ? x - 3 : x + 3;
        return (
          <text
            key={`lbl-${i}`}
            x={labelX.toFixed(1)}
            y={(y - 3).toFixed(1)}
            textAnchor={x > W - PAD_R - 20 ? 'end' : 'start'}
            fontSize={8}
            fill={color}
            fontWeight="bold"
          >
            {v}{unit}
          </text>
        );
      })}
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      color: '#5a7a95',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: 4,
      marginTop: 12,
    }}>
      {children}
    </div>
  );
}

function StatRow({ label, value, highlight }: { label: string; value: string | number; highlight?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: '#6a8a9a' }}>{label}</span>
      <span style={{ color: highlight ?? '#c8dcea', fontWeight: highlight ? 700 : 400 }}>{value}</span>
    </div>
  );
}

export function CacheStatsModalContent({ closeModal }: { closeModal?: () => void }) {
  const buckets = getHourlyBuckets();
  const summary = getSummary();
  const cdnStats = getCombinedCategoryStats([
    'fetch-cdn-index', 'fetch-cdn-year', 'fetch-cdn-votes', 'fetch-live-summary',
  ]);

  const totalLookups = summary.counters.cacheHits + summary.counters.cacheMisses;
  const hitPct = totalLookups > 0
    ? ((summary.counters.cacheHits / totalLookups) * 100).toFixed(1)
    : 'n/a';
  const uptimeMin = Math.floor(summary.uptimeMs / 60000);

  const SP = findSP();
  const modalH = SP.innerHeight - 60;

  return (
    <Focusable
      onCancelButton={closeModal}
      style={{
        margin: 30,
        height: modalH,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgba(37, 40, 46, 0.97)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e0ebf3', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Cache Performance <span style={{ color: '#3d556a', fontWeight: 400 }}>· uptime {uptimeMin}m</span>
        </span>
        <DialogButton
          onClick={closeModal}
          style={{ fontSize: 10, padding: '2px 10px', minWidth: 0, height: 24, whiteSpace: 'nowrap' }}
        >
          Close
        </DialogButton>
      </div>

      {/* scrollable body */}
      <Focusable style={{ overflowY: 'scroll', flex: 1, padding: '4px 16px' }}>

        {/* hit rate */}
        <SectionLabel>Cache hit rate (% per hour)</SectionLabel>
        <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '6px 8px' }}>
          <LineChart
            buckets={buckets}
            getValue={(b) => {
              const total = b.hits + b.misses;
              return total > 0 ? Math.round((b.hits / total) * 100) : 0;
            }}
            color="#4caf7d"
            unit="%"
            maxValue={100}
          />
        </div>

        {/* CDN latency */}
        <SectionLabel>CDN avg latency (ms per hour)</SectionLabel>
        <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '6px 8px' }}>
          <LineChart
            buckets={buckets.filter(b => b.fetchCount > 0)}
            getValue={(b) => b.fetchCount > 0 ? Math.round(b.totalFetchMs / b.fetchCount) : 0}
            color="#5ec8f4"
            unit="ms"
          />
        </div>

        {/* fetch volume */}
        <SectionLabel>Fetch volume (requests per hour)</SectionLabel>
        <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '6px 8px' }}>
          <LineChart
            buckets={buckets}
            getValue={(b) => b.fetches}
            color="#f6b347"
          />
        </div>

        {/* session counters */}
        <SectionLabel>Session totals</SectionLabel>
        <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '6px 10px' }}>
          <StatRow label="Hit rate" value={`${hitPct}%`} highlight={Number(hitPct) >= 70 ? '#4caf7d' : Number(hitPct) >= 40 ? '#f6b347' : undefined} />
          <StatRow label="Cache hits" value={summary.counters.cacheHits} />
          <StatRow label="Cache misses" value={summary.counters.cacheMisses} />
          <StatRow label="Total fetches" value={summary.counters.totalFetches} />
          <StatRow label="Fetch errors" value={summary.counters.fetchErrors} highlight={summary.counters.fetchErrors > 0 ? '#f44336' : undefined} />
          <StatRow label="No CDN data (404)" value={summary.counters.noDataGames} />
          <StatRow label="Prefetched games" value={summary.counters.prefetchedGames} />
          <StatRow label="Cache evictions" value={summary.counters.cacheEvictions} />
        </div>

        {/* CDN timing */}
        {cdnStats && (
          <>
            <SectionLabel>CDN fetch timing (all-time)</SectionLabel>
            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '6px 10px' }}>
              <StatRow label="Requests" value={cdnStats.count} />
              <StatRow label="Avg" value={`${cdnStats.avgMs}ms`} />
              <StatRow label="p95" value={`${cdnStats.p95Ms}ms`} />
              <StatRow label="Max" value={`${cdnStats.maxMs}ms`} />
              <StatRow label="Errors" value={cdnStats.errorCount} />
            </div>
          </>
        )}

        <div style={{ height: 8 }} />
      </Focusable>
    </Focusable>
  );
}
