// src/components/Modal.tsx
import { useState } from 'react';
import { ModalRoot, Tabs } from '@decky/ui';
import type { Tab } from '@decky/ui';
import type { ProtonDBReport, SystemInfo } from '../types';
import { ConfigureTab } from './tabs/ConfigureTab';
import { ManageTab } from './tabs/ManageTab';
import { LogsTab } from './tabs/LogsTab';
import { SettingsTab } from './tabs/SettingsTab';
import { AboutTab } from './tabs/AboutTab';

export type TabId = 'configure' | 'manage' | 'logs' | 'settings' | 'about';

// Set before calling showModal to control which tab opens first
let _pendingTab: TabId = 'configure';
export function setPendingTab(tab: TabId): void {
  _pendingTab = tab;
}

interface Props {
  appId: number | null;
  appName: string;
  reports: ProtonDBReport[];
  sysInfo: SystemInfo | null;
  closeModal: () => void;
}

export function ProtonPulseModal({ appId, appName, reports, sysInfo, closeModal }: Props) {
  const [activeTab, setActiveTab] = useState<string>(_pendingTab);

  const tabs: Tab[] = [
    {
      id: 'configure',
      title: 'Configure',
      content: (
        <ConfigureTab
          appId={appId}
          appName={appName}
          reports={reports}
          sysInfo={sysInfo}
          closeModal={closeModal}
        />
      ),
    },
    {
      id: 'manage',
      title: 'Manage',
      content: <ManageTab appId={appId} appName={appName} />,
    },
    {
      id: 'logs',
      title: 'Logs',
      content: <LogsTab />,
    },
    {
      id: 'settings',
      title: 'Settings',
      content: <SettingsTab />,
    },
    {
      id: 'about',
      title: 'About',
      content: <AboutTab />,
    },
  ];

  return (
    <ModalRoot onCancel={closeModal} style={{ width: '90vw', maxWidth: 640 }}>
      <Tabs tabs={tabs} activeTab={activeTab} onShowTab={setActiveTab} autoFocusContents={false} />
    </ModalRoot>
  );
}
