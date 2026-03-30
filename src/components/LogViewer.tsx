// src/components/LogViewer.tsx
import { useEffect, useRef, useState } from 'react';
import { callable } from '@decky/api';

const getLogContents = callable<[], string>('get_log_contents');

export function LogViewer() {
  const [logs, setLogs] = useState<string>('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const content = await getLogContents();
        if (active) setLogs(content);
      } catch {
        // silently ignore — log file may not exist yet
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

  if (!logs) {
    return (
      <div style={{ color: '#666', fontSize: 11, padding: 8 }}>
        No logs yet.
      </div>
    );
  }

  return (
    <div style={{
      maxHeight: 200,
      overflowY: 'auto',
      background: 'rgba(0,0,0,0.4)',
      borderRadius: 4,
      padding: 6,
      fontSize: 10,
      fontFamily: 'monospace',
      color: '#bbb',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    }}>
      {logs}
      <div ref={bottomRef} />
    </div>
  );
}
