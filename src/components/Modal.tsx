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
import { useLanguage, t } from '../lib/i18n';

const getSystemInfo = callable<[], SystemInfo>('get_system_info');

export function ProtonPulsePage() {
  const _lang = useLanguage(); // triggers re-render on language change
  const [activePage, setActivePage] = useState<string>(pageState.initialPage);
  const [appId, setAppId]           = useState<number | null>(pageState.appId);
  const [appName, setAppName]       = useState<string>(pageState.appName);
  const [sysInfo, setSysInfo]       = useState<SystemInfo | null>(null);

  useEffect(() => {
    getSystemInfo()
      .then((info) => {
        void logFrontendEvent('INFO', 'System info loaded for modal', {
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
  );
}
