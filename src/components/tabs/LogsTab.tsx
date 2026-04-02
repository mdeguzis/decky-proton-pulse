// src/components/tabs/LogsTab.tsx
import { useEffect, useRef, useState } from 'react';
import { Focusable, GamepadButton, DialogButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { callable } from '@decky/api';

const getLogContents = callable<[], string>('get_log_contents');

const SCROLL_STEP = 80;

export function LogsTab() {
  const [logs, setLogs] = useState<string>('');
  const [focused, setFocused] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const focusScrollPane = () => {
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
    if (!autoFollow) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, autoFollow]);

  useEffect(() => {
    const timer = setTimeout(() => focusScrollPane(), 75);
    return () => clearTimeout(timer);
  }, []);

  // Dpad / left-stick up-down scroll while the log pane has gamepad focus.
  const handleDirection = (evt: GamepadEvent) => {
    if (!scrollRef.current) return;
    if (evt.detail.button === GamepadButton.DIR_UP) {
      setAutoFollow(false);
      scrollRef.current.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
    } else if (evt.detail.button === GamepadButton.DIR_DOWN) {
      setAutoFollow(false);
      scrollRef.current.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
    }
  };

  // Give the scroll div real DOM focus so Steam's right-stick-to-scroll fires.
  const handleFocus = () => focusScrollPane();
  const handleBlur = () => setFocused(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div
          style={{
            flex: 1,
            paddingLeft: 2,
            fontSize: 11,
            color: '#7a9bb5',
          }}
        >
          Move right to focus the log output. Use the right stick or D-pad up/down to scroll.
        </div>
        <DialogButton
          onClick={() => {
            setAutoFollow(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
            focusScrollPane();
          }}
          style={{
            minWidth: 0,
            padding: '2px 10px',
            fontSize: 10,
          }}
        >
          {autoFollow ? 'FOLLOWING' : 'JUMP TO LATEST'}
        </DialogButton>
      </div>
      <Focusable
        onGamepadDirection={handleDirection}
        onGamepadFocus={handleFocus}
        onGamepadBlur={handleBlur}
        style={{ flex: 1 }}
      >
        <div
          ref={scrollRef}
          tabIndex={0}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onWheel={() => setAutoFollow(false)}
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
          {logs || <span style={{ color: '#666' }}>No logs yet.</span>}
          <div ref={bottomRef} />
        </div>
      </Focusable>
    </div>
  );
}
