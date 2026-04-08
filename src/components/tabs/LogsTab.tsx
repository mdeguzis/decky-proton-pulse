// src/components/tabs/LogsTab.tsx
//
// Shows live plugin logs from the frontend ring buffer. Logs appear
// instantly since they come from the in-memory buffer, not the Python
// backend file. Auto-scrolls to the bottom by default, with dpad/
// stick scrolling support.
import { useEffect, useRef, useState, useCallback } from 'react';
import { Focusable, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { t } from '../../lib/i18n';
import { getLogText, subscribeToLogs, getLogCount } from '../../lib/logger';

const SCROLL_STEP = 80;

export function LogsTab() {
  const [logs, setLogs] = useState<string>('');
  const [focused, setFocused] = useState(false);
  const [paneActive, setPaneActive] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [showJumpHint, setShowJumpHint] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshLogs = useCallback(() => {
    setLogs(getLogText());
  }, []);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const focusScrollPane = () => {
    setPaneActive(true);
    setFocused(true);
    if (autoFollow) {
      scrollToBottom();
    }
  };

  // subscribe to frontend log buffer for live updates
  useEffect(() => {
    refreshLogs(); // initial load
    const unsub = subscribeToLogs(refreshLogs);
    return unsub;
  }, [refreshLogs]);

  // auto-scroll to bottom when new logs come in.
  // scrollIntoView doesn't work reliably here because Decky's tab
  // containers don't always give us a properly constrained height,
  // so we set scrollTop directly on the scroll container instead
  useEffect(() => {
    if (!autoFollow) return;
    setShowJumpHint(false);
    scrollToBottom();
  }, [logs, autoFollow]);

  const handleDirection = (evt: GamepadEvent) => {
    if (!scrollRef.current) return;
    if (evt.detail.button === GamepadButton.DIR_RIGHT) {
      evt.preventDefault();
      focusScrollPane();
      return;
    }
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      setPaneActive(false);
      evt.preventDefault();
      return;
    }
    if (!paneActive) return;
    if (evt.detail.button === GamepadButton.DIR_UP) {
      evt.preventDefault();
      setAutoFollow(false);
      setShowJumpHint(true);
      scrollRef.current.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
    } else if (evt.detail.button === GamepadButton.DIR_DOWN) {
      evt.preventDefault();
      setAutoFollow(false);
      setShowJumpHint(true);
      scrollRef.current.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
    }
  };

  const handleJumpToLatest = () => {
    setPaneActive(true);
    setAutoFollow(true);
    setShowJumpHint(false);
    scrollToBottom();
    focusScrollPane();
  };

  const handleFocus = () => {
    focusScrollPane();
  };
  const handleBlur = () => {
    setFocused(false);
    setPaneActive(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* log count header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: '#7a9bb5' }}>
          {autoFollow
            ? paneActive
              ? t().logs.focused
              : t().logs.moveRight
            : t().logs.manualScroll}
        </div>
        <div style={{ fontSize: 10, color: '#556b7a' }}>
          {t().logs.entryCount(getLogCount())}
        </div>
      </div>
      <Focusable
        onButtonDown={handleDirection}
        onGamepadDirection={handleDirection}
        onGamepadFocus={handleFocus}
        onGamepadBlur={handleBlur}
        onOKButton={handleJumpToLatest}
        style={{ flex: 1 }}
      >
        <div
          ref={scrollRef}
          onWheel={() => {
            setAutoFollow(false);
            setShowJumpHint(true);
          }}
          onClick={() => focusScrollPane()}
          style={{
            height: '100%',
            minHeight: 460,
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.4)',
            borderRadius: 4,
            padding: 8,
            fontSize: 10,
            fontFamily: 'monospace',
            color: '#bbb',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            outline: focused && paneActive ? '2px solid rgba(255,255,255,0.3)' : 'none',
          }}
        >
          {!autoFollow && showJumpHint && (
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
                marginBottom: 8,
                padding: '4px 8px',
                borderRadius: 6,
                background: 'rgba(17, 31, 47, 0.92)',
                color: '#9dc4e8',
                fontSize: 10,
              }}
            >
              {t().logs.jumpHint}
            </div>
          )}
          {logs || <span style={{ color: '#666' }}>{t().logs.noLogs}</span>}
        </div>
      </Focusable>
    </div>
  );
}
