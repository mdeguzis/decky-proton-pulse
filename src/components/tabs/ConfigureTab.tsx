// src/components/tabs/ConfigureTab.tsx
import { Component, type ErrorInfo, type ReactNode, useState, useEffect } from 'react';
import { DialogButton, Focusable } from '@decky/ui';
import { toaster } from '@decky/api';
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
import { getLaunchOptionsFromDetails, getSteamAppDetails } from '../../lib/steamApps';

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

function LoadingIndicator({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 20 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '3px solid rgba(255,255,255,0.18)',
          borderTopColor: '#4c9eff',
          animation: 'proton-pulse-spin 1s linear infinite',
        }}
      />
      <div style={{ color: '#9db0c4', fontSize: 12, textAlign: 'center' }}>{label}</div>
      <style>{'@keyframes proton-pulse-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}

interface ConfigureTabBoundaryProps extends Props {
  children: ReactNode;
}

interface ConfigureTabBoundaryState {
  hasError: boolean;
  message: string | null;
  stack: string | null;
}

class ConfigureTabErrorBoundary extends Component<ConfigureTabBoundaryProps, ConfigureTabBoundaryState> {
  state: ConfigureTabBoundaryState = {
    hasError: false,
    message: null,
    stack: null,
  };

  static getDerivedStateFromError(error: unknown): ConfigureTabBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
      stack: null,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState({
      stack: info.componentStack || null,
    });
    void logFrontendEvent('ERROR', 'Manage This Game render crashed', {
      appId: this.props.appId,
      appName: this.props.appName,
      error: error instanceof Error ? error.message : String(error),
      componentStack: info.componentStack,
    });
    console.error('Proton Pulse: ConfigureTab render crashed', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const hint = this.state.message?.includes('Minified React error #310')
        ? 'Likely cause: rendered a different number of hooks between renders.'
        : null;
      return (
        <Focusable style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {this.props.appId ? (
            <GameSummaryHeader appId={this.props.appId} appName={this.props.appName} />
          ) : null}
          <div
            style={{
              margin: '0 16px',
              padding: 12,
              borderRadius: 6,
              background: 'rgba(47, 17, 17, 0.75)',
              color: '#ffd7d7',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            Manage This Game hit a render error in the current Steam UI environment.
            {this.state.message ? `\n\n${this.state.message}` : ''}
            {hint ? `\n\n${hint}` : ''}
            {this.state.stack ? `\n\nComponent stack:\n${this.state.stack.trim()}` : ''}
          </div>
        </Focusable>
      );
    }

    return this.props.children;
  }
}

function ConfigureTabContent({ appId, appName, sysInfo }: Props) {
  const [reports, setReports]   = useState<CdnReport[]>([]);
  const [votes, setVotes]       = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState<ScoredReport | null>(null);
  const [applying, setApplying] = useState(false);
  const [upvoting, setUpvoting] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('score');
  const [reportDiagnostics, setReportDiagnostics] = useState<ReportFetchDiagnostics | null>(null);
  const [voteDiagnostics, setVoteDiagnostics] = useState<VotesFetchDiagnostics | null>(null);
  const [currentLaunchOptions, setCurrentLaunchOptions] = useState('');

  const gpuVendor = sysInfo?.gpu_vendor ?? null;
  const initialFilter: FilterTier =
    gpuVendor === 'nvidia' || gpuVendor === 'amd' || gpuVendor === 'intel' ? gpuVendor : 'other';
  const [filter, setFilter] = useState<FilterTier>(initialFilter);

  const scored: ScoredReport[] = reports.map(r => ({
    ...scoreReport(r, sysInfo ?? {
      cpu: null,
      ram_gb: null,
      gpu: null,
      gpu_vendor: null,
      driver_version: null,
      kernel: null,
      distro: null,
      proton_custom: null,
    }),
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
    if (!appId) {
      setCurrentLaunchOptions('');
      return;
    }

    void getSteamAppDetails(appId).then((result) => {
      setCurrentLaunchOptions(getLaunchOptionsFromDetails(result.details));
    });
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
        <LoadingIndicator label="Fetching ProtonDB reports…" />
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

  const setFilterMode = (nextFilter: FilterTier) => {
    void logFrontendEvent('DEBUG', 'Changed report filter', { appId, previousFilter: filter, nextFilter });
    setFilter(nextFilter);
  };

  const setSortPreference = (nextSortMode: SortMode) => {
    void logFrontendEvent('DEBUG', 'Changed sort mode', { appId, sortMode: nextSortMode });
    setSortMode(nextSortMode);
  };

  const cycleSortMode = () => {
    setSortPreference(sortMode === 'score' ? 'votes' : 'score');
  };

  const handleApply = async () => {
    if (!selected || !appId) return;
    void logFrontendEvent('INFO', 'Apply launch option requested', {
      appId,
      appName,
      protonVersion: selected.protonVersion,
    });
    const running = (SteamClient.GameSessions as any)?.GetRunningApps?.() ?? [];
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
      const detailsResult = await getSteamAppDetails(appId);
      const appliedLaunchOptions = getLaunchOptionsFromDetails(detailsResult.details);
      setCurrentLaunchOptions(appliedLaunchOptions);
      void logFrontendEvent('INFO', 'Launch options applied', {
        appId,
        appName,
        protonVersion: selected.protonVersion,
        appliedLaunchOptions,
      });
      toaster.toast({
        title: 'Proton Pulse',
        body: appliedLaunchOptions || `Applied for ${appName}`,
      });
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
    background: active ? '#4c9eff' : '#333',
    color: active ? '#fff' : '#b8c8d8',
    borderRadius: 4,
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
          padding: '8px 0',
          borderBottom: '1px solid #2a3a4a',
        }}
      >
        <DialogButton onClick={cycleSortMode} style={controlButtonStyle(true)}>
          SORT: {SORT_LABELS[sortMode]}
        </DialogButton>
        <DialogButton onClick={() => {
          const idx = FILTER_ORDER.indexOf(filter);
          const nextFilter = FILTER_ORDER[(idx + 1) % FILTER_ORDER.length];
          setFilterMode(nextFilter);
        }} style={controlButtonStyle()}>
          GPU: {FILTER_LABELS[filter]}
        </DialogButton>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: 11,
            color: '#7a9bb5',
            whiteSpace: 'nowrap',
          }}
        >
          {sortedReports.length} shown
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
        {selected ? (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 8,
              background: 'linear-gradient(180deg, rgba(18, 31, 46, 0.92), rgba(9, 18, 28, 0.92))',
              border: '1px solid #2a3a4a',
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 4 }}>
                Selected Report
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

            <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 6 }}>Current Launch Options</div>
              <div style={{ fontSize: 12, color: currentLaunchOptions ? '#e8f4ff' : '#9db0c4', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                {currentLaunchOptions || 'No launch options set.'}
              </div>
            </div>

            <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 6 }}>Report Summary</div>
              <div style={{ fontSize: 12, color: '#e8f4ff', lineHeight: 1.6 }}>
                <div>Submitted: {formatTimestamp(selected.timestamp)} · {formatAge(selected.recencyDays)}</div>
                <div>Community: {selected.upvotes} upvotes · GPU tier {selected.gpuTier}</div>
                <div>GPU / Driver: {selected.gpu || 'Unknown GPU'} · {selected.gpuDriver || 'Unknown driver'}</div>
                <div>OS / Kernel / RAM: {selected.os || 'Unknown OS'} · {selected.kernel || 'Unknown kernel'} · {selected.ram || 'Unknown RAM'}</div>
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
          </div>
        ) : null}

        <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid #2a3a4a' }}>
          {sortedReports.length === 0 ? (
            <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
              No reports for this GPU tier.
            </div>
          ) : (
            sortedReports.map((r) => (
              <DialogButton
                key={reportKey(r)}
                onClick={() => {
                  setSelected(r);
                  void logFrontendEvent('DEBUG', 'Changed selected ProtonDB report', {
                    appId,
                    protonVersion: r.protonVersion,
                    total: sortedReports.length,
                  });
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  marginBottom: 8,
                  borderRadius: 6,
                  border: `1px solid ${selected !== null && reportKey(selected) === reportKey(r) ? '#4c9eff' : '#2a3a4a'}`,
                  background: selected !== null && reportKey(selected) === reportKey(r)
                    ? 'rgba(76,158,255,0.10)'
                    : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                }}
                >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff' }}>{r.protonVersion}</div>
                    <div style={{ fontSize: 11, color: '#7a9bb5' }}>
                      {[r.gpu, r.os].filter(Boolean).join(' · ') || 'Hardware details unavailable'}
                    </div>
                    <div style={{ fontSize: 10, color: '#9db0c4', marginTop: 4 }}>
                      {r.rating.toUpperCase()} · {r.upvotes} votes · {formatAge(r.recencyDays)}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#9dc4e8', whiteSpace: 'nowrap' }}>
                    Score {r.score}
                  </div>
                </div>
              </DialogButton>
            ))
          )}
        </div>
      </div>
    </Focusable>
  );
}

export function ConfigureTab(props: Props) {
  return (
    <ConfigureTabErrorBoundary {...props}>
      <ConfigureTabContent {...props} />
    </ConfigureTabErrorBoundary>
  );
}
