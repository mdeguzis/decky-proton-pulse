// src/components/tabs/ManageTab.tsx
import { DialogButton, Focusable, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { useEffect, useState } from 'react';
import { toaster } from '@decky/api';
import { logFrontendEvent } from '../../lib/logger';
import { getLaunchOptionsFromDetails, getSteamAppDetails } from '../../lib/steamApps';
import { t } from '../../lib/i18n';

interface Props {
  appId: number | null;
  appName: string;
}

export function ManageTab({ appId, appName }: Props) {
  const [launchOptions, setLaunchOptions] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!appId) {
      setLaunchOptions('');
      return;
    }

    setLoading(true);
    void getSteamAppDetails(appId).then((result) => {
      const nextLaunchOptions = getLaunchOptionsFromDetails(result.details);
      setLaunchOptions(nextLaunchOptions);
      void logFrontendEvent('DEBUG', 'Loaded current launch options', {
        appId,
        appName,
        hasLaunchOptions: !!nextLaunchOptions,
      });
    }).finally(() => setLoading(false));
  }, [appId, appName]);

  if (!appId) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, lineHeight: 1.6 }}>
        Right-click any game in your library (or use the settings gear) and select{' '}
        <span style={{ color: '#ccc' }}>ProtonDB Config</span> to configure launch options.
      </div>
    );
  }

  const handleClear = async () => {
    void logFrontendEvent('INFO', 'Clear launch options requested', { appId, appName });
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, '');
      const result = await getSteamAppDetails(appId);
      setLaunchOptions(getLaunchOptionsFromDetails(result.details));
      void logFrontendEvent('INFO', 'Launch options cleared', { appId, appName });
      toaster.toast({ title: 'Proton Pulse', body: t().toast.cleared });
    } catch (e) {
      void logFrontendEvent('ERROR', 'Failed to clear launch options', {
        appId,
        appName,
        error: e instanceof Error ? e.message : String(e),
      });
      console.error('Proton Pulse: failed to clear launch options', e);
      toaster.toast({ title: 'Proton Pulse', body: t().toast.clearFailed('check logs') });
    }
  };

  return (
    <Focusable onGamepadDirection={handleRootDirection} style={{ padding: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 13, color: '#ccc' }}>
        <strong>{appName || `App ${appId}`}</strong>
      </div>
      <div style={{ marginBottom: 6, fontSize: 11, color: '#888' }}>
        Current launch options from Steam app details:
      </div>
      <div
        style={{
          marginBottom: 12,
          padding: 10,
          borderRadius: 6,
          background: 'rgba(255,255,255,0.03)',
          color: launchOptions ? '#d8ebff' : '#888',
          fontSize: 11,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'monospace',
        }}
      >
        {loading ? 'Loading launch options…' : launchOptions || 'No launch options set.'}
      </div>
      <DialogButton onClick={handleClear} style={{ background: '#555' }}>
        Clear Launch Options
      </DialogButton>
    </Focusable>
  );
}
  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };
