// src/components/tabs/SettingsTab.tsx
import { useEffect, useRef, useMemo, useState } from 'react';
import { ToggleField, Focusable, GamepadButton, DialogButton, ConfirmModal, ModalRoot, showModal, Menu, MenuItem, showContextMenu } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { openFilePicker, FileSelectionType } from '@decky/api';
import { toaster } from '../../lib/notify';
import { getSetting, setSetting } from '../../lib/settings';
import { logFrontendEvent } from '../../lib/logger';
import { cancelCompatToolInstall, getCompatManagerState, installCompatTool, installCompatibilityToolArchive, uninstallCompatibilityTool } from '../../lib/compatTools';
import { maybeToastRollingSlotChange } from '../../lib/rollingSlotToast';
import type { CompatToolId, CompatToolRelease, InstalledCompatTool, ProtonGeManagerState } from '../../types';
import { COMPAT_TOOL_OPTIONS } from '../../types';
import { t } from '../../lib/i18n';
import { registerScreenshotAutomationHandler } from '../../lib/screenshotAutomation';
import { buildInstallProgressDetails, shouldPollInstallStatus, shouldShowInstallStatusToast } from './settingsTabProgress';

const getAutoUpdateKey = (toolId: CompatToolId) => `compat-auto-update-${toolId}`;
const RESTART_HINT = ' Steam may need a restart before the new compatibility tool appears everywhere.';
const RELEASE_GRID_TEMPLATE = 'minmax(0, 1fr) 72px 104px 112px';
type CompatibilityRowType = 'proton-ge' | 'proton-cachyos' | 'custom';

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
  reinstallLabel?: string;
  onReinstall?: () => void;
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
  if (!value) return t().compatTools.unknownDate;
  return value.slice(0, 10);
}

function formatReleaseVersion(tagName: string): string {
  return tagName.replace(/^GE-Proton/i, '');
}

function withRestartHint(message: string, shouldAppend = true): string {
  if (!shouldAppend) return message;
  return message.includes('restart') ? message : `${message}${RESTART_HINT}`;
}

function getInstallProgressLabels() {
  return {
    finalizing: t().extras!.compatFinalizing(),
    extracting: t().extras!.compatExtracting(),
    downloading: t().extras!.compatDownloading(),
    estimating: t().compatTools.estimating,
    timeLeft: t().compatTools.timeLeft,
  };
}

function releaseStatusLabel(release: CompatToolRelease, installedReleaseTags: Set<string>, currentReleaseTag?: string | null): string {
  const extras = t().extras!;
  if (release.tag_name === currentReleaseTag && installedReleaseTags.has(release.tag_name)) return extras.compatLatestInstalled();
  if (release.tag_name === currentReleaseTag) return extras.compatLatest();
  if (installedReleaseTags.has(release.tag_name)) return t().compatTools.installed;
  return extras.compatAvailable();
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

const RELEASE_SCROLL_STEP = 120;

function ReleaseInfoModal({ release, onClose }: { release: CompatToolRelease; onClose: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <ModalRoot
      onCancel={onClose}
      bAllowFullSize
      className="pp-release-info-modal"
      modalClassName="pp-release-info-modal"
    >
      <style>{`
        .pp-release-info-modal,
        .pp-release-info-modal > div,
        .pp-release-info-modal .DialogContent_InnerWidth {
          max-height: 80vh !important;
          height: 80vh !important;
          padding: 0 !important;
        }
        .pp-release-info-modal .ModalPosition { inset: 0 !important; }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(80vh - 40px)', padding: '16px 20px 0' }}>
        <div style={{ flexShrink: 0, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#eef7ff' }}>{release.tag_name}</div>
          {release.published_at && (
            <div style={{ fontSize: 11, color: '#7a9bb5', marginTop: 4 }}>
              {t().detail.releasedLabel} {release.published_at.slice(0, 10)}
            </div>
          )}
        </div>

        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ fontSize: 12, color: '#c8dcea', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', paddingBottom: 12 }}>
            {release.body ?? <span style={{ color: '#556a7a' }}>{t().detail.noGameRequirementsFound}</span>}
          </div>
        </div>

        <Focusable
          onGamepadDirection={(evt: GamepadEvent) => {
            const el = scrollRef.current;
            if (!el) return;
            if (evt.detail.button === GamepadButton.DIR_UP) {
              el.scrollBy({ top: -RELEASE_SCROLL_STEP, behavior: 'auto' });
            } else if (evt.detail.button === GamepadButton.DIR_DOWN) {
              evt.preventDefault();
              el.scrollBy({ top: RELEASE_SCROLL_STEP, behavior: 'auto' });
            }
          }}
          style={{ flexShrink: 0, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <DialogButton onClick={onClose} style={{ width: '100%' }}>
            {t().common.close}
          </DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
}

function VersionBrowserModal({
  releases,
  installedReleaseTags,
  currentReleaseTag,
  installingTag,
  installStatus,
  onInstall,
  onOpenArchiveInstaller,
  onClose,
}: {
  releases: CompatToolRelease[];
  installedReleaseTags: Set<string>;
  currentReleaseTag?: string | null;
  installingTag: string | null;
  installStatus: ProtonGeManagerState['install_status'] | null;
  onInstall: (tagName: string) => void;
  onOpenArchiveInstaller: () => void;
  onClose: () => void;
}) {
  const extras = t().extras!;
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
      strTitle={extras.compatVersionBrowserTitle()}
      strDescription={extras.compatVersionBrowserDescription()}
      strOKButtonText={t().common.close}
      onOK={onClose}
      onCancel={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, width: 'min(720px, calc(100vw - 96px))', maxWidth: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center' }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t().compatTools.filterPlaceholder}
            style={{
              width: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              background: '#162535',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              color: '#e8f4ff',
              fontSize: 12,
              padding: '8px 10px',
            }}
          />
          <CompactActionButton
            label={t().compatTools.installFromZip}
            onClick={onOpenArchiveInstaller}
            disabled={installingTag !== null}
            fullWidth={false}
          />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: RELEASE_GRID_TEMPLATE,
            gap: 8,
            padding: '0 0 8px',
            fontSize: 10,
            fontWeight: 700,
            color: '#7f9bb2',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          <div>{extras.compatNameColumn()}</div>
          <div>{extras.compatVersionColumn()}</div>
          <div>{extras.compatStatusColumn()}</div>
          <div style={{ textAlign: 'right' }}>{extras.compatActionColumn()}</div>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {filteredReleases.length === 0 ? (
            <div style={{ padding: '16px 0', fontSize: 12, color: '#9eb7cc' }}>
              {extras.compatNoVersionsMatched()}
            </div>
          ) : (
            filteredReleases.map((release, index) => {
              const installed = installedReleaseTags.has(release.tag_name);
              const isInstalling = installingTag === release.tag_name;
              const progress = isInstalling
                ? buildInstallProgressDetails(installStatus, release.asset_size, getInstallProgressLabels())
                : null;
              return (
                <div
                  key={release.tag_name}
                  style={{
                    position: 'relative',
                    display: 'grid',
                    gridTemplateColumns: RELEASE_GRID_TEMPLATE,
                    gap: 8,
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
                    {isInstalling ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center', marginTop: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ height: 8, borderRadius: 999, background: 'rgba(111,198,255,0.12)', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${Math.max(4, Math.round(Math.max(0, Math.min(100, (progress?.progressRatio ?? 0.08) * 100))))}%`,
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
                            {progress?.progressLabel ?? '0%'}
                          </div>
                          <div style={{ fontSize: 10, color: '#7f9bb2', marginTop: 4, whiteSpace: 'nowrap' }}>
                            {progress?.progressMeta ?? extras.compatDownloading()}
                          </div>
                          <div style={{ fontSize: 10, color: '#6faee8', marginTop: 2, whiteSpace: 'nowrap' }}>
                            {progress?.etaLabel ?? t().compatTools.estimating}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: '#7f9bb2', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {release.tag_name} . {formatReleaseDate(release.published_at)}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#d7e7f6', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {formatReleaseVersion(release.tag_name)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        maxWidth: '100%',
                        minWidth: 0,
                        padding: '3px 7px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        ...releaseStatusTone(release, installedReleaseTags, currentReleaseTag),
                      }}
                    >
                      {isInstalling ? t().compatTools.installing : releaseStatusLabel(release, installedReleaseTags, currentReleaseTag)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <CompactActionButton
                      label={isInstalling ? t().compatTools.refreshing : installed ? t().compatTools.reinstall : t().compatTools.install}
                      onClick={() => onInstall(release.tag_name)}
                      disabled={installingTag !== null}
                      fullWidth={false}
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
  const extras = t().extras!;
  const [archivePath, setArchivePath] = useState('');
  const [pickingArchive, setPickingArchive] = useState(false);

  const handleBrowseArchive = async () => {
    setPickingArchive(true);
    try {
      const picked = await openFilePicker(
        FileSelectionType.FILE,
        '/home/deck/Downloads',
        true,
        false,
        undefined,
        ['zip', 'tar', 'gz', 'xz', 'bz2', 'tgz', 'tbz2'],
        false,
        true,
        1,
      );
      if (picked?.realpath || picked?.path) {
        setArchivePath(picked.realpath || picked.path);
      }
    } catch (error) {
      void logFrontendEvent('WARNING', 'Archive file picker failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      toaster.toast({
        title: 'Proton Pulse',
        body: t().compatTools.archivePickerFailed,
      });
    } finally {
      setPickingArchive(false);
    }
  };

  return (
    <ConfirmModal
      strTitle={extras.compatInstallFromZipTitle()}
      strDescription={extras.compatInstallFromZipDescription()}
      strOKButtonText={t().common.close}
      onOK={onClose}
      onCancel={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, width: 'min(680px, calc(100vw - 96px))', maxWidth: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center' }}>
          <input
            type="text"
            value={archivePath}
            onChange={(e) => setArchivePath(e.target.value)}
            placeholder={t().compatTools.zipPlaceholder}
            style={{
              width: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              background: '#162535',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              color: '#e8f4ff',
              fontSize: 12,
              padding: '8px 10px',
            }}
          />
          <DialogButton
            onClick={() => void handleBrowseArchive()}
            disabled={pickingArchive}
            style={{ minWidth: 44, width: 44, padding: '0 10px', fontSize: 12 }}
          >
            ...
          </DialogButton>
        </div>
        <div style={{ fontSize: 11, color: '#8fa9bf', lineHeight: 1.45 }}>
          {extras.compatInstallArchiveHint()}
        </div>
        <DialogButton onClick={() => archivePath.trim() && onInstall(archivePath.trim())} disabled={!archivePath.trim() || pickingArchive}>
          {extras.compatInstallArchive()}
        </DialogButton>
      </div>
    </ConfirmModal>
  );
}

function matchesRelease(tool: InstalledCompatTool, release: CompatToolRelease): boolean {
  const tag = release.tag_name.toLowerCase();
  return [tool.directory_name, tool.display_name, tool.internal_name].some((field) => field.toLowerCase().includes(tag));
}

function isManagedToolForId(tool: InstalledCompatTool, toolId: CompatToolId): boolean {
  if (tool.tool_id) return tool.tool_id === toolId;
  if (toolId === 'proton-ge') {
    if (tool.managed_slot === 'latest') return true;
    return [tool.directory_name, tool.display_name, tool.internal_name].some((f) =>
      f.toLowerCase().includes('ge-proton'),
    );
  }
  if (toolId === 'proton-cachyos') {
    return [tool.directory_name, tool.display_name, tool.internal_name].some((f) =>
      f.toLowerCase().includes('proton-cachyos'),
    );
  }
  return false;
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
        minWidth: fullWidth ? '100%' : 96,
        width: fullWidth ? '100%' : undefined,
        height: 34,
        padding: '0 10px',
        fontSize: 11,
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
  const extras = t().extras!;
  const [selectedTool, setSelectedTool] = useState<CompatToolId>('proton-ge');
  const [autoUpdateCurrent, setAutoUpdateCurrent] = useState(() => getSetting(getAutoUpdateKey('proton-ge'), false));
  const [managerState, setManagerState] = useState<ProtonGeManagerState | null>(null);
  const [loadingManager, setLoadingManager] = useState(true);
  const [installingTag, setInstallingTag] = useState<string | null>(null);
  const [removingTool, setRemovingTool] = useState<string | null>(null);
  const [autoUpdateTriggered, setAutoUpdateTriggered] = useState(false);
  const [focusedMenuKey, setFocusedMenuKey] = useState<string | null>(null);

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

  const refreshManager = async (forceRefresh = false, showSuccessToast = false, toolIdOverride?: CompatToolId) => {
    setLoadingManager(true);
    try {
      const nextState = await getCompatManagerState(toolIdOverride ?? selectedTool, forceRefresh);
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
      if (showSuccessToast) {
        toaster.toast({
          title: 'Proton Pulse',
          body: extras.compatRefreshed(),
        });
      }
    } catch (error) {
      console.error('Proton Pulse: failed to load Proton-GE manager state', error);
      void logFrontendEvent('ERROR', 'Failed to load Proton-GE manager state', {
        error: error instanceof Error ? error.message : String(error),
      });
      toaster.toast({ title: 'Proton Pulse', body: extras.compatLoadFailed() });
    } finally {
      setLoadingManager(false);
    }
  };

  const compatibilityRows = useMemo<CompatibilityCatalogRow[]>(() => {
    if (!managerState) return [];

    const toolOption = COMPAT_TOOL_OPTIONS.find((o) => o.id === selectedTool);
    const toolLabel = toolOption?.label ?? selectedTool;
    const latestSlotLabel = `${toolLabel}-Latest`;

    const matchedDirectories = new Set<string>();
    const releaseRows = managerState.releases.map((release) => {
      const matchedTool = managerState.installed_tools.find((tool) => matchesRelease(tool, release));
      if (matchedTool) matchedDirectories.add(matchedTool.directory_name);
      const installed = !!matchedTool;
      const isInstalling = installingTag === release.tag_name;
      const installStatus = managerState.install_status;
      const progress = isInstalling && installStatus.tag_name === release.tag_name
        ? buildInstallProgressDetails(installStatus, release.asset_size, getInstallProgressLabels())
        : null;

      return {
        key: `release:${release.tag_name}`,
        kind: 'release' as const,
        type: selectedTool as CompatibilityRowType,
        release,
        tool: matchedTool,
        installed,
        installing: isInstalling,
        removing: false,
        displayName: matchedTool?.managed_slot === 'latest' ? latestSlotLabel : toolLabel,
        versionLabel: formatReleaseVersion(release.tag_name),
        versionMeta: progress?.progressMeta,
        progressRatio: progress?.progressRatio,
        progressLabel: progress?.progressLabel,
        etaLabel: progress?.etaLabel,
        statusLabel: isInstalling
          ? t().compatTools.installing
          : releaseStatusLabel(release, installedReleaseTags, managerState.current_release?.tag_name),
        statusStyle: releaseStatusTone(release, installedReleaseTags, managerState.current_release?.tag_name),
        actionLabel: isInstalling ? t().common.cancel : installed ? t().compatTools.uninstall : t().compatTools.install,
        actionDanger: isInstalling || installed,
        actionDisabled: isInstalling ? false : installingTag !== null || removingTool !== null,
        onAction: installed && matchedTool && matchedTool.source !== 'valve' && isManagedToolForId(matchedTool, selectedTool)
          ? () => void handleUninstallTool(matchedTool)
          : isInstalling
            ? () => void handleCancelInstall()
            : () => void handleInstallRelease(release.tag_name),
        reinstallLabel: installed ? t().compatTools.reinstall : undefined,
        onReinstall: installed && !isInstalling
          ? () => void handleInstallRelease(release.tag_name, true)
          : undefined,
      };
    });

    const installedOnlyRows = managerState.installed_tools
      .filter((tool) => isManagedToolForId(tool, selectedTool))
      .filter((tool) => !matchedDirectories.has(tool.directory_name))
      .filter((tool) => tool.source !== 'valve')
      .map((tool) => {
        const isLatestSlotInstall = tool.managed_slot === 'latest'
          && managerState.install_status.install_as_latest
          && managerState.install_status.state === 'running';
        const progress = isLatestSlotInstall
          ? buildInstallProgressDetails(managerState.install_status, managerState.current_release?.asset_size, getInstallProgressLabels())
          : null;
        const isManagedTool = isManagedToolForId(tool, selectedTool);
        return ({
          key: `installed:${tool.directory_name}`,
          kind: 'installed-only' as const,
          type: isManagedTool ? (selectedTool as CompatibilityRowType) : ('custom' as const),
          tool,
          installed: true,
          installing: isLatestSlotInstall,
          removing: removingTool === tool.directory_name,
          displayName: tool.display_name,
          versionLabel: isManagedTool
            ? formatReleaseVersion(tool.internal_name || tool.display_name || tool.directory_name)
            : extras.compatCustom(),
          versionMeta: progress?.progressMeta,
          progressRatio: progress?.progressRatio,
          progressLabel: progress?.progressLabel,
          etaLabel: progress?.etaLabel,
          statusLabel: removingTool === tool.directory_name
            ? t().compatTools.removing
            : tool.managed_slot === 'latest'
              ? extras.compatLatestSlot()
              : isManagedTool
                ? t().compatTools.installed
                : extras.compatCustom(),
          statusStyle: installedToolStatusTone(tool),
          actionLabel: removingTool === tool.directory_name ? t().compatTools.removing : t().compatTools.uninstall,
          actionDanger: true,
          actionDisabled: removingTool !== null || installingTag !== null,
          onAction: tool.source !== 'valve'
            ? () => void handleUninstallTool(tool)
            : undefined,
          reinstallLabel: isManagedTool ? t().compatTools.reinstall : undefined,
          onReinstall: isManagedTool
            ? () => void handleInstallRelease(
              tool.latest_tag ?? managerState.current_release?.tag_name ?? null,
              true,
            )
            : undefined,
        });
      });

    return [...releaseRows, ...installedOnlyRows].sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      if (a.kind !== b.kind) return a.kind === 'release' ? -1 : 1;
      return 0;
    });
  }, [installedReleaseTags, installingTag, managerState, removingTool, selectedTool]);

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

  const handleToolSwitch = (toolId: CompatToolId) => {
    setSelectedTool(toolId);
    setInstallingTag(null);
    setAutoUpdateTriggered(false);
    const nextAutoUpdate = getSetting(getAutoUpdateKey(toolId), false);
    setAutoUpdateCurrent(nextAutoUpdate);
    void refreshManager(false, false, toolId);
    void logFrontendEvent('INFO', 'Compat tool selector changed', { toolId });
  };



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
      const result = await installCompatTool(selectedTool, managerState.current_release!.tag_name, true);
      toaster.toast({
        title: 'Proton Pulse',
        body: result.message,
      });
      if (!result.success) {
        setInstallingTag(null);
        await refreshManager(true);
      }
    })();
  }, [autoUpdateCurrent, autoUpdateTriggered, loadingManager, managerState, selectedTool]);

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
    if (!shouldPollInstallStatus(managerState, installingTag)) {
      return;
    }
    const interval = window.setInterval(() => {
      void refreshManager(false);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [installingTag, managerState]);

  useEffect(() => {
    if (!managerState) {
      return;
    }
    const { install_status: installStatus } = managerState;
    if (!shouldShowInstallStatusToast(installStatus)) {
      return;
    }
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
    setSetting(getAutoUpdateKey(selectedTool), enabled);
    void logFrontendEvent('INFO', 'Compat tool auto-update toggle changed', {
      toolId: selectedTool,
      nextValue: enabled,
    });
    if (enabled && managerState?.current_release && !managerState.current_latest_slot_installed && !installingTag) {
      setAutoUpdateTriggered(true);
      void (async () => {
        setInstallingTag(managerState.current_release!.tag_name);
        const result = await installCompatTool(selectedTool, managerState.current_release!.tag_name, true);
        toaster.toast({
          title: 'Proton Pulse',
          body: result.success ? withRestartHint(result.message) : result.message,
        });
        // #116: separate toast when the rolling latest-slot symlink got
        // updated so users know Steam client needs a restart to see the
        // new label in Compat Properties.
        maybeToastRollingSlotChange(result);
        if (!result.success) {
          setInstallingTag(null);
          await refreshManager(true);
        }
      })();
    }
  };

  const handleInstallRelease = async (tagName?: string | null, forceReinstall = false) => {
    const nextTag = tagName ?? managerState?.current_release?.tag_name ?? null;
    if (!nextTag) return;
    const installAsLatest = nextTag === managerState?.current_release?.tag_name;

    setInstallingTag(nextTag);
    const result = await installCompatTool(selectedTool, nextTag, installAsLatest, forceReinstall);
    if (result.success) {
      await refreshManager(false);
    }
    toaster.toast({
      title: 'Proton Pulse',
      body: result.success ? withRestartHint(result.message) : `Install failed: ${result.message}`,
    });
    maybeToastRollingSlotChange(result);
    if (!result.success) {
      setInstallingTag(null);
      await refreshManager(true);
    }
  };

  const handleCancelInstall = async () => {
    const result = await cancelCompatToolInstall(selectedTool);
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

  const handleOpenVersionBrowser = () => {
    const modal = showModal(
      <VersionBrowserModal
        releases={managerState?.releases ?? []}
        installedReleaseTags={installedReleaseTags}
        currentReleaseTag={managerState?.current_release?.tag_name ?? null}
        installingTag={installingTag}
        installStatus={managerState?.install_status ?? null}
        onInstall={(tagName) => void handleInstallRelease(tagName)}
        onOpenArchiveInstaller={handleOpenArchiveInstaller}
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
            maybeToastRollingSlotChange(result);
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

  useEffect(() => registerScreenshotAutomationHandler('compatibility-tools/release-picker', async () => {
    handleOpenVersionBrowser();
  }), [installedReleaseTags, installingTag, managerState]);

  useEffect(() => registerScreenshotAutomationHandler('compatibility-tools/install-from-zip', async () => {
    handleOpenArchiveInstaller();
  }), [managerState]);

  useEffect(() => registerScreenshotAutomationHandler('compatibility-tools/active-install', async () => {
    const release = managerState?.current_release ?? managerState?.releases[0];
    if (!managerState || !release) {
      throw new Error('Compatibility tools release data is not loaded for the active install screenshot.');
    }

    const totalBytes = release.asset_size ?? 1024 * 1024 * 1024;
    const downloadedBytes = Math.round(totalBytes * 0.64);
    setInstallingTag(release.tag_name);
    setManagerState({
      ...managerState,
      install_status: {
        state: 'running',
        tag_name: release.tag_name,
        message: `Installing ${release.tag_name}...`,
        stage: 'downloading',
        downloaded_bytes: downloadedBytes,
        total_bytes: totalBytes,
        progress_fraction: downloadedBytes / totalBytes,
        started_at: Math.round(Date.now() / 1000) - 90,
        finished_at: null,
        install_as_latest: release.tag_name === managerState.current_release?.tag_name,
      },
    });
  }), [managerState]);

  return (
    <Focusable>
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
      {/* --- Compatibility Tools --- */}
      <div style={sectionStyle()}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'start', gap: 16, marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff' }}>
              {t().compatTools.title}
            </div>
            <div style={{ fontSize: 11, color: '#7a9bb5', marginTop: 4, maxWidth: 520, lineHeight: 1.45 }}>
              {t().compatTools.description}
            </div>
          </div>
          <CompactActionButton
            label={loadingManager ? t().compatTools.refreshing : t().compatTools.refresh}
            onClick={() => {
              setAutoUpdateTriggered(false);
              void refreshManager(true, true);
            }}
            disabled={loadingManager || installingTag !== null}
            fullWidth={false}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <Focusable
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            onGamepadFocus={() => setFocusedMenuKey('tool-selector')}
            onGamepadBlur={() => setFocusedMenuKey((c) => c === 'tool-selector' ? null : c)}
          >
            <div style={{ fontSize: 11, color: '#7a9bb5', flexShrink: 0 }}>
              {t().compatTools.toolSelector}:
            </div>
            <DialogButton
              style={{
                height: 32,
                minWidth: 0,
                padding: '0 12px',
                fontSize: 12,
                fontWeight: 600,
                boxShadow: focusedMenuKey === 'tool-selector' ? '0 0 0 1px rgba(160,210,255,0.38) inset' : undefined,
              }}
              onClick={(e: MouseEvent) =>
                showContextMenu(
                  <Menu label={t().compatTools.toolSelector} cancelText={t().common.close}>
                    {COMPAT_TOOL_OPTIONS.map((opt) => (
                      <MenuItem
                        key={opt.id}
                        onClick={() => handleToolSwitch(opt.id)}
                      >
                        {opt.label}{selectedTool === opt.id ? ' *' : ''}
                      </MenuItem>
                    ))}
                  </Menu>,
                  e.currentTarget ?? window,
                )
              }
            >
              {COMPAT_TOOL_OPTIONS.find((o) => o.id === selectedTool)?.label ?? selectedTool} {'\u25BE'}
            </DialogButton>
          </Focusable>
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
              label={extras.compatAutoUpdateCurrentVersion()}
              description={t().compatTools.autoUpdateDescription.replace('Proton-GE', COMPAT_TOOL_OPTIONS.find((o) => o.id === selectedTool)?.label ?? selectedTool)}
              checked={autoUpdateCurrent}
              onChange={handleAutoUpdateToggle}
            />
          </div>
          <div style={{ padding: '4px 18px 0' }}>
            {installedCompatibilityRows.length > 0 ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#dbe8f4', marginBottom: 8 }}>{t().compatTools.installed}</div>
                <div style={{ ...compactCatalogStyle(), padding: '0 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)' }}>
                  {installedCompatibilityRows.map((row, index) => {
                    const menuLabel = row.removing ? t().compatTools.removing : t().compatTools.actions;
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
                            {row.statusLabel === extras.compatLatestSlot() ? ` (${extras.compatLatest()})` : ''}
                          </div>
                          {row.installing ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center', marginTop: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ height: 8, borderRadius: 999, background: 'rgba(111,198,255,0.12)', overflow: 'hidden' }}>
                                  <div
                                    style={{
                                      width: `${Math.max(4, Math.round(Math.max(0, Math.min(100, (row.progressRatio ?? 0.08) * 100))))}%`,
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
                                  {row.progressLabel ?? `${Math.round(Math.max(0, Math.min(100, (row.progressRatio ?? 0.08) * 100)))}%`}
                                </div>
                                <div style={{ fontSize: 10, color: '#7f9bb2', marginTop: 4, whiteSpace: 'nowrap' }}>
                                  {row.versionMeta ?? extras.compatDownloading()}
                                </div>
                                <div style={{ fontSize: 10, color: '#6faee8', marginTop: 2, whiteSpace: 'nowrap' }}>
                                  {row.etaLabel ?? t().compatTools.estimating}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: '#d7e7f6', marginTop: 2, lineHeight: 1.35 }}>
                              {row.versionLabel}
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
                                <Menu label={row.displayName} cancelText={t().common.close}>
                                  {row.release && (
                                    <MenuItem onClick={() => {
                                      const m = showModal(<ReleaseInfoModal release={row.release!} onClose={() => m.Close()} />);
                                    }}>
                                      {t().compatTools.info}
                                    </MenuItem>
                                  )}
                                  {row.onReinstall && row.reinstallLabel ? (
                                    <MenuItem onClick={row.onReinstall}>
                                      {row.reinstallLabel}
                                    </MenuItem>
                                  ) : null}
                                  <MenuItem onClick={row.onAction}>
                                    {menuLabel === t().compatTools.removing ? t().compatTools.removing : row.actionLabel ?? t().compatTools.uninstall}
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

            <div style={{ fontSize: 11, fontWeight: 700, color: '#dbe8f4', marginBottom: 8 }}>{extras.compatNotInstalled()}</div>
            <div style={{ ...compactCatalogStyle(), padding: '0 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)' }}>
              {!managerState || availableCompatibilityRows.length === 0 ? (
                <div style={{ fontSize: 11, color: '#8fa9bf', padding: '14px 0' }}>
                  {loadingManager ? extras.compatLoadingReleaseFeed() : extras.compatNoReleasesReturned()}
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
                                  {row.versionMeta ?? extras.compatDownloading()}
                                </div>
                                <div style={{ fontSize: 10, color: '#6faee8', marginTop: 2, whiteSpace: 'nowrap' }}>
                                  {row.etaLabel ?? t().compatTools.estimating}
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
                                <Menu label={row.release?.tag_name ?? row.displayName} cancelText={t().common.close}>
                                  {row.release && (
                                    <MenuItem onClick={() => {
                                      const m = showModal(<ReleaseInfoModal release={row.release!} onClose={() => m.Close()} />);
                                    }}>
                                      {t().compatTools.info}
                                    </MenuItem>
                                  )}
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
              <Focusable style={{ display: 'flex', gap: 10, padding: '12px 0 0' }}>
                <CompactActionButton
                  label={`${t().compatTools.otherVersion} (${availableCompatibilityRows.length - 8} more)`}
                  onClick={handleOpenVersionBrowser}
                  disabled={installingTag !== null || removingTool !== null}
                  fullWidth
                />
                <CompactActionButton
                  label={t().compatTools.installFromZip}
                  onClick={handleOpenArchiveInstaller}
                  disabled={installingTag !== null || removingTool !== null}
                  fullWidth
                />
              </Focusable>
            ) : (
              <div style={{ padding: '10px 0 0' }}>
                <CompactActionButton
                  label={t().compatTools.installFromZip}
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
