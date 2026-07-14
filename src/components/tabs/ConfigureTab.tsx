// src/components/tabs/ConfigureTab.tsx
import { Component, type ErrorInfo, type ReactNode, useState, useEffect, useMemo } from 'react';
import { Focusable, DialogButton, ConfirmModal, ModalRoot, showModal, Dropdown, SteamSpinner } from '@decky/ui';
import { toaster } from '../../lib/notify';
import { computeConfidence, bucketByGpuTier } from '../../lib/scoring';
import {
  getProtonDBReportsWithDiagnostics,
  type ReportFetchDiagnostics,
} from '../../lib/protondb';
import { getUserVote, getVoteTotals, submitVote, deleteVote } from '../../lib/voting';
import { getUserConfigs, type UserConfigRow } from '../../lib/userConfigs';
import type { VoteTotals } from '../../lib/cache';
import { getSetting, setSetting } from '../../lib/settings';
import type { CdnReport, ScoredReport, SystemInfo, GpuVendor } from '../../types';
import { logFrontendEvent } from '../../lib/logger';
import { getLaunchOptionsFromDetails, getSteamAppDetails, getSteamAppOverview, isSteamShortcutApp, NON_STEAM_ID_THRESHOLD } from '../../lib/steamApps';
import { getGameSource, sourceStoreLabel, type GameSourceInfo } from '../../lib/gameSource';
import { GameBanner } from '../GameBanner';
import { checkProtonVersionAvailability, getProtonGeManagerState, installProtonGe } from '../../lib/compatTools';
import {
  registerScreenshotAutomationHandler,
  runRegisteredScreenshotAutomationHandler,
} from '../../lib/screenshotAutomation';
import { ReportCard, type DisplayReportCard } from '../ReportCard';
import { showPerReportAnalysisModal } from '../PerReportAnalysisModal';
import { ReportDetailModal } from '../ReportDetailModal';
import { RATING_COLORS } from '../../lib/reportFormatters';
import { resolveLaunchOptionsWithPrompt, showLaunchOptionConflictPreview } from '../LaunchOptionConflictModal';
import { t } from '../../lib/i18n';
import { addTrackedConfig } from '../../lib/trackedConfigs';
import { parseLaunchOptions } from '../../lib/launchVars';
import { computeCombinedTier, type PulseTierResult } from '../../lib/pulseTier';
import { computeGameStats } from '../../lib/gameStats';
import { matchesConfigFilter, type ConfigFilter } from '../../lib/reportFilters';

interface Props {
  appId: number | null;
  appName: string;
  sysInfo: SystemInfo | null;
}

type FilterTier = GpuVendor | 'all';
type FilterArch = string; // e.g. "RDNA2", "Ada", "Polaris", or "all"
type SortMode = 'score' | 'votes';

// Resolve a display name for an app id, trying every source Steam exposes.
// Order matters: caller-supplied appName wins (it came from dispatchNavigate
// which already did its own lookup), then SteamClient.Apps overview (real
// Steam apps), then collectionStore (non-Steam shortcuts where
// GetAppOverviewByAppID can return null), then a plain App <id> as last resort
function resolveDisplayName(appId: number, appName: string): string {
  if (appName && appName.trim()) return appName;
  try {
    const overview = getSteamAppOverview(appId);
    const overviewName = overview?.display_name || overview?.strDisplayName || overview?.app_name || overview?.appname;
    if (typeof overviewName === 'string' && overviewName.trim()) return overviewName;
    const collection = (globalThis as any).collectionStore?.allAppsCollection;
    const allApps = Array.isArray(collection?.allApps)
      ? collection.allApps
      : collection?.apps && Symbol.iterator in collection.apps
        ? Array.from(collection.apps)
        : [];
    const libraryEntry = allApps.find((app: any) => Number(app?.appid) === appId);
    const libraryName = libraryEntry?.display_name || libraryEntry?.strDisplayName || libraryEntry?.app_name || libraryEntry?.appname || libraryEntry?.name;
    if (typeof libraryName === 'string' && libraryName.trim()) return libraryName;
  } catch { /* steamclient not available, fall through */ }
  return `App ${appId}`;
}

const reportKey = (r: CdnReport) => `${r.timestamp}_${r.protonVersion}`;

const FILTER_ORDER: FilterTier[] = ['nvidia', 'amd', 'intel', 'other', 'all'];
const CONFIG_FILTER_ORDER: ConfigFilter[] = ['all', 'pulse', 'protondb', 'protondb-edited'];
function filterLabel(tier: FilterTier): string {
  const extras = t().extras!;
  if (tier === 'all') return extras.all();
  if (tier === 'other') return extras.other();
  return tier === 'nvidia' ? 'NVIDIA' : tier === 'amd' ? 'AMD' : 'Intel';
}

function gpuFilterOptionLabel(tier: FilterTier, count: number): string {
  return `${filterLabel(tier)} (${count})`;
}

function configFilterLabel(filter: ConfigFilter): string {
  const strings = t();
  if (filter === 'all') return strings.extras!.all();
  if (filter === 'pulse') return 'Proton Pulse';
  if (filter === 'protondb') return strings.configManager.configTypeProtondb;
  return strings.configManager.configTypeProtondbEdited;
}

function configFilterOptionLabel(filter: ConfigFilter, count: number): string {
  return `${configFilterLabel(filter)} (${count})`;
}
const EDIT_STORAGE_PREFIX = 'edited-reports:';
const EDIT_INDEX_KEY = 'edited-reports-index';

export interface EditedReportIndexEntry { appId: number; appName: string; protonVersion: string; label: string; savedAt: number; }

export function getEditedReportIndex(): EditedReportIndexEntry[] {
  return getSetting<EditedReportIndexEntry[]>(EDIT_INDEX_KEY, []);
}

export function upsertEditedReportIndex(appId: number, appName: string, protonVersion: string, label: string): void {
  const index = getEditedReportIndex().filter((e) => e.appId !== appId);
  setSetting(EDIT_INDEX_KEY, [...index, { appId, appName, protonVersion, label, savedAt: Date.now() }]);
}

export function removeFromEditedReportIndex(appId: number): void {
  setSetting(EDIT_INDEX_KEY, getEditedReportIndex().filter((e) => e.appId !== appId));
}

// --- Pulse user-report helpers ---

function pulseRowToCdnReport(row: UserConfigRow): CdnReport {
  return {
    appId:        String(row.app_id),
    cpu:          row.cpu,
    duration:     row.duration || 'unreported',
    gpu:          row.gpu,
    gpuDriver:    row.gpu_driver || '',
    kernel:       row.kernel || '',
    notes:        row.notes || '',
    os:           row.os,
    protonVersion: row.proton_version,
    ram:          row.ram,
    rating:       row.rating,
    timestamp:    Math.floor(new Date(row.created_at).getTime() / 1000),
    title:        row.title,
    reportId:     row.id ?? null,
    formResponses: row.form_responses ?? null,
  };
}

/** Normalise a proton version string for fuzzy comparison. */
function normaliseVersion(v: string): string {
  return v.toLowerCase().replace(/[\s\-_]/g, '').replace(/^ge/, '');
}

/**
 * Insert Pulse report cards after the first CDN card whose proton version
 * matches (exact) or near-matches (same major.minor prefix).  Falls back to
 * prepending when no CDN match exists.
 */
function mergeWithPulse(
  base: DisplayReportCard[],
  pulse: DisplayReportCard[],
): DisplayReportCard[] {
  if (!pulse.length) return base;

  const result = [...base];
  for (const p of pulse) {
    const normP = normaliseVersion(p.protonVersion);
    // Prefer exact match, then prefix match (same major.minor).
    const exactIdx  = result.findIndex(r => !r.isPulse && normaliseVersion(r.protonVersion) === normP);
    const prefixIdx = exactIdx === -1
      ? result.findIndex(r => !r.isPulse && (
          normaliseVersion(r.protonVersion).startsWith(normP.slice(0, 6)) ||
          normP.startsWith(normaliseVersion(r.protonVersion).slice(0, 6))
        ))
      : -1;
    const insertAfter = exactIdx !== -1 ? exactIdx : prefixIdx;
    if (insertAfter !== -1) {
      result.splice(insertAfter + 1, 0, p);
    } else {
      result.unshift(p);   // no CDN match - show at top
    }
  }
  return result;
}

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

function ReportFiltersModal({
  filter, setFilterMode, gpuFilterCounts,
  archFilter, setArchFilter, availArchitectures, tierFiltered,
  configFilter, setConfigFilterMode, configFilterCounts,
  visibleReports,
  onClose,
}: {
  filter: FilterTier;
  setFilterMode: (f: FilterTier) => void;
  gpuFilterCounts: Record<FilterTier, number>;
  archFilter: FilterArch;
  setArchFilter: (a: FilterArch) => void;
  availArchitectures: string[];
  tierFiltered: DisplayReportCard[];
  configFilter: ConfigFilter;
  setConfigFilterMode: (f: ConfigFilter) => void;
  configFilterCounts: Record<ConfigFilter, number>;
  visibleReports: DisplayReportCard[];
  onClose: () => void;
}) {
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#cfe2f4', fontWeight: 700, width: 100, flexShrink: 0 };
  return (
    <ModalRoot onCancel={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0 16px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff', marginBottom: 2 }}>{t().common.filters}</div>
        <div style={rowStyle}>
          <div style={labelStyle}>{t().configManager.gpuFilter}</div>
          <div style={{ flex: 1 }}>
            <Dropdown
              strDefaultLabel={gpuFilterOptionLabel(filter, gpuFilterCounts[filter])}
              rgOptions={FILTER_ORDER.map((tier) => ({ data: tier, label: gpuFilterOptionLabel(tier, gpuFilterCounts[tier]) }))}
              selectedOption={filter}
              onChange={(opt) => setFilterMode(opt.data as FilterTier)}
            />
          </div>
        </div>
        {availArchitectures.length > 1 && (
          <div style={rowStyle}>
            <div style={labelStyle}>{t().configManager.archFilter}</div>
            <div style={{ flex: 1 }}>
              <Dropdown
                strDefaultLabel={archFilter === 'all' ? `All (${tierFiltered.length})` : `${archFilter} (${visibleReports.length})`}
                rgOptions={[
                  { data: 'all', label: `All (${tierFiltered.length})` },
                  ...availArchitectures.map(arch => ({
                    data: arch,
                    label: `${arch} (${tierFiltered.filter(r => r.gpuArchitecture === arch).length})`,
                  })),
                ]}
                selectedOption={archFilter}
                onChange={(opt) => setArchFilter(opt.data as FilterArch)}
              />
            </div>
          </div>
        )}
        <div style={rowStyle}>
          <div style={labelStyle}>{t().configManager.configFilter}</div>
          <div style={{ flex: 1 }}>
            <Dropdown
              strDefaultLabel={configFilterOptionLabel(configFilter, configFilterCounts[configFilter])}
              rgOptions={CONFIG_FILTER_ORDER.map((value) => ({ data: value, label: configFilterOptionLabel(value, configFilterCounts[value]) }))}
              selectedOption={configFilter}
              onChange={(opt) => setConfigFilterMode(opt.data as ConfigFilter)}
            />
          </div>
        </div>
        <Focusable style={{ marginTop: 4 }}>
          <DialogButton onClick={onClose} style={{ width: '100%', fontSize: 13 }}>
            {t().common.close}
          </DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
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
      strTitle={t().configure.requiredProtonVersion}
      strDescription={t().configure.requiresVersion(requiredVersion)}
      strOKButtonText={t().common.cancel}
      onOK={onCancel}
      onCancel={onCancel}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 420, maxWidth: 520 }}>
        <div style={{ fontSize: 11, color: '#9eb7cc', lineHeight: 1.45 }}>
          {t().configure.chooseApplyMethod}
        </div>
        <DialogButton onClick={() => onResolve('install')}>{t().configure.installVersion(requiredVersion)}</DialogButton>
        <DialogButton onClick={() => onResolve('pick')}>{t().configure.pickInstalledVersion}</DialogButton>
        <DialogButton onClick={() => onResolve('closest')} disabled={!closestInstalledLabel && !latestInstalledLabel}>
          {closestInstalledLabel
            ? t().configure.searchClosestWith(closestInstalledLabel)
            : t().configure.searchClosestVersion}
        </DialogButton>
        <DialogButton onClick={() => onResolve('latest')} disabled={!latestInstalledLabel}>
          {latestInstalledLabel ? t().configure.useLatestInstalledWith(latestInstalledLabel) : t().configure.useLatestInstalled}
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
      strTitle={t().configure.pickInstalledVersion}
      strDescription={t().configure.chooseInstalledTool}
      strOKButtonText={t().common.cancel}
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
          {t().configure.useSelectedVersion}
        </DialogButton>
      </div>
    </ConfirmModal>
  );
}

function GameSummaryHeader({
  appId,
  appName,
  reportsCount,
  combinedTier,
  resolvedSteamAppId,
  isInLibrary,
  demoFullGameAppId,
  demoFullGameName,
}: {
  appId: number;
  appName: string;
  reportsCount?: number;
  combinedTier?: PulseTierResult | null;
  resolvedSteamAppId?: number | null;
  isInLibrary?: boolean;
  demoFullGameAppId?: number | null;
  demoFullGameName?: string;
}) {
  const extras = t().extras!;
  const isShortcut = isSteamShortcutApp(appId);
  const isDemo = !!demoFullGameAppId;
  const headerAppId = demoFullGameAppId ?? (isShortcut && resolvedSteamAppId ? resolvedSteamAppId : appId);
  const resolvedName = resolveDisplayName(appId, appName);
  const displayName = isDemo
    ? `${demoFullGameName || resolvedName} (${t().configure.demo})`
    : resolvedName;
  const tierColor = combinedTier && combinedTier.count > 0 ? (RATING_COLORS[combinedTier.tier] ?? '#888') : null;
  // Show the identified launcher (Heroic / GOG / Epic) in the subtitle when we
  // have it. Falls back to the generic non-Steam label so nothing regresses.
  const [gameSource, setGameSource] = useState<GameSourceInfo | null>(null);
  useEffect(() => {
    if (!isShortcut) return;
    let alive = true;
    void getGameSource(appId, appName).then((info) => {
      if (alive) setGameSource(info);
    });
    return () => { alive = false; };
  }, [appId, appName, isShortcut]);
  // Show launcher and store together (e.g. "Heroic . Epic Games") so the
  // reader knows both what launches the game and where it came from.
  const shortcutSubtitle = gameSource?.source
    ? [gameSource.source, sourceStoreLabel(gameSource)].filter(Boolean).join(' . ')
    : extras.nonSteamShortcut();
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
      <GameBanner
        appId={headerAppId}
        // 50px lines up the title row + appID subtitle row with the GOLD +
        // Confidence stack on the right side. 40px was just enough to fit the
        // title but left the subtitle dangling below the right-side badges
        style={{ height: 50, borderRadius: 3, objectFit: 'cover' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff' }}>
          {displayName}
        </div>
        <div style={{ fontSize: 11, color: '#7a9bb5' }}>
          {isShortcut
            ? `${shortcutSubtitle}${resolvedSteamAppId ? ` (Steam app id: ${resolvedSteamAppId})` : ''}`
            : `${extras.appIdLabel(appId)}${typeof reportsCount === 'number' ? ` . ${t().reports.communityReports(reportsCount)}` : ''}`}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {isDemo && (
          <span style={{
            background: 'rgba(100,180,255,0.15)',
            border: '1px solid rgba(100,180,255,0.4)',
            color: 'rgba(140,200,255,0.9)',
            borderRadius: 999,
            padding: '2px 8px',
            fontWeight: 600,
            fontSize: 10,
            whiteSpace: 'nowrap',
            letterSpacing: '0.03em',
          }}>
            {t().configure.demo}
          </span>
        )}
        {isInLibrary === false && (
          <span style={{
            background: 'rgba(255,200,60,0.15)',
            border: '1px solid rgba(255,200,60,0.4)',
            color: 'rgba(255,200,60,0.9)',
            borderRadius: 999,
            padding: '2px 8px',
            fontWeight: 600,
            fontSize: 10,
            whiteSpace: 'nowrap',
            letterSpacing: '0.03em',
          }}>
            {t().configure.notInLibrary}
          </span>
        )}
        {tierColor && combinedTier && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginBottom: 6 }}>
            <span
              style={{
                background: tierColor,
                color: '#111',
                borderRadius: 999,
                padding: '3px 10px',
                fontWeight: 700,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {(t().ratings as Record<string, string>)[combinedTier.tier] ?? combinedTier.tier}
            </span>
            {combinedTier.confidencePct > 0 && (
              <span
                title={`${combinedTier.confidencePct}% confidence across ${combinedTier.count} report${combinedTier.count === 1 ? '' : 's'}`}
                style={{
                  // cyan-blue confidence palette, matches proton-pulse.com
                  background: combinedTier.confidencePct >= 80 ? '#66c0f4'
                             : combinedTier.confidencePct >= 60 ? '#4a90b8'
                             : combinedTier.confidencePct >= 40 ? '#3a6680'
                             : '#4a5a6a',
                  color: combinedTier.confidencePct >= 60 ? '#0a1a24' : '#e8f4ff',
                  borderRadius: 3,
                  padding: '2px 8px',
                  fontWeight: 700,
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  letterSpacing: 0.4,
                }}
              >
                {t().reports.confidence}: {combinedTier.confidencePct}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function effectiveAutoFilter(gpuVendor: GpuVendor | null): FilterTier {
  if (gpuVendor === 'nvidia' || gpuVendor === 'amd') return gpuVendor;
  if (gpuVendor === 'intel') return 'intel';
  return 'all';
}

function emptyScoreContext(): SystemInfo {
  return {
    cpu: null,
    ram_gb: null,
    gpu: null,
    gpu_vendor: null,
    driver_version: null,
    kernel: null,
    distro: null,
    proton_custom: null,
    vram_mb: null,
    cpu_cores: null,
    display_resolution: null,
    steam_deck_model: null,
  };
}

function buildScoreContextForFilter(sysInfo: SystemInfo | null, filter: FilterTier): SystemInfo {
  const base = sysInfo ?? emptyScoreContext();
  if (filter === 'all') return base;
  if (base.gpu_vendor === filter) return base;

  return {
    ...base,
    gpu_vendor: filter,
    gpu: null,
    driver_version: null,
  };
}

function editStorageKey(appId: number): string {
  return `${EDIT_STORAGE_PREFIX}${appId}`;
}

function loadEditedReports(appId: number): EditedReportEntry[] {
  return getSetting<EditedReportEntry[]>(editStorageKey(appId), []);
}

export function clearEditedReports(appId: number): void {
  setSetting(editStorageKey(appId), []);
  removeFromEditedReportIndex(appId);
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
            {t().configure.renderErrorIntro}
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

function lookupAppNameFromCollection(appId: number): string {
  try {
    const collection = (globalThis as any).collectionStore?.allAppsCollection;
    const allApps = Array.isArray(collection?.allApps)
      ? collection.allApps
      : collection?.apps && Symbol.iterator in collection.apps
        ? Array.from(collection.apps)
        : [];
    const entry = allApps.find((app: any) => Number(app?.appid) === appId);
    return entry?.display_name || entry?.strDisplayName || entry?.app_name || entry?.appname || entry?.name || '';
  } catch {
    return '';
  }
}

function ConfigureTabContent({ appId, appName, sysInfo }: Props) {
  const extras = t().extras!;
  const isShortcut = appId ? isSteamShortcutApp(appId) : false;
  // Non-shortcut apps not found in the local library overview are store-only views;
  // applying launch options requires the game to be in the library.
  const isInLibrary = isShortcut || (appId !== null && appId !== undefined && appId >= NON_STEAM_ID_THRESHOLD) || (appId ? (
    getSteamAppOverview(appId) !== null ||
    (() => {
      try {
        const collection = (globalThis as any).collectionStore?.allAppsCollection;
        const allApps = Array.isArray(collection?.allApps)
          ? collection.allApps
          : collection?.apps && Symbol.iterator in collection.apps
            ? Array.from(collection.apps)
            : [];
        return allApps.some((app: any) => Number(app?.appid) === appId);
      } catch { return false; }
    })()
  ) : true);
  // When appName prop is empty, fall back to Steam's app overview for the
  // real title (covers entries from search results / deep links where the
  // navigation event didn't carry a display name). For non-Steam shortcuts
  // we additionally try collectionStore since BIsShortcut returns no name.
  const effectiveAppName = (
    appName
    || (appId ? (getSteamAppOverview(appId)?.display_name ?? '') : '')
    || (appId && isShortcut ? lookupAppNameFromCollection(appId) : '')
  ) ?? '';
  // null = resolution pending, 'none' = tried but no Steam match, number = resolved ID
  const [resolvedSteamAppId, setResolvedSteamAppId] = useState<number | 'none' | null>(null);
  const [demoFullGameAppId, setDemoFullGameAppId] = useState<number | null>(null);
  const [demoFullGameName, setDemoFullGameName] = useState<string>('');
  // For non-Steam shortcuts: block data fetches until resolution completes, then
  // use the matched Steam store app ID (or fall back to the shortcut ID if none).
  // For Steam demos: use the full game app ID for data fetching.
  const effectiveAppId = !isShortcut
    ? (demoFullGameAppId ?? appId)
    : resolvedSteamAppId === null ? null
    : resolvedSteamAppId === 'none' ? appId
    : resolvedSteamAppId;

  const [reports, setReports]   = useState<CdnReport[]>([]);
  const [editedReports, setEditedReports] = useState<EditedReportEntry[]>([]);
  const [pulseReports, setPulseReports] = useState<UserConfigRow[]>([]);
  const [votes, setVotes]       = useState<Record<string, VoteTotals>>({});
  const [loading, setLoading]   = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusedCardKey, setFocusedCardKey] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('score');
  const [filterTouched, setFilterTouched] = useState(false);
  const [reportDiagnostics, setReportDiagnostics] = useState<ReportFetchDiagnostics | null>(null);
  const [currentLaunchOptions, setCurrentLaunchOptions] = useState('');
  const [configFilter, setConfigFilter] = useState<ConfigFilter>('all');

  const gpuVendor = sysInfo?.gpu_vendor ?? null;
  const [filter, setFilter] = useState<FilterTier>('all');
  const [archFilter, setArchFilter] = useState<FilterArch>('all');

  const scoreContext = useMemo(
    () => buildScoreContextForFilter(sysInfo, filter),
    [sysInfo, filter],
  );

  const baseDisplayReports: DisplayReportCard[] = reports.map(r => ({
    ...computeConfidence(r, scoreContext),
    upvotes: votes[reportKey(r)]?.upvotes ?? 0,
    downvotes: votes[reportKey(r)]?.downvotes ?? 0,
    displayKey: `cdn:${reportKey(r)}`,
  }));

  const editedDisplayReports: DisplayReportCard[] = editedReports.map((entry) => ({
    ...computeConfidence(entry.report, scoreContext),
    upvotes: votes[reportKey(entry.report)]?.upvotes ?? 0,
    downvotes: votes[reportKey(entry.report)]?.downvotes ?? 0,
    displayKey: `edited:${entry.id}`,
    isEdited: true,
    editLabel: entry.label,
  }));

  const pulseDisplayReports: DisplayReportCard[] = pulseReports.map(row => ({
    ...computeConfidence(pulseRowToCdnReport(row), scoreContext),
    upvotes:    0,
    downvotes:  0,
    displayKey: `pulse:${row.id}`,
    isPulse:    true,
    pulseTitle: row.title,
  }));

  const scored: DisplayReportCard[] = mergeWithPulse(
    [...editedDisplayReports, ...baseDisplayReports],
    pulseDisplayReports,
  );

  const combinedTier = useMemo(() => computeCombinedTier(scored, pulseReports), [scored, pulseReports]);
  const gameStats = useMemo(() => computeGameStats(scored, pulseReports), [scored, pulseReports]);
  // Use computeGameStats confidencePct (same as Analysis tab) so header and Analysis agree
  const combinedTierForHeader = useMemo(
    () => combinedTier ? { ...combinedTier, confidencePct: gameStats.confidencePct } : null,
    [combinedTier, gameStats],
  );

  const buckets = bucketByGpuTier(scored as ScoredReport[]) as {
    nvidia: DisplayReportCard[];
    amd: DisplayReportCard[];
    other: DisplayReportCard[];
  };

  const tierFiltered: DisplayReportCard[] =
    filter === 'all'                       ? [...buckets.nvidia, ...buckets.amd, ...buckets.other] :
    filter === 'nvidia'                    ? buckets.nvidia :
    filter === 'amd'                       ? buckets.amd :
    filter === 'intel' || filter === 'other' ? buckets.other :
                                               buckets.other;

  const availArchitectures: string[] = useMemo(() => {
    const archs = [...new Set(tierFiltered.map(r => r.gpuArchitecture).filter(Boolean))];
    return archs.sort();
  }, [tierFiltered]);

  const visibleReports: DisplayReportCard[] = useMemo(() =>
    archFilter === 'all'
      ? tierFiltered
      : tierFiltered.filter(r => r.gpuArchitecture === archFilter),
    [tierFiltered, archFilter],
  );

  const gpuFilterCounts = useMemo(() => ({
    all: scored.length,
    nvidia: buckets.nvidia.length,
    amd: buckets.amd.length,
    intel: buckets.other.length,
    other: buckets.other.length,
  }), [scored, buckets]);

  const configFilterCounts = useMemo(() => ({
    all: visibleReports.length,
    pulse: visibleReports.filter((report) => matchesConfigFilter(report, 'pulse')).length,
    protondb: visibleReports.filter((report) => matchesConfigFilter(report, 'protondb')).length,
    'protondb-edited': visibleReports.filter((report) => matchesConfigFilter(report, 'protondb-edited')).length,
  }), [visibleReports]);

  const configFilteredReports = visibleReports.filter((report) => matchesConfigFilter(report, configFilter));

  const sortedReports =
    sortMode === 'votes'
      ? [...configFilteredReports].sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes))
      : configFilteredReports;

  // Resolve Steam store app ID for non-Steam shortcuts, and detect demos for Steam apps.
  useEffect(() => {
    setResolvedSteamAppId(null);
    setDemoFullGameAppId(null);
    setDemoFullGameName('');
    void logFrontendEvent('DEBUG', '[ConfigureTab] resolve effect fired', { appId, appName: effectiveAppName, isShortcut });
    if (!appId) return;
    let cancelled = false;
    void getGameSource(appId, effectiveAppName).then((info) => {
      if (cancelled) return;
      void logFrontendEvent('DEBUG', '[ConfigureTab] getGameSource result', { appId, appName: effectiveAppName, info });
      if (isShortcut) {
        const matched = info?.steam_app_id_match ? parseInt(info.steam_app_id_match, 10) : null;
        const resolved = matched && Number.isFinite(matched) ? matched : 'none';
        void logFrontendEvent('DEBUG', '[ConfigureTab] resolved steam app id', { appId, resolved });
        setResolvedSteamAppId(resolved);
      }
      if (info?.full_game_app_id) {
        const fgId = parseInt(info.full_game_app_id, 10);
        if (Number.isFinite(fgId)) {
          setDemoFullGameAppId(fgId);
          setDemoFullGameName(info.full_game_name ?? '');
        }
      }
    });
    return () => { cancelled = true; };
  }, [appId, effectiveAppName, isShortcut]);

  useEffect(() => {
    if (!effectiveAppId) {
      setLoading(false);
      setReports([]);
      setEditedReports([]);
      setVotes({});
      setSelectedKey(null);
      setFocusedCardKey(null);
      setFilterTouched(false);
      setFilter('all');
      setConfigFilter('all');
      setReportDiagnostics(null);
      return;
    }

    let cancelled = false;
    const loadT0 = Date.now();
    void logFrontendEvent('INFO', 'Manage This Game: loading started', {
      appId: effectiveAppId,
      appName,
      hasSystemInfo: !!sysInfo,
      gpuVendor: sysInfo?.gpu_vendor ?? null,
    });
    setLoading(true);
    setReports([]);
    const loaded = loadEditedReports(effectiveAppId);
    setEditedReports(loaded);
    if (loaded.length > 0) {
      upsertEditedReportIndex(effectiveAppId, appName, loaded[0].report.protonVersion, loaded[0].label || '');
    }
    setPulseReports([]);
    setVotes({});
    setSelectedKey(null);
    setFocusedCardKey(null);
    setFilterTouched(false);
    setFilter('all');
    setConfigFilter('all');
    setReportDiagnostics(null);

    void Promise.all([
      getProtonDBReportsWithDiagnostics(String(effectiveAppId)),
      getVoteTotals(String(effectiveAppId)),
      getUserConfigs(String(effectiveAppId)),
    ])
      .then(([reportResult, voteTotals, pulseRows]) => {
        if (cancelled) return;
        const r = reportResult.reports;
        void logFrontendEvent('INFO', `Manage This Game: loaded (${Date.now() - loadT0}ms)`, {
          appId: effectiveAppId,
          appName,
          reportCount: r.length,
          pulseCount: pulseRows.length,
          voteCount: Object.keys(voteTotals).length,
          durationMs: Date.now() - loadT0,
          source: reportResult.diagnostics.source,
        });
        setReports(r);
        setVotes(voteTotals);
        setPulseReports(pulseRows);
        setReportDiagnostics(reportResult.diagnostics);
      })
      .catch((error) => {
        if (cancelled) return;
        void logFrontendEvent('ERROR', `Manage This Game: load FAILED (${Date.now() - loadT0}ms)`, {
          appId: effectiveAppId,
          appName,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - loadT0,
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
  }, [effectiveAppId, appName, sysInfo]);

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

  const setConfigFilterMode = (nextFilter: ConfigFilter) => {
    void logFrontendEvent('DEBUG', 'Changed report config filter', {
      appId,
      previousFilter: configFilter,
      nextFilter,
    });
    setConfigFilter(nextFilter);
  };

  const setSortPreference = (nextSortMode: SortMode) => {
    void logFrontendEvent('DEBUG', 'Changed sort mode', { appId, sortMode: nextSortMode });
    setSortMode(nextSortMode);
  };

  const handleApply = async (targetReport: DisplayReportCard) => {
    if (!appId) return;
    if (!isInLibrary) return;
    void logFrontendEvent('INFO', 'Apply launch option requested', {
      appId,
      appName,
      protonVersion: targetReport.protonVersion,
    });
    const running = (SteamClient.GameSessions as any)?.GetRunningApps?.() ?? [];
    if (running.length > 0) {
      void logFrontendEvent('WARNING', 'Apply blocked because a game is running', { appId, runningCount: running.length });
      toaster.toast({ title: 'Proton Pulse', body: t().configure.quitGameFirst });
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
          toaster.toast({ title: 'Proton Pulse', body: t().configure.applyCancelled });
          return;
        }

        if (choice === 'pick') {
          if (installedTools.length === 0) {
            toaster.toast({ title: 'Proton Pulse', body: t().configure.noCompatTools });
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
              toaster.toast({ title: 'Proton Pulse', body: t().configure.applyCancelled });
              return;
            }
            launchProtonVersion = pickedVersion;
          }
        } else if (choice === 'closest') {
          if (closestInstalledTool) {
            launchProtonVersion = launchVersionValueForTool(closestInstalledTool);
            toaster.toast({
              title: 'Proton Pulse',
              body: t().configure.usingClosest(closestInstalledTool.display_name),
            });
          } else if (latestInstalledTool) {
            launchProtonVersion = launchVersionValueForTool(latestInstalledTool);
            toaster.toast({
              title: 'Proton Pulse',
              body: t().configure.noCloseMatch(latestInstalledTool.display_name),
            });
          } else {
            const installResult = await installProtonGe(availability.normalized_version);
            if (!installResult.success) {
              toaster.toast({
                title: 'Proton Pulse',
                body: t().configure.installFailed(availability.normalized_version!),
              });
            } else if (availability.normalized_version) {
              launchProtonVersion = availability.normalized_version;
            }
          }
        } else if (choice === 'latest') {
          if (latestInstalledTool) {
            launchProtonVersion = launchVersionValueForTool(latestInstalledTool);
          } else {
            toaster.toast({ title: 'Proton Pulse', body: t().configure.noCompatTools });
          }
        } else {
          const installResult = await installProtonGe(availability.normalized_version);
          if (!installResult.success) {
            if (latestInstalledTool) {
              launchProtonVersion = launchVersionValueForTool(latestInstalledTool);
              toaster.toast({
                title: 'Proton Pulse',
                body: t().configure.installFailedFallback(availability.normalized_version!, latestInstalledTool.display_name),
              });
            } else {
              toaster.toast({
                title: 'Proton Pulse',
                body: t().configure.installFailedNoFallback(availability.normalized_version!),
              });
            }
          } else {
            toaster.toast({
              title: 'Proton Pulse',
              body: installResult.already_installed
                ? t().toast.alreadyInstalled(availability.normalized_version!)
                : `${t().toast.installed(availability.normalized_version!)} ${t().compatTools.restartHint}`,
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

      const nextLaunchOptions = `PROTON_VERSION="${launchProtonVersion}" %command%`;
      const currentDetails = await getSteamAppDetails(appId);
      const resolvedLaunchOptions = await resolveLaunchOptionsWithPrompt(
        appName,
        getLaunchOptionsFromDetails(currentDetails.details),
        nextLaunchOptions,
      );
      if (!resolvedLaunchOptions) {
        toaster.toast({ title: 'Proton Pulse', body: t().configure.applyCancelled });
        return;
      }

      await SteamClient.Apps.SetAppLaunchOptions(appId, resolvedLaunchOptions);
      const detailsResult = await getSteamAppDetails(appId);
      const appliedLaunchOptions = getLaunchOptionsFromDetails(detailsResult.details);
      setCurrentLaunchOptions(appliedLaunchOptions);
      const parsedVars = parseLaunchOptions(appliedLaunchOptions);
      addTrackedConfig({
        appId,
        appName,
        profileName: '',
        protonVersion: launchProtonVersion,
        launchOptions: appliedLaunchOptions,
        enabledVars: parsedVars.vars,
        appliedAt: Date.now(),
        source: 'protondb',
        isNonSteam: isShortcut,
        resolvedSteamAppId: typeof resolvedSteamAppId === 'number' ? resolvedSteamAppId : undefined,
      });
      void logFrontendEvent('INFO', 'Launch options applied', {
        appId,
        appName,
        protonVersion: launchProtonVersion,
        appliedLaunchOptions,
      });
      toaster.toast({
        title: 'Proton Pulse',
        body: appliedLaunchOptions || t().configure.appliedFor(appName),
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
      toaster.toast({ title: 'Proton Pulse', body: t().configure.applyFailed(msg.slice(0, 80)) });
    }
  };

  const handleUpvote = async (targetReport: DisplayReportCard): Promise<boolean> => {
    if (!appId) return false;
    const key = reportKey(targetReport);
    void logFrontendEvent('INFO', 'Upvote requested', { appId, appName, reportKey: key });

    const previousVote = await getUserVote(String(appId), key);
    if (previousVote === 1) {
      const ok = await deleteVote(String(appId), key);
      if (ok) {
        setVotes(prev => ({
          ...prev,
          [key]: {
            upvotes: Math.max(0, (prev[key]?.upvotes ?? 0) - 1),
            downvotes: prev[key]?.downvotes ?? 0,
          },
        }));
        toaster.toast({ title: 'Proton Pulse', body: t().configure.voteRemoved });
        return true;
      }
      toaster.toast({ title: 'Proton Pulse', body: t().configure.voteFailed });
      return false;
    }
    const ok = await submitVote(String(appId), key, 1);
    if (ok) {
      setVotes(prev => ({
        ...prev,
        [key]: {
          upvotes: (prev[key]?.upvotes ?? 0) + 1,
          downvotes: Math.max(0, (prev[key]?.downvotes ?? 0) - (previousVote === -1 ? 1 : 0)),
        },
      }));
      toaster.toast({ title: 'Proton Pulse', body: t().configure.voteSubmitted });
      return true;
    }
    toaster.toast({ title: 'Proton Pulse', body: t().configure.voteFailed });
    return false;
  };

  const handleDownvote = async (targetReport: DisplayReportCard): Promise<boolean> => {
    if (!appId) return false;
    const key = reportKey(targetReport);
    void logFrontendEvent('INFO', 'Downvote requested', { appId, appName, reportKey: key });

    const previousVote = await getUserVote(String(appId), key);
    if (previousVote === -1) {
      const ok = await deleteVote(String(appId), key);
      if (ok) {
        setVotes(prev => ({
          ...prev,
          [key]: {
            upvotes: prev[key]?.upvotes ?? 0,
            downvotes: Math.max(0, (prev[key]?.downvotes ?? 0) - 1),
          },
        }));
        toaster.toast({ title: 'Proton Pulse', body: t().configure.voteRemoved });
        return true;
      }
      toaster.toast({ title: 'Proton Pulse', body: t().configure.voteFailed });
      return false;
    }
    const ok = await submitVote(String(appId), key, -1);
    if (ok) {
      setVotes(prev => ({
        ...prev,
        [key]: {
          upvotes: Math.max(0, (prev[key]?.upvotes ?? 0) - (previousVote === 1 ? 1 : 0)),
          downvotes: (prev[key]?.downvotes ?? 0) + 1,
        },
      }));
      toaster.toast({ title: 'Proton Pulse', body: t().configure.voteSubmitted });
      return true;
    }
    toaster.toast({ title: 'Proton Pulse', body: t().configure.voteFailed });
    return false;
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
        canApply={isInLibrary}
        onApply={handleApply}
        onUpvote={handleUpvote}
        onDownvote={handleDownvote}
        onSaveEdit={(entry) => {
          setEditedReports((prev) => [entry, ...prev]);
          upsertEditedReportIndex(appId!, appName, entry.report.protonVersion, entry.label || '');
        }}
      />,
      window,
    );
  };

  useEffect(() => registerScreenshotAutomationHandler('manage-game/report-detail', async () => {
    const firstReport = sortedReports[0];
    if (!firstReport) {
      throw new Error('No report is available for the Manage Game detail screenshot.');
    }
    openReportDetail(firstReport);
  }), [sortedReports, appId, appName, sysInfo, currentLaunchOptions]);

  useEffect(() => registerScreenshotAutomationHandler('manage-game/hardware-compare', async () => {
    const firstReport = sortedReports[0];
    if (!firstReport) {
      throw new Error('No report is available for the Manage Game hardware comparison screenshot.');
    }
    openReportDetail(firstReport);
    await runRegisteredScreenshotAutomationHandler('manage-game/report-detail/hardware-compare');
  }), [sortedReports, appId, appName, sysInfo, currentLaunchOptions]);

  useEffect(() => registerScreenshotAutomationHandler('manage-game/edit-modal', async () => {
    const firstReport = sortedReports[0];
    if (!firstReport) {
      throw new Error('No report is available for the Manage Game edit modal screenshot.');
    }
    openReportDetail(firstReport);
    await runRegisteredScreenshotAutomationHandler('manage-game/report-detail/edit-modal');
  }), [sortedReports, appId, appName, sysInfo, currentLaunchOptions]);

  useEffect(() => registerScreenshotAutomationHandler('manage-game/matching-guide', async () => {
    const firstReport = sortedReports[0];
    if (!firstReport) {
      throw new Error('No report is available for the Manage Game matching guide screenshot.');
    }
    openReportDetail(firstReport);
    await runRegisteredScreenshotAutomationHandler('manage-game/report-detail/matching-guide');
  }), [sortedReports, appId, appName, sysInfo, currentLaunchOptions]);

  useEffect(() => registerScreenshotAutomationHandler('manage-game/system-requirements', async () => {
    const firstReport = sortedReports[0];
    if (!firstReport) {
      throw new Error('No report is available for the Manage Game system requirements screenshot.');
    }
    openReportDetail(firstReport);
    await runRegisteredScreenshotAutomationHandler('manage-game/report-detail/system-requirements');
  }), [sortedReports, appId, appName, sysInfo, currentLaunchOptions]);

  useEffect(() => registerScreenshotAutomationHandler('manage-game/upload-destination', async () => {
    const firstReport = sortedReports[0];
    if (!firstReport) {
      throw new Error('No report is available for the Manage Game upload destination screenshot.');
    }
    openReportDetail(firstReport);
    await runRegisteredScreenshotAutomationHandler('manage-game/report-detail/upload-destination');
  }), [sortedReports, appId, appName, sysInfo, currentLaunchOptions]);

  useEffect(() => registerScreenshotAutomationHandler('manage-game/launch-option-conflict', async (action) => {
    if (!appName) {
      throw new Error('No game is available for the launch option conflict screenshot.');
    }
    showLaunchOptionConflictPreview(
      action.appName || appName,
      action.currentLaunchOptions || 'PROTON_LOG=1 DXVK_HUD=devinfo %command%',
      action.incomingLaunchOptions || 'MANGOHUD=1 PROTON_VERSION="GE-Proton10-1" %command%',
    );
  }), [appName]);

  if (!appId) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        {t().reports.navigateToGame}
      </div>
    );
  }

  const diagnosticsLines = !sysInfo
    ? []
    : [
      extras.diagnosticsTriedAppId(appId),
      reportDiagnostics
        ? extras.diagnosticsPrimarySource(String(reportDiagnostics.source))
        : extras.diagnosticsPrimarySourcePending(),
      reportDiagnostics
        ? extras.diagnosticsReportIndexResponse(String(reportDiagnostics.indexStatus ?? 'request failed'))
        : extras.diagnosticsReportIndexPending(),
      reportDiagnostics
        ? (
          reportDiagnostics.source === 'live-summary'
            ? extras.diagnosticsLiveSummary(
              String(reportDiagnostics.liveSummaryStatus ?? 'request failed'),
              reportDiagnostics.liveSummaryTotal ?? 0,
              String(reportDiagnostics.liveSummaryTier ?? 'unknown'),
            )
            : extras.diagnosticsLiveSummary(String(reportDiagnostics.liveSummaryStatus ?? 'not tried'))
        )
        : extras.diagnosticsLiveSummaryPending(),
    ];

  const showDiagnosticsState = !loading && (!sysInfo || (reports.length === 0 && editedReports.length === 0));
  const detectingGpu = !gpuVendor && !filterTouched;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <GameSummaryHeader appId={appId} appName={effectiveAppName || appName} reportsCount={scored.length} combinedTier={loading ? null : combinedTierForHeader} resolvedSteamAppId={typeof resolvedSteamAppId === 'number' ? resolvedSteamAppId : null} isInLibrary={isInLibrary} demoFullGameAppId={demoFullGameAppId} demoFullGameName={demoFullGameName} />
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <SteamSpinner />
        </div>
      ) : showDiagnosticsState ? (
        <>
          <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
            {!sysInfo ? t().reports.loadingSystemInfo : t().reports.noReportsForGame}
          </div>
          {reportDiagnostics?.source === 'live-summary' && (
            <div style={{ padding: '0 16px 12px', color: '#9dc4e8', fontSize: 11, textAlign: 'center' }}>
              {extras.liveSummaryUnavailable()}
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
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: 4,
            }}
          >
            <div style={{ fontSize: 11, color: '#7a9bb5', whiteSpace: 'nowrap', textAlign: 'right' }}>
              {t().common.shown(sortedReports.length)}
            </div>
          </div>
          <Focusable
            flow-children="horizontal"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 8,
              padding: '6px 0',
              borderBottom: '1px solid #2a3a4a',
            }}
          >
            <div style={{ fontSize: 10, color: '#cfe2f4', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {t().common.sort}
            </div>
            <div style={{ width: 160, flexShrink: 0 }}>
              <Dropdown
                strDefaultLabel={t().reports.bestMatch}
                rgOptions={[
                  { data: 'score', label: t().reports.bestMatch },
                  { data: 'votes', label: t().reports.mostVotes },
                ]}
                selectedOption={sortMode}
                onChange={(opt) => setSortPreference(opt.data as SortMode)}
              />
            </div>
            {(() => {
              const activeFilterCount = [filter !== 'all', archFilter !== 'all', configFilter !== 'all'].filter(Boolean).length;
              return (
                <>
                  <DialogButton
                    style={{ flex: 1, height: 40, padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 0 }}
                    onClick={() => {
                      const modal = showModal(
                        <ReportFiltersModal
                          filter={filter}
                          setFilterMode={setFilterMode}
                          gpuFilterCounts={gpuFilterCounts}
                          archFilter={archFilter}
                          setArchFilter={setArchFilter}
                          availArchitectures={availArchitectures}
                          tierFiltered={tierFiltered}
                          configFilter={configFilter}
                          setConfigFilterMode={setConfigFilterMode}
                          configFilterCounts={configFilterCounts}
                          visibleReports={visibleReports}
                          onClose={() => modal.Close()}
                        />,
                      );
                    }}
                  >
                    {/* sliders/filter icon */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/>
                    </svg>
                    {activeFilterCount > 0 ? `${t().common.filters} (${activeFilterCount})` : t().common.filters}
                  </DialogButton>
                  <DialogButton
                    style={{ flex: 1, height: 40, padding: '0 12px', fontSize: 12, minWidth: 0 }}
                    disabled={activeFilterCount === 0}
                    onClick={() => {
                      setFilter('all');
                      setArchFilter('all');
                      setConfigFilter('all');
                      setFilterTouched(true);
                    }}
                  >
                    {t().configManager.resetFilters}
                  </DialogButton>
                </>
              );
            })()}
          </Focusable>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            <div style={{ marginBottom: 12, color: '#9db0c4', fontSize: 11 }}>
              {detectingGpu
                ? t().reports.detectingGpuHint
                : t().reports.selectReport}
            </div>
            <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid #2a3a4a' }}>
              {sortedReports.length === 0 ? (
                <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
                  {detectingGpu ? t().reports.detectingGpu : t().reports.noReportsForTier}
                </div>
              ) : (
                sortedReports.map((r) => (
                  <ReportCard
                    key={r.displayKey}
                    report={r}
                    selected={selectedKey === r.displayKey}
                    focused={focusedCardKey === r.displayKey}
                    systemGpuVendor={filter === 'all' ? gpuVendor : filter}
                    onFocus={(report) => {
                      setFocusedCardKey(report.displayKey);
                      setSelectedKey(report.displayKey);
                    }}
                    onSelect={openReportDetail}
                    onUpvote={handleUpvote}
                    onDownvote={handleDownvote}
                    onAnalyze={(report) => showPerReportAnalysisModal(
                      report, sortedReports, pulseReports, sysInfo,
                    )}
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
