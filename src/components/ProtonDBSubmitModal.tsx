// src/components/ProtonDBSubmitModal.tsx
import { useState, useEffect } from 'react';
import { ModalRoot, Focusable, DialogButton, Navigation } from '@decky/ui';
import { callable, toaster } from '@decky/api';
import { t } from '../lib/i18n';
import { logFrontendEvent } from '../lib/logger';

const getProtonDBSystemInfo = callable<[], string>('get_protondb_systeminfo');

interface Props {
  appId: number | null;
  appName: string;
  closeModal?: () => void;
}

export function ProtonDBSubmitModal({ appId, appName, closeModal }: Props) {
  const [systemInfo, setSystemInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void logFrontendEvent('INFO', 'ProtonDB submit modal opened', { appId, appName });
    getProtonDBSystemInfo()
      .then((info) => setSystemInfo(info))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        void logFrontendEvent('ERROR', 'Failed to get ProtonDB system info', { error: msg });
        setError(msg);
      });
  }, []);

  const handleCopy = async () => {
    if (!systemInfo) return;
    try {
      await navigator.clipboard.writeText(systemInfo);
      setCopied(true);
      toaster.toast({ title: 'Proton Pulse', body: t().protondbSubmit.copiedToClipboard });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: t().protondbSubmit.copyFailed });
    }
  };

  const handleOpen = () => {
    const url = appId
      ? `https://www.protondb.com/contribute?appId=${appId}`
      : 'https://www.protondb.com/contribute';
    Navigation.NavigateToExternalWeb(url);
    void logFrontendEvent('INFO', 'Opened ProtonDB contribute page', { appId, url });
  };

  const handleCopyAndOpen = async () => {
    await handleCopy();
    handleOpen();
  };

  const strings = t().protondbSubmit;

  return (
    <ModalRoot onCancel={closeModal}>
      <div style={{ padding: 16, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e8f4ff', marginBottom: 4 }}>
          {strings.title}
        </div>
        {appName && (
          <div style={{ fontSize: 12, color: '#7a9bb5', marginBottom: 12 }}>
            {appName}{appId ? ` (${appId})` : ''}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#9dc4e8', lineHeight: 1.5, marginBottom: 12 }}>
          {strings.instructions}
        </div>

        {/* System info preview */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.4)',
            borderRadius: 6,
            padding: 10,
            fontFamily: 'monospace',
            fontSize: 9,
            color: '#9dc4e8',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            lineHeight: 1.4,
            marginBottom: 12,
            maxHeight: '40vh',
          }}
        >
          {error
            ? <span style={{ color: '#ff6b6b' }}>{strings.generateFailed}: {error}</span>
            : systemInfo ?? strings.generating}
        </div>

        {/* Actions */}
        <Focusable style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <DialogButton
            onClick={handleCopyAndOpen}
            disabled={!systemInfo}
            style={{ flex: 1, minWidth: 120, padding: '8px 16px', fontSize: 12 }}
          >
            {strings.copyAndOpen}
          </DialogButton>
          <DialogButton
            onClick={handleCopy}
            disabled={!systemInfo}
            style={{ minWidth: 80, padding: '8px 12px', fontSize: 12, background: '#444' }}
          >
            {copied ? strings.copied : strings.copyInfo}
          </DialogButton>
          <DialogButton
            onClick={() => closeModal?.()}
            style={{ minWidth: 60, padding: '8px 12px', fontSize: 12, background: '#555' }}
          >
            {t().common.close}
          </DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
}
