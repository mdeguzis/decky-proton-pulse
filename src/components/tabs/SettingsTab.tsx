// src/components/tabs/SettingsTab.tsx
import { useState } from 'react';
import { ToggleField, Focusable } from '@decky/ui';
import { callable } from '@decky/api';
import { getSetting, setSetting } from '../../lib/settings';

const setLogLevel = callable<[level: string], boolean>('set_log_level');

export function SettingsTab() {
  const [debugEnabled, setDebugEnabled] = useState(() => getSetting('debugEnabled', false));
  const [showBadge, setShowBadge] = useState(() => getSetting('showBadge', true));
  const [ghToken, setGhToken] = useState(() => getSetting<string>('gh-votes-token', ''));

  const handleDebugToggle = async (enabled: boolean) => {
    setDebugEnabled(enabled);
    setSetting('debugEnabled', enabled);
    await setLogLevel(enabled ? 'DEBUG' : 'INFO');
  };

  const handleShowBadgeToggle = (enabled: boolean) => {
    setShowBadge(enabled);
    setSetting('showBadge', enabled);
  };

  const handleTokenChange = (value: string) => {
    setGhToken(value);
    setSetting('gh-votes-token', value);
  };

  return (
    <Focusable>
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
      <div style={{ padding: '8px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e8f4ff', marginBottom: 2 }}>
          GitHub Votes Token
        </div>
        <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 6 }}>
          Personal access token for submitting upvotes (repo scope)
        </div>
        <input
          type="password"
          value={ghToken}
          onChange={(e) => handleTokenChange(e.target.value)}
          placeholder="ghp_…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#1a2a3a', border: '1px solid #2a3a4a',
            borderRadius: 3, color: '#e8f4ff', fontSize: 12,
            padding: '4px 8px',
          }}
        />
      </div>
    </Focusable>
  );
}
