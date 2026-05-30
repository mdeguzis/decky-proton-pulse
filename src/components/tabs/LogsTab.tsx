import { useEffect, useState } from 'react';
import { Focusable, DialogButton, showModal } from '@decky/ui';
import { t } from '../../lib/i18n';
import { getLogText, subscribeToLogs, getLogCount } from '../../lib/logger';
import { registerScreenshotAutomationHandler } from '../../lib/screenshotAutomation';
import { LogViewerModal } from '../LogViewerModal';

export function LogsTab() {
  const [logs, setLogs] = useState<string>('');
  const [entryCount, setEntryCount] = useState(0);

  useEffect(() => {
    const refreshLogs = () => {
      setLogs(getLogText());
      setEntryCount(getLogCount());
    };

    refreshLogs();
    const unsub = subscribeToLogs(refreshLogs);
    return unsub;
  }, []);

  const openViewer = () => {
    showModal(<LogViewerModal logs={logs} entryCount={entryCount} />);
  };

  useEffect(() => registerScreenshotAutomationHandler('logs/viewer', async () => {
    openViewer();
  }), [logs, entryCount]);

  useEffect(() => registerScreenshotAutomationHandler('logs/default', async () => {
    // Base tab capture only; no extra modal work needed.
  }), []);

  const lines = logs.split('\n').filter(Boolean);
  const latestLines = lines.slice(-5).join('\n');
  const strings = t().logs;

  return (
    // height: 100% lets the preview pane grow to fill the tab. Without it
    // the Focusable just sizes to its content and the preview sits as a
    // 250px floor with empty space below
    <Focusable style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ fontSize: 11, color: '#7a9bb5', lineHeight: 1.5 }}>
        {strings.viewerHint}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: '#9dc4e8' }}>{strings.entryCount(entryCount)}</div>
        <div style={{ fontSize: 11, color: '#6d8799' }}>{strings.openHint}</div>
      </div>

      <DialogButton onClick={openViewer}>
        {strings.openViewer}
      </DialogButton>

      <div
        style={{
          background: 'rgba(0,0,0,0.35)',
          borderRadius: 6,
          padding: 10,
          fontSize: 10,
          fontFamily: 'monospace',
          color: '#a7c0d7',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          lineHeight: 1.45,
          minHeight: 250,
          // flex: 1 makes the preview pane fill the remaining vertical
          // space in the tab. overflow: auto keeps long lines from
          // breaking the layout. The preview shows the last 5 lines so
          // overflow is rare but defensive
          flex: 1,
          overflow: 'auto',
        }}
      >
        {latestLines || strings.noLogs}
      </div>
    </Focusable>
  );
}
