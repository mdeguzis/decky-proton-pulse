// src/components/tabs/LogsTab.tsx
import { useEffect, useRef, useState } from 'react';
import { Focusable, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { callable } from '@decky/api';

const getLogContents = callable<[], string>('get_log_contents');

const SCROLL_STEP = 80;

export function LogsTab() {
  const [logs, setLogs] = useState<string>('');
  const [focused, setFocused] = useState(false);
  const [paneActive, setPaneActive] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [showJumpHint, setShowJumpHint] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const focusScrollPane = () => {
    setPaneActive(true);
    setFocused(true);
    scrollRef.current?.focus();
  };

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const content = await getLogContents();
        if (active) setLogs(content);
      } catch {
        // log file may not exist yet
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!autoFollow || !paneActive) return;
    setShowJumpHint(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, autoFollow, paneActive]);

  // Dpad / left-stick up-down scroll while the log pane has gamepad focus.
  const handleDirection = (evt: GamepadEvent) => {
    if (!scrollRef.current) return;
    if (evt.detail.button === GamepadButton.DIR_RIGHT) {
      focusScrollPane();
      if (autoFollow) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      setPaneActive(false);
      setFocused(false);
      return;
    }
    if (!paneActive) return;
    if (evt.detail.button === GamepadButton.DIR_UP) {
      setAutoFollow(false);
      setShowJumpHint(true);
      scrollRef.current.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
    } else if (evt.detail.button === GamepadButton.DIR_DOWN) {
      setAutoFollow(false);
      setShowJumpHint(true);
      scrollRef.current.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
    }
  };

  const handleJumpToLatest = () => {
    setPaneActive(true);
    setAutoFollow(true);
    setShowJumpHint(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    focusScrollPane();
  };

  // Give the scroll div real DOM focus so Steam's right-stick-to-scroll fires.
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          marginBottom: 8,
          paddingLeft: 2,
          fontSize: 11,
          color: '#7a9bb5',
        }}
      >
        {autoFollow
          ? paneActive
            ? 'Logs focused. Right stick or D-pad scrolls.'
            : 'Move right to focus logs.'
          : 'Manual scroll active.'}
      </div>
      <Focusable
        onGamepadDirection={handleDirection}
        onGamepadFocus={handleFocus}
        onGamepadBlur={handleBlur}
        onOKButton={handleJumpToLatest}
        style={{ flex: 1 }}
      >
        <div
          ref={scrollRef}
          tabIndex={0}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
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
            outline: focused ? '2px solid rgba(255,255,255,0.3)' : 'none',
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
              Manual scroll active. Press A/OK to jump to latest log output.
            </div>
          )}
          {logs || <span style={{ color: '#666' }}>No logs yet.</span>}
          <div ref={bottomRef} />
        </div>
      </Focusable>
    </div>
  );
}
