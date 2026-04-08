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
import { logFrontendEvent, callWithTimeout } from './lib/logger';
import { TRANSLATIONS_LOADED } from './lib/translations';
import { useLanguage, t } from './lib/i18n';
import { initCache } from './lib/cache';
import { runStartupPrefetch } from './lib/prefetch';
import { startAutoFlush, stopAutoFlush, flushMetricsToDisk } from './lib/metrics';

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
  startAutoFlush();
  // delay prefetch a bit so Steam's UI is fully loaded and collectionStore is populated
  const prefetchTimer = setTimeout(() => {
    void runStartupPrefetch();
  }, 5000);

  routerHook.addRoute('/proton-pulse', ProtonPulsePage);
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
    return props;
  });
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
      // flush metrics one last time before shutdown
      stopAutoFlush();
      clearTimeout(prefetchTimer);
      void flushMetricsToDisk();
      routerHook.removeRoute('/proton-pulse');
      routerHook.removePatch('/library/app/:appid', gamePagePatch);
      clearInterval(focusedGamePoll);
      menuPatch.unpatch();
    },
  };
});
