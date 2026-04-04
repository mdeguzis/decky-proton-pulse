// src/components/tabs/SettingsTab.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { ToggleField, Focusable, GamepadButton, DialogButton, ConfirmModal, showModal, Menu, MenuItem, showContextMenu } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { toaster } from '@decky/api';
import { getSetting, setSetting } from '../../lib/settings';
import { logFrontendEvent } from '../../lib/logger';
import { cancelProtonGeInstall, getProtonGeManagerState, installCompatibilityToolArchive, installProtonGe, uninstallCompatibilityTool } from '../../lib/compatTools';
import type { CompatToolRelease, InstalledCompatTool, ProtonGeManagerState } from '../../types';

const AUTO_UPDATE_KEY = 'compat-auto-update-proton-ge';
const RESTART_HINT = ' Steam may need a restart before the new compatibility tool appears everywhere.';
const RELEASE_GRID_TEMPLATE = 'minmax(0, 1.15fr) 92px 112px 166px';
type CompatibilityRowType = 'proton-ge' | 'custom';

interface CompatibilityCatalogRow {
  key: string;
  kind: 'release' | 'installed-only';
  type: CompatibilityRowType;
  release?: CompatToolRelease;
  tool?: InstalledCompatTool;
  installed: boolean;
  installing: boolean;
  removing: boolean;
  displayName: string;
  versionLabel: string;
  versionMeta?: string;
  progressRatio?: number | null;
  progressLabel?: string;
  etaLabel?: string;
  statusLabel: string;
  statusStyle: React.CSSProperties;
  actionLabel?: string;
  actionDanger?: boolean;
  actionDisabled?: boolean;
  onAction?: () => void;
}

function sectionStyle(): React.CSSProperties {
  return {
    margin: '0',
    padding: '16px 0 18px',
    borderRadius: 0,
    background: 'transparent',
    border: 0,
    borderTop: '1px solid rgba(255,255,255,0.07)',
    boxShadow: 'none',
    overflow: 'hidden',
  };
}

function compactCatalogStyle(): React.CSSProperties {
  return {
    borderTop: '1px solid rgba(255,255,255,0.06)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    marginBottom: 14,
  };
}

function focusClipRowStyle(): React.CSSProperties {
  return {
    borderRadius: 10,
    overflow: 'hidden',
    margin: '0 8px',
  };
}

function formatReleaseDate(value: string | null): string {
  if (!value) return 'Unknown date';
  return value.slice(0, 10);
}

function formatReleaseVersion(tagName: string): string {
  return tagName.replace(/^GE-Proton/i, '');
}

function formatByteCount(value: number | null | undefined): string {
  if (!value || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function formatEta(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return 'estimating…';
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return `${rounded}s left`;
  const minutes = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (minutes < 60) return secs ? `${minutes}m ${secs}s left` : `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m left` : `${hours}h left`;
}

function withRestartHint(message: string, shouldAppend = true): string {
  if (!shouldAppend) return message;
  return message.includes('restart') ? message : `${message}${RESTART_HINT}`;
}

function releaseStatusLabel(release: CompatToolRelease, installedReleaseTags: Set<string>, currentReleaseTag?: string | null): string {
  if (release.tag_name === currentReleaseTag && installedReleaseTags.has(release.tag_name)) return 'Latest installed';
  if (release.tag_name === currentReleaseTag) return 'Latest';
  if (installedReleaseTags.has(release.tag_name)) return 'Installed';
  return 'Available';
}

function releaseStatusTone(release: CompatToolRelease, installedReleaseTags: Set<string>, currentReleaseTag?: string | null): React.CSSProperties {
  if (release.tag_name === currentReleaseTag && installedReleaseTags.has(release.tag_name)) {
    return {
      color: '#d9f8e4',
      background: 'rgba(56, 167, 92, 0.22)',
      border: '1px solid rgba(110, 212, 140, 0.35)',
    };
  }
  if (release.tag_name === currentReleaseTag) {
    return {
      color: '#ffe7bf',
      background: 'rgba(204, 144, 44, 0.22)',
      border: '1px solid rgba(240, 186, 96, 0.35)',
    };
  }
  if (installedReleaseTags.has(release.tag_name)) {
    return {
      color: '#cde6ff',
      background: 'rgba(61, 116, 175, 0.22)',
      border: '1px solid rgba(119, 169, 224, 0.35)',
    };
  }
  return {
    color: '#b7cadc',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
  };
}

function VersionBrowserModal({
  releases,
  installedReleaseTags,
  currentReleaseTag,
  installingTag,
  onInstall,
  onClose,
}: {
  releases: CompatToolRelease[];
  installedReleaseTags: Set<string>;
  currentReleaseTag?: string | null;
  installingTag: string | null;
  onInstall: (tagName: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');

  const filteredReleases = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) return releases;
    return releases.filter((release) =>
      [release.tag_name, release.name, formatReleaseVersion(release.tag_name)].some((field) =>
        field.toLowerCase().includes(normalized),
      ),
    );
  }, [filter, releases]);

  return (
    <ConfirmModal
      strTitle="Other Proton-GE Versions"
      strDescription="Browse and filter the full Proton-GE release list."
      strOKButtonText="Close"
      onOK={onClose}
      onCancel={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 640 }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter versions…"
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
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: RELEASE_GRID_TEMPLATE,
            gap: 10,
            padding: '0 0 8px',
            fontSize: 10,
            fontWeight: 700,
            color: '#7f9bb2',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          <div>Name</div>
          <div>Version</div>
          <div>Status</div>
          <div style={{ textAlign: 'right' }}>Action</div>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {filteredReleases.length === 0 ? (
            <div style={{ padding: '16px 0', fontSize: 12, color: '#9eb7cc' }}>
              No versions matched that filter.
            </div>
          ) : (
            filteredReleases.map((release, index) => {
              const installed = installedReleaseTags.has(release.tag_name);
              const isInstalling = installingTag === release.tag_name;
              return (
                <div
                  key={release.tag_name}
                  style={{
                    position: 'relative',
                    display: 'grid',
                    gridTemplateColumns: RELEASE_GRID_TEMPLATE,
                    gap: 10,
                    alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: index === filteredReleases.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {isInstalling ? (
                    <div
                      className="pp-progress-track"
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: 3,
                        background: 'rgba(111,198,255,0.12)',
                        borderRadius: 999,
                      }}
                    >
                      <div className="pp-progress-bar" />
                    </div>
                  ) : null}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#eef7ff', fontWeight: 600 }}>Proton-GE</div>
                    <div style={{ fontSize: 10, color: '#7f9bb2', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {release.tag_name} · {formatReleaseDate(release.published_at)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#d7e7f6', fontVariantNumeric: 'tabular-nums' }}>
                    {formatReleaseVersion(release.tag_name)}
                  </div>
                  <div>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 86,
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                        ...releaseStatusTone(release, installedReleaseTags, currentReleaseTag),
                      }}
                    >
                      {isInstalling ? 'Installing' : releaseStatusLabel(release, installedReleaseTags, currentReleaseTag)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <CompactActionButton
                      label={isInstalling ? 'Installing…' : installed ? 'Reinstall' : 'Install'}
                      onClick={() => onInstall(release.tag_name)}
                      disabled={installingTag !== null}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </ConfirmModal>
  );
}

function InstallArchiveModal({
  onInstall,
  onClose,
}: {
  onInstall: (archivePath: string) => void;
  onClose: () => void;
}) {
  const [archivePath, setArchivePath] = useState('');

  return (
    <ConfirmModal
      strTitle="Install From ZIP"
      strDescription="Enter a local archive path on the Deck. Proton Pulse accepts .zip and tar-based archives."
      strOKButtonText="Close"
      onOK={onClose}
      onCancel={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 640 }}>
        <input
          type="text"
          value={archivePath}
          onChange={(e) => setArchivePath(e.target.value)}
          placeholder="/home/deck/Downloads/GE-Proton8-3.tar.gz"
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
        />
        <div style={{ fontSize: 11, color: '#8fa9bf', lineHeight: 1.45 }}>
          Use this for older Proton-GE builds or custom compatibility tool archives you already copied onto the Deck.
        </div>
        <DialogButton onClick={() => archivePath.trim() && onInstall(archivePath.trim())} disabled={!archivePath.trim()}>
          Install Archive
        </DialogButton>
      </div>
    </ConfirmModal>
  );
}

function matchesRelease(tool: InstalledCompatTool, release: CompatToolRelease): boolean {
  const tag = release.tag_name.toLowerCase();
  return [tool.directory_name, tool.display_name, tool.internal_name].some((field) => field.toLowerCase().includes(tag));
}

function isManagedGeTool(tool: InstalledCompatTool): boolean {
  if (tool.managed_slot === 'latest') return true;
  return [tool.directory_name, tool.display_name, tool.internal_name].some((field) =>
    field.toLowerCase().includes('ge-proton'),
  );
}

function installedToolStatusTone(tool: InstalledCompatTool): React.CSSProperties {
  if (tool.source === 'valve') {
    return {
      color: '#d5e5f5',
      background: 'rgba(88, 104, 122, 0.22)',
      border: '1px solid rgba(156, 177, 198, 0.2)',
    };
  }
  return {
    color: '#d9f8e4',
    background: 'rgba(56, 167, 92, 0.22)',
    border: '1px solid rgba(110, 212, 140, 0.35)',
  };
}

function CompactActionButton({
  label,
  onClick,
  disabled,
  fullWidth,
  danger,
  active,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <DialogButton
      disabled={disabled}
      onClick={onClick}
      onOKButton={disabled ? undefined : onClick}
      style={{
        minWidth: fullWidth ? '100%' : 110,
        width: fullWidth ? '100%' : undefined,
        height: 34,
        padding: '0 12px',
        fontSize: 12,
        boxShadow: active ? '0 0 0 1px rgba(160, 210, 255, 0.38) inset, 0 0 16px rgba(111, 174, 232, 0.18)' : undefined,
        ...(danger ? {
          background: 'linear-gradient(180deg, #702c2c 0%, #5d1f1f 100%)',
          color: '#ffe5e5',
          border: '1px solid rgba(255, 130, 130, 0.3)',
        } : {}),
      }}
    >
      {label}
    </DialogButton>
  );
}

export function SettingsTab() {
  const [autoUpdateCurrent, setAutoUpdateCurrent] = useState(() => getSetting(AUTO_UPDATE_KEY, false));
  const [managerState, setManagerState] = useState<ProtonGeManagerState | null>(null);
  const [loadingManager, setLoadingManager] = useState(true);
  const [installingTag, setInstallingTag] = useState<string | null>(null);
  const [removingTool, setRemovingTool] = useState<string | null>(null);
  const [autoUpdateTriggered, setAutoUpdateTriggered] = useState(false);
  const [focusedMenuKey, setFocusedMenuKey] = useState<string | null>(null);
  const lastInstallStatusStamp = useRef<string | null>(null);

  const installedReleaseTags = useMemo(() => {
    const tags = new Set<string>();
    if (!managerState) return tags;
    for (const release of managerState.releases) {
      if (managerState.installed_tools.some((tool) => matchesRelease(tool, release))) {
        tags.add(release.tag_name);
      }
    }
    return tags;
  }, [managerState]);

  const refreshManager = async (forceRefresh = false) => {
    setLoadingManager(true);
    try {
      const nextState = await getProtonGeManagerState(forceRefresh);
      setManagerState(nextState);
      void logFrontendEvent('INFO', 'Loaded Proton-GE manager state', {
        releases: nextState.releases.length,
        installedTools: nextState.installed_tools.length,
        currentRelease: nextState.current_release?.tag_name ?? null,
        currentInstalled: nextState.current_installed,
        currentLatestSlotInstalled: nextState.current_latest_slot_installed,
        installState: nextState.install_status.state,
        installTag: nextState.install_status.tag_name,
        installStage: nextState.install_status.stage,
        installDownloadedBytes: nextState.install_status.downloaded_bytes,
        installTotalBytes: nextState.install_status.total_bytes,
        installProgressFraction: nextState.install_status.progress_fraction,
      });
    } catch (error) {
      console.error('Proton Pulse: failed to load Proton-GE manager state', error);
      void logFrontendEvent('ERROR', 'Failed to load Proton-GE manager state', {
        error: error instanceof Error ? error.message : String(error),
      });
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to load Proton-GE manager state.' });
    } finally {
      setLoadingManager(false);
    }
  };

  const compatibilityRows = useMemo<CompatibilityCatalogRow[]>(() => {
    if (!managerState) return [];

    const matchedDirectories = new Set<string>();
    const releaseRows = managerState.releases.map((release) => {
      const matchedTool = managerState.installed_tools.find((tool) => matchesRelease(tool, release));
      if (matchedTool) matchedDirectories.add(matchedTool.directory_name);
      const installed = !!matchedTool;
      const isInstalling = installingTag === release.tag_name;
      const installStatus = managerState.install_status;
      const elapsedSeconds = installStatus.started_at ? Math.max(1, Math.round(Date.now() / 1000 - installStatus.started_at)) : null;
      const progressRatio = isInstalling && installStatus.tag_name === release.tag_name
        ? installStatus.progress_fraction
        : null;
      const etaSeconds =
        isInstalling
        && installStatus.tag_name === release.tag_name
        && installStatus.total_bytes
        && installStatus.downloaded_bytes
        && elapsedSeconds
        && installStatus.downloaded_bytes > 0
          ? ((installStatus.total_bytes - installStatus.downloaded_bytes) / (installStatus.downloaded_bytes / elapsedSeconds))
          : null;
      const progressMeta = isInstalling && installStatus.tag_name === release.tag_name
        ? (
          installStatus.total_bytes && installStatus.downloaded_bytes !== null
            ? `${formatByteCount(installStatus.downloaded_bytes)} / ${formatByteCount(installStatus.total_bytes)}`
            : release.asset_size
              ? `${formatByteCount(installStatus.downloaded_bytes)} / ${formatByteCount(release.asset_size)}`
              : `${installStatus.stage === 'finalizing' ? 'Finalizing…' : installStatus.stage === 'extracting' ? 'Extracting…' : 'Downloading…'}`
        )
        : undefined;

      return {
        key: `release:${release.tag_name}`,
        kind: 'release' as const,
        type: 'proton-ge' as const,
        release,
        tool: matchedTool,
        installed,
        installing: isInstalling,
        removing: false,
        displayName: matchedTool?.managed_slot === 'latest' ? 'Proton-GE-Latest' : 'Proton-GE',
        versionLabel: formatReleaseVersion(release.tag_name),
        versionMeta: progressMeta,
        progressRatio,
        progressLabel: isInstalling && progressRatio !== null ? `${Math.round(progressRatio * 100)}%` : undefined,
        etaLabel: isInstalling ? formatEta(etaSeconds) : undefined,
        statusLabel: isInstalling
          ? 'Installing'
          : releaseStatusLabel(release, installedReleaseTags, managerState.current_release?.tag_name),
        statusStyle: releaseStatusTone(release, installedReleaseTags, managerState.current_release?.tag_name),
        actionLabel: isInstalling ? 'Cancel' : installed ? 'Uninstall' : 'Install',
        actionDanger: isInstalling || installed,
        actionDisabled: isInstalling ? false : installingTag !== null || removingTool !== null,
        onAction: installed && matchedTool && matchedTool.source !== 'valve' && isManagedGeTool(matchedTool)
          ? () => void handleUninstallTool(matchedTool)
          : isInstalling
            ? () => void handleCancelInstall()
            : () => void handleInstallRelease(release.tag_name),
      };
    });

    const installedOnlyRows = managerState.installed_tools
      .filter((tool) => !matchedDirectories.has(tool.directory_name))
      .filter((tool) => tool.source !== 'valve')
      .map((tool) => ({
        key: `installed:${tool.directory_name}`,
        kind: 'installed-only' as const,
        type: isManagedGeTool(tool) ? ('proton-ge' as const) : ('custom' as const),
        tool,
        installed: true,
        installing: false,
        removing: removingTool === tool.directory_name,
        displayName: tool.display_name,
        versionLabel: isManagedGeTool(tool)
          ? formatReleaseVersion(tool.internal_name || tool.display_name || tool.directory_name)
          : 'Custom',
        versionMeta: undefined,
        progressRatio: null,
        progressLabel: undefined,
        etaLabel: undefined,
        statusLabel: removingTool === tool.directory_name
          ? 'Removing'
          : tool.managed_slot === 'latest'
            ? 'Latest Slot'
            : isManagedGeTool(tool)
              ? 'Installed'
            : 'Custom',
        statusStyle: installedToolStatusTone(tool),
        actionLabel: removingTool === tool.directory_name ? 'Removing…' : 'Uninstall',
        actionDanger: true,
        actionDisabled: removingTool !== null || installingTag !== null,
        onAction: tool.source !== 'valve'
          ? () => void handleUninstallTool(tool)
          : undefined,
      }));

    return [...releaseRows, ...installedOnlyRows].sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      if (a.kind !== b.kind) return a.kind === 'release' ? -1 : 1;
      if (a.type !== b.type) return a.type === 'proton-ge' ? -1 : 1;
      return 0;
    });
  }, [installedReleaseTags, installingTag, managerState, removingTool]);

  const installedCompatibilityRows = useMemo(
    () => compatibilityRows.filter((row) => row.installed),
    [compatibilityRows],
  );
  const availableCompatibilityRows = useMemo(
    () => compatibilityRows.filter((row) => !row.installed),
    [compatibilityRows],
  );
  const visibleAvailableCompatibilityRows = useMemo(
    () => availableCompatibilityRows.slice(0, 8),
    [availableCompatibilityRows],
  );

  useEffect(() => {
    void refreshManager(false);
  }, []);

  useEffect(() => {
    if (
      !autoUpdateCurrent
      || autoUpdateTriggered
      || loadingManager
      || !managerState?.current_release
      || managerState.current_latest_slot_installed
      || managerState.install_status.state === 'running'
    ) {
      return;
    }

    setAutoUpdateTriggered(true);
    void (async () => {
      setInstallingTag(managerState.current_release!.tag_name);
      const result = await installProtonGe(managerState.current_release!.tag_name, true);
      toaster.toast({
        title: 'Proton Pulse',
        body: result.message,
      });
      if (!result.success) {
        setInstallingTag(null);
        await refreshManager(true);
      }
    })();
  }, [autoUpdateCurrent, autoUpdateTriggered, loadingManager, managerState]);

  useEffect(() => {
    if (!managerState) {
      return;
    }
    if (managerState.install_status.state === 'running' && managerState.install_status.tag_name) {
      setInstallingTag(managerState.install_status.tag_name);
      return;
    }
    if (!installingTag) {
      return;
    }
    if (installingTag.startsWith('archive:')) {
      return;
    }
    if (managerState.current_release?.tag_name === installingTag && managerState.current_latest_slot_installed) {
      setInstallingTag(null);
      return;
    }
    if (installedReleaseTags.has(installingTag)) {
      setInstallingTag(null);
    }
  }, [installingTag, installedReleaseTags, managerState]);

  useEffect(() => {
    if (managerState?.install_status.state !== 'running') {
      return;
    }
    const interval = window.setInterval(() => {
      void refreshManager(false);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [managerState?.install_status.state]);

  useEffect(() => {
    if (!managerState) {
      return;
    }
    const { install_status: installStatus } = managerState;
    if (installStatus.state === 'idle' || installStatus.state === 'running' || !installStatus.finished_at) {
      return;
    }
    const stamp = `${installStatus.state}:${installStatus.tag_name ?? 'unknown'}:${installStatus.finished_at}`;
    if (lastInstallStatusStamp.current === stamp) {
      return;
    }
    lastInstallStatusStamp.current = stamp;
    setInstallingTag(null);
    toaster.toast({
      title: 'Proton Pulse',
      body: installStatus.message ?? (
        installStatus.state === 'success'
          ? withRestartHint(`${installStatus.tag_name ?? 'Proton-GE'} installed.`)
          : `${installStatus.tag_name ?? 'Proton-GE'} failed to install.`
      ),
    });
    void refreshManager(true);
  }, [managerState]);

  const handleAutoUpdateToggle = (enabled: boolean) => {
    setAutoUpdateCurrent(enabled);
    setAutoUpdateTriggered(false);
    setSetting(AUTO_UPDATE_KEY, enabled);
    void logFrontendEvent('INFO', 'Current Proton-GE auto-update toggle changed', {
      nextValue: enabled,
    });
    if (enabled && managerState?.current_release && !managerState.current_latest_slot_installed && !installingTag) {
      setAutoUpdateTriggered(true);
      void (async () => {
        setInstallingTag(managerState.current_release!.tag_name);
        const result = await installProtonGe(managerState.current_release!.tag_name, true);
        toaster.toast({
          title: 'Proton Pulse',
          body: result.message,
        });
        if (!result.success) {
          setInstallingTag(null);
          await refreshManager(true);
        }
      })();
    }
  };

  const handleInstallRelease = async (tagName?: string | null) => {
    const nextTag = tagName ?? managerState?.current_release?.tag_name ?? null;
    if (!nextTag) return;
    const installAsLatest = nextTag === managerState?.current_release?.tag_name;

    setInstallingTag(nextTag);
    const result = await installProtonGe(nextTag, installAsLatest);
    toaster.toast({
      title: 'Proton Pulse',
      body: result.success ? withRestartHint(result.message) : `Install failed: ${result.message}`,
    });
    if (!result.success) {
      setInstallingTag(null);
      await refreshManager(true);
    }
  };

  const handleCancelInstall = async () => {
    const result = await cancelProtonGeInstall();
    toaster.toast({
      title: 'Proton Pulse',
      body: result.message,
    });
    if (result.success) {
      await refreshManager(false);
    }
  };

  const handleUninstallTool = async (tool: InstalledCompatTool) => {
    setRemovingTool(tool.directory_name);
    const result = await uninstallCompatibilityTool(tool.directory_name);
    toaster.toast({
      title: 'Proton Pulse',
      body: result.message,
    });
    setRemovingTool(null);
    if (result.success) {
      await refreshManager(true);
    }
  };

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  const handleOpenVersionBrowser = () => {
    const modal = showModal(
      <VersionBrowserModal
        releases={managerState?.releases ?? []}
        installedReleaseTags={installedReleaseTags}
        currentReleaseTag={managerState?.current_release?.tag_name ?? null}
        installingTag={installingTag}
        onInstall={(tagName) => void handleInstallRelease(tagName)}
        onClose={() => modal.Close()}
      />,
    );
  };

  const handleOpenArchiveInstaller = () => {
    const modal = showModal(
      <InstallArchiveModal
        onInstall={(archivePath) => {
          void (async () => {
            setInstallingTag(`archive:${archivePath}`);
            const result = await installCompatibilityToolArchive(archivePath);
            toaster.toast({
              title: 'Proton Pulse',
              body: result.success ? withRestartHint(result.message) : `Install failed: ${result.message}`,
            });
            setInstallingTag(null);
            if (result.success) {
              await refreshManager(true);
            }
          })();
          modal.Close();
        }}
        onClose={() => modal.Close()}
      />,
    );
  };

  return (
    <Focusable onGamepadDirection={handleRootDirection}>
      <style>{`
        .pp-progress-track {
          position: relative;
          overflow: hidden;
        }
        .pp-progress-bar {
          position: absolute;
          inset: 0 auto 0 0;
          width: var(--pp-progress-width, 0%);
          transform-origin: left center;
          background: linear-gradient(90deg, rgba(82,173,235,0.82) 0%, rgba(122,213,255,0.96) 70%, rgba(190,239,255,0.96) 100%);
          transition: width 240ms ease;
        }
      `}</style>
      <div style={sectionStyle()}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'start', gap: 16, marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff' }}>
              Compatibility Tools
            </div>
            <div style={{ fontSize: 11, color: '#7a9bb5', marginTop: 4, maxWidth: 520, lineHeight: 1.45 }}>
              Proton-GE management inspired by Wine Cellar, tailored for Proton Pulse apply flow.
            </div>
          </div>
          <CompactActionButton
            label={loadingManager ? 'Refreshing…' : 'Refresh'}
            onClick={() => {
              setAutoUpdateTriggered(false);
              void refreshManager(true);
            }}
            disabled={loadingManager || installingTag !== null}
            fullWidth={false}
          />
        </div>

        <div
          style={{
            padding: '12px 0 8px',
            borderRadius: 0,
            background: 'transparent',
            border: 0,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 14,
          }}
        >
          <div style={{ ...focusClipRowStyle(), margin: '0 10px 8px' }}>
            <ToggleField
              label="Auto-update Current Version"
              description="Keep the pinned latest Proton-GE release installed whenever Settings opens and refreshes."
              checked={autoUpdateCurrent}
              onChange={handleAutoUpdateToggle}
            />
          </div>
          <div style={{ padding: '4px 18px 0' }}>
            {installedCompatibilityRows.length > 0 ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#dbe8f4', marginBottom: 8 }}>Installed</div>
                <div style={{ ...compactCatalogStyle(), padding: '0 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)' }}>
                  {installedCompatibilityRows.map((row, index) => {
                    const menuLabel = row.removing ? 'Removing…' : 'Actions';
                    return (
                      <div
                        key={row.key}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) auto',
                          gap: 12,
                          alignItems: 'center',
                          padding: '12px 0',
                          borderBottom: index === installedCompatibilityRows.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#eef7ff', fontWeight: 700, lineHeight: 1.35 }}>
                            {row.displayName}
                            {row.statusLabel === 'Latest Slot' ? ' (Latest)' : ''}
                          </div>
                          <div style={{ fontSize: 11, color: '#d7e7f6', marginTop: 2, lineHeight: 1.35 }}>
                            {row.versionLabel}
                          </div>
                        </div>
                        <Focusable
                          style={{ marginLeft: 'auto', boxShadow: 'none', display: 'flex', justifyContent: 'right' }}
                          onGamepadFocus={() => setFocusedMenuKey(row.key)}
                          onGamepadBlur={() => setFocusedMenuKey((current) => current === row.key ? null : current)}
                        >
                          <DialogButton
                            disabled={row.actionDisabled || !row.onAction}
                            style={{
                              height: '40px',
                              width: '40px',
                              minWidth: '40px',
                              padding: '10px 12px',
                              boxShadow: focusedMenuKey === row.key ? '0 0 0 1px rgba(160, 210, 255, 0.38) inset, 0 0 16px rgba(111, 174, 232, 0.18)' : undefined,
                            }}
                            onClick={(e: MouseEvent) =>
                              showContextMenu(
                                <Menu label={row.displayName}>
                                  <MenuItem onClick={row.onAction}>
                                    {menuLabel === 'Removing…' ? 'Removing…' : row.actionLabel ?? 'Uninstall'}
                                  </MenuItem>
                                </Menu>,
                                e.currentTarget ?? window,
                              )
                            }
                          >
                            ...
                          </DialogButton>
                        </Focusable>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div style={{ fontSize: 11, fontWeight: 700, color: '#dbe8f4', marginBottom: 8 }}>Not Installed</div>
            <div style={{ ...compactCatalogStyle(), padding: '0 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)' }}>
              {!managerState || availableCompatibilityRows.length === 0 ? (
                <div style={{ fontSize: 11, color: '#8fa9bf', padding: '14px 0' }}>
                  {loadingManager ? 'Loading release feed…' : 'No Proton-GE releases were returned from GitHub.'}
                </div>
              ) : (
                visibleAvailableCompatibilityRows.map((row, index) => {
                  const progressPercent = Math.round(
                    Math.max(0, Math.min(100, (row.progressRatio ?? (row.removing ? 0.5 : 0.08)) * 100)),
                  );
                  return (
                    <div
                      key={row.key}
                      style={{
                        position: 'relative',
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        gap: 12,
                        alignItems: 'center',
                        padding: '12px 0',
                        borderBottom: index === visibleAvailableCompatibilityRows.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#eef7ff', fontWeight: 700, lineHeight: 1.35 }}>
                            {row.release?.tag_name ?? row.displayName}
                          </div>
                          {row.installing ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center', marginTop: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ height: 8, borderRadius: 999, background: 'rgba(111,198,255,0.12)', overflow: 'hidden' }}>
                                  <div
                                    style={{
                                      width: `${Math.max(4, progressPercent)}%`,
                                      height: '100%',
                                      borderRadius: 999,
                                      background: 'linear-gradient(90deg, rgba(82,173,235,0.9) 0%, rgba(122,213,255,0.98) 100%)',
                                      transition: 'width 240ms ease',
                                    }}
                                  />
                                </div>
                              </div>
                              <div style={{ minWidth: 88, textAlign: 'right' }}>
                                <div style={{ fontSize: 12, color: '#eef7ff', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                                  {row.progressLabel ?? `${progressPercent}%`}
                                </div>
                                <div style={{ fontSize: 10, color: '#7f9bb2', marginTop: 4, whiteSpace: 'nowrap' }}>
                                  {row.versionMeta ?? 'Downloading…'}
                                </div>
                                <div style={{ fontSize: 10, color: '#6faee8', marginTop: 2, whiteSpace: 'nowrap' }}>
                                  {row.etaLabel ?? 'estimating…'}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: '#d7e7f6', marginTop: 2, lineHeight: 1.35 }}>
                              {row.statusLabel}
                            </div>
                          )}
                        </div>
                        <Focusable
                          style={{ marginLeft: 'auto', boxShadow: 'none', display: 'flex', justifyContent: 'right' }}
                          onGamepadFocus={() => setFocusedMenuKey(row.key)}
                          onGamepadBlur={() => setFocusedMenuKey((current) => current === row.key ? null : current)}
                        >
                          <DialogButton
                            disabled={row.actionDisabled || !row.onAction}
                            style={{
                              height: '40px',
                              width: '40px',
                              minWidth: '40px',
                              padding: '10px 12px',
                              boxShadow: focusedMenuKey === row.key ? '0 0 0 1px rgba(160, 210, 255, 0.38) inset, 0 0 16px rgba(111, 174, 232, 0.18)' : undefined,
                            }}
                            onClick={(e: MouseEvent) =>
                              showContextMenu(
                                <Menu label={row.release?.tag_name ?? row.displayName}>
                                  {row.onAction && row.actionLabel ? (
                                    <MenuItem onClick={row.onAction}>{row.actionLabel}</MenuItem>
                                  ) : null}
                                </Menu>,
                                e.currentTarget ?? window,
                              )
                            }
                          >
                            ...
                          </DialogButton>
                        </Focusable>
                    </div>
                  );
                })
              )}
            </div>
            {managerState && availableCompatibilityRows.length > 8 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, padding: '12px 0 0' }}>
                <CompactActionButton
                  label={`Other version (${availableCompatibilityRows.length - 8} more)`}
                  onClick={handleOpenVersionBrowser}
                  disabled={installingTag !== null || removingTool !== null}
                  fullWidth
                />
                <CompactActionButton
                  label="Install from ZIP"
                  onClick={handleOpenArchiveInstaller}
                  disabled={installingTag !== null || removingTool !== null}
                  fullWidth
                />
              </div>
            ) : (
              <div style={{ padding: '10px 0 0' }}>
                <CompactActionButton
                  label="Install from ZIP"
                  onClick={handleOpenArchiveInstaller}
                  disabled={installingTag !== null || removingTool !== null}
                  fullWidth
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </Focusable>
  );
}
