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
import { logFrontendEvent, callWithTimeout } from '../lib/logger';
import { useLanguage, t } from '../lib/i18n';

const getSystemInfo = callable<[], SystemInfo>('get_system_info');
const getSystemInfoSafe = () => callWithTimeout(() => getSystemInfo(), 'get_system_info');

export function ProtonPulsePage() {
  useLanguage(); // triggers re-render on language change
  const [activePage, setActivePage] = useState<string>(pageState.initialPage);
  const [appId, setAppId]           = useState<number | null>(pageState.appId);
  const [appName, setAppName]       = useState<string>(pageState.appName);
  const [sysInfo, setSysInfo]       = useState<SystemInfo | null>(null);

  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    getSystemInfoSafe()
      .then((info) => {
        void logFrontendEvent('INFO', 'System info loaded', {
          gpuVendor: info.gpu_vendor,
          kernel: info.kernel,
        });
        setSysInfo(info);
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        void logFrontendEvent('ERROR', 'Failed to load system info', { error: msg });
        setBackendError(msg);
      });
  }, []);

  // React to re-navigation while the component is already mounted.
  useEffect(() => {
    const handler = (e: Event) => {
      const { tab, appId: id, appName: name } = (e as CustomEvent<NavigatePayload>).detail;
      void logFrontendEvent('DEBUG', 'Navigation event received', { tab, appId: id, appName: name });
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
      title: t().nav.manageThisGame,
      identifier: 'manage-game',
      content: (
        <ConfigureTab
          appId={appId}
          appName={appName}
          sysInfo={sysInfo}
        />
      ),
    }] : []),
    {
      title: t().nav.manageConfigurations,
      identifier: 'manage',
      content: <ManageTab appId={appId} appName={appName} gpuVendor={sysInfo?.gpu_vendor ?? null} />,
    },
    {
      title: t().nav.logs,
      identifier: 'logs',
      content: <LogsTab />,
    },
    {
      title: t().nav.compatibilityTools,
      identifier: 'compatibility-tools',
      content: <CompatibilityToolsTab />,
    },
    {
      title: t().nav.settings,
      identifier: 'settings',
      content: <GeneralSettingsTab />,
    },
    {
      title: t().nav.about,
      identifier: 'about',
      content: <AboutTab />,
    },
  ];

  return (
    <>
      {backendError && (
        <div style={{
          background: '#4a1c1c',
          border: '1px solid #8b3030',
          borderRadius: 6,
          padding: '8px 14px',
          margin: '0 0 8px',
          fontSize: 11,
          color: '#f4c6c6',
          lineHeight: 1.5,
        }}>
          <strong>Backend unavailable:</strong> {backendError}
          <div style={{ fontSize: 10, color: '#c09090', marginTop: 4 }}>
            Check Logs tab for details. The Python backend may have failed to start.
          </div>
        </div>
      )}
      <SidebarNavigation
        title="Proton Pulse"
        showTitle={false}
        pages={pages}
        page={activePage}
        onPageRequested={(page) => {
          void logFrontendEvent('DEBUG', 'Sidebar page requested', {
            page,
            appId,
            appName,
          });
          setActivePage(page);
        }}
        disableRouteReporting={true}
      />
    </>
  );
}
