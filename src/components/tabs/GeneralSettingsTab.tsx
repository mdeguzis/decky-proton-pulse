// src/components/tabs/GeneralSettingsTab.tsx
import { DropdownItem, Focusable, GamepadButton, ToggleField, SliderField, DialogButton, showModal } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { callable } from '@decky/api';
import { useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '../../lib/settings';
import { NOTIFICATIONS_ENABLED_KEY } from '../../lib/notify';
import { logFrontendEvent, callWithTimeout } from '../../lib/logger';
import { t, setLanguage, useLanguage, LANGUAGES, LANGUAGE_NAMES, detectLanguage, type Language } from '../../lib/i18n';
import { getCacheTtlMs, setCacheTtlHours, getCacheStats } from '../../lib/cache';
import { getSummary, getPrefetchFailureSummary } from '../../lib/metrics';
import { CacheManagerModalContent } from '../CacheManagerModal';

const setLogLevel = callable<[level: string], boolean>('set_log_level');
const setLogLevelSafe = (level: string) =>
  callWithTimeout(() => setLogLevel(level), 'set_log_level', 5000);

function sectionStyle(): React.CSSProperties {
  return {
    margin: '0',
    padding: '16px 0 18px',
    borderRadius: 0,
    background: 'transparent',
    border: 0,
    borderTop: '1px solid rgba(255,255,255,0.07)',
    boxShadow: 'none',
    overflow: 'hidden',
  };
}

function focusClipRowStyle(): React.CSSProperties {
  return {
    borderRadius: 10,
    overflow: 'hidden',
    margin: '0 8px',
  };
}

function scrollNearestScrollableAncestor(node: HTMLDivElement | null): void {
  let current = node?.parentElement ?? null;
  while (current) {
    const canScroll = current.scrollHeight > current.clientHeight;
    const overflowY = globalThis.getComputedStyle?.(current).overflowY ?? '';
    if (canScroll && (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')) {
      current.scrollTop = current.scrollHeight;
      return;
    }
    current = current.parentElement;
  }
}

const ADVANCED_SETTINGS_KEY = 'advanced-settings-enabled';

function formatCacheTtl(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`;
}

function stripUnitHint(label: string): string {
  return label.replace(/[\s\u3000]*[(（][^)）]+[)）]\s*$/u, '').trim();
}

function formatPrefetchReason(reason: string): string {
  switch (reason) {
    case 'index-miss':
      return 'CDN misses';
    case 'index-empty':
      return 'empty CDN entries';
    default:
      if (reason.startsWith('status-')) return `HTTP ${reason.slice(7)}`;
      return reason.replace(/-/g, ' ');
  }
}

// compact metrics info box for the advanced settings area
function MetricsInfoBox() {
  const extras = t().extras!;
  const [stats, setStats] = useState<ReturnType<typeof getSummary> | null>(null);
  const cacheStats = getCacheStats();

  useEffect(() => {
    setStats(getSummary());
  }, []);

  const refresh = () => setStats(getSummary());

  if (!stats) return null;

  const { counters, categories } = stats;
  const prefetchFailures = getPrefetchFailureSummary();
  const upMin = Math.floor(stats.uptimeMs / 60000);

  // pull avg fetch time from cdn-index category if available
  const cdnIdx = categories['fetch-cdn-index'];
  const prefetchCat = categories['prefetch-game'];
  const hitTotal = counters.cacheHits + counters.cacheMisses;
  const hitRate = hitTotal > 0
    ? ((counters.cacheHits / hitTotal) * 100).toFixed(1) + '%'
    : extras.notAvailable();
  const topPrefetchFailure = Object.entries(prefetchFailures.byReason)
    .sort((a, b) => b[1] - a[1])[0] ?? null;

  const infoStyle: React.CSSProperties = {
    background: '#0d1b2a',
    border: '1px solid #1b2f44',
    borderRadius: 8,
    padding: '10px 14px',
    margin: '4px 8px 0',
    fontSize: 11,
    color: '#a0bdd0',
    lineHeight: '1.6',
    fontFamily: 'monospace',
  };

  const labelStyle: React.CSSProperties = {
    color: '#5dade2',
    display: 'inline-block',
    width: 130,
  };

  return (
    <div style={infoStyle}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#e8f4ff', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{extras.performance()}</span>
        <Focusable
          onClick={refresh}
          onOKButton={refresh}
          style={{ cursor: 'pointer', fontSize: 11, color: '#5dade2', padding: '2px 6px' }}
        >
          {t().compatTools.refresh}
        </Focusable>
      </div>
      <div><span style={labelStyle}>{extras.uptime()}</span>{upMin}m</div>
      <div><span style={labelStyle}>{extras.cacheHitRate()}</span>{hitRate} ({extras.hitsAndMisses(counters.cacheHits, counters.cacheMisses)})</div>
      <div><span style={labelStyle}>{extras.cachedGames()}</span>{cacheStats.size} / {cacheStats.maxSize}</div>
      <div><span style={labelStyle}>{extras.prefetched()}</span>{counters.prefetchedGames} games</div>
      <div><span style={labelStyle}>{extras.totalFetches()}</span>{counters.totalFetches}{counters.fetchErrors > 0 ? extras.errorsSuffix(counters.fetchErrors) : ''}</div>
      <div><span style={labelStyle}>Local games</span>{counters.localNonSteamGames} skipped</div>
      {prefetchFailures.total > 0 && (
        <div>
          <span style={labelStyle}>Fetch issues</span>
          {topPrefetchFailure ? `${prefetchFailures.total} prefetch failures, mostly ${formatPrefetchReason(topPrefetchFailure[0])} (${topPrefetchFailure[1]})` : `${prefetchFailures.total} prefetch failures`}
        </div>
      )}
      {cdnIdx && (
        <div><span style={labelStyle}>{extras.cdnFetchAvg()}</span>{cdnIdx.avgMs}ms (p95: {cdnIdx.p95Ms}ms, max: {cdnIdx.maxMs}ms)</div>
      )}
      {prefetchCat && (
        <div><span style={labelStyle}>{extras.prefetchAvg()}</span>{prefetchCat.avgMs}ms (p95: {prefetchCat.p95Ms}ms)</div>
      )}
      {counters.cacheEvictions > 0 && (
        <div><span style={labelStyle}>{extras.evictions()}</span>{counters.cacheEvictions}</div>
      )}
    </div>
  );
}

export function GeneralSettingsTab() {
  const extras = t().extras!;
  const cacheStats = getCacheStats();
  const [debugEnabled, setDebugEnabled] = useState(() => getSetting('debugEnabled', false));
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => getSetting(NOTIFICATIONS_ENABLED_KEY, true));
  const [advancedEnabled, setAdvancedEnabled] = useState(() => getSetting(ADVANCED_SETTINGS_KEY, false));
  const [cacheTtlHours, setCacheTtlLocal] = useState(() => Math.round(getCacheTtlMs() / 3600000));
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void setLogLevelSafe(debugEnabled ? 'DEBUG' : 'INFO').catch((error) => {
      void logFrontendEvent('ERROR', 'Backend: set_log_level failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [debugEnabled]);

  const handleDebugToggle = async (enabled: boolean) => {
    void logFrontendEvent('INFO', 'Debug logging toggle changed', {
      previousValue: debugEnabled,
      nextValue: enabled,
    });
    setDebugEnabled(enabled);
    setSetting('debugEnabled', enabled);
  };

  useLanguage(); // subscribes to re-render on language change
  const currentPref = getSetting<Language | 'auto'>('language', 'auto');
  const detectedName = LANGUAGE_NAMES[detectLanguage()];
  const langOptions = [
    { data: 'auto' as const, label: t().settings.autoDetected(detectedName) },
    ...LANGUAGES.map((code) => ({ data: code, label: LANGUAGE_NAMES[code] })),
  ];

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  return (
    <Focusable onGamepadDirection={handleRootDirection}>
      <div style={sectionStyle()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff', marginBottom: 8 }}>
          {t().settings.general}
        </div>
        <div style={focusClipRowStyle()}>
          <DropdownItem
            label={t().settings.language}
            rgOptions={langOptions}
            selectedOption={currentPref}
            onChange={(opt) => setLanguage(opt.data)}
          />
        </div>
        <div style={focusClipRowStyle()}>
          <ToggleField
            label={t().settings.debugLogs}
            description={t().settings.debugLogsDescription}
            checked={debugEnabled}
            onChange={handleDebugToggle}
          />
        </div>
        <div style={focusClipRowStyle()}>
          <ToggleField
            label={t().settings.notifications}
            description={t().settings.notificationsDescription}
            checked={notificationsEnabled}
            onChange={(enabled) => {
              setNotificationsEnabled(enabled);
              setSetting(NOTIFICATIONS_ENABLED_KEY, enabled);
            }}
          />
        </div>
      </div>

      {/* advanced settings toggle */}
      <div style={sectionStyle()}>
        <div style={focusClipRowStyle()}>
          <ToggleField
            label={extras.advancedSettings()}
            description={extras.advancedSettingsDescription()}
            checked={advancedEnabled}
            onChange={(enabled) => {
              setAdvancedEnabled(enabled);
              setSetting(ADVANCED_SETTINGS_KEY, enabled);
              void logFrontendEvent('INFO', 'Advanced settings toggled', { enabled });
            }}
          />
        </div>
      </div>

      {/* advanced section: cache management */}
      {advancedEnabled && (
        <div style={sectionStyle()}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff', marginBottom: 8 }}>
            {extras.cacheSection()}
          </div>
          <div style={focusClipRowStyle()}>
            <SliderField
              label={stripUnitHint(extras.cacheTtlHours())}
              description={`Data re-fetched after ${formatCacheTtl(cacheTtlHours)}`}
              value={cacheTtlHours}
              min={1}
              max={720}
              step={1}
              showValue={false}
              onChange={(val) => {
                setCacheTtlLocal(val);
                setCacheTtlHours(val);
              }}
            />
          </div>
          <div style={{ ...focusClipRowStyle(), paddingTop: 8 }}>
            <DialogButton
              onClick={() => {
                showModal(<CacheManagerModalContent />);
              }}
              style={{ padding: '8px 16px' }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {extras.manageCache()}
              </div>
              <div style={{ fontSize: 11, color: '#7a9bb5' }}>
                {extras.manageCacheDescription()}
              </div>
              {cacheStats.networkFetchAvgMs !== null && (
                <div style={{ fontSize: 10, color: '#5dade2', marginTop: 4 }}>
                  {extras.cdnFetchAvg()}: {cacheStats.networkFetchAvgMs}ms
                  {cacheStats.networkFetchP95Ms !== null ? ` (p95: ${cacheStats.networkFetchP95Ms}ms)` : ''}
                </div>
              )}
            </DialogButton>
          </div>
        </div>
      )}

      {/* advanced section: performance metrics */}
      {advancedEnabled && (
        <div style={sectionStyle()}>
          <MetricsInfoBox />
        </div>
      )}

      {advancedEnabled && (
        <div style={{ padding: '0 8px 20px' }}>
          <DialogButton
            ref={bottomAnchorRef}
            onGamepadFocus={() => {
              scrollNearestScrollableAncestor(bottomAnchorRef.current);
            }}
            onClick={() => {
              scrollNearestScrollableAncestor(bottomAnchorRef.current);
            }}
            style={{
              minHeight: 28,
              borderRadius: 8,
              border: '1px solid transparent',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'transparent',
              boxShadow: 'none',
              padding: 0,
            }}
          >
            {'\u200B'}
          </DialogButton>
        </div>
      )}
    </Focusable>
  );
}
