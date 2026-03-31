// src/components/tabs/ManageTab.tsx
import { DialogButton, Focusable } from '@decky/ui';
import { toaster } from '@decky/api';

interface Props {
  appId: number | null;
  appName: string;
}

export function ManageTab({ appId, appName }: Props) {
  if (!appId) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        Navigate to a game first.
      </div>
    );
  }

  const handleClear = async () => {
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, '');
      toaster.toast({ title: 'Proton Pulse', body: 'Launch options cleared.' });
    } catch (e) {
      console.error('Proton Pulse: failed to clear launch options', e);
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to clear — check logs.' });
    }
  };

  return (
    <Focusable style={{ padding: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 13, color: '#ccc' }}>
        <strong>{appName || `App ${appId}`}</strong>
      </div>
      <div style={{ marginBottom: 12, fontSize: 11, color: '#888' }}>
        To view current launch options, open Steam → Library → right-click the game → Properties → General.
      </div>
      <DialogButton onClick={handleClear} style={{ background: '#555' }}>
        Clear Launch Options
      </DialogButton>
    </Focusable>
  );
}
