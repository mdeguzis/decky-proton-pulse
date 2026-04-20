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
import { toaster } from './lib/notify';
import { patchGamePageBadge } from './patches/gamePageBadge';

const setLogLevel = callable<[level: string], boolean>('set_log_level');
const getPluginVersion = callable<[], string>('get_plugin_version');

// wrap backend calls so they timeout + log clearly when Python is dead
const setLogLevelSafe = (level: string) =>
  callWithTimeout(() => setLogLevel(level), 'set_log_level', 5000);
const getPluginVersionSafe = () =>
  callWithTimeout(() => getPluginVersion(), 'get_plugin_version', 5000);
const EXPERIMENTAL_GAME_PAGE_SHORTCUT_KEY = 'experimental-game-page-shortcut-enabled';
const GAME_PAGE_SHORTCUT_ID = 'proton-pulse-game-page-shortcut';
const experimentalGamePageShortcutLogState: Record<string, string> = {};

function logExperimentalGamePageShortcutState(
  slot: string,
  message: string,
  context: Record<string, string | number | boolean>,
): void {
  const state = JSON.stringify(context);
  if (experimentalGamePageShortcutLogState[slot] === state) return;
  experimentalGamePageShortcutLogState[slot] = state;
  void logFrontendEvent('DEBUG', message, context);
}

function isLibraryAppRoute(pathname: string): boolean {
  return /\/(?:routes\/)?library\/app\/\d+/.test(pathname);
}

function extractLibraryAppId(pathname: string): number | null {
  const match = pathname.match(/\/(?:routes\/)?library\/app\/(\d+)/);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function navigateToManageGame(appId: number | null, appName: string): void {
  if (!appId) return;
  rememberReturnPath(globalThis.location?.pathname);
  const payload = { tab: 'manage-game' as const, appId, appName };
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
}

function removeExperimentalGamePageShortcut(): void {
  const existing = document.getElementById(GAME_PAGE_SHORTCUT_ID) as HTMLElement | null;
  if (!existing) return;
  void logFrontendEvent('DEBUG', 'Removing experimental game page shortcut button');
  existing.remove();
}

function findExperimentalGamePageShortcutAnchor(): HTMLElement | null {
  const buttons = [...document.querySelectorAll('button,[role="button"]')]
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((node) => node.offsetParent !== null);
  const candidates = buttons
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width >= 56
      && rect.width <= 108
      && rect.height >= 56
      && rect.height <= 108
      && rect.right >= window.innerWidth - 260
      && rect.top >= 300
      && rect.top <= 560,
    );
  if (candidates.length < 2) return null;

  const rows: Array<Array<{ node: HTMLElement; rect: DOMRect }>> = [];
  for (const candidate of candidates.sort((a, b) => a.rect.top - b.rect.top)) {
    const row = rows.find((group) => Math.abs(group[0].rect.top - candidate.rect.top) <= 18);
    if (row) {
      row.push(candidate);
    } else {
      rows.push([candidate]);
    }
  }

  const bestRow = rows
    .filter((group) => group.length >= 2)
    .sort((a, b) => {
      const aRight = Math.max(...a.map(({ rect }) => rect.right));
      const bRight = Math.max(...b.map(({ rect }) => rect.right));
      const rightBias = bRight - aRight;
      if (rightBias !== 0) return rightBias;
      return b.length - a.length;
    })[0];
  if (!bestRow) return null;

  bestRow.sort((a, b) => a.rect.left - b.rect.left);
  return bestRow[0]?.node ?? null;
}

function syncExperimentalGamePageShortcutButton(): void {
  const pathname = globalThis.location?.pathname ?? '';
  const enabled = getSetting(EXPERIMENTAL_GAME_PAGE_SHORTCUT_KEY, false);
  const libraryAppRoute = isLibraryAppRoute(pathname);
  logExperimentalGamePageShortcutState('sync', 'Syncing experimental game page shortcut button', {
    enabled,
    pathname,
    isLibraryAppRoute: libraryAppRoute,
  });
  if (!enabled || !libraryAppRoute) {
    removeExperimentalGamePageShortcut();
    return;
  }

  const appId = extractLibraryAppId(pathname);
  if (!appId) {
    logExperimentalGamePageShortcutState('missing-app-id', 'Experimental game page shortcut skipped: no appId from route', {
      pathname,
    });
    removeExperimentalGamePageShortcut();
    return;
  }

  const appName =
    (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(appId)?.display_name ?? '';
  const anchor = findExperimentalGamePageShortcutAnchor();
  if (!anchor?.parentElement) {
    logExperimentalGamePageShortcutState('anchor-missing', 'Experimental game page shortcut anchor not found', {
      appId,
      appName,
      pathname,
      visibleButtons: document.querySelectorAll('button,[role="button"]').length,
    });
    return;
  }

  logExperimentalGamePageShortcutState('anchor-found', 'Experimental game page shortcut anchor found', {
    appId,
    appName,
    anchorTag: anchor.tagName,
    anchorClassName: String(anchor.className),
    anchorText: anchor.textContent?.trim()?.slice(0, 60) ?? '',
  });

  const existing = document.getElementById(GAME_PAGE_SHORTCUT_ID) as HTMLElement | null;
  if (existing && existing.parentElement === anchor.parentElement) {
    existing.onclick = () => navigateToManageGame(appId, appName);
    existing.title = t().nav.manageThisGame;
    existing.setAttribute('aria-label', t().nav.manageThisGame);
    logExperimentalGamePageShortcutState('updated-in-place', 'Experimental game page shortcut updated in place', {
      appId,
      appName,
    });
    return;
  }

  removeExperimentalGamePageShortcut();

  const button = document.createElement('button');
  button.id = GAME_PAGE_SHORTCUT_ID;
  button.setAttribute('type', 'button');
  button.title = t().nav.manageThisGame;
  button.setAttribute('aria-label', t().nav.manageThisGame);
  button.onclick = () => navigateToManageGame(appId, appName);
  button.style.width = '72px';
  button.style.height = '72px';
  button.style.minWidth = '72px';
  button.style.borderRadius = '10px';
  button.style.border = 'none';
  button.style.background = '#2f3540';
  button.style.display = 'flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.cursor = 'pointer';
  button.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.04)';
  button.style.marginRight = '8px';
  button.style.flex = '0 0 auto';
  button.style.color = '#eef7ff';
  button.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true" style="display:block;flex:0 0 auto">
      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="32,10 46,16 54,28 50,44 32,54 14,44 10,28 18,16" stroke-width="3"></polygon>
        <polygon points="32,18 41,22 46,31 43,40 32,46 21,40 18,31 23,22" stroke-width="2.5" opacity="0.9"></polygon>
        <circle cx="32" cy="32" r="7" stroke-width="2.5"></circle>
        <path d="M32 32 L32 18 C37 19.5 41 23.5 42.5 28.5 C44 33.5 42 39 37.5 42.5" stroke-width="2.5"></path>
      </g>
    </svg>
  `;
  anchor.parentElement.insertBefore(button, anchor);
  void logFrontendEvent('INFO', 'Experimental game page shortcut inserted', {
    appId,
    appName,
  });
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

    const focusedAppName =
      (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(focusedAppId)?.display_name ?? '';
    pageState.focusedAppId = focusedAppId;
    pageState.focusedAppName = focusedAppName;
    void logFrontendEvent('DEBUG', 'Observed focused library app route', {
      focusedAppId,
      focusedAppName,
      pathname,
    });
  };

  syncFocusedGameFromPath();
  const focusedGamePoll = setInterval(syncFocusedGameFromPath, 1000);
  const gamePagePatch = routerHook.addPatch('/library/app/:appid', (props: { appid?: string }) => {
    syncFocusedGameFromPath();
    window.setTimeout(syncExperimentalGamePageShortcutButton, 50);
    window.setTimeout(syncExperimentalGamePageShortcutButton, 400);
    return props;
  });
  const gamePageShortcutPoll = setInterval(syncExperimentalGamePageShortcutButton, 1500);
  const menuPatch = patchGameContextMenu(LibraryContextMenu);
  const badgePatch = patchGamePageBadge();

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
      routerHook.removePatch('/library/app/:appid', badgePatch);
      clearInterval(focusedGamePoll);
      clearInterval(gamePageShortcutPoll);
      removeExperimentalGamePageShortcut();
      menuPatch.unpatch();
      teardownScreenshotAutomation();
    },
  };
});
