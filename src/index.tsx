// src/index.tsx
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  staticClasses,
  showModal,
} from '@decky/ui';
import {
  addEventListener,
  removeEventListener,
  callable,
  definePlugin,
  toaster,
  routerHook,
} from '@decky/api';
import { useState, useEffect } from 'react';
import { FaBolt } from 'react-icons/fa';

import { ProtonPulseModal } from './components/Modal';
import { ProtonPulseBadge } from './components/Badge';
import { getSetting } from './lib/settings';
import type { SystemInfo, ProtonDBReport, ProtonDBSummary } from './types';

// ─── Backend callables ────────────────────────────────────────────────────────
const getSystemInfo  = callable<[], SystemInfo>('get_system_info');
const fetchSummary   = callable<[app_id: string], ProtonDBSummary>('fetch_protondb_summary');
const fetchReports   = callable<[app_id: string], ProtonDBReport[]>('fetch_protondb_reports');
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
  const [showBadge]                         = useState(() => getSetting('showBadge', true));

  useEffect(() => {
    // Fetch system info once on mount
    getSystemInfo().then(setSysInfo).catch(console.error);

    // URL-first appId detection — works when sidebar opens while already on a game page
    const match = window.location.pathname.match(/\/library\/app\/(\d+)/);
    if (match) {
      const appId = parseInt(match[1], 10);
      setCurrentAppId(appId);
      fetchSummary(String(appId)).then(setCurrentSummary).catch(console.error);
    } else if (pendingAppId !== null) {
      setCurrentAppId(pendingAppId);
      fetchSummary(String(pendingAppId)).then(setCurrentSummary).catch(console.error);
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
    fetchSummary(String(appId)).then(setCurrentSummary).catch(console.error);
  };
  (Content as any)._onGameFocus = onGameFocus;
  (Content as any)._onGameStart = () => setGameRunning(true);

  // ─── Modal helpers ────────────────────────────────────────────────────────

  // Open modal at any non-configure tab (no reports fetch needed)
  const openModalAt = (tab: 'manage' | 'logs' | 'settings' | 'about') => {
    const modalRef: { hide?: () => void } = {};
    const modal = showModal(
      <ProtonPulseModal
        appId={currentAppId}
        appName={currentAppName}
        reports={[]}
        sysInfo={sysInfo}
        initialTab={tab}
        closeModal={() => modalRef.hide?.()}
      />
    );
    modalRef.hide = modal.Close;
  };

  // Open Configure tab — fetches reports first
  const handleConfigure = async () => {
    if (!currentAppId || gameRunning) return;

    toaster.toast({ title: 'Proton Pulse', body: 'Fetching ProtonDB reports…' });
    try {
      const [reports, info] = await Promise.all([
        fetchReports(String(currentAppId)),
        sysInfo ? Promise.resolve(sysInfo) : getSystemInfo(),
      ]);
      if (!sysInfo) setSysInfo(info);

      if (reports.length === 0) {
        toaster.toast({ title: 'Proton Pulse', body: 'No ProtonDB reports found for this game.' });
        return;
      }

      const modalRef: { hide?: () => void } = {};
      const modal = showModal(
        <ProtonPulseModal
          appId={currentAppId}
          appName={currentAppName}
          reports={reports}
          sysInfo={info}
          initialTab="configure"
          closeModal={() => modalRef.hide?.()}
        />
      );
      modalRef.hide = modal.Close;
    } catch (e) {
      console.error('Proton Pulse: failed to fetch reports', e);
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to fetch reports — check logs.' });
    }
  };

  // Badge click — same flow as Configure button
  const handleBadgeClick = () => { handleConfigure(); };

  // ─── Disable reasons ───────────────────────────────────────────────────────
  const configureDescription = gameRunning
    ? 'Quit your game first'
    : currentAppId
    ? 'Find & apply ProtonDB launch options'
    : 'Navigate to a game first';

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

      {/* Game section */}
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={gameRunning || !currentAppId}
          onClick={handleConfigure}
          description={configureDescription}
        >
          Configure This Game ▶
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={!currentAppId}
          onClick={() => openModalAt('manage')}
          description={manageDescription}
        >
          Manage Configurations ▶
        </ButtonItem>
      </PanelSectionRow>

      {/* Plugin section */}
      <PanelSection title="Plugin">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => openModalAt('logs')}
            description="View plugin activity log"
          >
            Logs ▶
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => openModalAt('settings')}
            description="Debug mode and display options"
          >
            Settings ▶
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </PanelSection>
  );
}

// ─── Plugin definition ────────────────────────────────────────────────────────
export default definePlugin(() => {
  console.log('Proton Pulse initializing');

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
      removeEventListener('game_start', gameStartListener);
    },
  };
});
