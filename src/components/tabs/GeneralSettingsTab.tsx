// src/components/tabs/GeneralSettingsTab.tsx
import { DropdownItem, Focusable, GamepadButton, ToggleField, SliderField, DialogButton, showModal } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { callable } from '@decky/api';
import { useEffect, useState } from 'react';
import { getSetting, setSetting } from '../../lib/settings';
import { logFrontendEvent, callWithTimeout } from '../../lib/logger';
import { t, setLanguage, useLanguage, LANGUAGES, LANGUAGE_NAMES, detectLanguage, type Language } from '../../lib/i18n';
import { getCacheTtlMs, setCacheTtlHours, getCacheStats } from '../../lib/cache';
import { getSummary, flushMetricsToDisk } from '../../lib/metrics';
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

const ADVANCED_SETTINGS_KEY = 'advanced-settings-enabled';

// compact metrics info box for the advanced settings area
function MetricsInfoBox() {
  const [stats, setStats] = useState<ReturnType<typeof getSummary> | null>(null);
  const cacheStats = getCacheStats();

  useEffect(() => {
    setStats(getSummary());
  }, []);

  const refresh = () => setStats(getSummary());

  if (!stats) return null;

  const { counters, categories } = stats;
  const upMin = Math.floor(stats.uptimeMs / 60000);

  // pull avg fetch time from cdn-index category if available
  const cdnIdx = categories['fetch-cdn-index'];
  const prefetchCat = categories['prefetch-game'];
  const hitTotal = counters.cacheHits + counters.cacheMisses;
  const hitRate = hitTotal > 0
    ? ((counters.cacheHits / hitTotal) * 100).toFixed(1) + '%'
    : 'n/a';

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
        <span>Performance</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Focusable
            onClick={refresh}
            onOKButton={refresh}
            style={{ cursor: 'pointer', fontSize: 11, color: '#5dade2', padding: '2px 6px' }}
          >
            Refresh
          </Focusable>
          <Focusable
            onClick={() => void flushMetricsToDisk()}
            onOKButton={() => void flushMetricsToDisk()}
            style={{ cursor: 'pointer', fontSize: 11, color: '#7a9bb5', padding: '2px 6px' }}
          >
            Export
          </Focusable>
        </div>
      </div>
      <div><span style={labelStyle}>Uptime</span>{upMin}m</div>
      <div><span style={labelStyle}>Cache hit rate</span>{hitRate} ({counters.cacheHits} hits / {counters.cacheMisses} misses)</div>
      <div><span style={labelStyle}>Cached games</span>{cacheStats.size} / {cacheStats.maxSize}</div>
      <div><span style={labelStyle}>Prefetched</span>{counters.prefetchedGames} games</div>
      <div><span style={labelStyle}>Total fetches</span>{counters.totalFetches}{counters.fetchErrors > 0 ? ` (${counters.fetchErrors} errors)` : ''}</div>
      {cdnIdx && (
        <div><span style={labelStyle}>CDN fetch avg</span>{cdnIdx.avgMs}ms (p95: {cdnIdx.p95Ms}ms, max: {cdnIdx.maxMs}ms)</div>
      )}
      {prefetchCat && (
        <div><span style={labelStyle}>Prefetch avg</span>{prefetchCat.avgMs}ms (p95: {prefetchCat.p95Ms}ms)</div>
      )}
      {counters.cacheEvictions > 0 && (
        <div><span style={labelStyle}>Evictions</span>{counters.cacheEvictions}</div>
      )}
    </div>
  );
}

export function GeneralSettingsTab() {
  const [debugEnabled, setDebugEnabled] = useState(() => getSetting('debugEnabled', false));
  const [ghToken, setGhToken] = useState(() => getSetting<string>('gh-votes-token', ''));
  const [advancedEnabled, setAdvancedEnabled] = useState(() => getSetting(ADVANCED_SETTINGS_KEY, false));
  const [cacheTtlHours, setCacheTtlLocal] = useState(() => Math.round(getCacheTtlMs() / 3600000));

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

  const handleTokenChange = (value: string) => {
    void logFrontendEvent('DEBUG', 'GitHub token field updated', {
      hasToken: value.trim().length > 0,
      length: value.length,
    });
    setGhToken(value);
    setSetting('gh-votes-token', value);
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
          <div style={{ padding: '8px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#e8f4ff', marginBottom: 2 }}>
              {t().settings.ghToken}
            </div>
            <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 6 }}>
              {t().settings.ghTokenDescription}
            </div>
            <input
              type="password"
              value={ghToken}
              onChange={(e) => handleTokenChange(e.target.value)}
              placeholder="ghp_..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#1a2a3a',
                border: '1px solid #2a3a4a',
                borderRadius: 6,
                color: '#e8f4ff',
                fontSize: 12,
                padding: '6px 10px',
              }}
            />
          </div>
        </div>
      </div>

      {/* advanced settings toggle */}
      <div style={sectionStyle()}>
        <div style={focusClipRowStyle()}>
          <ToggleField
            label="Advanced Settings"
            description="Show cache management and developer tools"
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
            Cache
          </div>
          <div style={focusClipRowStyle()}>
            <SliderField
              label="Cache TTL (hours)"
              description={`Data re-fetched after ${cacheTtlHours}h`}
              value={cacheTtlHours}
              min={1}
              max={168}
              step={1}
              showValue
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
                Manage Cache...
              </div>
              <div style={{ fontSize: 11, color: '#7a9bb5' }}>
                View, refresh, or delete cached game data
              </div>
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
    </Focusable>
  );
}
