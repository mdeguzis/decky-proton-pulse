import { useEffect, useRef, useState } from 'react';
import { ModalRoot, Focusable, DialogButton, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { t } from '../lib/i18n';
import { toaster } from '../lib/notify';
import { logFrontendEvent } from '../lib/logger';

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

  const copyLogsToClipboard = async (): Promise<void> => {
    void logFrontendEvent('DEBUG', 'Attempting to copy logs to clipboard', {
      entryCount,
      logLength: logs.length,
    });

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(logs);
        void logFrontendEvent('INFO', 'Copied logs with navigator.clipboard.writeText', {
          entryCount,
          logLength: logs.length,
        });
        return;
      } catch (error) {
        void logFrontendEvent('WARNING', 'navigator.clipboard.writeText failed for logs', {
          error: error instanceof Error ? error.message : String(error),
          entryCount,
          logLength: logs.length,
        });
      }
    }

    void logFrontendEvent('DEBUG', 'Falling back to document.execCommand for log copy', {
      entryCount,
      logLength: logs.length,
    });

    const textarea = document.createElement('textarea');
    textarea.value = logs;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    try {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const copied = document.execCommand('copy');
      if (!copied) {
        throw new Error('document.execCommand returned false');
      }
      void logFrontendEvent('INFO', 'Copied logs with document.execCommand fallback', {
        entryCount,
        logLength: logs.length,
      });
    } finally {
      document.body.removeChild(textarea);
    }
  };

  const handleCopy = async () => {
    try {
      await copyLogsToClipboard();
      setCopied(true);
      void logFrontendEvent('INFO', 'Log copy action completed successfully', {
        entryCount,
        logLength: logs.length,
      });
      toaster.toast({ title: 'Proton Pulse', body: t().logs.copiedToClipboard });
      window.setTimeout(() => setCopied(false), 2500);
    } catch (error) {
      void logFrontendEvent('ERROR', 'Failed to copy logs to clipboard', {
        error: error instanceof Error ? error.message : String(error),
        entryCount,
        logLength: logs.length,
      });
      toaster.toast({ title: 'Proton Pulse', body: t().logs.copyFailed });
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
          height: 'calc(100vh - 88px)',
          padding: '12px 16px 0',
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
            onGamepadDirection={handleDirection}
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
