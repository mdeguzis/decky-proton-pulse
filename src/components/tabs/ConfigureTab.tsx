// src/components/tabs/ConfigureTab.tsx
import { useState, useEffect } from 'react';
import { DialogButton, Focusable } from '@decky/ui';
import { toaster } from '@decky/api';
import { ReportCard } from '../ReportCard';
import { scoreReport, bucketByGpuTier } from '../../lib/scoring';
import { getProtonDBReports, getVotes, postUpvote } from '../../lib/protondb';
import { getSetting } from '../../lib/settings';
import type { CdnReport, ScoredReport, SystemInfo, GpuVendor } from '../../types';

interface Props {
  appId: number | null;
  appName: string;
  sysInfo: SystemInfo | null;
}

type FilterTier = GpuVendor | 'all';
type SortMode = 'score' | 'votes';

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

const reportKey = (r: CdnReport) => `${r.timestamp}_${r.protonVersion}`;

const FILTER_ORDER: FilterTier[] = ['nvidia', 'amd', 'other', 'all'];
const FILTER_LABELS: Record<FilterTier, string> = {
  nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', other: 'Other', all: 'All',
};

export function ConfigureTab({ appId, appName, sysInfo }: Props) {
  const [reports, setReports]   = useState<CdnReport[]>([]);
  const [votes, setVotes]       = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState<ScoredReport | null>(null);
  const [applying, setApplying] = useState(false);
  const [upvoting, setUpvoting] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('score');

  const gpuVendor = sysInfo?.gpu_vendor ?? null;
  const initialFilter: FilterTier =
    gpuVendor === 'nvidia' || gpuVendor === 'amd' || gpuVendor === 'intel' ? gpuVendor : 'other';
  const [filter, setFilter] = useState<FilterTier>(initialFilter);

  useEffect(() => {
    if (!appId) return;
    setLoading(true);
    setReports([]);
    setVotes({});
    setSelected(null);
    Promise.all([getProtonDBReports(String(appId)), getVotes(String(appId))])
      .then(([r, v]) => { setReports(r); setVotes(v); })
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

  const scored: ScoredReport[] = reports.map(r => ({
    ...scoreReport(r, sysInfo),
    upvotes: votes[reportKey(r)] ?? 0,
  }));

  const buckets = bucketByGpuTier(scored);

  const visibleReports: ScoredReport[] =
    filter === 'all'                       ? [...buckets.nvidia, ...buckets.amd, ...buckets.other] :
    filter === 'nvidia'                    ? buckets.nvidia :
    filter === 'amd'                       ? buckets.amd :
    filter === 'intel' || filter === 'other' ? buckets.other :
                                               buckets.other;

  const sortedReports =
    sortMode === 'votes'
      ? [...visibleReports].sort((a, b) => b.upvotes - a.upvotes)
      : visibleReports;

  const cycleFilter = () => {
    const idx = FILTER_ORDER.indexOf(filter);
    setFilter(FILTER_ORDER[(idx + 1) % FILTER_ORDER.length]);
  };

  const handleApply = async () => {
    if (!selected || !appId) return;
    const running = (SteamClient.GameSessions as any).GetRunningApps();
    if (running.length > 0) {
      toaster.toast({ title: 'Proton Pulse', body: 'Quit your game first.' });
      return;
    }
    setApplying(true);
    try {
      await SteamClient.Apps.SetAppLaunchOptions(
        appId, `PROTON_VERSION="${selected.protonVersion}" %command%`
      );
      toaster.toast({ title: 'Proton Pulse', body: `Applied for ${appName}` });
    } catch (e) {
      console.error('Proton Pulse: apply failed', e);
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to apply — check logs.' });
    } finally {
      setApplying(false);
    }
  };

  const handleUpvote = async () => {
    if (!selected || !appId) return;
    const token = getSetting<string>('gh-votes-token', '');
    if (!token) {
      toaster.toast({ title: 'Proton Pulse', body: 'Set a GitHub token in Settings to upvote.' });
      return;
    }
    setUpvoting(true);
    try {
      const ok = await postUpvote(String(appId), reportKey(selected), token);
      if (ok) {
        toaster.toast({ title: 'Proton Pulse', body: 'Vote submitted! Count updates in ~60s.' });
        const capturedAppId = appId;
        setTimeout(() => {
          if (capturedAppId) getVotes(String(capturedAppId)).then(setVotes).catch(console.error);
        }, 90_000);
      } else {
        toaster.toast({ title: 'Proton Pulse', body: 'Vote failed. Check the token value and its repo/actions permissions.' });
      }
    } finally {
      setUpvoting(false);
    }
  };

  const btnStyle = (active?: boolean) => ({
    padding: '3px 8px', minWidth: 0, flex: '0 0 auto', fontSize: 10,
    background: active ? '#4c9eff' : '#333',
    color: active ? '#fff' : '#aaa',
  });

  return (
    <Focusable style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <img
          src={STEAM_HEADER_URL(appId)}
          style={{ height: 40, borderRadius: 3, objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff' }}>
            {appName}
          </div>
          <div style={{ fontSize: 11, color: '#7a9bb5' }}>
            {reports.length} community reports
          </div>
        </div>
      </div>

      {/* Report list */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 8 }}>
        {sortedReports.length === 0 ? (
          <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
            No reports for this GPU tier.
          </div>
        ) : (
          sortedReports.map(r => (
            <ReportCard
              key={reportKey(r)}
              report={r}
              selected={selected !== null && reportKey(selected) === reportKey(r)}
              onSelect={setSelected}
            />
          ))
        )}
      </div>

      {/* Bottom action bar */}
      <div style={{
        display: 'flex', gap: 4, flexWrap: 'wrap',
        paddingTop: 6, borderTop: '1px solid #2a3a4a',
      }}>
        <DialogButton onClick={() => setSortMode('votes')} style={btnStyle(sortMode === 'votes')}>
          SORT BY VOTES
        </DialogButton>
        <DialogButton onClick={() => setSortMode('score')} style={btnStyle(sortMode === 'score')}>
          SORT BY SCORE
        </DialogButton>
        <DialogButton onClick={cycleFilter} style={btnStyle()}>
          FILTER: {FILTER_LABELS[filter]}
        </DialogButton>
        <div style={{ flex: 1 }} />
        <DialogButton
          onClick={handleApply}
          disabled={!selected || applying}
          style={btnStyle(!!selected)}
        >
          {applying ? 'APPLYING…' : 'APPLY'}
        </DialogButton>
        <DialogButton
          onClick={handleUpvote}
          disabled={!selected || upvoting}
          style={{ ...btnStyle(), color: '#ffd700' }}
        >
          {upvoting ? '★ …' : '★ UPVOTE'}
        </DialogButton>
      </div>
    </Focusable>
  );
}
