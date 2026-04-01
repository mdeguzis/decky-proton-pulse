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
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Dpad / left-stick up-down scroll while the log pane has gamepad focus.
  const handleDirection = (evt: GamepadEvent) => {
    if (!scrollRef.current) return;
    if (evt.detail.button === GamepadButton.DIR_UP) {
      scrollRef.current.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
    } else if (evt.detail.button === GamepadButton.DIR_DOWN) {
      scrollRef.current.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
    }
  };

  // Give the scroll div real DOM focus so Steam's right-stick-to-scroll fires.
  const handleFocus = () => {
    setFocused(true);
    scrollRef.current?.focus();
  };
  const handleBlur = () => setFocused(false);

  return (
    <Focusable
      onGamepadDirection={handleDirection}
      onGamepadFocus={handleFocus}
      onGamepadBlur={handleBlur}
    >
      <div
        ref={scrollRef}
        tabIndex={0}
        style={{
          height: 460,
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
  );
}
