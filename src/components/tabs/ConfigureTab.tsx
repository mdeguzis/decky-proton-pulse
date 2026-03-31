// src/components/tabs/ConfigureTab.tsx
import { useState, useEffect } from 'react';
import { DialogButton, Focusable } from '@decky/ui';
import { toaster, callable } from '@decky/api';
import { ReportCard } from '../ReportCard';
import { scoreReport, bucketByGpuTier } from '../../lib/scoring';
import type { ProtonDBReport, ScoredReport, SystemInfo, GpuVendor } from '../../types';

const fetchReports = callable<[app_id: string], ProtonDBReport[]>('fetch_protondb_reports');

interface Props {
  appId: number | null;
  appName: string;
  sysInfo: SystemInfo | null;
}

type FilterTier = GpuVendor | 'all';

export function ConfigureTab({ appId, appName, sysInfo }: Props) {
  const [reports, setReports] = useState<ProtonDBReport[]>([]);
  const [loading, setLoading] = useState(false);

  const gpuVendor = sysInfo?.gpu_vendor ?? null;
  const initialFilter: FilterTier = (gpuVendor === 'nvidia' || gpuVendor === 'amd') ? gpuVendor : 'other';
  const [filter, setFilter] = useState<FilterTier>(initialFilter);
  const [selected, setSelected] = useState<ScoredReport | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!appId) return;
    setLoading(true);
    setReports([]);
    setSelected(null);
    fetchReports(String(appId))
      .then(setReports)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [appId]);

  if (!appId) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        Navigate to a game first.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        Fetching ProtonDB reports…
      </div>
    );
  }

  if (!sysInfo || reports.length === 0) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        {!sysInfo ? 'Loading system info…' : 'No ProtonDB reports found for this game.'}
      </div>
    );
  }

  const scored = reports.map(r => scoreReport(r, sysInfo));
  const buckets = bucketByGpuTier(scored);

  const visibleReports: ScoredReport[] = filter === 'all'
    ? [...buckets.nvidia, ...buckets.amd, ...buckets.other]
    : filter === 'nvidia' ? buckets.nvidia
    : filter === 'amd'    ? buckets.amd
    :                       buckets.other;

  const FILTER_OPTIONS: Array<{ value: FilterTier; label: string }> = [
    { value: 'nvidia', label: 'NVIDIA' },
    { value: 'amd',   label: 'AMD'   },
    { value: 'other', label: 'Other' },
    { value: 'all',   label: 'All'   },
  ];

  const handleApply = async () => {
    if (!selected || !appId) return;
    const running = (SteamClient.GameSessions as any).GetRunningApps();
    if (running.length > 0) {
      toaster.toast({ title: 'Proton Pulse', body: 'Quit your game first.' });
      return;
    }
    setApplying(true);
    try {
      const launchOptions = `STEAM_COMPAT_TOOL_INSTALL_PATH="" PROTON_VERSION="${selected.protonVersion}" %command%`;
      await SteamClient.Apps.SetAppLaunchOptions(appId, launchOptions);
      toaster.toast({ title: 'Proton Pulse', body: `Launch options applied for ${appName}` });
    } catch (e) {
      console.error('Proton Pulse: failed to apply launch options', e);
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to apply — check logs.' });
    } finally {
      setApplying(false);
    }
  };

  const handleClear = async () => {
    if (!appId) return;
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, '');
      toaster.toast({ title: 'Proton Pulse', body: 'Launch options cleared.' });
    } catch (e) {
      console.error('Proton Pulse: failed to clear launch options', e);
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to clear — check logs.' });
    }
  };

  return (
    <Focusable style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {FILTER_OPTIONS.map(({ value, label }) => (
          <DialogButton
            key={value}
            onClick={() => setFilter(value)}
            style={{
              padding: '3px 10px', minWidth: 0, flex: '0 0 auto',
              fontWeight: filter === value ? 700 : 400,
              background: filter === value ? '#4c9eff' : '#333',
              color: filter === value ? '#fff' : '#aaa',
              fontSize: 11,
            }}
          >
            {label}
          </DialogButton>
        ))}
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {visibleReports.length === 0 ? (
          <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
            No ProtonDB reports found for this GPU tier.
          </div>
        ) : (
          visibleReports.map((r) => (
            <ReportCard
              key={r.timestamp + '-' + r.protonVersion}
              report={r}
              selected={selected === r}
              onSelect={setSelected}
            />
          ))
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <DialogButton onClick={handleClear} style={{ background: '#555', flex: '0 0 auto' }}>Clear</DialogButton>
        <DialogButton
          onClick={handleApply}
          disabled={!selected || applying}
          style={{ background: selected ? '#4c9eff' : '#333', flex: '0 0 auto' }}
        >
          {applying ? 'Applying…' : 'Apply'}
        </DialogButton>
      </div>
    </Focusable>
  );
}
