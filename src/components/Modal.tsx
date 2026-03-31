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

const getSystemInfo = callable<[], SystemInfo>('get_system_info');

export function ProtonPulsePage() {
  const [activePage, setActivePage] = useState<string>(pageState.initialPage);
  const [appId, setAppId]           = useState<number | null>(pageState.appId);
  const [appName, setAppName]       = useState<string>(pageState.appName);
  const [sysInfo, setSysInfo]       = useState<SystemInfo | null>(null);

  useEffect(() => {
    getSystemInfo().then(setSysInfo).catch(console.error);
  }, []);

  // React to re-navigation while the component is already mounted.
  useEffect(() => {
    const handler = (e: Event) => {
      const { tab, appId: id, appName: name } = (e as CustomEvent<NavigatePayload>).detail;
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
      setActivePage('manage');
    }
  }, [appId, activePage]);

  const hasGame = !!appId;

  const pages: (SidebarNavigationPage | 'separator')[] = [
    // "Manage This Game" — hidden when no game is in context.
    {
      title: 'Manage This Game',
      identifier: 'manage-game',
      visible: hasGame,
      content: <ConfigureTab appId={appId} appName={appName} sysInfo={sysInfo} />,
    },
    // Separator only renders when the game page is visible.
    ...(hasGame ? ['separator' as const] : []),
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
    <SidebarNavigation
      title="Proton Pulse"
      showTitle={true}
      pages={pages}
      page={activePage}
      onPageRequested={setActivePage}
      disableRouteReporting={true}
    />
  );
}
