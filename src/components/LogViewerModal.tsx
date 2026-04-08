import { useEffect, useRef, useState } from 'react';
import { ModalRoot, Focusable, DialogButton, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { t } from '../lib/i18n';
import { toaster } from '../lib/notify';

const SCROLL_STEP = 120;

interface Props {
  logs: string;
  entryCount: number;
  closeModal?: () => void;
}

export function LogViewerModal({ logs, entryCount, closeModal }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const initializedRef = useRef(false);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      el.scrollTop = 0;
    }
  }, [logs]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      toaster.toast({ title: 'Proton Pulse', body: t().logs.copiedToClipboard });
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: t().logs.copyFailed });
    }
  };

  const handleDirection = (evt: GamepadEvent) => {
    if (!scrollRef.current) return;
    if (evt.detail.button === GamepadButton.DIR_UP) {
      evt.preventDefault();
      scrollRef.current.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
    } else if (evt.detail.button === GamepadButton.DIR_DOWN) {
      evt.preventDefault();
      scrollRef.current.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
    }
  };

  const strings = t().logs;

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
          height: 'calc(100vh - 40px)',
          padding: '12px 16px 16px',
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
              {strings.viewerTitle}
            </div>
            <div style={{ fontSize: 11, color: '#7a9bb5' }}>
              {strings.entryCount(entryCount)}
            </div>
          </div>
          <Focusable
            flow-children="horizontal"
            style={{ display: 'flex', gap: 8, flexShrink: 0, alignSelf: 'flex-start' }}
            onGamepadDirection={(evt: GamepadEvent) => {
              // Only consume left/right here; let up/down bubble to the scroll handler
              if (
                evt.detail.button === GamepadButton.DIR_LEFT ||
                evt.detail.button === GamepadButton.DIR_RIGHT
              ) {
                return; // let Focusable handle horizontal focus movement
              }
            }}
          >
            <DialogButton
              onClick={scrollToBottom}
              style={{
                minWidth: 0,
                width: 'auto',
                maxWidth: 150,
                padding: '4px 10px',
                fontSize: 11,
                flex: '0 0 auto',
              }}
            >
              {strings.jumpToLatest}
            </DialogButton>
            <DialogButton
              onClick={handleCopy}
              style={{
                minWidth: 0,
                width: 'auto',
                maxWidth: 120,
                padding: '4px 10px',
                fontSize: 11,
                flex: '0 0 auto',
              }}
            >
              {copied ? strings.copied : strings.copyLogs}
            </DialogButton>
          </Focusable>
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
          {logs || <span style={{ color: '#666' }}>{strings.noLogs}</span>}
        </div>
      </Focusable>
    </ModalRoot>
  );
}
