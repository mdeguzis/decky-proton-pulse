// src/components/tabs/GeneralSettingsTab.tsx
import { DropdownItem, Focusable, GamepadButton, ToggleField, SliderField, DialogButton, ConfirmModal, showModal, Navigation } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { callable, openFilePicker, FileSelectionType } from '@decky/api';
import { useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '../../lib/settings';
import { NOTIFICATIONS_ENABLED_KEY, toaster } from '../../lib/notify';
import { logFrontendEvent, callWithTimeout } from '../../lib/logger';
import { t, setLanguage, useLanguage, LANGUAGES, LANGUAGE_NAMES, detectLanguage, type Language } from '../../lib/i18n';
import { registerScreenshotAutomationHandler } from '../../lib/screenshotAutomation';
import { getCacheTtlMs, setCacheTtlHours, getCacheStats, getCachedAppIds } from '../../lib/cache';
import { getSummary, getPrefetchFailureSummary } from '../../lib/metrics';
import { CacheManagerModalContent } from '../CacheManagerModal';
import { MyHardwareModal } from '../MyHardwareModal';
import { uploadSystem } from '../../lib/userSystems';
import { exportLocalDataBackup, importLocalDataBackup } from '../../lib/localDataBackup';
import {
  isAutoSyncEnabled,
  setAutoSyncEnabled,
  isPluginSettingsAutoSyncEnabled,
  setPluginSettingsAutoSyncEnabled,
} from '../../lib/cloudSync';
import { getVoterId } from '../../lib/voting';
import { fetchPluginLinkStatus, getInstallationId, startPluginLink, unlinkPluginLink, type PluginLinkStatus } from '../../lib/protonPulseAccount';
import { buildPluginLinkProfileUrl } from '../../lib/protonPulseLinkUrl';

const setLogLevel = callable<[level: string], boolean>('set_log_level');
const getInstalledGameStatsCallable = callable<[], {
  installed_steam_games: number;
  installed_steam_app_ids: string[];
}>('get_installed_game_stats');
const getProtonDBSystemInfoCall = callable<[], string>('get_protondb_systeminfo');
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

function compactActionRowStyle(): React.CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    margin: '0 8px',
    flexWrap: 'wrap',
  };
}

function compactActionCellStyle(): React.CSSProperties {
  return {
    flex: '1 1 0',
    minWidth: 0,
  };
}

function compactDialogButtonStyle(): React.CSSProperties {
  return {
    width: '100%',
    minHeight: 52,
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
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
const EXPERIMENTAL_GAME_PAGE_SHORTCUT_KEY = 'experimental-game-page-shortcut-enabled';

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
  const [backendInstalledStats, setBackendInstalledStats] = useState<{
    installedSteamGames: number;
    installedSteamAppIds: string[];
  }>({ installedSteamGames: 0, installedSteamAppIds: [] });
  const cacheStats = getCacheStats();

  useEffect(() => {
    setStats(getSummary());
    void getInstalledGameStatsCallable()
      .then((result) => {
        setBackendInstalledStats({
          installedSteamGames: Math.max(0, result.installed_steam_games ?? 0),
          installedSteamAppIds: Array.isArray(result.installed_steam_app_ids)
            ? result.installed_steam_app_ids.map(String)
            : [],
        });
      })
      .catch((error) => {
        void logFrontendEvent('WARNING', 'Failed to fetch backend installed game stats', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);

  const refresh = () => {
    setStats(getSummary());
    void getInstalledGameStatsCallable()
      .then((result) => {
        setBackendInstalledStats({
          installedSteamGames: Math.max(0, result.installed_steam_games ?? 0),
          installedSteamAppIds: Array.isArray(result.installed_steam_app_ids)
            ? result.installed_steam_app_ids.map(String)
            : [],
        });
      })
      .catch((error) => {
        void logFrontendEvent('WARNING', 'Failed to refresh backend installed game stats', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

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
  const cachedAppIds = getCachedAppIds();
  const cachedInstalledGames = backendInstalledStats.installedSteamAppIds.filter((appId) => cachedAppIds.has(appId)).length;
  const installedRemaining = Math.max(backendInstalledStats.installedSteamGames - cachedInstalledGames, 0);
  const installedCoverage = backendInstalledStats.installedSteamGames > 0
    ? `${((cachedInstalledGames / backendInstalledStats.installedSteamGames) * 100).toFixed(1)}%`
    : extras.notAvailable();
  const prefetchStatus =
    backendInstalledStats.installedSteamGames <= 0
      ? extras.notAvailable()
      : installedRemaining > 0
        ? extras.prefetchStatusWarming(
            cachedInstalledGames,
            backendInstalledStats.installedSteamGames,
            installedRemaining,
          )
        : prefetchFailures.total > 0
          ? extras.prefetchStatusCompleteWithMisses(
              cachedInstalledGames,
              backendInstalledStats.installedSteamGames,
              prefetchFailures.total,
            )
          : extras.prefetchStatusComplete(
              cachedInstalledGames,
              backendInstalledStats.installedSteamGames,
            );

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
      <div><span style={labelStyle}>{extras.installedCoverage()}</span>{installedCoverage} ({cachedInstalledGames} / {backendInstalledStats.installedSteamGames})</div>
      <div><span style={labelStyle}>{extras.prefetchStatus()}</span>{prefetchStatus}</div>
      <div><span style={labelStyle}>{extras.prefetched()}</span>{extras.gamesCount(counters.prefetchedGames)}</div>
      <div><span style={labelStyle}>{extras.totalFetches()}</span>{counters.totalFetches}{counters.fetchErrors > 0 ? extras.errorsSuffix(counters.fetchErrors) : ''}</div>
      <div><span style={labelStyle}>{extras.localGames()}</span>{extras.skippedCount(counters.localNonSteamGames)}</div>
      {prefetchFailures.total > 0 && (
        <div>
          <span style={labelStyle}>{extras.fetchIssues()}</span>
          {extras.prefetchFailuresSummary(
            prefetchFailures.total,
            topPrefetchFailure ? formatPrefetchReason(topPrefetchFailure[0]) : undefined,
            topPrefetchFailure?.[1],
          )}
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
  const [cloudAutoSync, setCloudAutoSync] = useState(() => isAutoSyncEnabled());
  const [cloudPluginSettingsAutoSync, setCloudPluginSettingsAutoSync] = useState(
    () => isPluginSettingsAutoSyncEnabled(),
  );
  const [advancedEnabled, setAdvancedEnabled] = useState(() => getSetting(ADVANCED_SETTINGS_KEY, false));
  const [experimentalGamePageShortcutEnabled, setExperimentalGamePageShortcutEnabled] = useState(
    () => getSetting(EXPERIMENTAL_GAME_PAGE_SHORTCUT_KEY, false),
  );
  const [badgeEnabled, setBadgeEnabled] = useState(() => getSetting('showGamePageBadge', true));
  const [cacheTtlHours, setCacheTtlLocal] = useState(() => Math.round(getCacheTtlMs() / 3600000));
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const languageRowRef = useRef<HTMLDivElement>(null);
  const localDataSectionRef = useRef<HTMLDivElement>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatusMessage, setBackupStatusMessage] = useState('');
  const [backupStatusTone, setBackupStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [anonymousClientId, setAnonymousClientId] = useState<string | null>(null);
  const [pluginLinkStatus, setPluginLinkStatus] = useState<PluginLinkStatus | null>(null);
  const [pluginLinkBusy, setPluginLinkBusy] = useState(false);

  useEffect(() => {
    void setLogLevelSafe(debugEnabled ? 'DEBUG' : 'INFO').catch((error) => {
      void logFrontendEvent('ERROR', 'Backend: set_log_level failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [debugEnabled]);

  useEffect(() => {
    void getVoterId()
      .then((value) => setAnonymousClientId(value))
      .catch((error) => {
        void logFrontendEvent('WARNING', 'Failed to resolve anonymous client id', {
          error: error instanceof Error ? error.message : String(error),
        });
        setAnonymousClientId(null);
      });
  }, []);

  useEffect(() => {
    void fetchPluginLinkStatus()
      .then(setPluginLinkStatus)
      .catch((error) => {
        void logFrontendEvent('WARNING', 'Failed to fetch Proton Pulse link status', {
          error: error instanceof Error ? error.message : String(error),
        });
        setPluginLinkStatus(null);
      });
  }, []);

  useEffect(() => {
    if (pluginLinkStatus?.linked || !pluginLinkStatus?.linkCode) return;
    const timer = window.setInterval(() => {
      void fetchPluginLinkStatus()
        .then(setPluginLinkStatus)
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pluginLinkStatus?.linked, pluginLinkStatus?.linkCode]);

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

  useEffect(() => registerScreenshotAutomationHandler('settings/cache-manager-modal', async () => {
    if (!advancedEnabled) {
      setAdvancedEnabled(true);
      setSetting(ADVANCED_SETTINGS_KEY, true);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    showModal(<CacheManagerModalContent />);
  }), [advancedEnabled]);

  useEffect(() => registerScreenshotAutomationHandler('settings/language-selector', async () => {
    const row = languageRowRef.current;
    const button = row?.querySelector<HTMLElement>('button,[role="button"]');
    button?.click();
  }), []);

  useEffect(() => registerScreenshotAutomationHandler('settings/local-data', async () => {
    localDataSectionRef.current?.scrollIntoView({ block: 'center' });
  }), []);

  const handleExportLocalData = async () => {
    setBackupBusy(true);
    try {
      const result = await exportLocalDataBackup();
      if (result.success && result.path) {
        setBackupStatusTone('success');
        setBackupStatusMessage(extras.backupExported(result.path));
      } else {
        setBackupStatusTone('error');
        setBackupStatusMessage(result.message);
      }
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportLocalData = async () => {
    setBackupBusy(true);
    try {
      const picked = await openFilePicker(
        FileSelectionType.FILE,
        '/home/deck/Downloads',
        true,
        false,
        undefined,
        ['zip'],
        false,
        true,
        1,
      );
      const archivePath = picked?.realpath || picked?.path;
      if (!archivePath) return;
      const modal = showModal(
        <ConfirmModal
          strTitle={extras.importLocalDataConfirmTitle()}
          strDescription={extras.importLocalDataConfirmDescription(archivePath)}
          strOKButtonText={extras.importLocalData()}
          strCancelButtonText={t().common.cancel}
          onOK={() => {
            void (async () => {
              const result = await importLocalDataBackup(archivePath);
              if (result.success) {
                setBackupStatusTone('success');
                setBackupStatusMessage(extras.backupImported(result.restoredCount ?? 0));
              } else {
                setBackupStatusTone('error');
                setBackupStatusMessage(result.message);
              }
              modal?.Close();
              if (result.success) {
                window.setTimeout(() => globalThis.location?.reload(), 500);
              }
            })();
          }}
          onCancel={() => modal?.Close()}
        />,
      );
    } catch (error) {
      void logFrontendEvent('WARNING', 'Local data backup picker failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      setBackupStatusTone('error');
      setBackupStatusMessage(extras.backupPickerFailed());
    } finally {
      setBackupBusy(false);
    }
  };

  const handleCopyAnonymousClientId = async () => {
    if (!anonymousClientId) return;
    try {
      void logFrontendEvent('DEBUG', 'Attempting to copy anonymous client ID', {
        idLength: anonymousClientId.length,
      });
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(anonymousClientId);
          void logFrontendEvent('INFO', 'Copied anonymous client ID with navigator.clipboard.writeText', {
            idLength: anonymousClientId.length,
          });
          toaster.toast({ title: 'Proton Pulse', body: extras.anonymousClientIdCopied() });
          return;
        } catch (error) {
          void logFrontendEvent('WARNING', 'navigator.clipboard.writeText failed for anonymous client ID', {
            error: error instanceof Error ? error.message : String(error),
            idLength: anonymousClientId.length,
          });
        }
      }

      const textarea = document.createElement('textarea');
      textarea.value = anonymousClientId;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      try {
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand('copy');
        if (!copied) {
          throw new Error('document.execCommand returned false');
        }
        void logFrontendEvent('INFO', 'Copied anonymous client ID with document.execCommand fallback', {
          idLength: anonymousClientId.length,
        });
      } finally {
        document.body.removeChild(textarea);
      }
      toaster.toast({ title: 'Proton Pulse', body: extras.anonymousClientIdCopied() });
    } catch (error) {
      void logFrontendEvent('ERROR', 'Failed to copy anonymous client ID', {
        error: error instanceof Error ? error.message : String(error),
        idLength: anonymousClientId.length,
      });
      toaster.toast({ title: 'Proton Pulse', body: extras.anonymousClientIdCopyFailed() });
    }
  };

  const handleGeneratePluginLinkCode = async () => {
    setPluginLinkBusy(true);
    try {
      const status = await startPluginLink();
      setPluginLinkStatus(status);
      if (status.linked) {
        toaster.toast({ title: 'Proton Pulse', body: extras.protonPulseAccountLinked() });
      } else if (status.linkCode) {
        toaster.toast({ title: 'Proton Pulse', body: extras.protonPulseLinkCodeReady(status.linkCode) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void logFrontendEvent('ERROR', 'Failed to start Proton Pulse link flow', { error: message });
      toaster.toast({ title: 'Proton Pulse', body: extras.protonPulseLinkFailed(message) });
    } finally {
      setPluginLinkBusy(false);
    }
  };

  const handleOpenProfileForLinking = async () => {
    if (pluginLinkStatus?.linked) {
      toaster.toast({ title: 'Proton Pulse', body: extras.protonPulseAlreadyLinked() });
      return;
    }
    let code = pluginLinkStatus?.linkCode ?? null;
    try {
      if (!pluginLinkStatus?.linked && !code) {
        const status = await startPluginLink();
        setPluginLinkStatus(status);
        code = status.linkCode;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toaster.toast({ title: 'Proton Pulse', body: extras.protonPulseLinkFailed(message) });
      return;
    }
    Navigation.NavigateToExternalWeb(buildPluginLinkProfileUrl(code));
    void logFrontendEvent('INFO', 'Opened Proton Pulse profile for plugin linking', {
      hasCode: !!code,
    });
  };

  const handleUnlinkPlugin = async () => {
    const modal = showModal(
      <ConfirmModal
        strTitle={extras.protonPulseUnlink()}
        strDescription={extras.protonPulseUnlinkConfirm()}
        strOKButtonText={extras.protonPulseUnlink()}
        strCancelButtonText={t().common.cancel}
        onOK={() => {
          void (async () => {
            setPluginLinkBusy(true);
            try {
              const status = await unlinkPluginLink();
              setPluginLinkStatus(status);
              toaster.toast({ title: 'Proton Pulse', body: extras.protonPulseUnlinked() });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              void logFrontendEvent('ERROR', 'Failed to unlink Proton Pulse account', { error: message });
              toaster.toast({ title: 'Proton Pulse', body: extras.protonPulseUnlinkFailed(message) });
            } finally {
              setPluginLinkBusy(false);
              modal?.Close();
            }
          })();
        }}
        onCancel={() => modal?.Close()}
      />,
    );
  };

  const linkStatusLine = pluginLinkStatus?.linked
    ? extras.protonPulseAccountLinked()
    : extras.protonPulseAccountNotLinked();
  const linkCodeLine = pluginLinkStatus?.linkCode
    ? extras.protonPulseLinkCodeReady(pluginLinkStatus.linkCode)
    : '';
  const linkExpiresLine = pluginLinkStatus?.linkCodeExpiresAt
    ? extras.protonPulseLinkCodeExpires(new Date(pluginLinkStatus.linkCodeExpiresAt).toLocaleTimeString())
    : '';

  return (
    <Focusable onGamepadDirection={handleRootDirection}>
      <div style={sectionStyle()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff', marginBottom: 8 }}>
          {t().settings.general}
        </div>
        <div ref={languageRowRef} style={focusClipRowStyle()}>
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
        <div style={focusClipRowStyle()}>
          <ToggleField
            label={t().settings.gamePageBadge}
            description={t().settings.gamePageBadgeDescription}
            checked={badgeEnabled}
            onChange={(enabled) => {
              setBadgeEnabled(enabled);
              setSetting('showGamePageBadge', enabled);
              void logFrontendEvent('INFO', 'Game page badge toggled', { enabled });
            }}
          />
        </div>
        <div style={focusClipRowStyle()}>
          <ToggleField
            label={t().configManager.cloudAutoSync}
            description={t().configManager.cloudAutoSyncDescription}
            checked={cloudAutoSync}
            onChange={(enabled) => {
              setCloudAutoSync(enabled);
              setAutoSyncEnabled(enabled);
              void logFrontendEvent('INFO', 'Cloud auto-sync toggled', { enabled });
            }}
          />
        </div>
         <div style={focusClipRowStyle()}>
           <ToggleField
             label={t().settings.cloudPluginSettingsAutoSync}
             description={t().settings.cloudPluginSettingsAutoSyncDescription}
             checked={cloudPluginSettingsAutoSync}
             onChange={(enabled) => {
               setCloudPluginSettingsAutoSync(enabled);
               setPluginSettingsAutoSyncEnabled(enabled);
               void logFrontendEvent('INFO', 'Cloud plugin settings auto-sync toggled', { enabled });
             }}
           />
         </div>
       </div>

      {/* My Hardware */}
      <div style={sectionStyle()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff', marginBottom: 4 }}>
          {extras.protonPulseAccountSection()}
        </div>
        <div style={{ fontSize: 11, color: '#7a9bb5', margin: '0 8px 10px' }}>
          {extras.protonPulseAccountSectionDescription()}
        </div>
        <div
          style={{
            margin: '0 8px 12px',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: '#eef7ff', marginBottom: 6 }}>
            {linkStatusLine}
          </div>
          <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 4, lineHeight: 1.4 }}>
            {extras.protonPulseInstallationId()}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#9dc4e8', wordBreak: 'break-all', marginBottom: 6 }}>
            {getInstallationId()}
          </div>
          {!!linkCodeLine && (
            <div style={{ fontSize: 11, color: '#eef7ff', marginBottom: 4 }}>
              {linkCodeLine}
            </div>
          )}
          {!!linkExpiresLine && (
            <div style={{ fontSize: 10, color: '#7a9bb5' }}>
              {linkExpiresLine}
            </div>
          )}
        </div>
        <div style={compactActionRowStyle()}>
          <div style={compactActionCellStyle()}>
            <DialogButton
              onClick={() => void handleGeneratePluginLinkCode()}
              disabled={pluginLinkBusy}
              style={compactDialogButtonStyle()}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{extras.protonPulseGenerateLinkCode()}</div>
            </DialogButton>
          </div>
          <div style={compactActionCellStyle()}>
            <DialogButton
              onClick={() => void handleOpenProfileForLinking()}
              disabled={pluginLinkBusy}
              style={compactDialogButtonStyle()}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{extras.protonPulseOpenLinkPage()}</div>
            </DialogButton>
          </div>
          <div style={compactActionCellStyle()}>
            <DialogButton
              onClick={() => void handleUnlinkPlugin()}
              disabled={pluginLinkBusy || !pluginLinkStatus?.linked}
              style={compactDialogButtonStyle()}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{extras.protonPulseUnlink()}</div>
            </DialogButton>
          </div>
        </div>
      </div>

      <div style={sectionStyle()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff', marginBottom: 4 }}>
          {extras.myHardwareSection()}
        </div>
        <div style={{ fontSize: 11, color: '#7a9bb5', margin: '0 8px 10px' }}>
          {extras.myHardwareSectionDescription()}
        </div>
        <div style={compactActionRowStyle()}>
          <div style={compactActionCellStyle()}>
            <DialogButton
              onClick={() => {
                showModal(<MyHardwareModal />);
              }}
              style={compactDialogButtonStyle()}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{extras.myHardwareView()}</div>
            </DialogButton>
          </div>
          <div style={compactActionCellStyle()}>
            <DialogButton
              onClick={async () => {
                void logFrontendEvent('INFO', 'My Hardware upload clicked');
                try {
                  const info = await getProtonDBSystemInfoCall();
                  void logFrontendEvent('DEBUG', 'My Hardware upload starting', {
                    infoBytes: info?.length ?? 0,
                  });
                  const result = await uploadSystem(info);
                  if (result.ok) {
                    void logFrontendEvent('INFO', 'My Hardware upload succeeded');
                    toaster.toast({ title: 'Proton Pulse', body: extras.myHardwareUploadSuccess() });
                  } else {
                    void logFrontendEvent('ERROR', 'My Hardware upload failed', { error: result.error });
                    toaster.toast({ title: 'Proton Pulse', body: extras.myHardwareUploadFailed(result.error) });
                  }
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  void logFrontendEvent('ERROR', 'My Hardware upload threw', { error: msg });
                  toaster.toast({ title: 'Proton Pulse', body: extras.myHardwareUploadFailed(msg) });
                }
              }}
              style={compactDialogButtonStyle()}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{extras.myHardwareUpload()}</div>
            </DialogButton>
          </div>
          <div style={compactActionCellStyle()}>
            <DialogButton
              onClick={() => {
                Navigation.NavigateToExternalWeb('https://www.proton-pulse.com/profile.html');
                void logFrontendEvent('INFO', 'Opened Pulse web profile from settings');
              }}
              style={compactDialogButtonStyle()}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{extras.myHardwareOpenProfile()}</div>
            </DialogButton>
          </div>
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
            {t().settings.experimental}
          </div>
          <div style={focusClipRowStyle()}>
            <ToggleField
              label={t().settings.experimentalGamePageShortcut}
              description={t().settings.experimentalGamePageShortcutDescription}
              checked={experimentalGamePageShortcutEnabled}
              onChange={(enabled) => {
                setExperimentalGamePageShortcutEnabled(enabled);
                setSetting(EXPERIMENTAL_GAME_PAGE_SHORTCUT_KEY, enabled);
                void logFrontendEvent('INFO', 'Experimental game page shortcut toggled', { enabled });
              }}
            />
          </div>
        </div>
      )}

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

      {advancedEnabled && (
        <div ref={localDataSectionRef} style={sectionStyle()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 4, marginRight: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff' }}>
              {extras.localDataSection()}
            </div>
            {backupStatusMessage && (
              <div
                style={{
                  fontSize: 10,
                  color:
                    backupStatusTone === 'success'
                      ? '#9dc4e8'
                      : backupStatusTone === 'error'
                        ? '#f3b3b3'
                        : '#7a9bb5',
                  textAlign: 'right',
                  maxWidth: 360,
                  lineHeight: 1.35,
                }}
              >
                {backupStatusMessage}
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#7a9bb5', margin: '0 8px 10px' }}>
            {extras.localDataSectionDescription()}
          </div>
          <div
            style={{
              margin: '0 8px 12px',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#eef7ff', minWidth: 0, flex: 1 }}>
                {extras.anonymousClientId()}
              </div>
              <div style={{ width: 76, flexShrink: 0, overflow: 'hidden', borderRadius: 8 }}>
                <DialogButton
                  onClick={() => void handleCopyAnonymousClientId()}
                  disabled={!anonymousClientId}
                  style={{
                    minWidth: 0,
                    width: '100%',
                    padding: '4px 8px',
                    fontSize: 10,
                    lineHeight: 1.1,
                  }}
                >
                  {extras.copyAnonymousClientId()}
                </DialogButton>
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 6, lineHeight: 1.4 }}>
              {extras.anonymousClientIdDescription()}
            </div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#9dc4e8', wordBreak: 'break-all' }}>
              {anonymousClientId ?? extras.anonymousClientIdLoading()}
            </div>
          </div>
          <div style={{ ...focusClipRowStyle(), paddingBottom: 8 }}>
            <DialogButton onClick={() => void handleExportLocalData()} disabled={backupBusy}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {extras.backupLocalData()}
              </div>
              <div style={{ fontSize: 11, color: '#7a9bb5' }}>
                {extras.backupLocalDataDescription()}
              </div>
            </DialogButton>
          </div>
          <div style={focusClipRowStyle()}>
            <DialogButton onClick={() => void handleImportLocalData()} disabled={backupBusy}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {extras.importLocalData()}
              </div>
              <div style={{ fontSize: 11, color: '#7a9bb5' }}>
                {extras.importLocalDataDescription()}
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
