// Full-viewport scrollable view of the user's ProtonDB-compatible system info.
// Small copy button lives in the top right. Mirrors LogViewerModal's layout
import { useEffect, useRef, useState } from 'react';
import { ModalRoot, Focusable, DialogButton, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { callable } from '@decky/api';
import { t } from '../lib/i18n';
import { toaster } from '../lib/notify';
import { logFrontendEvent } from '../lib/logger';
import { copyToClipboard } from '../lib/clipboard';

const getProtonDBSystemInfo = callable<[], string>('get_protondb_systeminfo');
const SCROLL_STEP = 120;

interface Props {
  closeModal?: () => void;
}

export function MyHardwareModal({ closeModal }: Props) {
  const extras = t().extras!;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sysinfo, setSysinfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void logFrontendEvent('INFO', 'My Hardware modal opened');
    getProtonDBSystemInfo()
      .then((info) => setSysinfo(info))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        void logFrontendEvent('ERROR', 'Failed to load system info for My Hardware modal', { error: msg });
        setError(msg);
      });
  }, []);

  const handleCopy = async () => {
    if (!sysinfo) return;
    try {
      const ok = await copyToClipboard(sysinfo);
      if (!ok) throw new Error('backend copy failed');
      setCopied(true);
      toaster.toast({ title: 'Proton Pulse', body: extras.myHardwareCopied() });
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: extras.myHardwareCopyFailed() });
    }
  };

  const handleDirection = (evt: GamepadEvent) => {
    const el = scrollRef.current;
    if (!el) return;

    if (evt.detail.button === GamepadButton.DIR_UP) {
      evt.preventDefault();
      el.scrollBy({
        top: el.scrollTop <= SCROLL_STEP ? -el.scrollTop : -SCROLL_STEP,
        behavior: 'auto',
      });
    } else if (evt.detail.button === GamepadButton.DIR_DOWN) {
      evt.preventDefault();
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      el.scrollBy({
        top: remaining <= SCROLL_STEP ? remaining : SCROLL_STEP,
        behavior: 'auto',
      });
    }
  };

  return (
    <ModalRoot
      onCancel={closeModal}
      bAllowFullSize
      className="proton-pulse-log-modal"
      modalClassName="proton-pulse-log-modal"
    >
      <style>{`
        .proton-pulse-log-modal,
        .proton-pulse-log-modal > div,
        .proton-pulse-log-modal .DialogContent_InnerWidth {
          padding: 0 !important;
          margin: 0 !important;
          max-width: 100vw !important;
          width: 100vw !important;
          max-height: 100vh !important;
        }
        .proton-pulse-log-modal .ModalPosition { inset: 0 !important; }
      `}</style>
      <Focusable
        onGamepadDirection={handleDirection}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 88px)',
          padding: '12px 16px 20px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e8f4ff', marginBottom: 4 }}>
              {extras.myHardwareTitle()}
            </div>
            <div style={{ fontSize: 11, color: '#7a9bb5' }}>
              {extras.myHardwareSubtitle()}
            </div>
          </div>
          <DialogButton
            onClick={handleCopy}
            disabled={!sysinfo}
            style={{
              minWidth: 0,
              width: 'auto',
              maxWidth: 110,
              padding: '4px 10px',
              fontSize: 11,
              flex: '0 0 auto',
            }}
          >
            {copied ? extras.myHardwareCopied() : extras.myHardwareCopy()}
          </DialogButton>
        </div>

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.42)',
            borderRadius: 6,
            padding: '10px 10px 24px',
            fontSize: 10,
            fontFamily: 'monospace',
            color: '#bbb',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            lineHeight: 1.45,
            minHeight: 0,
          }}
        >
          {error
            ? <span style={{ color: '#ff6b6b' }}>{extras.myHardwareLoadFailed(error)}</span>
            : sysinfo ?? extras.myHardwareLoading()}
        </div>
      </Focusable>
    </ModalRoot>
  );
}
