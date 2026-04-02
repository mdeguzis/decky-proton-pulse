// src/components/tabs/ConfigureTab.tsx
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { DialogButton, Focusable, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { toaster } from '@decky/api';
import { ReportCard } from '../ReportCard';
import { scoreReport, bucketByGpuTier } from '../../lib/scoring';
import {
  getProtonDBReportsWithDiagnostics,
  getVotes,
  getVotesWithDiagnostics,
  postUpvote,
  type ReportFetchDiagnostics,
  type VotesFetchDiagnostics,
} from '../../lib/protondb';
import { getSetting } from '../../lib/settings';
import type { CdnReport, ScoredReport, SystemInfo, GpuVendor } from '../../types';
import { logFrontendEvent } from '../../lib/logger';

interface Props {
  appId: number | null;
  appName: string;
  sysInfo: SystemInfo | null;
}

type FilterTier = GpuVendor | 'all';
type SortMode = 'score' | 'votes';
type ActivePane = 'list' | 'detail';

const LIST_SCROLL_STEP = 92;
const DETAIL_SCROLL_STEP = 120;

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

const reportKey = (r: CdnReport) => `${r.timestamp}_${r.protonVersion}`;

const FILTER_ORDER: FilterTier[] = ['nvidia', 'amd', 'other', 'all'];
const FILTER_LABELS: Record<FilterTier, string> = {
  nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', other: 'Other', all: 'All',
};
const SORT_LABELS: Record<SortMode, string> = {
  score: 'Best Match',
  votes: 'Most Votes',
};

function GameSummaryHeader({
  appId,
  appName,
  reportsCount,
}: {
  appId: number;
  appName: string;
  reportsCount?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <img
        src={STEAM_HEADER_URL(appId)}
        style={{ height: 40, borderRadius: 3, objectFit: 'cover' }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff' }}>
          {appName || `App ${appId}`}
        </div>
        <div style={{ fontSize: 11, color: '#7a9bb5' }}>
          AppID {appId}
          {typeof reportsCount === 'number' ? ` · ${reportsCount} community reports` : ''}
        </div>
      </div>
    </div>
  );
}

function buildLaunchOptionPreview(protonVersion: string): string {
  return `PROTON_VERSION="${protonVersion}" %command%`;
}

function formatAge(days: number): string {
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString();
}

function matchLabel(report: ScoredReport, sysInfo: SystemInfo | null): string {
  if (!sysInfo?.gpu_vendor || report.gpuTier === 'unknown') return 'Unknown GPU match';
  return report.gpuTier === sysInfo.gpu_vendor ? 'Matches your GPU vendor' : 'Different GPU vendor';
}

function ToolbarGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(120, 150, 180, 0.18)',
      }}
    >
      <span style={{ fontSize: 10, color: '#7a9bb5', letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function ConfigureTab({ appId, appName, sysInfo }: Props) {
  const [reports, setReports]   = useState<CdnReport[]>([]);
  const [votes, setVotes]       = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState<ScoredReport | null>(null);
  const [activePane, setActivePane] = useState<ActivePane>('list');
  const [listFocused, setListFocused] = useState(false);
  const [detailFocused, setDetailFocused] = useState(false);
  const [applying, setApplying] = useState(false);
  const [upvoting, setUpvoting] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('score');
  const [reportDiagnostics, setReportDiagnostics] = useState<ReportFetchDiagnostics | null>(null);
  const [voteDiagnostics, setVoteDiagnostics] = useState<VotesFetchDiagnostics | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const gpuVendor = sysInfo?.gpu_vendor ?? null;
  const initialFilter: FilterTier =
    gpuVendor === 'nvidia' || gpuVendor === 'amd' || gpuVendor === 'intel' ? gpuVendor : 'other';
  const [filter, setFilter] = useState<FilterTier>(initialFilter);

  useEffect(() => {
    if (!appId) return;
    logFrontendEvent('INFO', 'Opening Manage This Game', {
      appId,
      appName,
      hasSystemInfo: !!sysInfo,
      gpuVendor: sysInfo?.gpu_vendor ?? null,
    });
    setLoading(true);
    setReports([]);
    setVotes({});
    setSelected(null);
    setActivePane('list');
    setReportDiagnostics(null);
    setVoteDiagnostics(null);
    Promise.all([getProtonDBReportsWithDiagnostics(String(appId)), getVotesWithDiagnostics(String(appId))])
      .then(([reportResult, voteResult]) => {
        const r = reportResult.reports;
        const v = voteResult.votes;
        logFrontendEvent('INFO', 'Manage This Game data loaded', {
          appId,
          appName,
          reportCount: r.length,
          voteCount: Object.keys(v).length,
        });
        setReports(r);
        setVotes(v);
        setReportDiagnostics(reportResult.diagnostics);
        setVoteDiagnostics(voteResult.diagnostics);
      })
      .catch((error) => {
        logFrontendEvent('ERROR', 'Manage This Game load failed', {
          appId,
          appName,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(error);
      })
      .finally(() => setLoading(false));
  }, [appId, appName]);

  if (!appId) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        Navigate to a game first.
      </div>
    );
  }

  if (loading) {
    return (
      <Focusable style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <GameSummaryHeader appId={appId} appName={appName} />
        <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
          Fetching ProtonDB reports…
        </div>
      </Focusable>
    );
  }

  if (!sysInfo || reports.length === 0) {
    const diagnosticsLines = !sysInfo
        ? []
        : [
          `Tried App ID ${appId}`,
          reportDiagnostics
            ? `Primary source: ${reportDiagnostics.source}`
            : 'Primary source: pending',
          reportDiagnostics
            ? `Report index response: ${reportDiagnostics.indexStatus ?? 'request failed'}`
            : 'Report index response: pending',
          reportDiagnostics
            ? `Live detailed fallback: ${reportDiagnostics.liveDetailedStatus ?? 'not tried'}${reportDiagnostics.liveDetailedCount !== null ? ` · ${reportDiagnostics.liveDetailedCount} rows` : ''}`
            : 'Live detailed fallback: pending',
          reportDiagnostics && reportDiagnostics.source === 'live-summary'
            ? `Live ProtonDB summary: ${reportDiagnostics.liveSummaryStatus ?? 'request failed'} · ${reportDiagnostics.liveSummaryTotal ?? 0} reports · ${reportDiagnostics.liveSummaryTier ?? 'unknown'} tier`
            : reportDiagnostics
              ? `Live ProtonDB summary: ${reportDiagnostics.liveSummaryStatus ?? 'not tried'}`
              : 'Live ProtonDB summary: pending',
          voteDiagnostics
            ? `Votes response: ${voteDiagnostics.status ?? 'request failed'}`
            : 'Votes response: pending',
        ];
    return (
      <Focusable style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <GameSummaryHeader appId={appId} appName={appName} reportsCount={reports.length} />
        <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
          {!sysInfo ? 'Loading system info…' : 'No ProtonDB reports found for this game.'}
        </div>
        {reportDiagnostics?.source === 'live-summary' && (
          <div style={{ padding: '0 16px 12px', color: '#9dc4e8', fontSize: 11, textAlign: 'center' }}>
            ProtonDB live summary exists, but detailed report cards were not available from the mirror or live detailed fallback.
          </div>
        )}
        {!!diagnosticsLines.length && (
          <div
            style={{
              margin: '0 16px',
              padding: 12,
              borderRadius: 6,
              background: 'rgba(17, 31, 47, 0.75)',
              color: '#9dc4e8',
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {diagnosticsLines.join('\n')}
          </div>
        )}
      </Focusable>
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

  const selectedIndex = selected
    ? sortedReports.findIndex((report) => reportKey(report) === reportKey(selected))
    : -1;

  const focusListPane = () => {
    setActivePane('list');
    setListFocused(true);
    setDetailFocused(false);
    listScrollRef.current?.focus();
  };

  const focusDetailPane = () => {
    setActivePane('detail');
    setListFocused(false);
    setDetailFocused(true);
    detailScrollRef.current?.focus();
  };

  useEffect(() => {
    if (!sortedReports.length) {
      setSelected(null);
      return;
    }
    if (!selected) {
      setSelected(sortedReports[0]);
      return;
    }
    const stillVisible = sortedReports.find((report) => reportKey(report) === reportKey(selected));
    if (!stillVisible) {
      setSelected(sortedReports[0]);
    }
  }, [selected, sortedReports]);

  useEffect(() => {
    if (!selected) return;
    const row = rowRefs.current[reportKey(selected)];
    row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected]);

  const setFilterMode = (nextFilter: FilterTier) => {
    void logFrontendEvent('DEBUG', 'Changed report filter', { appId, previousFilter: filter, nextFilter });
    setFilter(nextFilter);
  };

  const setSortPreference = (nextSortMode: SortMode) => {
    void logFrontendEvent('DEBUG', 'Changed sort mode', { appId, sortMode: nextSortMode });
    setSortMode(nextSortMode);
  };

  const moveSelection = (delta: number) => {
    if (!sortedReports.length) return;
    const baseIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = Math.max(0, Math.min(sortedReports.length - 1, baseIndex + delta));
    const nextReport = sortedReports[nextIndex];
    if (!nextReport) return;
    setSelected(nextReport);
    void logFrontendEvent('DEBUG', 'Changed selected ProtonDB report', {
      appId,
      protonVersion: nextReport.protonVersion,
      nextIndex,
      total: sortedReports.length,
    });
  };

  const handleListDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_RIGHT) {
      focusDetailPane();
      return;
    }
    if (evt.detail.button === GamepadButton.DIR_UP) {
      moveSelection(-1);
      listScrollRef.current?.scrollBy({ top: -LIST_SCROLL_STEP, behavior: 'smooth' });
      return;
    }
    if (evt.detail.button === GamepadButton.DIR_DOWN) {
      moveSelection(1);
      listScrollRef.current?.scrollBy({ top: LIST_SCROLL_STEP, behavior: 'smooth' });
    }
  };

  const handleDetailDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      focusListPane();
      return;
    }
    if (evt.detail.button === GamepadButton.DIR_UP) {
      detailScrollRef.current?.scrollBy({ top: -DETAIL_SCROLL_STEP, behavior: 'smooth' });
      return;
    }
    if (evt.detail.button === GamepadButton.DIR_DOWN) {
      detailScrollRef.current?.scrollBy({ top: DETAIL_SCROLL_STEP, behavior: 'smooth' });
    }
  };

  const handleApply = async () => {
    if (!selected || !appId) return;
    void logFrontendEvent('INFO', 'Apply launch option requested', {
      appId,
      appName,
      protonVersion: selected.protonVersion,
    });
    const running = (SteamClient.GameSessions as any).GetRunningApps();
    if (running.length > 0) {
      void logFrontendEvent('WARNING', 'Apply blocked because a game is running', { appId, runningCount: running.length });
      toaster.toast({ title: 'Proton Pulse', body: 'Quit your game first.' });
      return;
    }
    setApplying(true);
    try {
      await SteamClient.Apps.SetAppLaunchOptions(
        appId, `PROTON_VERSION="${selected.protonVersion}" %command%`
      );
      void logFrontendEvent('INFO', 'Launch options applied', {
        appId,
        appName,
        protonVersion: selected.protonVersion,
      });
      toaster.toast({ title: 'Proton Pulse', body: `Applied for ${appName}` });
    } catch (e) {
      void logFrontendEvent('ERROR', 'Failed to apply launch options', {
        appId,
        appName,
        protonVersion: selected.protonVersion,
        error: e instanceof Error ? e.message : String(e),
      });
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
      void logFrontendEvent('WARNING', 'Upvote blocked because GitHub token is missing', { appId, appName });
      toaster.toast({ title: 'Proton Pulse', body: 'Set a GitHub token in Settings to upvote.' });
      return;
    }
    void logFrontendEvent('INFO', 'Upvote requested', {
      appId,
      appName,
      protonVersion: selected.protonVersion,
      reportTimestamp: selected.timestamp,
    });
    setUpvoting(true);
    try {
      const ok = await postUpvote(String(appId), reportKey(selected), token);
      if (ok) {
        void logFrontendEvent('INFO', 'Upvote accepted by remote endpoint', { appId, appName });
        toaster.toast({ title: 'Proton Pulse', body: 'Vote submitted! Count updates in ~60s.' });
        const capturedAppId = appId;
        setTimeout(() => {
          if (capturedAppId) {
            void logFrontendEvent('DEBUG', 'Refreshing votes after upvote delay', { appId: capturedAppId });
            getVotes(String(capturedAppId)).then(setVotes).catch(console.error);
          }
        }, 90_000);
      } else {
        void logFrontendEvent('WARNING', 'Upvote request failed at remote endpoint', { appId, appName });
        toaster.toast({ title: 'Proton Pulse', body: 'Vote failed. Check the token value and its repo/actions permissions.' });
      }
    } finally {
      setUpvoting(false);
    }
  };

  const controlButtonStyle = (active?: boolean) => ({
    padding: '4px 10px',
    minWidth: 0,
    flex: '0 0 auto',
    fontSize: 10,
    borderRadius: 999,
    background: active ? '#4c9eff' : 'rgba(255,255,255,0.05)',
    color: active ? '#fff' : '#b8c8d8',
    border: active ? '1px solid rgba(158, 208, 255, 0.85)' : '1px solid rgba(120, 150, 180, 0.12)',
    boxShadow: active ? '0 0 0 1px rgba(255,255,255,0.08) inset' : 'none',
  });

  const selectedLaunchPreview = selected ? buildLaunchOptionPreview(selected.protonVersion) : '';
  const selectedConfidence = selected ? (Math.min(100, selected.score) / 10).toFixed(1) : null;

  return (
    <Focusable style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page header */}
      <GameSummaryHeader appId={appId} appName={appName} reportsCount={reports.length} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 10,
          padding: '8px 10px',
          borderRadius: 10,
          background: 'linear-gradient(180deg, rgba(13, 23, 34, 0.92), rgba(10, 17, 26, 0.88))',
          border: '1px solid rgba(120, 150, 180, 0.14)',
        }}
      >
        <ToolbarGroup label="Sort">
          <DialogButton onClick={() => setSortPreference('score')} style={controlButtonStyle(sortMode === 'score')}>
            {SORT_LABELS.score}
          </DialogButton>
          <DialogButton onClick={() => setSortPreference('votes')} style={controlButtonStyle(sortMode === 'votes')}>
            {SORT_LABELS.votes}
          </DialogButton>
        </ToolbarGroup>
        <ToolbarGroup label="GPU">
          {FILTER_ORDER.map((tier) => (
            <DialogButton
              key={tier}
              onClick={() => setFilterMode(tier)}
              style={controlButtonStyle(filter === tier)}
            >
              {FILTER_LABELS[tier]}
            </DialogButton>
          ))}
        </ToolbarGroup>
        <div style={{ flex: 1 }} />
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(120, 150, 180, 0.18)',
            fontSize: 11,
            color: '#7a9bb5',
            whiteSpace: 'nowrap',
          }}
        >
          {sortedReports.length} shown · {activePane === 'list'
            ? 'Right: inspect'
            : 'Left: back to list'}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, gap: 12, minHeight: 0 }}>
        <Focusable
          style={{ flex: '0 0 52%', minWidth: 0 }}
          onGamepadDirection={handleListDirection}
          onGamepadFocus={() => {
            setListFocused(true);
            setActivePane('list');
          }}
          onGamepadBlur={() => setListFocused(false)}
          onOKButton={focusDetailPane}
        >
          <div
            ref={listScrollRef}
            tabIndex={0}
            onFocus={() => {
              setListFocused(true);
              setActivePane('list');
            }}
            onBlur={() => setListFocused(false)}
            onClick={focusListPane}
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: 8,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${listFocused || activePane === 'list' ? 'rgba(158, 208, 255, 0.5)' : '#2a3a4a'}`,
              outline: 'none',
            }}
          >
            {sortedReports.length === 0 ? (
              <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
                No reports for this GPU tier.
              </div>
            ) : (
              sortedReports.map((r) => (
                <div
                  key={reportKey(r)}
                  ref={(node) => { rowRefs.current[reportKey(r)] = node; }}
                >
                  <ReportCard
                    report={r}
                    selected={selected !== null && reportKey(selected) === reportKey(r)}
                    active={activePane === 'list' && selected !== null && reportKey(selected) === reportKey(r)}
                    onSelect={(report) => {
                      setSelected(report);
                      focusDetailPane();
                    }}
                  />
                </div>
              ))
            )}
          </div>
        </Focusable>

        <Focusable
          style={{ flex: 1, minWidth: 0 }}
          onGamepadDirection={handleDetailDirection}
          onGamepadFocus={() => {
            setDetailFocused(true);
            setActivePane('detail');
          }}
          onGamepadBlur={() => setDetailFocused(false)}
        >
          <div
            ref={detailScrollRef}
            tabIndex={0}
            onFocus={() => {
              setDetailFocused(true);
              setActivePane('detail');
            }}
            onBlur={() => setDetailFocused(false)}
            onClick={focusDetailPane}
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: 12,
              borderRadius: 8,
              background: 'linear-gradient(180deg, rgba(18, 31, 46, 0.92), rgba(9, 18, 28, 0.92))',
              border: `1px solid ${detailFocused || activePane === 'detail' ? 'rgba(158, 208, 255, 0.5)' : '#2a3a4a'}`,
              outline: 'none',
            }}
          >
            {selected ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 4 }}>
                    Report Preview
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#e8f4ff', marginBottom: 4 }}>
                    {selected.protonVersion}
                  </div>
                  <div style={{ fontSize: 12, color: '#9dc4e8' }}>
                    {selected.rating.toUpperCase()} · {selectedConfidence}/10 confidence · {matchLabel(selected, sysInfo)}
                  </div>
                </div>

                <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.22)' }}>
                  <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 6 }}>
                    Launch Option Preview
                  </div>
                  <div style={{ fontSize: 12, color: '#d8ebff', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                    {selectedLaunchPreview}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 4 }}>Submitted</div>
                    <div style={{ fontSize: 12, color: '#e8f4ff' }}>{formatTimestamp(selected.timestamp)} · {formatAge(selected.recencyDays)}</div>
                  </div>
                  <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 4 }}>Community</div>
                    <div style={{ fontSize: 12, color: '#e8f4ff' }}>{selected.upvotes} upvotes · GPU tier {selected.gpuTier}</div>
                  </div>
                  <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 4 }}>GPU / Driver</div>
                    <div style={{ fontSize: 12, color: '#e8f4ff' }}>{selected.gpu || 'Unknown GPU'}</div>
                    <div style={{ fontSize: 11, color: '#9db0c4' }}>{selected.gpuDriver || 'Unknown driver'}</div>
                  </div>
                  <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 4 }}>OS / Kernel / RAM</div>
                    <div style={{ fontSize: 12, color: '#e8f4ff' }}>{selected.os || 'Unknown OS'}</div>
                    <div style={{ fontSize: 11, color: '#9db0c4' }}>{selected.kernel || 'Unknown kernel'} · {selected.ram || 'Unknown RAM'}</div>
                  </div>
                </div>

                <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                  <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 6 }}>Why this report ranks here</div>
                  <div style={{ fontSize: 12, color: '#d8ebff', lineHeight: 1.5 }}>
                    {selected.score} score · {selected.rating} base rating · {selected.notesModifier >= 0 ? '+' : ''}{selected.notesModifier} notes modifier
                  </div>
                </div>

                <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                  <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 6 }}>Report Notes</div>
                  <div style={{ fontSize: 12, color: '#e8f4ff', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {selected.notes || 'No additional notes were provided for this report.'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid #2a3a4a' }}>
                  <DialogButton
                    onClick={handleApply}
                    disabled={!selected || applying}
                    style={controlButtonStyle(!!selected)}
                  >
                    {applying ? 'APPLYING…' : 'APPLY THIS REPORT'}
                  </DialogButton>
                  <DialogButton
                    onClick={handleUpvote}
                    disabled={!selected || upvoting}
                    style={{ ...controlButtonStyle(), color: '#ffd700' }}
                  >
                    {upvoting ? '★ …' : '★ UPVOTE REPORT'}
                  </DialogButton>
                </div>
              </>
            ) : (
              <div style={{ color: '#7a9bb5', fontSize: 12, padding: 12 }}>
                Select a report from the left to inspect its details and launch option preview.
              </div>
            )}
          </div>
        </Focusable>
      </div>
    </Focusable>
  );
}
