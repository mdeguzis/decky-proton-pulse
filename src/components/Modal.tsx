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
import { SettingsTab } from './tabs/SettingsTab';
import { AboutTab } from './tabs/AboutTab';
import { logFrontendEvent } from '../lib/logger';
import { BrandLogo } from './BrandLogo';

const getSystemInfo = callable<[], SystemInfo>('get_system_info');

export function ProtonPulsePage() {
  const [activePage, setActivePage] = useState<string>(pageState.initialPage);
  const [appId, setAppId]           = useState<number | null>(pageState.appId);
  const [appName, setAppName]       = useState<string>(pageState.appName);
  const [sysInfo, setSysInfo]       = useState<SystemInfo | null>(null);

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

  const hasGame = !!appId;

  const pages: SidebarNavigationPage[] = [
    ...(hasGame ? [{
      title: 'Manage This Game',
      identifier: 'manage-game',
      content: <ConfigureTab appId={appId} appName={appName} sysInfo={sysInfo} />,
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
      title: 'Settings',
      identifier: 'settings',
      content: <SettingsTab />,
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
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderRadius: 999,
          background: 'rgba(14, 22, 35, 0.78)',
          border: '1px solid rgba(110, 180, 255, 0.18)',
          pointerEvents: 'none',
        }}
      >
        <BrandLogo size={18} />
        <span style={{ fontSize: 10, color: '#9dc4e8', letterSpacing: 0.3 }}>
          Proton Pulse
        </span>
      </div>
      <SidebarNavigation
        title="Proton Pulse"
        showTitle={true}
        pages={pages}
        page={activePage}
        onPageRequested={(page) => {
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
