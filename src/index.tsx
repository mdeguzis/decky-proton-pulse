// src/index.tsx
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Focusable,
  ToggleField,
  staticClasses,
  Router,
} from '@decky/ui';
import { useEffect, useState } from 'react';
import {
  definePlugin,
  routerHook,
  callable,
} from '@decky/api';

import { ProtonPulsePage } from './components/Modal';
import { BrandGlyph } from './components/BrandGlyph';
import { pageState, dispatchNavigate } from './lib/pageState';
import type { PageId } from './lib/pageState';
import { LibraryContextMenu, patchGameContextMenu } from './patches/gameContextMenu';
import { getSetting, setSetting } from './lib/settings';
import { logFrontendEvent } from './lib/logger';
import { TRANSLATIONS_LOADED } from './lib/translations';
import { useLanguage } from './lib/i18n';

const setLogLevel = callable<[level: string], boolean>('set_log_level');
const getPluginVersion = callable<[], string>('get_plugin_version');

function extractLibraryAppId(pathname: string): number | null {
  const match = pathname.match(/\/(?:routes\/)?library\/app\/(\d+)/);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// ─── Sidebar panel ────────────────────────────────────────────────────────────
function Content() {
  const _lang = useLanguage(); // triggers re-render on language change
  const [version, setVersion] = useState('...');
  const [debugEnabled, setDebugEnabled] = useState(() => getSetting('debugEnabled', false));

  useEffect(() => {
    void getPluginVersion()
      .then(setVersion)
      .catch(() => setVersion('unknown'));
  }, []);

  useEffect(() => {
    void setLogLevel(debugEnabled ? 'DEBUG' : 'INFO').catch((error) => {
      console.error('Proton Pulse: failed to sync debug setting from sidebar', error);
    });
  }, [debugEnabled]);

  const navigateTo = (tab: PageId) => {
    void logFrontendEvent('INFO', 'Sidebar navigation requested', { tab });
    pageState.initialPage = tab;
    pageState.appId = null;
    pageState.appName = '';
    dispatchNavigate({ tab, appId: null, appName: '' });
    Router.CloseSideMenus();
    Router.Navigate('/proton-pulse');
  };

  return (
    <Focusable style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => navigateTo('manage')}
            description="View and manage ProtonDB configurations"
          >
            Manage Configurations
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => navigateTo('compatibility-tools')}
            description="Install, remove, and manage compatibility tools"
          >
            Compatibility Tools
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => navigateTo('settings')}
            description="Plugin preferences and tokens"
          >
            Settings
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
      <div style={{ flex: 1 }} />
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => navigateTo('logs')}
            description="Open the live plugin log viewer"
          >
            View Logs
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Debug Logs"
            description="Enable verbose logging without opening Settings"
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
            <small>About: Proton Pulse v{version}</small>
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

  void setLogLevel(getSetting('debugEnabled', false) ? 'DEBUG' : 'INFO').catch((error) => {
    console.error('Proton Pulse: failed to sync saved debug setting', error);
  });

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
      routerHook.removeRoute('/proton-pulse');
      routerHook.removePatch('/library/app/:appid', gamePagePatch);
      clearInterval(focusedGamePoll);
      menuPatch.unpatch();
    },
  };
});
