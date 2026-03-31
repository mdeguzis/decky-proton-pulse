// src/components/tabs/LogsTab.tsx
import { useEffect, useRef, useState } from 'react';
import { callable } from '@decky/api';

const getLogContents = callable<[], string>('get_log_contents');

export function LogsTab() {
  const [logs, setLogs] = useState<string>('');
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

  return (
    <div
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
      }}
    >
      {logs || <span style={{ color: '#666' }}>No logs yet.</span>}
      <div ref={bottomRef} />
    </div>
  );
}
