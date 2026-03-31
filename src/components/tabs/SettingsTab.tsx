// src/components/tabs/SettingsTab.tsx
import { useState } from 'react';
import { ToggleField } from '@decky/ui';
import { callable } from '@decky/api';
import { getSetting, setSetting } from '../../lib/settings';

const setLogLevel = callable<[level: string], boolean>('set_log_level');

export function SettingsTab() {
  const [debugEnabled, setDebugEnabled] = useState(() => getSetting('debugEnabled', false));
  const [showBadge, setShowBadge] = useState(() => getSetting('showBadge', true));

  const handleDebugToggle = async (enabled: boolean) => {
    setDebugEnabled(enabled);
    setSetting('debugEnabled', enabled);
    await setLogLevel(enabled ? 'DEBUG' : 'INFO');
  };

  const handleShowBadgeToggle = (enabled: boolean) => {
    setShowBadge(enabled);
    setSetting('showBadge', enabled);
  };

  return (
    <div style={{ padding: 8 }}>
      <ToggleField
        label="Debug Logs"
        description="Enable verbose logging in plugin activity log"
        checked={debugEnabled}
        onChange={handleDebugToggle}
      />
      <ToggleField
        label="Show Badge"
        description="Display Proton Pulse badge in the sidebar"
        checked={showBadge}
        onChange={handleShowBadgeToggle}
      />
    </div>
  );
}
