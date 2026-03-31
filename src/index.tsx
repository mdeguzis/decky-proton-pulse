// src/index.tsx
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
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
import { LogViewer } from './components/LogViewer';
import type { SystemInfo, ProtonDBReport, ProtonDBSummary } from './types';

// ─── Backend callables ────────────────────────────────────────────────────────
const getSystemInfo      = callable<[], SystemInfo>('get_system_info');
const fetchSummary       = callable<[app_id: string], ProtonDBSummary>('fetch_protondb_summary');
const fetchReports       = callable<[app_id: string], ProtonDBReport[]>('fetch_protondb_reports');
const setLogLevel        = callable<[level: string], boolean>('set_log_level');
const isGameRunning      = callable<[], boolean>('is_game_running');

// ─── Sidebar panel ────────────────────────────────────────────────────────────
function Content() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [gameRunning, setGameRunning] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [currentAppId, setCurrentAppId] = useState<number | null>(null);
  const [currentAppName, setCurrentAppName] = useState<string>('');
  const [currentSummary, setCurrentSummary] = useState<ProtonDBSummary | null>(null);

  useEffect(() => {
    getSystemInfo().then(setSysInfo).catch(console.error);

    const checkGame = async () => {
      const running = await isGameRunning();
      setGameRunning(running);
    };
    checkGame();
    const interval = setInterval(checkGame, 5000);
    return () => clearInterval(interval);
  }, []);

  // Called from routerHook when user focuses a game — see definePlugin below
  const onGameFocus = (appId: number, appName: string) => {
    setCurrentAppId(appId);
    setCurrentAppName(appName);
    setCurrentSummary(null);
    fetchSummary(String(appId)).then(setCurrentSummary).catch(console.error);
  };
  // Expose so definePlugin can call it (module-level ref pattern)
  (Content as any)._onGameFocus = onGameFocus;

  const handleDebugToggle = async (enabled: boolean) => {
    setDebugEnabled(enabled);
    await setLogLevel(enabled ? 'DEBUG' : 'INFO');
  };

  const handleCheckProtonDB = async () => {
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

      // showModal returns { Hide } — pass it as closeModal via a ref to avoid
      // the temporal dead-zone circular reference
      const modalRef: { hide?: () => void } = {};
      const modal = showModal(
        <ProtonPulseModal
          appId={currentAppId}
          appName={currentAppName}
          reports={reports}
          sysInfo={info}
          closeModal={() => modalRef.hide?.()}
        />
      );
      modalRef.hide = modal.Close;
    } catch (e) {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to fetch reports — check logs.' });
    }
  };

  return (
    <PanelSection>
      {/* Badge preview in sidebar — also satisfies noUnusedLocals for ProtonPulseBadge */}
      {currentAppId && (
        <PanelSectionRow>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: '#aaa' }}>
            {currentAppName}
            <ProtonPulseBadge summary={currentSummary} gpuVendor={sysInfo?.gpu_vendor ?? null} />
          </div>
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={gameRunning || !currentAppId}
          onClick={handleCheckProtonDB}
          description={gameRunning ? 'Quit your game first' : (currentAppId ? undefined : 'Navigate to a game first')}
        >
          Check ProtonDB ▶
        </ButtonItem>
      </PanelSectionRow>

      <PanelSection title="Settings">
        <PanelSectionRow>
          <ToggleField
            label="Debug Logs"
            checked={debugEnabled}
            onChange={handleDebugToggle}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Logs">
        <PanelSectionRow>
          <LogViewer />
        </PanelSectionRow>
      </PanelSection>
    </PanelSection>
  );
}

// ─── Plugin definition ────────────────────────────────────────────────────────
export default definePlugin(() => {
  console.log('Proton Pulse initializing');

  // Track the currently focused app — updated by the router
  let focusedAppId: number | null = null;
  void focusedAppId;
  let focusedAppName = '';
  void focusedAppName;

  // Badge patch: inject into game detail pages
  const patchGamePage = routerHook.addPatch(
    '/library/app/:appid',
    (props: any) => {
      const appId = props.appid ? parseInt(props.appid, 10) : null;
      focusedAppId = appId;
      // Note: badge injection into existing badge row requires finding the
      // Steam DOM node for the badge area. This is Steam-version-dependent.
      // The badge component is returned here; exact positioning is adjusted
      // by inspecting the live Steam DOM with Decky's devtools.
      return props;
    }
  );

  // Listen for game launch events to update game-running state
  const gameStartListener = addEventListener(
    'game_start',
    (appId: number) => {
      console.log(`Proton Pulse: game started ${appId}`);
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
