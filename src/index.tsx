// src/index.tsx
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  staticClasses,
  Router,
} from '@decky/ui';
import {
  addEventListener,
  removeEventListener,
  callable,
  definePlugin,
  routerHook,
} from '@decky/api';
import { useState, useEffect } from 'react';
import { FaBolt } from 'react-icons/fa';

import { ProtonPulsePage } from './components/Modal';
import { ProtonPulseBadge } from './components/Badge';
import { getSetting } from './lib/settings';
import { pageState } from './lib/pageState';
import type { PageId } from './lib/pageState';
import type { SystemInfo, ProtonDBSummary } from './types';

// ─── Backend callables ────────────────────────────────────────────────────────
const getSystemInfo  = callable<[], SystemInfo>('get_system_info');
const fetchSummary   = callable<[app_id: string], ProtonDBSummary>('fetch_protondb_summary');
const isGameRunning  = callable<[], boolean>('is_game_running');

// ─── Module-level state ───────────────────────────────────────────────────────
let pendingAppId: number | null = null;

// ─── Sidebar panel ────────────────────────────────────────────────────────────
function Content() {
  const [sysInfo, setSysInfo]               = useState<SystemInfo | null>(null);
  const [gameRunning, setGameRunning]       = useState(false);
  const [currentAppId, setCurrentAppId]     = useState<number | null>(null);
  const [currentAppName, setCurrentAppName] = useState<string>('');
  const [currentSummary, setCurrentSummary] = useState<ProtonDBSummary | null>(null);
  const [summaryLoaded, setSummaryLoaded]   = useState(false);
  const [showBadge]                         = useState(() => getSetting('showBadge', true));

  useEffect(() => {
    // Fetch system info once on mount
    getSystemInfo().then(setSysInfo).catch(console.error);

    // URL-first appId detection — works when sidebar opens while already on a game page
    const match = window.location.pathname.match(/\/library\/app\/(\d+)/);
    const loadSummary = (appId: number) => {
      setSummaryLoaded(false);
      fetchSummary(String(appId))
        .then(setCurrentSummary)
        .catch(console.error)
        .finally(() => setSummaryLoaded(true));
    };

    if (match) {
      const appId = parseInt(match[1], 10);
      setCurrentAppId(appId);
      loadSummary(appId);
    } else if (pendingAppId !== null) {
      setCurrentAppId(pendingAppId);
      loadSummary(pendingAppId);
      pendingAppId = null;
    }

    // Poll game-running state every 5s
    const checkGame = async () => {
      const running = await isGameRunning();
      setGameRunning(running);
    };
    checkGame();
    const interval = setInterval(checkGame, 5000);
    return () => clearInterval(interval);
  }, []);

  // Called from routerHook when user navigates to a game page mid-session
  const onGameFocus = (appId: number, appName: string) => {
    setCurrentAppId(appId);
    setCurrentAppName(appName);
    setCurrentSummary(null);
    setSummaryLoaded(false);
    fetchSummary(String(appId))
      .then(setCurrentSummary)
      .catch(console.error)
      .finally(() => setSummaryLoaded(true));
  };
  (Content as any)._onGameFocus = onGameFocus;
  (Content as any)._onGameStart = () => setGameRunning(true);

  // ─── Navigation helpers ───────────────────────────────────────────────────

  const navigateTo = (tab: PageId) => {
    pageState.initialPage = tab;
    pageState.appId = currentAppId;
    pageState.appName = currentAppName;
    Router.Navigate('/proton-pulse');
  };

  const handleConfigure = () => {
    if (!currentAppId || gameRunning) return;
    navigateTo('configure');
  };

  // Badge click — same flow as Configure button
  const handleBadgeClick = () => { handleConfigure(); };

  // ─── Disable reasons ───────────────────────────────────────────────────────
  const protonDbStatus = !currentAppId
    ? 'Navigate to a game first'
    : !summaryLoaded
    ? 'Checking ProtonDB…'
    : currentSummary
    ? `ProtonDB: ${currentSummary.tier} · ${currentSummary.total} report${currentSummary.total !== 1 ? 's' : ''}`
    : 'Not found in ProtonDB';

  const configureDescription = gameRunning
    ? `Quit your game first · ${protonDbStatus}`
    : protonDbStatus;

  const manageDescription = currentAppId
    ? 'View and clear applied configs'
    : 'Navigate to a game first';

  return (
    <PanelSection>
      {/* Badge row — gated by showBadge setting */}
      {showBadge && currentAppId && (
        <PanelSectionRow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aaa' }}>
            <span>{currentAppName || `App ${currentAppId}`}</span>
            <ProtonPulseBadge
              summary={currentSummary}
              gpuVendor={sysInfo?.gpu_vendor ?? null}
              onClick={handleBadgeClick}
            />
          </div>
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={gameRunning || !currentAppId}
          onClick={handleConfigure}
          description={configureDescription}
        >
          Configure This Game
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={!currentAppId}
          onClick={() => navigateTo('manage')}
          description={manageDescription}
        >
          Manage Configurations
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => navigateTo('logs')}
          description="View plugin activity log"
        >
          Logs
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => navigateTo('settings')}
          description="Debug mode and display options"
        >
          Settings
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

// ─── Plugin definition ────────────────────────────────────────────────────────
export default definePlugin(() => {
  console.log('Proton Pulse initializing');

  routerHook.addRoute('/proton-pulse', ProtonPulsePage);

  let focusedAppId: number | null = null;
  void focusedAppId;

  const patchGamePage = routerHook.addPatch(
    '/library/app/:appid',
    (props: any) => {
      const appId = props.appid ? parseInt(props.appid, 10) : null;
      focusedAppId = appId;
      if (appId) {
        const appName = (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(appId)?.display_name ?? '';
        if ((Content as any)._onGameFocus) {
          (Content as any)._onGameFocus(appId, appName);
        } else {
          pendingAppId = appId;
        }
      }
      return props;
    }
  );

  const gameStartListener = addEventListener(
    'game_start',
    (appId: number) => {
      console.log(`Proton Pulse: game started ${appId}`);
      if ((Content as any)._onGameStart) {
        (Content as any)._onGameStart();
      }
    }
  );

  return {
    name: 'Proton Pulse',
    titleView: <div className={staticClasses.Title}>Proton Pulse</div>,
    content: <Content />,
    icon: <FaBolt />,
    onDismount() {
      console.log('Proton Pulse unloading');
      routerHook.removePatch('/library/app/:appid', patchGamePage);
      routerHook.removeRoute('/proton-pulse');
      removeEventListener('game_start', gameStartListener);
    },
  };
});
