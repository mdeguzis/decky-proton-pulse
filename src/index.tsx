// src/index.tsx
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Focusable,
  ToggleField,
  staticClasses,
  Router,
  Navigation,
  findInReactTree,
} from '@decky/ui';
import { useEffect, useState } from 'react';
import {
  definePlugin,
  routerHook,
  callable,
} from '@decky/api';

import { ProtonPulsePage } from './components/Modal';
import { BrandGlyph } from './components/BrandGlyph';
import { pageState, dispatchNavigate, rememberReturnPath } from './lib/pageState';
import type { PageId } from './lib/pageState';
import { LibraryContextMenu, patchGameContextMenu } from './patches/gameContextMenu';
import { setupGamePageBadge } from './patches/gamePageBadge';
import { setupSearchResultsHint, teardownSearchResultsHint } from './patches/searchResultsHint';
import { getSetting, setSetting } from './lib/settings';
import { NOTIFICATIONS_ENABLED_KEY } from './lib/notify';
import { logFrontendEvent, callWithTimeout } from './lib/logger';
import { TRANSLATIONS_LOADED } from './lib/translations';
import { useLanguage, t } from './lib/i18n';
import { installScreenshotAutomationBridge } from './lib/screenshotAutomation';
import { initCache } from './lib/cache';
import { runStartupPrefetch } from './lib/prefetch';
import { startAutoFlush, stopAutoFlush, flushMetricsToDisk } from './lib/metrics';
import { getProtonGeManagerState, installProtonGe } from './lib/compatTools';
import { startSessionTracking, stopSessionTracking } from './lib/playtime';
import {
  initCloudSync,
  teardownCloudSync,
  checkHasCloudBackup,
  onCloudConfigPushed,
} from './lib/cloudSync';
import { getTrackedConfigs } from './lib/trackedConfigs';
import { getShortcutName } from './lib/gameSource';
import { toaster } from './lib/notify';

const setLogLevel = callable<[level: string], boolean>('set_log_level');
const getPluginVersion = callable<[], string>('get_plugin_version');

// wrap backend calls so they timeout + log clearly when Python is dead
const setLogLevelSafe = (level: string) =>
  callWithTimeout(() => setLogLevel(level), 'set_log_level', 5000);
const getPluginVersionSafe = () =>
  callWithTimeout(() => getPluginVersion(), 'get_plugin_version', 5000);
function extractLibraryAppId(pathname: string): number | null {
  const match = pathname.match(/\/(?:routes\/)?library\/app\/(\d+)/);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// ─── Sidebar panel ────────────────────────────────────────────────────────────
function Content() {
  useLanguage(); // triggers re-render on language change
  const extras = t().extras!;
  const [version, setVersion] = useState('...');
  const [debugEnabled, setDebugEnabled] = useState(() => getSetting('debugEnabled', false));
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => getSetting(NOTIFICATIONS_ENABLED_KEY, true));

  useEffect(() => {
    void getPluginVersionSafe()
      .then(setVersion)
      .catch(() => setVersion(extras.backendOfflineVersion()));
  }, []);

  useEffect(() => {
    void setLogLevelSafe(debugEnabled ? 'DEBUG' : 'INFO').catch((error) => {
      void logFrontendEvent('ERROR', 'Backend: set_log_level failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [debugEnabled]);

  const navigateTo = (tab: PageId) => {
    void logFrontendEvent('INFO', 'Sidebar navigation requested', { tab });
    rememberReturnPath(globalThis.location?.pathname);
    const payload = { tab, appId: null, appName: '' };
    const pathname = globalThis.location?.pathname ?? '';
    const alreadyOpen = pathname.includes('/proton-pulse');
    if (alreadyOpen) {
      dispatchNavigate(payload);
      Router.CloseSideMenus();
      return;
    }

    Router.CloseSideMenus();
    try {
      Navigation.Navigate('/proton-pulse');
    } catch {
      Router.Navigate('/proton-pulse');
    }
    window.setTimeout(() => {
      dispatchNavigate(payload);
    }, 100);
    window.setTimeout(() => {
      dispatchNavigate(payload);
    }, 400);
  };

  return (
    <Focusable style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => navigateTo('manage')}
            description={t().sidebar.manageConfigurationsDesc}
          >
            {t().sidebar.manageConfigurations}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => navigateTo('compatibility-tools')}
            description={t().sidebar.compatibilityToolsDesc}
          >
            {t().sidebar.compatibilityTools}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => navigateTo('logs')}
            description={t().sidebar.viewLogsDesc}
          >
            {t().sidebar.viewLogs}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => navigateTo('settings')}
            description={t().sidebar.settingsDesc}
          >
            {t().sidebar.settings}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
      <PanelSection>
        <PanelSectionRow>
          <ToggleField
            label={t().sidebar.debugLogs}
            description={t().sidebar.debugLogsDesc}
            checked={debugEnabled}
            onChange={(enabled) => {
              void logFrontendEvent('INFO', 'Sidebar debug logging toggle changed', {
                previousValue: debugEnabled,
                nextValue: enabled,
              });
              setDebugEnabled(enabled);
              setSetting('debugEnabled', enabled);
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label={t().sidebar.notifications}
            description={t().sidebar.notificationsDesc}
            checked={notificationsEnabled}
            onChange={(enabled) => {
              setNotificationsEnabled(enabled);
              setSetting(NOTIFICATIONS_ENABLED_KEY, enabled);
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div
            style={{
              width: '100%',
              padding: '4px 16px 0',
              fontSize: 11,
              color: '#7a9bb5',
              textAlign: 'center',
            }}
          >
            <small>{t().sidebar.about(version)}</small>
          </div>
        </PanelSectionRow>
      </PanelSection>
    </Focusable>
  );
}

// ─── Plugin definition ────────────────────────────────────────────────────────
export default definePlugin(() => {
  console.log('Proton Pulse initializing');
  void logFrontendEvent('INFO', 'Plugin frontend initializing', { translationsLoaded: TRANSLATIONS_LOADED });

  void setLogLevelSafe(getSetting('debugEnabled', false) ? 'DEBUG' : 'INFO').catch((error) => {
    void logFrontendEvent('ERROR', 'Backend: initial set_log_level failed - Python may not be running', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // init cache from localStorage and start prefetch in background
  initCache();
  initCloudSync();
  startAutoFlush();

  // Auto-sync is silent on success, but the user has no way to know it failed
  // otherwise. Toast failed auto-pushes here at the plugin level so it works
  // regardless of which tab (if any) is open. Manual pushes already show their
  // own toasts from the ManageTab, so skip source='manual'
  const unsubCloudPush = onCloudConfigPushed((result) => {
    if (result.source !== 'auto' || result.ok) return;
    toaster.toast({
      title: 'Proton Pulse',
      body: t().configManager.cloudSyncFailed(result.error ?? 'push failed'),
    });
  });
  void (async () => {
    try {
      if (getTrackedConfigs().length > 0) return;
      const hasBackup = await checkHasCloudBackup();
      if (!hasBackup) return;
      toaster.toast({
        title: 'Proton Pulse',
        body: t().configManager.cloudRestoreAvailable,
      });
    } catch {
      // best-effort startup nudge
    }
  })();
  // delay prefetch and playtime tracking so Steam's UI is fully loaded
  const prefetchTimer = setTimeout(() => {
    void runStartupPrefetch();
    startSessionTracking();
  }, 5000);

  // Auto-install latest Proton-GE on load if the user has the setting enabled
  const geAutoUpdateTimer = setTimeout(() => {
    if (!getSetting('compat-auto-update-proton-ge', false)) {
      void logFrontendEvent('DEBUG', 'Startup Proton-GE-Latest auto-update check skipped', {
        reason: 'disabled',
      });
      return;
    }
    void (async () => {
      try {
        void logFrontendEvent('DEBUG', 'Startup Proton-GE-Latest auto-update check started');
        const state = await getProtonGeManagerState(true);
        if (!state.current_release) {
          void logFrontendEvent('DEBUG', 'Startup Proton-GE-Latest auto-update check finished', {
            reason: 'no-current-release',
          });
          return;
        }
        if (state.current_latest_slot_installed) {
          void logFrontendEvent('DEBUG', 'Startup Proton-GE-Latest auto-update check finished', {
            reason: 'already-up-to-date',
            tag: state.current_release.tag_name,
          });
          return;
        }
        if (state.install_status.state === 'running') {
          void logFrontendEvent('DEBUG', 'Startup Proton-GE-Latest auto-update check finished', {
            reason: 'install-already-running',
            tag: state.install_status.tag_name,
          });
          return;
        }

        void logFrontendEvent('DEBUG', 'Startup Proton-GE-Latest auto-update install needed', {
          tag: state.current_release.tag_name,
        });
        const result = await installProtonGe(state.current_release.tag_name, true);
        void logFrontendEvent('INFO', 'Startup auto-install Proton-GE-Latest', { tag: state.current_release.tag_name, result });
      } catch (e) {
        void logFrontendEvent('ERROR', 'Startup auto-install Proton-GE failed', { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, 8000);

  routerHook.addRoute('/proton-pulse', ProtonPulsePage);
  const teardownScreenshotAutomation = installScreenshotAutomationBridge();
  const syncFocusedGameFromPath = () => {
    const pathname = globalThis.location?.pathname ?? '';
    const focusedAppId = extractLibraryAppId(pathname);
    if (!focusedAppId || focusedAppId === pageState.focusedAppId) return;

    const _ov = (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(focusedAppId)
      ?? (globalThis as any).appStore?.GetAppOverviewByAppID?.(focusedAppId)
      ?? null;
    let focusedAppName =
      _ov?.display_name || _ov?.strDisplayName || _ov?.app_name || _ov?.appname || '';

    // Fallback: scan collectionStore.allAppsCollection for non-Steam shortcuts
    // where GetAppOverviewByAppID returns null
    if (!focusedAppName) {
      try {
        const collection = (globalThis as any).collectionStore?.allAppsCollection;
        const allApps = Array.isArray(collection?.allApps)
          ? collection.allApps
          : collection?.apps && Symbol.iterator in collection.apps
            ? Array.from(collection.apps)
            : [];
        const entry = allApps.find((app: any) => Number(app?.appid) === focusedAppId);
        focusedAppName = entry?.display_name || entry?.strDisplayName || entry?.app_name || entry?.appname || entry?.name || '';
      } catch { /* not available */ }
    }

    pageState.focusedAppId = focusedAppId;
    pageState.focusedAppName = focusedAppName;
    void logFrontendEvent('DEBUG', 'Observed focused library app route', {
      focusedAppId,
      focusedAppName,
      ovKeys: _ov ? Object.keys(_ov).filter(k => typeof (_ov as any)[k] === 'string').slice(0, 15) : null,
      pathname,
    });
    // For non-Steam shortcuts, also try VDF lookup and collectionStore as async fallbacks.
    if (!focusedAppName && focusedAppId >= 2_000_000_000) {
      void getShortcutName(focusedAppId).then((name) => {
        if (name && pageState.focusedAppId === focusedAppId) {
          pageState.focusedAppName = name;
          void logFrontendEvent('DEBUG', 'Resolved non-Steam shortcut name from vdf', { focusedAppId, name });
        }
      });
    }
  };

  syncFocusedGameFromPath();
  const focusedGamePoll = setInterval(syncFocusedGameFromPath, 1000);
  const gamePagePatch = routerHook.addPatch('/library/app/:appid', (tree: any) => {
    syncFocusedGameFromPath();
    const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
    if (routeProps) setupGamePageBadge(routeProps);
    return tree;
  });
  setupSearchResultsHint();
  const menuPatch = patchGameContextMenu(LibraryContextMenu);

  return {
    name: 'Proton Pulse',
    titleView: (
      <div
        className={staticClasses.Title}
        style={{ display: 'flex', alignItems: 'center' }}
      >
        <span>Proton Pulse</span>
      </div>
    ),
    content: <Content />,
    icon: <BrandGlyph size={20} />,
    onDismount() {
      console.log('Proton Pulse unloading');
      void logFrontendEvent('INFO', 'Plugin frontend unloading');
      unsubCloudPush();
      teardownCloudSync();
      // finalize any active playtime session before shutdown
      stopSessionTracking();
      // flush metrics one last time before shutdown
      stopAutoFlush();
      clearTimeout(prefetchTimer);
      clearTimeout(geAutoUpdateTimer);
      void flushMetricsToDisk();
      routerHook.removeRoute('/proton-pulse');
      routerHook.removePatch('/library/app/:appid', gamePagePatch);
      teardownSearchResultsHint();
      clearInterval(focusedGamePoll);
      menuPatch.unpatch();
      teardownScreenshotAutomation();
    },
  };
});
