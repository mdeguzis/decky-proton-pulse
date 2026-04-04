// src/components/tabs/ConfigureTab.tsx
import { Component, type ErrorInfo, type ReactNode, useState, useEffect, useMemo } from 'react';
import { Focusable, GamepadButton, DialogButton, ConfirmModal, showModal, Dropdown, SteamSpinner } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
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
import { getSetting, setSetting } from '../../lib/settings';
import type { CdnReport, ScoredReport, SystemInfo, GpuVendor } from '../../types';
import { logFrontendEvent } from '../../lib/logger';
import { getLaunchOptionsFromDetails, getSteamAppDetails } from '../../lib/steamApps';
import { checkProtonVersionAvailability, getProtonGeManagerState, installProtonGe } from '../../lib/compatTools';
import { ReportCard, type DisplayReportCard } from '../ReportCard';
import { ReportDetailModal } from '../ReportDetailModal';

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

const FILTER_ORDER: FilterTier[] = ['nvidia', 'amd', 'intel', 'other', 'all'];
const FILTER_LABELS: Record<FilterTier, string> = {
  nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', other: 'Other', all: 'All',
};
const EDIT_STORAGE_PREFIX = 'edited-reports:';

export interface EditedReportEntry {
  id: string;
  label: string;
  baseReportKey: string;
  report: CdnReport;
  updatedAt: number;
}

type MissingVersionChoice = 'install' | 'pick' | 'latest' | 'closest' | 'cancel';

function launchVersionValueForTool(tool: { internal_name: string; directory_name: string }): string {
  return tool.internal_name || tool.directory_name;
}

function findLatestInstalledTool(
  managerState: Awaited<ReturnType<typeof getProtonGeManagerState>>,
) {
  for (const release of managerState.releases) {
    const matched = managerState.installed_tools.find((tool) =>
      [tool.directory_name, tool.display_name, tool.internal_name].some((field) =>
        field.toLowerCase().includes(release.tag_name.toLowerCase()),
      ),
    );
    if (matched) return matched;
  }
  return managerState.installed_tools[0] ?? null;
}

function extractProtonVersionParts(version: string): { major: number; minor: number } | null {
  const normalized = version.trim();
  const match = normalized.match(/(?:GE-?)?Proton(\d+)-(\d+)/i) ?? normalized.match(/(\d+)\.0-(\d+)/i);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
  };
}

function findClosestInstalledTool(
  managerState: Awaited<ReturnType<typeof getProtonGeManagerState>>,
  targetVersion: string,
) {
  const target = extractProtonVersionParts(targetVersion);
  if (!target) return null;

  const ranked = managerState.installed_tools
    .map((tool) => {
      const parts = extractProtonVersionParts(tool.internal_name || tool.directory_name || tool.display_name);
      if (!parts) return null;
      const majorDistance = Math.abs(parts.major - target.major);
      const minorDistance = Math.abs(parts.minor - target.minor);
      return {
        tool,
        score: majorDistance * 1000 + minorDistance,
      };
    })
    .filter((entry): entry is { tool: Awaited<ReturnType<typeof getProtonGeManagerState>>['installed_tools'][number]; score: number } => !!entry)
    .sort((a, b) => a.score - b.score);

  return ranked[0]?.tool ?? null;
}

function MissingVersionModal({
  requiredVersion,
  latestInstalledLabel,
  closestInstalledLabel,
  onResolve,
  onCancel,
}: {
  requiredVersion: string;
  latestInstalledLabel: string | null;
  closestInstalledLabel: string | null;
  onResolve: (choice: MissingVersionChoice) => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      strTitle="Required Proton Version"
      strDescription={`This profile config requires ${requiredVersion}, but it is not currently installed.`}
      strOKButtonText="Cancel"
      onOK={onCancel}
      onCancel={onCancel}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 420, maxWidth: 520 }}>
        <div style={{ fontSize: 11, color: '#9eb7cc', lineHeight: 1.45 }}>
          Choose how you want to apply this profile.
        </div>
        <DialogButton onClick={() => onResolve('install')}>Install {requiredVersion}</DialogButton>
        <DialogButton onClick={() => onResolve('pick')}>Pick Installed Version</DialogButton>
        <DialogButton onClick={() => onResolve('closest')} disabled={!closestInstalledLabel && !latestInstalledLabel}>
          {closestInstalledLabel
            ? `Search Closest Version (${closestInstalledLabel})`
            : 'Search Closest Version'}
        </DialogButton>
        <DialogButton onClick={() => onResolve('latest')} disabled={!latestInstalledLabel}>
          {latestInstalledLabel ? `Use Latest Installed (${latestInstalledLabel})` : 'Use Latest Installed'}
        </DialogButton>
      </div>
    </ConfirmModal>
  );
}

function InstalledVersionPickerModal({
  tools,
  onPick,
  onCancel,
}: {
  tools: Array<{ display_name: string; internal_name: string; directory_name: string; source?: 'custom' | 'valve' }>;
  onPick: (version: string) => void;
  onCancel: () => void;
}) {
  const sortedTools = useMemo(
    () => [...tools].sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' })),
    [tools],
  );
  const [selectedValue, setSelectedValue] = useState<string>(
    sortedTools[0] ? launchVersionValueForTool(sortedTools[0]) : '',
  );

  return (
    <ConfirmModal
      strTitle="Pick Installed Version"
      strDescription="Choose an installed compatibility tool for this profile."
      strOKButtonText="Cancel"
      onOK={onCancel}
      onCancel={onCancel}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <select
          value={selectedValue}
          onChange={(e) => setSelectedValue(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#162535',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            color: '#e8f4ff',
            fontSize: 12,
            padding: '8px 10px',
          }}
        >
          {sortedTools.map((tool) => {
            const value = launchVersionValueForTool(tool);
            return (
              <option key={`${tool.directory_name}-${tool.internal_name}`} value={value}>
                {tool.display_name}
              </option>
            );
          })}
        </select>
        <DialogButton onClick={() => selectedValue && onPick(selectedValue)} disabled={!selectedValue}>
          Use Selected Version
        </DialogButton>
      </div>
    </ConfirmModal>
  );
}

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

function effectiveAutoFilter(gpuVendor: GpuVendor | null): FilterTier {
  if (gpuVendor === 'nvidia' || gpuVendor === 'amd') return gpuVendor;
  if (gpuVendor === 'intel') return 'intel';
  return 'all';
}

function editStorageKey(appId: number): string {
  return `${EDIT_STORAGE_PREFIX}${appId}`;
}

function loadEditedReports(appId: number): EditedReportEntry[] {
  return getSetting<EditedReportEntry[]>(editStorageKey(appId), []);
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
  const [editedReports, setEditedReports] = useState<EditedReportEntry[]>([]);
  const [votes, setVotes]       = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusedCardKey, setFocusedCardKey] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('score');
  const [filterTouched, setFilterTouched] = useState(false);
  const [reportDiagnostics, setReportDiagnostics] = useState<ReportFetchDiagnostics | null>(null);
  const [voteDiagnostics, setVoteDiagnostics] = useState<VotesFetchDiagnostics | null>(null);
  const [currentLaunchOptions, setCurrentLaunchOptions] = useState('');

  const gpuVendor = sysInfo?.gpu_vendor ?? null;
  const [filter, setFilter] = useState<FilterTier>('all');

  const scoreContext = sysInfo ?? {
    cpu: null,
    ram_gb: null,
    gpu: null,
    gpu_vendor: null,
    driver_version: null,
    kernel: null,
    distro: null,
    proton_custom: null,
  };

  const baseDisplayReports: DisplayReportCard[] = reports.map(r => ({
    ...scoreReport(r, scoreContext),
    upvotes: votes[reportKey(r)] ?? 0,
    displayKey: `cdn:${reportKey(r)}`,
  }));

  const editedDisplayReports: DisplayReportCard[] = editedReports.map((entry) => ({
    ...scoreReport(entry.report, scoreContext),
    upvotes: votes[reportKey(entry.report)] ?? 0,
    displayKey: `edited:${entry.id}`,
    isEdited: true,
    editLabel: entry.label,
  }));

  const scored: DisplayReportCard[] = [...editedDisplayReports, ...baseDisplayReports];

  const buckets = bucketByGpuTier(scored as ScoredReport[]) as {
    nvidia: DisplayReportCard[];
    amd: DisplayReportCard[];
    other: DisplayReportCard[];
  };

  const visibleReports: DisplayReportCard[] =
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
    if (!appId) {
      setLoading(false);
      setReports([]);
      setEditedReports([]);
      setVotes({});
      setSelectedKey(null);
      setFocusedCardKey(null);
      setFilterTouched(false);
      setFilter('all');
      setReportDiagnostics(null);
      setVoteDiagnostics(null);
      return;
    }

    let cancelled = false;
    void logFrontendEvent('DEBUG', 'Loading Manage This Game data', {
      appId,
      appName,
      hasSystemInfo: !!sysInfo,
      gpuVendor: sysInfo?.gpu_vendor ?? null,
    });
    setLoading(true);
    setReports([]);
    setEditedReports(loadEditedReports(appId));
    setVotes({});
    setSelectedKey(null);
    setFocusedCardKey(null);
    setFilterTouched(false);
    setFilter('all');
    setReportDiagnostics(null);
    setVoteDiagnostics(null);

    void Promise.all([getProtonDBReportsWithDiagnostics(String(appId)), getVotesWithDiagnostics(String(appId))])
      .then(([reportResult, voteResult]) => {
        if (cancelled) return;
        const r = reportResult.reports;
        const v = voteResult.votes;
        void logFrontendEvent('DEBUG', 'Manage This Game data loaded', {
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
        if (cancelled) return;
        void logFrontendEvent('ERROR', 'Manage This Game load failed', {
          appId,
          appName,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(error);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appId, appName, sysInfo]);

  useEffect(() => {
    if (filterTouched) return;
    setFilter(effectiveAutoFilter(gpuVendor));
  }, [gpuVendor, filterTouched]);

  useEffect(() => {
    if (!sortedReports.length) {
      setSelectedKey(null);
      setFocusedCardKey(null);
      return;
    }
    if (!selectedKey) {
      setSelectedKey(sortedReports[0].displayKey);
      setFocusedCardKey(sortedReports[0].displayKey);
      return;
    }
    const stillVisible = sortedReports.find((report) => report.displayKey === selectedKey);
    if (!stillVisible) {
      setSelectedKey(sortedReports[0].displayKey);
      setFocusedCardKey(sortedReports[0].displayKey);
    }
  }, [selectedKey, sortedReports]);

  useEffect(() => {
    if (!appId) {
      setCurrentLaunchOptions('');
      return;
    }

    void getSteamAppDetails(appId).then((result) => {
      setCurrentLaunchOptions(getLaunchOptionsFromDetails(result.details));
    });
  }, [appId, appName]);

  useEffect(() => {
    if (!appId) return;
    setSetting(editStorageKey(appId), editedReports);
  }, [appId, editedReports]);

  const setFilterMode = (nextFilter: FilterTier) => {
    void logFrontendEvent('DEBUG', 'Changed report filter', { appId, previousFilter: filter, nextFilter });
    setFilterTouched(true);
    setFilter(nextFilter);
  };

  const setSortPreference = (nextSortMode: SortMode) => {
    void logFrontendEvent('DEBUG', 'Changed sort mode', { appId, sortMode: nextSortMode });
    setSortMode(nextSortMode);
  };

  const handleApply = async (targetReport: DisplayReportCard) => {
    if (!appId) return;
    void logFrontendEvent('INFO', 'Apply launch option requested', {
      appId,
      appName,
      protonVersion: targetReport.protonVersion,
    });
    const running = (SteamClient.GameSessions as any)?.GetRunningApps?.() ?? [];
    if (running.length > 0) {
      void logFrontendEvent('WARNING', 'Apply blocked because a game is running', { appId, runningCount: running.length });
      toaster.toast({ title: 'Proton Pulse', body: 'Quit your game first.' });
      return;
    }
    try {
      const availability = await checkProtonVersionAvailability(targetReport.protonVersion);
      void logFrontendEvent('INFO', 'Proton version availability check result', {
        appId,
        rawVersion: targetReport.protonVersion,
        managed: availability.managed,
        installed: availability.installed,
        normalized: availability.normalized_version,
        matchedTool: availability.matched_tool_name,
        closestTool: availability.closest_tool_name,
        hasRelease: !!availability.release,
        message: availability.message,
      });
      let launchProtonVersion = availability.managed
        ? (availability.normalized_version ?? targetReport.protonVersion)
        : targetReport.protonVersion;
      if (availability.managed && !availability.installed) {
        let managerState: Awaited<ReturnType<typeof getProtonGeManagerState>>;
        try {
          managerState = await getProtonGeManagerState(false);
        } catch (e) {
          void logFrontendEvent('WARNING', 'getProtonGeManagerState failed; showing dialog with empty state', {
            appId,
            error: e instanceof Error ? e.message : String(e),
          });
          managerState = {
            releases: [],
            installed_tools: [],
            current_release: null,
            current_installed: false,
            current_latest_slot_installed: false,
            install_status: {
              state: 'idle',
              tag_name: null,
              message: null,
              stage: null,
              downloaded_bytes: null,
              total_bytes: null,
              progress_fraction: null,
              started_at: null,
              finished_at: null,
              install_as_latest: false,
            },
          };
        }
        const latestInstalledTool = findLatestInstalledTool(managerState);
        const closestInstalledTool = findClosestInstalledTool(
          managerState,
          availability.normalized_version ?? targetReport.protonVersion,
        );
        const installedTools = managerState.installed_tools;

        const choice = await new Promise<MissingVersionChoice>((resolve) => {
          const modal = showModal(
            <MissingVersionModal
              requiredVersion={availability.normalized_version ?? targetReport.protonVersion}
              latestInstalledLabel={latestInstalledTool?.display_name ?? null}
              closestInstalledLabel={closestInstalledTool?.display_name ?? null}
              onResolve={(nextChoice) => {
                resolve(nextChoice);
                modal.Close();
              }}
              onCancel={() => {
                resolve('cancel');
                modal.Close();
              }}
            />,
          );
        });

        if (choice === 'cancel') {
          toaster.toast({ title: 'Proton Pulse', body: 'Apply cancelled.' });
          return;
        }

        if (choice === 'pick') {
          if (installedTools.length === 0) {
            toaster.toast({ title: 'Proton Pulse', body: 'No installed compatibility tools were available. Using the required version instead.' });
          } else {
            const pickedVersion = await new Promise<string | null>((resolve) => {
              const modal = showModal(
                <InstalledVersionPickerModal
                  tools={installedTools}
                  onPick={(version) => {
                    resolve(version);
                    modal.Close();
                  }}
                  onCancel={() => {
                    resolve(null);
                    modal.Close();
                  }}
                />,
              );
            });

            if (!pickedVersion) {
              toaster.toast({ title: 'Proton Pulse', body: 'Apply cancelled.' });
              return;
            }
            launchProtonVersion = pickedVersion;
          }
        } else if (choice === 'closest') {
          if (closestInstalledTool) {
            launchProtonVersion = launchVersionValueForTool(closestInstalledTool);
            toaster.toast({
              title: 'Proton Pulse',
              body: `Using closest installed version: ${closestInstalledTool.display_name}`,
            });
          } else if (latestInstalledTool) {
            launchProtonVersion = launchVersionValueForTool(latestInstalledTool);
            toaster.toast({
              title: 'Proton Pulse',
              body: `No close match found. Using latest installed: ${latestInstalledTool.display_name}`,
            });
          } else {
            const installResult = await installProtonGe(availability.normalized_version);
            if (!installResult.success) {
              toaster.toast({
                title: 'Proton Pulse',
                body: `Closest-version search failed, and install failed for ${availability.normalized_version}.`,
              });
            } else if (availability.normalized_version) {
              launchProtonVersion = availability.normalized_version;
            }
          }
        } else if (choice === 'latest') {
          if (latestInstalledTool) {
            launchProtonVersion = launchVersionValueForTool(latestInstalledTool);
          } else {
            toaster.toast({ title: 'Proton Pulse', body: 'No installed compatibility tools were available. Using the required version instead.' });
          }
        } else {
          const installResult = await installProtonGe(availability.normalized_version);
          if (!installResult.success) {
            if (latestInstalledTool) {
              launchProtonVersion = launchVersionValueForTool(latestInstalledTool);
              toaster.toast({
                title: 'Proton Pulse',
                body: `Install failed for ${availability.normalized_version}. Using ${latestInstalledTool.display_name} instead.`,
              });
            } else {
              toaster.toast({
                title: 'Proton Pulse',
                body: `Install failed for ${availability.normalized_version}. Applying with the requested version anyway.`,
              });
            }
          } else {
            toaster.toast({
              title: 'Proton Pulse',
              body: installResult.already_installed
                ? `${availability.normalized_version} is already installed.`
                : `Installed ${availability.normalized_version}. Steam may need a restart before the new compatibility tool appears everywhere.`,
            });
            launchProtonVersion = availability.normalized_version ?? targetReport.protonVersion;
          }
        }

        void logFrontendEvent('INFO', 'Apply resolved missing Proton version choice', {
          appId,
          appName,
          requiredVersion: availability.normalized_version ?? targetReport.protonVersion,
          selectedLaunchVersion: launchProtonVersion,
          choice,
          latestInstalledTool: latestInstalledTool?.display_name ?? null,
        });
      }

      await SteamClient.Apps.SetAppLaunchOptions(
        appId, `PROTON_VERSION="${launchProtonVersion}" %command%`
      );
      const detailsResult = await getSteamAppDetails(appId);
      const appliedLaunchOptions = getLaunchOptionsFromDetails(detailsResult.details);
      setCurrentLaunchOptions(appliedLaunchOptions);
      void logFrontendEvent('INFO', 'Launch options applied', {
        appId,
        appName,
        protonVersion: launchProtonVersion,
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
        protonVersion: targetReport.protonVersion,
        error: e instanceof Error ? e.message : String(e),
      });
      console.error('Proton Pulse: apply failed', e);
      const msg = e instanceof Error ? e.message : String(e);
      toaster.toast({ title: 'Proton Pulse', body: `Apply failed: ${msg.slice(0, 80)}` });
    }
  };

  const handleUpvote = async (targetReport: DisplayReportCard) => {
    if (!appId) return;
    const token = getSetting<string>('gh-votes-token', '');
    if (!token) {
      void logFrontendEvent('WARNING', 'Upvote blocked because GitHub token is missing', { appId, appName });
      toaster.toast({ title: 'Proton Pulse', body: 'Set a GitHub token in Settings to upvote.' });
      return;
    }
    void logFrontendEvent('INFO', 'Upvote requested', {
      appId,
      appName,
      protonVersion: targetReport.protonVersion,
      reportTimestamp: targetReport.timestamp,
    });
    try {
      const ok = await postUpvote(String(appId), reportKey(targetReport), token);
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
    } catch (e) {
      void logFrontendEvent('ERROR', 'Upvote failed', {
        appId,
        appName,
        error: e instanceof Error ? e.message : String(e),
      });
      console.error('Proton Pulse: upvote failed', e);
      toaster.toast({ title: 'Proton Pulse', body: 'Upvote failed — check logs.' });
    }
  };

  const openReportDetail = (report: DisplayReportCard) => {
    setSelectedKey(report.displayKey);
    showModal(
      <ReportDetailModal
        report={report}
        appId={appId!}
        appName={appName}
        sysInfo={sysInfo}
        currentLaunchOptions={currentLaunchOptions}
        onApply={handleApply}
        onUpvote={handleUpvote}
        onSaveEdit={(entry) => setEditedReports((prev) => [entry, ...prev])}
      />,
      window,
    );
  };

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  if (!appId) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        Navigate to a game first.
      </div>
    );
  }

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
        ? (
          reportDiagnostics.source === 'live-summary'
            ? `Live ProtonDB summary: ${reportDiagnostics.liveSummaryStatus ?? 'request failed'} · ${reportDiagnostics.liveSummaryTotal ?? 0} reports · ${reportDiagnostics.liveSummaryTier ?? 'unknown'} tier`
            : `Live ProtonDB summary: ${reportDiagnostics.liveSummaryStatus ?? 'not tried'}`
        )
        : 'Live ProtonDB summary: pending',
      voteDiagnostics
        ? `Votes response: ${voteDiagnostics.status ?? 'request failed'}`
        : 'Votes response: pending',
    ];

  const showDiagnosticsState = !loading && (!sysInfo || (reports.length === 0 && editedReports.length === 0));
  const detectingGpu = !gpuVendor && !filterTouched;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <GameSummaryHeader appId={appId} appName={appName} reportsCount={scored.length} />
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <SteamSpinner />
        </div>
      ) : showDiagnosticsState ? (
        <>
          <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
            {!sysInfo ? 'Loading system info…' : 'No ProtonDB reports found for this game.'}
          </div>
          {reportDiagnostics?.source === 'live-summary' && (
            <div style={{ padding: '0 16px 12px', color: '#9dc4e8', fontSize: 11, textAlign: 'center' }}>
              ProtonDB live summary exists, but detailed report cards were not available from the CDN.
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
        </>
      ) : (
        <Focusable
          onGamepadDirection={handleRootDirection}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '92px auto minmax(0, 220px) auto minmax(0, 170px) auto',
              alignItems: 'center',
              gap: 10,
              marginBottom: 8,
              padding: '6px 0',
              borderBottom: '1px solid #2a3a4a',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 4px 0 0',
                color: '#f4fbff',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.35,
                whiteSpace: 'nowrap',
              }}
            >
              <span>Filters</span>
            </div>
            <div
              style={{ fontSize: 10, color: '#cfe2f4', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right' }}
            >
              Sort
            </div>
            <Dropdown
              rgOptions={[
                { data: 'score', label: 'Best Match' },
                { data: 'votes', label: 'Most Votes' },
              ]}
              selectedOption={sortMode}
              onChange={(opt) => setSortPreference(opt.data as SortMode)}
            />
            <div
              style={{ fontSize: 10, color: '#cfe2f4', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right' }}
            >
              GPU
            </div>
            <Dropdown
              rgOptions={FILTER_ORDER.map((tier) => ({
                data: tier,
                label: tier === 'all' ? 'All' : FILTER_LABELS[tier],
              }))}
              selectedOption={filter}
              onChange={(opt) => setFilterMode(opt.data as FilterTier)}
            />
            <div style={{ fontSize: 11, color: '#7a9bb5', whiteSpace: 'nowrap', textAlign: 'right' }}>
              {sortedReports.length} shown
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            <div style={{ marginBottom: 12, color: '#9db0c4', fontSize: 11 }}>
              {detectingGpu
                ? 'Detecting your GPU tier before narrowing the list. Showing all reports for now.'
                : 'Select a report card to view the full report.'}
            </div>
            <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid #2a3a4a' }}>
              {sortedReports.length === 0 ? (
                <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
                  {detectingGpu ? 'Detecting GPU tier…' : 'No reports for this GPU tier.'}
                </div>
              ) : (
                sortedReports.map((r) => (
                  <ReportCard
                    key={r.displayKey}
                    report={r}
                    selected={selectedKey === r.displayKey}
                    focused={focusedCardKey === r.displayKey}
                    onFocus={(report) => {
                      setFocusedCardKey(report.displayKey);
                      setSelectedKey(report.displayKey);
                    }}
                    onSelect={openReportDetail}
                  />
                ))
              )}
            </div>
          </div>
        </Focusable>
      )}
    </div>
  );
}

export function ConfigureTab(props: Props) {
  return (
    <ConfigureTabErrorBoundary {...props}>
      <ConfigureTabContent {...props} />
    </ConfigureTabErrorBoundary>
  );
}
