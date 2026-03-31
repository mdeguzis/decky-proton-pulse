// src/components/Modal.tsx
import { useState } from 'react';
import { DialogButton, ModalRoot, DialogHeader } from '@decky/ui';
import { toaster } from '@decky/api';
import { ReportCard } from './ReportCard';
import { scoreReport, bucketByGpuTier } from '../lib/scoring';
import type { ProtonDBReport, ScoredReport, SystemInfo, GpuVendor } from '../types';

interface Props {
  appId: number;
  appName: string;
  reports: ProtonDBReport[];
  sysInfo: SystemInfo;
  closeModal: () => void;
}

type FilterTier = GpuVendor | 'all';

export function ProtonPulseModal({ appId, appName, reports, sysInfo, closeModal }: Props) {
  const scored = reports.map(r => scoreReport(r, sysInfo));
  const buckets = bucketByGpuTier(scored);

  const gpuVendor = sysInfo.gpu_vendor;
  const initialFilter: FilterTier = (gpuVendor === 'nvidia' || gpuVendor === 'amd') ? gpuVendor : 'other';
  const [filter, setFilter] = useState<FilterTier>(initialFilter);
  const [selected, setSelected] = useState<ScoredReport | null>(null);
  const [applying, setApplying] = useState(false);

  const visibleReports: ScoredReport[] = filter === 'all'
    ? [...buckets.nvidia, ...buckets.amd, ...buckets.other]
    : filter === 'nvidia' ? buckets.nvidia
    : filter === 'amd'    ? buckets.amd
    :                       buckets.other;

  const handleApply = async () => {
    if (!selected) return;
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
      closeModal();
    } catch (e) {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to apply — check logs.' });
    } finally {
      setApplying(false);
    }
  };

  const handleClear = async () => {
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, '');
      toaster.toast({ title: 'Proton Pulse', body: 'Launch options cleared.' });
      closeModal();
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to clear — check logs.' });
    }
  };

  const FILTER_OPTIONS: Array<{ value: FilterTier; label: string }> = [
    { value: 'nvidia', label: 'NVIDIA' },
    { value: 'amd',   label: 'AMD'   },
    { value: 'other', label: 'Other' },
    { value: 'all',   label: 'All'   },
  ];

  return (
    <ModalRoot onCancel={closeModal}>
      <DialogHeader>Proton Pulse — {appName}</DialogHeader>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {FILTER_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            style={{
              padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
              fontWeight: filter === value ? 700 : 400,
              background: filter === value ? '#4c9eff' : '#333',
              color: filter === value ? '#fff' : '#aaa',
              fontSize: 11,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ maxHeight: 360, overflowY: 'auto', marginBottom: 10 }}>
        {visibleReports.length === 0 ? (
          <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
            No ProtonDB reports found for this GPU tier.
          </div>
        ) : (
          visibleReports.map((r, i) => (
            <ReportCard
              key={i}
              report={r}
              selected={selected === r}
              onSelect={setSelected}
            />
          ))
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <DialogButton onClick={handleClear} style={{ background: '#555' }}>Clear</DialogButton>
        <DialogButton onClick={closeModal} style={{ background: '#333' }}>Exit</DialogButton>
        <DialogButton
          onClick={handleApply}
          disabled={!selected || applying}
          style={{ background: selected ? '#4c9eff' : '#333' }}
        >
          {applying ? 'Applying…' : 'Apply ▶'}
        </DialogButton>
      </div>
    </ModalRoot>
  );
}
