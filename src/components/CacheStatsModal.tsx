// Cache performance stats modal.
// Shows 24h hourly charts for cache hit rate and fetch latency,
// plus a live counter summary. Opened from the Manage Cache modal.

import { Focusable, DialogButton } from '@decky/ui';
import { getHourlyBuckets, getSummary, getCombinedCategoryStats } from '../lib/metrics';
import type { HourlyBucket } from '../lib/metrics';

function formatHour(hourKey: number): string {
  const d = new Date(hourKey);
  const h = d.getHours();
  return `${h.toString().padStart(2, '0')}:00`;
}

// Simple bar chart. Each bucket is one vertical bar.
function BarChart({
  buckets,
  getValue,
  getLabel,
  color,
  maxValue,
  height = 60,
  suffix = '',
}: {
  buckets: HourlyBucket[];
  getValue: (b: HourlyBucket) => number;
  getLabel: (b: HourlyBucket) => string;
  color: string;
  maxValue?: number;
  height?: number;
  suffix?: string;
}) {
  if (buckets.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a6070', fontSize: 11 }}>
        No data yet this session
      </div>
    );
  }

  const values = buckets.map(getValue);
  const max = maxValue ?? Math.max(...values, 1);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, padding: '0 2px' }}>
      {buckets.map((b, i) => {
        const val = values[i];
        const pct = max > 0 ? val / max : 0;
        const barH = Math.max(pct * (height - 16), val > 0 ? 3 : 0);
        return (
          <div
            key={b.hourKey}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
            title={`${formatHour(b.hourKey)}: ${getLabel(b)}${suffix}`}
          >
            <div style={{ fontSize: 8, color: '#4a6070', lineHeight: 1, marginBottom: 1 }}>
              {val > 0 ? getLabel(b) : ''}
            </div>
            <div style={{
              width: '100%',
              height: barH,
              background: color,
              borderRadius: '2px 2px 0 0',
              opacity: val > 0 ? 1 : 0.2,
              minHeight: val > 0 ? 3 : 0,
            }} />
            <div style={{ fontSize: 7, color: '#3a5060', lineHeight: 1 }}>
              {formatHour(b.hourKey).split(':')[0]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      color: '#7a9bb5',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: 6,
      marginTop: 14,
    }}>
      {children}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#c8dcea', padding: '3px 0' }}>
      <span style={{ color: '#7a9bb5' }}>{label}</span>
      <span>{value}</span>
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

  return (
    <Focusable
      style={{
        margin: '30px',
        padding: '20px 24px',
        backgroundColor: 'rgba(37, 40, 46, 0.55)',
        borderRadius: 6,
        overflowY: 'scroll',
        maxHeight: 'calc(100vh - 80px)',
      }}
      onCancelButton={closeModal}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{
          fontSize: 13, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em', color: '#e0ebf3',
        }}>
          Cache Stats
        </div>
        <div style={{ fontSize: 10, color: '#4a6070' }}>
          Uptime: {uptimeMin}m
        </div>
      </div>

      {/* hit rate chart */}
      <SectionLabel>Cache hit rate (% per hour)</SectionLabel>
      <div style={{
        background: 'rgba(0,0,0,0.2)', borderRadius: 4, padding: '8px 8px 4px',
      }}>
        <BarChart
          buckets={buckets}
          getValue={(b) => {
            const total = b.hits + b.misses;
            return total > 0 ? Math.round((b.hits / total) * 100) : 0;
          }}
          getLabel={(b) => {
            const total = b.hits + b.misses;
            return total > 0 ? `${Math.round((b.hits / total) * 100)}%` : '0%';
          }}
          color="#4caf7d"
          maxValue={100}
          height={72}
          suffix="%"
        />
      </div>

      {/* fetch latency chart */}
      <SectionLabel>CDN fetch avg latency (ms per hour)</SectionLabel>
      <div style={{
        background: 'rgba(0,0,0,0.2)', borderRadius: 4, padding: '8px 8px 4px',
      }}>
        <BarChart
          buckets={buckets.filter(b => b.fetchCount > 0)}
          getValue={(b) => b.fetchCount > 0 ? Math.round(b.totalFetchMs / b.fetchCount) : 0}
          getLabel={(b) => b.fetchCount > 0 ? `${Math.round(b.totalFetchMs / b.fetchCount)}` : '0'}
          color="#5ec8f4"
          height={72}
          suffix="ms"
        />
      </div>

      {/* fetch volume chart */}
      <SectionLabel>Fetch volume (requests per hour)</SectionLabel>
      <div style={{
        background: 'rgba(0,0,0,0.2)', borderRadius: 4, padding: '8px 8px 4px',
      }}>
        <BarChart
          buckets={buckets}
          getValue={(b) => b.fetches}
          getLabel={(b) => `${b.fetches}`}
          color="#f6b347"
          height={64}
        />
      </div>

      {/* counter summary */}
      <SectionLabel>Session totals</SectionLabel>
      <div style={{
        background: 'rgba(0,0,0,0.2)', borderRadius: 4, padding: '8px 10px',
      }}>
        <StatRow label="Cache hits" value={summary.counters.cacheHits} />
        <StatRow label="Cache misses" value={summary.counters.cacheMisses} />
        <StatRow label="Hit rate" value={`${hitPct}%`} />
        <StatRow label="Total fetches" value={summary.counters.totalFetches} />
        <StatRow label="Fetch errors" value={summary.counters.fetchErrors} />
        <StatRow label="No CDN data (404)" value={summary.counters.noDataGames} />
        <StatRow label="Prefetched games" value={summary.counters.prefetchedGames} />
        <StatRow label="Cache evictions" value={summary.counters.cacheEvictions} />
      </div>

      {/* CDN timing summary */}
      {cdnStats && (
        <>
          <SectionLabel>CDN fetch timing (all-time)</SectionLabel>
          <div style={{
            background: 'rgba(0,0,0,0.2)', borderRadius: 4, padding: '8px 10px',
          }}>
            <StatRow label="Requests" value={cdnStats.count} />
            <StatRow label="Avg" value={`${cdnStats.avgMs}ms`} />
            <StatRow label="p95" value={`${cdnStats.p95Ms}ms`} />
            <StatRow label="Max" value={`${cdnStats.maxMs}ms`} />
            <StatRow label="Errors" value={cdnStats.errorCount} />
          </div>
        </>
      )}

      {/* close button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <DialogButton onClick={closeModal} style={{ minWidth: 120, fontSize: 12 }}>
          Close
        </DialogButton>
      </div>
    </Focusable>
  );
}
