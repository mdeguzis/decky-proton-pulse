// src/components/Modal.tsx
import { useState, useEffect } from 'react';
import { SidebarNavigation } from '@decky/ui';
import type { SidebarNavigationPage } from '@decky/ui';
import { callable } from '@decky/api';
import { pageState, NAVIGATE_EVENT } from '../lib/pageState';
import type { NavigatePayload } from '../lib/pageState';
import type { SystemInfo } from '../types';
import { ConfigureTab } from './tabs/ConfigureTab';
import { ManageTab } from './tabs/ManageTab';
import { LogsTab } from './tabs/LogsTab';
import { CompatibilityToolsTab } from './tabs/CompatibilityToolsTab';
import { GeneralSettingsTab } from './tabs/GeneralSettingsTab';
import { AboutTab } from './tabs/AboutTab';
import { logFrontendEvent } from '../lib/logger';

const getSystemInfo = callable<[], SystemInfo>('get_system_info');

export function ProtonPulsePage() {
  const [activePage, setActivePage] = useState<string>(pageState.initialPage);
  const [appId, setAppId]           = useState<number | null>(pageState.appId);
  const [appName, setAppName]       = useState<string>(pageState.appName);
  const [sysInfo, setSysInfo]       = useState<SystemInfo | null>(null);
  const [manageGameLoadNonce, setManageGameLoadNonce] = useState(0);
  const [manageGameOverlayOpen, setManageGameOverlayOpen] = useState(false);
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const overlayLocked =
    activePage === 'manage-game' &&
    (manageGameOverlayOpen || ((overlayHost?.childElementCount ?? 0) > 0));

  useEffect(() => {
    getSystemInfo()
      .then((info) => {
        void logFrontendEvent('DEBUG', 'System info loaded for modal', {
          gpuVendor: info.gpu_vendor,
          kernel: info.kernel,
        });
        setSysInfo(info);
      })
      .catch((error) => {
        void logFrontendEvent('ERROR', 'Failed to load system info for modal', {
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(error);
      });
  }, []);

  // React to re-navigation while the component is already mounted.
  useEffect(() => {
    const handler = (e: Event) => {
      const { tab, appId: id, appName: name } = (e as CustomEvent<NavigatePayload>).detail;
      void logFrontendEvent('INFO', 'Navigation event received', { tab, appId: id, appName: name });
      setAppId(id);
      setAppName(name);
      setActivePage(tab);
      if (tab === 'manage-game' && id) {
        setManageGameLoadNonce((value) => value + 1);
      }
    };
    window.addEventListener(NAVIGATE_EVENT, handler);
    return () => window.removeEventListener(NAVIGATE_EVENT, handler);
  }, []);

  // If the game-specific page is active but appId is cleared, fall back to Manage.
  useEffect(() => {
    if (!appId && activePage === 'manage-game') {
      void logFrontendEvent('WARNING', 'Manage This Game page lost app context; falling back to Manage');
      setActivePage('manage');
    }
  }, [appId, activePage]);

  useEffect(() => {
    if (activePage === 'manage-game' && appId) {
      setManageGameLoadNonce((value) => value + 1);
    }
  }, [activePage, appId]);

  const hasGame = !!appId;

  const pages: SidebarNavigationPage[] = [
    ...(hasGame ? [{
      title: 'Manage This Game',
      identifier: 'manage-game',
      content: (
        <ConfigureTab
          appId={appId}
          appName={appName}
          sysInfo={sysInfo}
          isActive={activePage === 'manage-game'}
          loadNonce={manageGameLoadNonce}
          onOverlayOpenChange={setManageGameOverlayOpen}
          overlayHost={overlayHost}
        />
      ),
    }] : []),
    {
      title: 'Manage Configurations',
      identifier: 'manage',
      content: <ManageTab appId={appId} appName={appName} />,
    },
    {
      title: 'Logs',
      identifier: 'logs',
      content: <LogsTab />,
    },
    {
      title: 'Compatibility Tools',
      identifier: 'compatibility-tools',
      content: <CompatibilityToolsTab />,
    },
    {
      title: 'Settings',
      identifier: 'settings',
      content: <GeneralSettingsTab />,
    },
    {
      title: 'About',
      identifier: 'about',
      content: <AboutTab />,
    },
  ];

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div
        ref={setOverlayHost}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 50,
          pointerEvents: overlayLocked ? 'auto' : 'none',
        }}
      />
      {activePage === 'manage-game' && overlayLocked && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 362,
            zIndex: 3,
            background: '#151c22',
            borderRight: '1px solid rgba(255,255,255,0.05)',
            pointerEvents: 'auto',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 138,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          background: 'rgba(14, 22, 35, 0.78)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          pointerEvents: 'none',
        }}
      >
        <span style={{ fontSize: 10, color: '#f4fbff', letterSpacing: 0.3 }}>
          B Back
        </span>
      </div>
      <SidebarNavigation
        title="Proton Pulse"
        showTitle={false}
        pages={pages}
        page={activePage}
        onPageRequested={(page) => {
          if (overlayLocked) {
            void logFrontendEvent('INFO', 'Ignored sidebar page request while report detail overlay is open', {
              page,
              appId,
              appName,
            });
            return;
          }
          void logFrontendEvent('INFO', 'Sidebar page requested', {
            page,
            appId,
            appName,
          });
          setActivePage(page);
        }}
        disableRouteReporting={true}
      />
    </div>
  );
}
