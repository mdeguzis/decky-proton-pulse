// src/components/tabs/ConfigureTab.tsx
import { Component, type ErrorInfo, type ReactNode, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Focusable, GamepadButton, DialogButton, DropdownItem } from '@decky/ui';
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
import { ReportCard, type DisplayReportCard } from '../ReportCard';
import { BrandLogo } from '../BrandLogo';

interface Props {
  appId: number | null;
  appName: string;
  sysInfo: SystemInfo | null;
  isActive?: boolean;
  loadNonce?: number;
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
const DETAIL_SCROLL_STEP = 100;
const EDIT_STORAGE_PREFIX = 'edited-reports:';

interface EditedReportEntry {
  id: string;
  label: string;
  baseReportKey: string;
  report: CdnReport;
  updatedAt: number;
}

interface EditableReportFields {
  label: string;
  protonVersion: string;
  rating: CdnReport['rating'];
  title: string;
  gpu: string;
  gpuDriver: string;
  os: string;
  kernel: string;
  ram: string;
  notes: string;
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

function buildLaunchOptionPreview(protonVersion: string): string {
  return `PROTON_VERSION="${protonVersion}" %command%`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function gamepadButtonLabel(button: number): string {
  const labels: Partial<Record<GamepadButton, string>> = {
    [GamepadButton.DIR_UP]: 'DIR_UP',
    [GamepadButton.DIR_DOWN]: 'DIR_DOWN',
    [GamepadButton.DIR_LEFT]: 'DIR_LEFT',
    [GamepadButton.DIR_RIGHT]: 'DIR_RIGHT',
    [GamepadButton.OK]: 'OK',
    [GamepadButton.CANCEL]: 'CANCEL',
  };

  return labels[button as GamepadButton] ?? `BUTTON_${button}`;
}

function describeActiveElement(): string {
  if (typeof document === 'undefined') return 'no-document';
  const active = document.activeElement;
  if (!active) return 'none';

  const parts = [active.tagName.toLowerCase()];
  if (active.id) parts.push(`#${active.id}`);
  if (active.className && typeof active.className === 'string') {
    const className = active.className.trim().replace(/\s+/g, '.');
    if (className) parts.push(`.${className}`);
  }

  const text = active.textContent?.trim().replace(/\s+/g, ' ').slice(0, 48);
  if (text) parts.push(`"${text}"`);

  return parts.join('');
}

function matchLabel(report: ScoredReport, sysInfo: SystemInfo | null): string {
  if (!sysInfo?.gpu_vendor || report.gpuTier === 'unknown') return 'Unknown GPU match';
  return report.gpuTier === sysInfo.gpu_vendor ? 'Matches your GPU vendor' : 'Different GPU vendor';
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

function makeEditableFields(report: CdnReport, label = ''): EditableReportFields {
  return {
    label,
    protonVersion: report.protonVersion,
    rating: report.rating,
    title: report.title,
    gpu: report.gpu,
    gpuDriver: report.gpuDriver,
    os: report.os,
    kernel: report.kernel,
    ram: report.ram,
    notes: report.notes,
  };
}

function applyEditableFields(base: CdnReport, fields: EditableReportFields): CdnReport {
  return {
    ...base,
    protonVersion: fields.protonVersion,
    rating: fields.rating,
    title: fields.title,
    gpu: fields.gpu,
    gpuDriver: fields.gpuDriver,
    os: fields.os,
    kernel: fields.kernel,
    ram: fields.ram,
    notes: fields.notes,
  };
}

function detailPanelStyle() {
  return {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025))',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset',
  };
}

function bareDetailSectionStyle() {
  return {
    padding: '2px 0',
    color: '#dce9f6',
  };
}

function FilterIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <path
        d="M4 6h16l-6 7v5l-4 2v-7L4 6z"
        fill="none"
        stroke="#f4fbff"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProtonDbBrandIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <circle cx="12" cy="12" r="10" fill="#16a34a" />
      <path
        d="M8.5 16V8h4.7a2.9 2.9 0 0 1 0 5.8h-2.6V16"
        fill="none"
        stroke="#f4fbff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface CompactButtonProps {
  label: string;
  onPress: () => void;
  focused: boolean;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  cancelAction?: () => void;
}

function CompactButton({
  label,
  onPress,
  focused,
  active = false,
  accent = false,
  disabled = false,
  onFocus,
  onBlur,
  cancelAction,
}: CompactButtonProps) {
  return (
    <DialogButton
      onClick={disabled ? undefined : onPress}
      onOKButton={disabled ? undefined : onPress}
      onCancelButton={cancelAction}
      onGamepadFocus={onFocus}
      onGamepadBlur={onBlur}
      style={{
        minHeight: 26,
        height: 26,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        padding: '0 10px',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: disabled ? '#6d7b88' : accent ? '#ffe37a' : '#eef6ff',
        background: active
          ? 'linear-gradient(180deg, #4f97eb, #3f7ecc)'
          : 'linear-gradient(180deg, rgba(58, 66, 77, 0.96), rgba(48, 54, 63, 0.96))',
        border: focused
          ? '1px solid rgba(255,255,255,0.9)'
          : '1px solid rgba(255,255,255,0.08)',
        boxShadow: focused
          ? '0 0 0 1px rgba(255,255,255,0.28) inset, 0 0 16px rgba(255,255,255,0.18)'
          : '0 1px 0 rgba(255,255,255,0.04) inset',
        opacity: disabled ? 0.55 : 1,
        animation: focused ? 'proton-pulse-toolbar-glow 1.7s ease-in-out infinite' : 'none',
      }}
    >
      {label}
    </DialogButton>
  );
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

function ConfigureTabContent({ appId, appName, sysInfo, isActive = false, loadNonce = 0 }: Props) {
  const [reports, setReports]   = useState<CdnReport[]>([]);
  const [editedReports, setEditedReports] = useState<EditedReportEntry[]>([]);
  const [votes, setVotes]       = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusedCardKey, setFocusedCardKey] = useState<string | null>(null);
  const [overlayMode, setOverlayMode] = useState<'list' | 'detail' | 'edit'>('list');
  const [applying, setApplying] = useState(false);
  const [upvoting, setUpvoting] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('score');
  const [filterTouched, setFilterTouched] = useState(false);
  const [focusedToolbarControl, setFocusedToolbarControl] = useState<'sort' | 'filter' | null>(null);
  const [focusedActionControl, setFocusedActionControl] = useState<'apply' | 'edit' | 'upvote' | 'back' | 'save' | 'cancel' | null>(null);
  const [reportDiagnostics, setReportDiagnostics] = useState<ReportFetchDiagnostics | null>(null);
  const [voteDiagnostics, setVoteDiagnostics] = useState<VotesFetchDiagnostics | null>(null);
  const [currentLaunchOptions, setCurrentLaunchOptions] = useState('');
  const [editDraft, setEditDraft] = useState<EditableReportFields | null>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);

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
  const selected = sortedReports.find((report) => report.displayKey === selectedKey)
    ?? scored.find((report) => report.displayKey === selectedKey)
    ?? null;

  const debugMovement = (event: string, context: Record<string, unknown> = {}) => {
    const payload = {
      appId,
      appName,
      overlayMode,
      selectedKey,
      focusedCardKey,
      focusedToolbarControl,
      focusedActionControl,
      filter,
      sortMode,
      activeElement: describeActiveElement(),
      detailScrollTop: detailScrollRef.current?.scrollTop ?? null,
      detailScrollHeight: detailScrollRef.current?.scrollHeight ?? null,
      detailClientHeight: detailScrollRef.current?.clientHeight ?? null,
      ...context,
    };
    console.log(`[Proton Pulse movement] ${event}`, payload);
    void logFrontendEvent('DEBUG', `Movement: ${event}`, payload);
  };

  useEffect(() => {
    if (!appId) {
      setLoading(false);
      setReports([]);
      setEditedReports([]);
      setVotes({});
      setSelectedKey(null);
      setFocusedCardKey(null);
      setOverlayMode('list');
      setFilterTouched(false);
      setFilter('all');
      setReportDiagnostics(null);
      setVoteDiagnostics(null);
      setEditDraft(null);
      return;
    }

    let cancelled = false;
    void logFrontendEvent('INFO', 'Loading Manage This Game data', {
      appId,
      appName,
      hasSystemInfo: !!sysInfo,
      gpuVendor: sysInfo?.gpu_vendor ?? null,
      isActive,
      loadNonce,
    });
    setLoading(true);
    setReports([]);
    setEditedReports(loadEditedReports(appId));
    setVotes({});
    setSelectedKey(null);
    setFocusedCardKey(null);
    setOverlayMode('list');
    setFilterTouched(false);
    setFilter('all');
    setReportDiagnostics(null);
    setVoteDiagnostics(null);
    setEditDraft(null);

    void Promise.all([getProtonDBReportsWithDiagnostics(String(appId)), getVotesWithDiagnostics(String(appId))])
      .then(([reportResult, voteResult]) => {
        if (cancelled) return;
        const r = reportResult.reports;
        const v = voteResult.votes;
        void logFrontendEvent('INFO', 'Manage This Game data loaded', {
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
  }, [appId, appName, loadNonce, sysInfo, isActive]);

  useEffect(() => {
    if (filterTouched) return;
    setFilter(effectiveAutoFilter(gpuVendor));
  }, [gpuVendor, filterTouched]);

  useEffect(() => {
    if (!sortedReports.length) {
      setSelectedKey(null);
      setFocusedCardKey(null);
      setOverlayMode('list');
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
      setOverlayMode('list');
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

  useLayoutEffect(() => {
    if (overlayMode !== 'detail' && overlayMode !== 'edit') return;
    const pane = detailScrollRef.current;
    if (!pane) return;
    pane.scrollTop = 0;
    requestAnimationFrame(() => {
      pane.scrollTop = 0;
      pane.focus();
      debugMovement('detail-overlay-open-focus', {
        selectedDisplayKey: selectedKey,
      });
    });
  }, [overlayMode, selectedKey]);

  useEffect(() => {
    debugMovement('overlay-mode-changed', { nextOverlayMode: overlayMode });
  }, [overlayMode]);

  const setFilterMode = (nextFilter: FilterTier) => {
    void logFrontendEvent('DEBUG', 'Changed report filter', { appId, previousFilter: filter, nextFilter });
    setFilterTouched(true);
    setFilter(nextFilter);
    setOverlayMode('list');
  };

  const setSortPreference = (nextSortMode: SortMode) => {
    void logFrontendEvent('DEBUG', 'Changed sort mode', { appId, sortMode: nextSortMode });
    setSortMode(nextSortMode);
  };

  const openReportDetail = (report: DisplayReportCard) => {
    setSelectedKey(report.displayKey);
    setFocusedCardKey(report.displayKey);
    setFocusedActionControl(null);
    setOverlayMode('detail');
    requestAnimationFrame(() => {
      detailScrollRef.current?.scrollTo({ top: 0 });
      detailScrollRef.current?.focus();
    });
    debugMovement('open-report-detail', {
      reportDisplayKey: report.displayKey,
      protonVersion: report.protonVersion,
    });
    void logFrontendEvent('DEBUG', 'Opened ProtonDB report detail', {
      appId,
      protonVersion: report.protonVersion,
      displayKey: report.displayKey,
      total: sortedReports.length,
    });
  };

  const openEditView = () => {
    if (!selected) return;
    debugMovement('open-edit-view', {
      reportDisplayKey: selected.displayKey,
    });
    setEditDraft(makeEditableFields(selected, selected.editLabel ?? ''));
    setOverlayMode('edit');
  };

  const saveEditedReport = () => {
    if (!appId || !selected || !editDraft) return;
    const nextEntry: EditedReportEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: editDraft.label.trim(),
      baseReportKey: reportKey(selected),
      report: applyEditableFields(selected, editDraft),
      updatedAt: Date.now(),
    };
    setEditedReports((current) => [nextEntry, ...current]);
    const nextKey = `edited:${nextEntry.id}`;
    setSelectedKey(nextKey);
    setFocusedCardKey(nextKey);
    setOverlayMode('list');
    setEditDraft(null);
    void logFrontendEvent('INFO', 'Saved edited report variant', {
      appId,
      baseDisplayKey: selected.displayKey,
      newDisplayKey: nextKey,
      label: nextEntry.label,
    });
    toaster.toast({
      title: 'Proton Pulse',
      body: nextEntry.label ? `Saved edited report: ${nextEntry.label}` : 'Saved edited report.',
    });
  };

  const handleDetailDirection = (evt: GamepadEvent) => {
    debugMovement('detail-direction', {
      button: gamepadButtonLabel(evt.detail.button),
    });
    if (!detailScrollRef.current) return;
    if (evt.detail.button === GamepadButton.DIR_UP) {
      detailScrollRef.current.scrollBy({ top: -DETAIL_SCROLL_STEP, behavior: 'smooth' });
      debugMovement('detail-scroll', {
        button: 'DIR_UP',
        nextScrollTop: detailScrollRef.current.scrollTop - DETAIL_SCROLL_STEP,
      });
      return;
    }
    if (evt.detail.button === GamepadButton.DIR_DOWN) {
      detailScrollRef.current.scrollBy({ top: DETAIL_SCROLL_STEP, behavior: 'smooth' });
      debugMovement('detail-scroll', {
        button: 'DIR_DOWN',
        nextScrollTop: detailScrollRef.current.scrollTop + DETAIL_SCROLL_STEP,
      });
      return;
    }
  };

  const handleRootDirection = (evt: GamepadEvent) => {
    debugMovement('root-direction', {
      button: gamepadButtonLabel(evt.detail.button),
      overlayOpen: overlayMode === 'detail' || overlayMode === 'edit',
    });
    if ((overlayMode === 'detail' || overlayMode === 'edit') && detailScrollRef.current) {
      if (evt.detail.button === GamepadButton.DIR_UP) {
        detailScrollRef.current.scrollBy({ top: -DETAIL_SCROLL_STEP, behavior: 'smooth' });
        return;
      }
      if (evt.detail.button === GamepadButton.DIR_DOWN) {
        detailScrollRef.current.scrollBy({ top: DETAIL_SCROLL_STEP, behavior: 'smooth' });
        return;
      }
    }
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      debugMovement('root-direction-trapped-left', {
        overlayOpen: overlayMode === 'detail' || overlayMode === 'edit',
      });
      return;
    }
  };

  const handleApply = async () => {
    const targetReport = selected;
    if (!targetReport || !appId) return;
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
    setApplying(true);
    try {
      await SteamClient.Apps.SetAppLaunchOptions(
        appId, `PROTON_VERSION="${targetReport.protonVersion}" %command%`
      );
      const detailsResult = await getSteamAppDetails(appId);
      const appliedLaunchOptions = getLaunchOptionsFromDetails(detailsResult.details);
      setCurrentLaunchOptions(appliedLaunchOptions);
      void logFrontendEvent('INFO', 'Launch options applied', {
        appId,
        appName,
        protonVersion: targetReport.protonVersion,
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
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to apply — check logs.' });
    } finally {
      setApplying(false);
    }
  };

  const handleUpvote = async () => {
    const targetReport = selected;
    if (!targetReport || !appId) return;
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
    setUpvoting(true);
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
    } finally {
      setUpvoting(false);
    }
  };

  const toolbarShellStyle = (focused?: boolean) => ({
    borderRadius: 8,
    padding: focused ? 2 : 1,
    background: focused ? 'rgba(255,255,255,0.12)' : 'transparent',
    boxShadow: focused
      ? '0 0 0 2px rgba(255,255,255,0.34) inset, 0 0 18px rgba(255,255,255,0.18), 0 0 30px rgba(255,255,255,0.14)'
      : 'none',
    animation: focused ? 'proton-pulse-toolbar-glow 1.7s ease-in-out infinite' : 'none',
  });

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

  const selectedLaunchPreview = selected ? buildLaunchOptionPreview(selected.protonVersion) : '';
  const selectedConfidence = selected ? (Math.min(100, selected.score) / 10).toFixed(1) : null;
  const showDiagnosticsState = !loading && (!sysInfo || (reports.length === 0 && editedReports.length === 0));
  const detectingGpu = !gpuVendor && !filterTouched;
  const overlayOpen = overlayMode === 'detail' || overlayMode === 'edit';
  const protonDbUrl = `https://www.protondb.com/app/${appId}`;

  return (
    <Focusable
      onGamepadDirection={handleRootDirection}
      onGamepadFocus={() => debugMovement('root-focus')}
      onGamepadBlur={() => debugMovement('root-blur')}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}
    >
      <style>
        {'@keyframes proton-pulse-toolbar-glow { 0% { box-shadow: 0 0 0 1px rgba(255,255,255,0.18) inset, 0 0 10px rgba(255,255,255,0.1); } 50% { box-shadow: 0 0 0 1px rgba(255,255,255,0.3) inset, 0 0 18px rgba(255,255,255,0.18); } 100% { box-shadow: 0 0 0 1px rgba(255,255,255,0.18) inset, 0 0 10px rgba(255,255,255,0.1); } }'}
      </style>
      <GameSummaryHeader appId={appId} appName={appName} reportsCount={scored.length} />
      {loading ? (
        <LoadingIndicator label="Fetching ProtonDB reports…" />
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
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '92px minmax(0, 1fr) minmax(0, 0.78fr) auto',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
              padding: '8px 0',
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
              <FilterIcon />
              <span>Filters</span>
            </div>
            <div
              style={{
                ...toolbarShellStyle(focusedToolbarControl === 'sort'),
                width: '100%',
                minWidth: 0,
              }}
              onFocusCapture={() => {
                setFocusedToolbarControl('sort');
                debugMovement('toolbar-focus', { control: 'sort' });
              }}
              onBlurCapture={() => {
                setFocusedToolbarControl((current) => current === 'sort' ? null : current);
                debugMovement('toolbar-blur', { control: 'sort' });
              }}
            >
              <DropdownItem
                rgOptions={[
                  { data: 'score', label: 'Sort: Best Match' },
                  { data: 'votes', label: 'Sort: Most Votes' },
                ]}
                selectedOption={sortMode}
                onChange={(option) => {
                  setSortPreference(option.data as SortMode);
                  setOverlayMode('list');
                }}
              />
            </div>
            <div
              style={{
                ...toolbarShellStyle(focusedToolbarControl === 'filter'),
                width: '100%',
                minWidth: 0,
                opacity: detectingGpu ? 0.7 : 1,
              }}
              onFocusCapture={() => {
                setFocusedToolbarControl('filter');
                debugMovement('toolbar-focus', { control: 'filter' });
              }}
              onBlurCapture={() => {
                setFocusedToolbarControl((current) => current === 'filter' ? null : current);
                debugMovement('toolbar-blur', { control: 'filter' });
              }}
            >
              <DropdownItem
                rgOptions={FILTER_ORDER.map((tier) => ({
                  data: tier,
                  label: tier === 'all' ? 'GPU: All' : `GPU: ${FILTER_LABELS[tier]}`,
                }))}
                selectedOption={filter}
                onChange={(option) => setFilterMode(option.data as FilterTier)}
                disabled={detectingGpu}
              />
            </div>
            <div style={{ fontSize: 11, color: '#7a9bb5', whiteSpace: 'nowrap', textAlign: 'right' }}>
              {sortedReports.length} shown
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4, opacity: overlayOpen ? 0.25 : 1 }}>
            <div style={{ marginBottom: 12, color: '#9db0c4', fontSize: 11 }}>
              {detectingGpu
                ? 'Detecting your GPU tier before narrowing the list. Showing all reports for now.'
                : 'Select a report card to open the full-screen detail view.'}
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
                      debugMovement('card-focus', {
                        reportDisplayKey: report.displayKey,
                        protonVersion: report.protonVersion,
                      });
                    }}
                    onSelect={openReportDetail}
                  />
                ))
              )}
            </div>
          </div>

          {overlayOpen && selected && (
            <Focusable
              onGamepadDirection={handleDetailDirection}
              onGamepadFocus={() => {
                detailScrollRef.current?.focus();
                debugMovement('detail-overlay-focus');
              }}
              onGamepadBlur={() => debugMovement('detail-overlay-blur')}
              onClick={() => {
                detailScrollRef.current?.focus();
                debugMovement('detail-overlay-click-focus');
              }}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 6,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflow: 'hidden',
                background: 'radial-gradient(circle at top left, rgba(73, 114, 158, 0.24), transparent 28%), linear-gradient(180deg, rgba(12, 18, 28, 0.992), rgba(7, 12, 20, 0.995))',
                border: 0,
                boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
                padding: '8px 8px 8px 4px',
              }}
            >
              <div
                ref={detailScrollRef}
                className="pp-detail-scroll"
                tabIndex={0}
                onFocus={() => debugMovement('detail-scroll-focus')}
                onBlur={() => debugMovement('detail-scroll-blur')}
                onScroll={() => debugMovement('detail-scroll-dom')}
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  outline: 'none',
                  borderRadius: 14,
                  paddingRight: 2,
                  paddingBottom: 8,
                  scrollBehavior: 'smooth',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(173, 216, 255, 0.55) rgba(255,255,255,0.08)',
                }}
              >
                <style>
                  {'.pp-detail-scroll::-webkit-scrollbar { width: 10px; } .pp-detail-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.06); border-radius: 999px; } .pp-detail-scroll::-webkit-scrollbar-thumb { background: rgba(173,216,255,0.45); border-radius: 999px; border: 2px solid rgba(8,14,22,0.4); }'}
                </style>
                <div
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '100%',
                    padding: 12,
                    borderRadius: 16,
                    background: 'linear-gradient(180deg, rgba(24, 34, 46, 0.96), rgba(12, 19, 28, 0.98))',
                    border: 0,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.24)',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(260px, 1fr)', gap: 14, alignItems: 'stretch', marginBottom: 12 }}>
                    <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <BrandLogo size={18} />
                          <div style={{ fontSize: 11, color: '#89a9c6', letterSpacing: 0.45 }}>
                            {overlayMode === 'edit' ? 'Edited Config' : 'Report Detail'}
                          </div>
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: '#f3fbff', marginBottom: 6 }}>
                          {selected.protonVersion}
                        </div>
                        <div style={{ fontSize: 12, color: '#c0d8ee', lineHeight: 1.45 }}>
                          {selected.rating.toUpperCase()} · {selectedConfidence}/10 confidence · {matchLabel(selected, sysInfo)}
                        </div>
                        {selected.isEdited && (
                          <div style={{ marginTop: 8, fontSize: 10, color: '#eaf4ff' }}>
                            Edited* {selected.editLabel ? `· ${selected.editLabel}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <img
                        src={STEAM_HEADER_URL(appId)}
                        style={{
                          width: '100%',
                          height: 104,
                          borderRadius: 8,
                          objectFit: 'cover',
                          border: '1px solid rgba(120, 170, 220, 0.3)',
                          boxShadow: '0 10px 24px rgba(0,0,0,0.24)',
                        }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ padding: '5px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: '#d9e8f4', fontSize: 10, whiteSpace: 'nowrap' }}>
                          {selected.gpuTier.toUpperCase()}
                        </div>
                        <div style={{ padding: '5px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: '#d9e8f4', fontSize: 10, whiteSpace: 'nowrap' }}>
                          {selected.upvotes} votes
                        </div>
                        <div style={{ padding: '5px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: '#d9e8f4', fontSize: 10, whiteSpace: 'nowrap' }}>
                          {formatTimestamp(selected.timestamp)}
                        </div>
                        <a
                          href={protonDbUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 30,
                            height: 30,
                            borderRadius: 999,
                            background: 'rgba(255,255,255,0.08)',
                            color: '#dff0ff',
                            textDecoration: 'none',
                          }}
                        >
                          <ProtonDbBrandIcon />
                        </a>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      ...detailPanelStyle(),
                      marginBottom: 12,
                      display: 'grid',
                      gap: 8,
                      gridTemplateColumns: overlayMode === 'edit'
                        ? 'repeat(2, minmax(0, 1fr))'
                        : 'repeat(4, minmax(0, 1fr))',
                      alignItems: 'center',
                    }}
                  >
                    {overlayMode === 'edit' ? (
                      <>
                        <CompactButton
                          label="Save Edits"
                          onPress={saveEditedReport}
                          focused={focusedActionControl === 'save'}
                          active
                          onFocus={() => {
                            setFocusedActionControl('save');
                            debugMovement('action-focus', { control: 'save' });
                          }}
                          onBlur={() => {
                            setFocusedActionControl((current) => current === 'save' ? null : current);
                            debugMovement('action-blur', { control: 'save' });
                          }}
                        />
                        <CompactButton
                          label="Cancel"
                          onPress={() => setOverlayMode('detail')}
                          focused={focusedActionControl === 'cancel'}
                          onFocus={() => {
                            setFocusedActionControl('cancel');
                            debugMovement('action-focus', { control: 'cancel' });
                          }}
                          onBlur={() => {
                            setFocusedActionControl((current) => current === 'cancel' ? null : current);
                            debugMovement('action-blur', { control: 'cancel' });
                          }}
                        />
                      </>
                    ) : (
                      <>
                        <CompactButton
                          label={applying ? 'Applying…' : 'Apply Config'}
                          onPress={handleApply}
                          focused={focusedActionControl === 'apply'}
                          active
                          disabled={!selected || applying}
                          onFocus={() => {
                            setFocusedActionControl('apply');
                            debugMovement('action-focus', { control: 'apply' });
                          }}
                          onBlur={() => {
                            setFocusedActionControl((current) => current === 'apply' ? null : current);
                            debugMovement('action-blur', { control: 'apply' });
                          }}
                        />
                        <CompactButton
                          label="Edit Config"
                          onPress={openEditView}
                          focused={focusedActionControl === 'edit'}
                          onFocus={() => {
                            setFocusedActionControl('edit');
                            debugMovement('action-focus', { control: 'edit' });
                          }}
                          onBlur={() => {
                            setFocusedActionControl((current) => current === 'edit' ? null : current);
                            debugMovement('action-blur', { control: 'edit' });
                          }}
                        />
                        <CompactButton
                          label={upvoting ? '★ …' : '★ Upvote Report'}
                          onPress={handleUpvote}
                          focused={focusedActionControl === 'upvote'}
                          accent
                          disabled={!selected || upvoting}
                          onFocus={() => {
                            setFocusedActionControl('upvote');
                            debugMovement('action-focus', { control: 'upvote' });
                          }}
                          onBlur={() => {
                            setFocusedActionControl((current) => current === 'upvote' ? null : current);
                            debugMovement('action-blur', { control: 'upvote' });
                          }}
                        />
                        <CompactButton
                          label="Back"
                          onPress={() => setOverlayMode('list')}
                          focused={focusedActionControl === 'back'}
                          onFocus={() => {
                            setFocusedActionControl('back');
                            debugMovement('action-focus', { control: 'back' });
                          }}
                          onBlur={() => {
                            setFocusedActionControl((current) => current === 'back' ? null : current);
                            debugMovement('action-blur', { control: 'back' });
                          }}
                        />
                      </>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gap: 12,
                      gridTemplateColumns: '1fr',
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ ...detailPanelStyle(), marginBottom: 0 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
                        <div style={{ fontSize: 10, color: '#7a9bb5' }}>Game</div>
                        <div style={{ fontSize: 12, color: '#eef7ff', fontWeight: 600 }}>{appName || `App ${appId}`}</div>
                      </div>
                    </div>
                    <div style={{ ...detailPanelStyle(), marginBottom: 0 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
                        <div style={{ fontSize: 10, color: '#7a9bb5' }}>Launch Preview</div>
                        <div style={{ fontSize: 11, color: '#d8ebff', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                          {selectedLaunchPreview}
                        </div>
                      </div>
                    </div>
                    <div style={{ ...detailPanelStyle(), marginBottom: 0 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
                        <div style={{ fontSize: 10, color: '#7a9bb5' }}>Current Launch Options</div>
                        <div style={{ fontSize: 11, color: currentLaunchOptions ? '#e8f4ff' : '#9db0c4', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                          {currentLaunchOptions || 'No launch options set.'}
                        </div>
                      </div>
                    </div>
                    {overlayMode === 'edit' && editDraft ? (
                      <div style={{ ...detailPanelStyle(), display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                        {[
                          ['Label', 'label'],
                          ['Proton Version', 'protonVersion'],
                          ['Title', 'title'],
                          ['GPU', 'gpu'],
                          ['GPU Driver', 'gpuDriver'],
                          ['OS', 'os'],
                          ['Kernel', 'kernel'],
                          ['RAM', 'ram'],
                        ].map(([label, key]) => (
                          <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: '#a9c2d7' }}>
                            {label}
                            <input
                              value={editDraft[key as keyof EditableReportFields] as string}
                              onChange={(e) => setEditDraft({ ...editDraft, [key]: e.target.value })}
                              style={{
                                borderRadius: 8,
                                border: '1px solid #44627f',
                                background: 'rgba(5,10,18,0.42)',
                                color: '#f1f7ff',
                                padding: '10px 12px',
                              }}
                            />
                          </label>
                        ))}
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: '#a9c2d7' }}>
                          Rating
                          <select
                            value={editDraft.rating}
                            onChange={(e) => setEditDraft({ ...editDraft, rating: e.target.value as CdnReport['rating'] })}
                            style={{
                              borderRadius: 8,
                              border: '1px solid #44627f',
                              background: 'rgba(5,10,18,0.42)',
                              color: '#f1f7ff',
                              padding: '10px 12px',
                            }}
                          >
                            {['platinum', 'gold', 'silver', 'bronze', 'borked', 'pending'].map((rating) => (
                              <option key={rating} value={rating}>{rating}</option>
                            ))}
                          </select>
                        </label>
                        <div />
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1', fontSize: 11, color: '#a9c2d7' }}>
                          Notes
                          <textarea
                            value={editDraft.notes}
                            onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                            rows={8}
                            style={{
                              borderRadius: 8,
                              border: '1px solid #44627f',
                              background: 'rgba(5,10,18,0.42)',
                              color: '#f1f7ff',
                              padding: '10px 12px',
                              resize: 'vertical',
                            }}
                          />
                        </label>
                      </div>
                    ) : (
                    <div style={{ display: 'grid', gap: 20, gridTemplateColumns: '1fr', flex: 1, alignItems: 'start', paddingTop: 10 }}>
                      <div style={bareDetailSectionStyle()}>
                        <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 8, letterSpacing: 0.25 }}>Hardware Match</div>
                        <div style={{ fontSize: 11, color: '#e8f4ff', lineHeight: 1.72 }}>
                          <div>GPU / Driver: {selected.gpu || 'Unknown GPU'} · {selected.gpuDriver || 'Unknown driver'}</div>
                          <div>OS / Kernel / RAM: {selected.os || 'Unknown OS'} · {selected.kernel || 'Unknown kernel'} · {selected.ram || 'Unknown RAM'}</div>
                          <div>Community: {selected.upvotes} upvotes · GPU tier {selected.gpuTier}</div>
                        </div>
                      </div>
                      <div style={bareDetailSectionStyle()}>
                        <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 8, letterSpacing: 0.25 }}>Scoring</div>
                        <div style={{ fontSize: 11, color: '#e8f4ff', lineHeight: 1.72 }}>
                          <div>Submitted: {formatTimestamp(selected.timestamp)}</div>
                          <div>Score: {selected.score}</div>
                          <div>{selected.rating} base rating · {selected.notesModifier >= 0 ? '+' : ''}{selected.notesModifier} notes modifier</div>
                        </div>
                      </div>
                      <div style={bareDetailSectionStyle()}>
                        <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 8, letterSpacing: 0.25 }}>Full Report Text</div>
                        <div style={{ fontSize: 11, color: '#d8ebff', lineHeight: 1.72, whiteSpace: 'pre-wrap' }}>
                          {selected.notes || 'No additional notes were provided for this report.'}
                        </div>
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              </div>
            </Focusable>
          )}
        </>
      )}
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
