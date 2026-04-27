// src/components/tabs/ManageTab.tsx
import { useState, useEffect, useRef } from 'react';
import { Focusable, DialogButton, ConfirmModal, showModal, showContextMenu, Menu, MenuItem, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { toaster } from '../../lib/notify';
import { getTrackedConfigs, addTrackedConfig, removeTrackedConfig, type TrackedConfig } from '../../lib/trackedConfigs';
import { logFrontendEvent } from '../../lib/logger';
import { t } from '../../lib/i18n';
import { registerScreenshotAutomationHandler, type ScreenshotAutomationAction } from '../../lib/screenshotAutomation';
import { ConfigEditorModal } from '../ConfigEditorModal';
import { NativePulseReportModal } from '../NativePulseReportModal';
import { callable } from '@decky/api';
import { getSteamAppDetails, isSteamShortcutApp } from '../../lib/steamApps';

const _getGridArtwork = callable<[number], { dataUrl: string | null }>('get_grid_artwork');
async function getGridArtworkDataUrl(appId: number): Promise<string | null> {
  try { return (await _getGridArtwork(appId)).dataUrl ?? null; } catch { return null; }
}
import type { GpuVendor, SystemInfo } from '../../types';
import {
  fetchCloudConfigs,
  getCloudSyncStatus,
  restoreCloudConfigs,
  pushAllConfigs,
  pushConfig,
  onCloudConfigPushed,
  deleteCloudConfig,
  type CloudConfigRow,
  type SyncStatus,
} from '../../lib/cloudSync';
import { deleteMyReport } from '../../lib/userConfigs';
import { getSetting } from '../../lib/settings';
import { clearEditedReports, getEditedReportIndex, removeFromEditedReportIndex, upsertEditedReportIndex, type EditedReportIndexEntry } from './ConfigureTab';
import { bucketPlaytimeMinutes, getEffectivePlaytimeMinutes } from '../../lib/playtime';

interface Props {
  appId: number | null;
  appName: string;
  gpuVendor: GpuVendor | null;
  sysInfo: SystemInfo | null;
}

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

// Shows the Steam CDN banner and silently falls back to local grid artwork for
// non-Steam shortcuts where the CDN URL returns nothing.
function GameBanner({ appId, style }: { appId: number; style?: React.CSSProperties }) {
  const [src, setSrc] = useState(STEAM_HEADER_URL(appId));
  const triedGrid = useRef(false);

  const handleError = () => {
    if (triedGrid.current) { setSrc(''); return; }
    triedGrid.current = true;
    void getGridArtworkDataUrl(appId).then((dataUrl) => {
      if (dataUrl) setSrc(dataUrl);
      else setSrc('');
    });
  };

  if (!src) return null;
  return <img src={src} style={style} onError={handleError} />;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return '<1m';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function ManageTab({ appId, appName, gpuVendor, sysInfo }: Props) {
  const extras = t().extras!;
  const [configs, setConfigs] = useState<TrackedConfig[]>([]);
  const [editedIndex, setEditedIndex] = useState<EditedReportIndexEntry[]>([]);
  const [resolvedNames, setResolvedNames] = useState<Record<number, string>>({});
  const [cloudConfigs, setCloudConfigs] = useState<CloudConfigRow[]>([]);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const refresh = () => {
    setConfigs(getTrackedConfigs());
    setEditedIndex(getEditedReportIndex());
  };

  const resolveEditedName = async (entry: EditedReportIndexEntry): Promise<string> => {
    if (entry.appName) return entry.appName;
    try {
      const result = await getSteamAppDetails(entry.appId);
      return result?.details?.strDisplayName || `App ${entry.appId}`;
    } catch { return `App ${entry.appId}`; }
  };
  const refreshCloud = async () => {
    try {
      const rows = await fetchCloudConfigs();
      setCloudConfigs(rows);
    } finally {
      setCloudLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    void (async () => {
      // Scan all tracked configs for edited reports not yet in the index
      const trackedAppIds = getTrackedConfigs().map((c) => c.appId);
      const indexedIds = new Set(getEditedReportIndex().map((e) => e.appId));
      for (const id of trackedAppIds) {
        if (indexedIds.has(id)) continue;
        const edits = getSetting<any[]>(`edited-reports:${id}`, []);
        if (edits.length === 0) continue;
        const stub: EditedReportIndexEntry = { appId: id, appName: '', protonVersion: edits[0]?.report?.protonVersion ?? '', label: edits[0]?.label ?? '', savedAt: Date.now() };
        const name = await resolveEditedName(stub);
        upsertEditedReportIndex(id, name, stub.protonVersion, stub.label);
      }
      // Resolve missing app names for existing index entries
      for (const entry of getEditedReportIndex()) {
        if (entry.appName) continue;
        const name = await resolveEditedName(entry);
        if (name !== `App ${entry.appId}`) {
          upsertEditedReportIndex(entry.appId, name, entry.protonVersion, entry.label);
        }
      }
      setEditedIndex(getEditedReportIndex());
    })();
  }, []);
  useEffect(() => {
    void refreshCloud();
  }, []);

  // Auto-sync fires pushConfig off in the background when a config is saved.
  // Without this, the SYNCED badge stays stale until the tab remounts - even though
  // the push actually succeeded on the server side
  useEffect(() => onCloudConfigPushed((result) => {
    if (result.ok) void refreshCloud();
  }), []);

  useEffect(() => registerScreenshotAutomationHandler('manage-configurations/config-editor', async (action: ScreenshotAutomationAction) => {
    showModal(
      <ConfigEditorModal
        appId={action.appId ?? appId}
        appName={action.appName || appName}
        existingConfig={null}
        gpuVendor={gpuVendor}
        onSave={() => refresh()}
      />,
    );
  }), [appId, appName, gpuVendor]);

  useEffect(() => registerScreenshotAutomationHandler('manage-configurations/config-editor-existing', async (action: ScreenshotAutomationAction) => {
    const targetAppId = action.appId ?? appId ?? 2561580;
    const targetAppName = action.appName || appName || 'Horizon Zero Dawn Remastered';
    showModal(
      <ConfigEditorModal
        appId={targetAppId}
        appName={targetAppName}
        existingConfig={{
          appId: targetAppId,
          appName: targetAppName,
          profileName: action.profileName ?? 'Steam Deck Tweaks',
          protonVersion: action.protonVersion ?? 'GE-Proton10-1',
          launchOptions: 'MANGOHUD=1 DXVK_ASYNC=1 PROTON_VERSION="GE-Proton10-1" %command%',
          enabledVars: {
            MANGOHUD: '1',
            DXVK_ASYNC: '1',
          },
          appliedAt: Date.now() - 1000 * 60 * 42,
          isEdited: true,
          source: 'user',
        }}
        gpuVendor={gpuVendor}
        onSave={() => refresh()}
      />,
    );
  }), [appId, appName, gpuVendor]);

  useEffect(() => registerScreenshotAutomationHandler('manage-configurations/protondb-submit', async (action: ScreenshotAutomationAction) => {
    const targetAppId = action.appId ?? appId;
    if (!targetAppId) return;
    showModal(
      <NativePulseReportModal
        appId={targetAppId}
        appName={action.appName || appName}
        sysInfo={sysInfo}
      />,
    );
  }), [appId, appName, sysInfo]);

  useEffect(() => registerScreenshotAutomationHandler('manage-configurations/custom-toggle-manager', async (action: ScreenshotAutomationAction) => {
    const targetAppId = action.appId ?? appId ?? 2561580;
    const targetAppName = action.appName || appName || 'Horizon Zero Dawn Remastered';
    showModal(
      <ConfigEditorModal
        appId={targetAppId}
        appName={targetAppName}
        existingConfig={{
          appId: targetAppId,
          appName: targetAppName,
          profileName: action.profileName ?? 'Steam Deck Tweaks',
          protonVersion: action.protonVersion ?? 'GE-Proton10-1',
          launchOptions: 'MANGOHUD=1 PROTON_VERSION="GE-Proton10-1" gamemoderun %command%',
          enabledVars: { MANGOHUD: '1' },
          appliedAt: Date.now() - 1000 * 60 * 18,
          isEdited: true,
          source: 'user',
        }}
        gpuVendor={gpuVendor}
        onSave={() => refresh()}
        screenshotMode="custom-toggle-manager"
      />,
    );
  }), [appId, appName, gpuVendor]);

  useEffect(() => registerScreenshotAutomationHandler('manage-configurations/upload-preview', async (action: ScreenshotAutomationAction) => {
    const targetAppId = action.appId ?? appId ?? 2561580;
    const targetAppName = action.appName || appName || 'Horizon Zero Dawn Remastered';
    showModal(
      <ConfigEditorModal
        appId={targetAppId}
        appName={targetAppName}
        existingConfig={{
          appId: targetAppId,
          appName: targetAppName,
          profileName: action.profileName ?? 'Steam Deck Tweaks',
          protonVersion: action.protonVersion ?? 'GE-Proton10-1',
          launchOptions: 'MANGOHUD=1 DXVK_HUD=devinfo PROTON_VERSION="GE-Proton10-1" %command%',
          enabledVars: {
            MANGOHUD: '1',
            DXVK_HUD: 'devinfo',
          },
          appliedAt: Date.now() - 1000 * 60 * 24,
          isEdited: true,
          source: 'user',
        }}
        gpuVendor={gpuVendor}
        onSave={() => refresh()}
        screenshotMode="upload-preview"
      />,
    );
  }), [appId, appName, gpuVendor]);

  useEffect(() => registerScreenshotAutomationHandler('manage-configurations/native-pulse-report', async (action: ScreenshotAutomationAction) => {
    const targetAppId = action.appId ?? appId ?? 2561580;
    showModal(
      <NativePulseReportModal
        appId={targetAppId}
        appName={action.appName || appName || 'Horizon Zero Dawn Remastered'}
        sysInfo={sysInfo}
        protonVersion={action.protonVersion ?? 'GE-Proton10-1'}
        autoDuration="oneToFourHours"
        launchOptions={'MANGOHUD=1 PROTON_VERSION="GE-Proton10-1" %command%'}
      />,
    );
  }), [appId, appName, sysInfo]);

  // Resolve missing app names from Steam and backfill into stored config
  useEffect(() => {
    for (const config of configs) {
      if (!config.appName && !resolvedNames[config.appId]) {
        getSteamAppDetails(config.appId)
          .then((result) => {
            const name = result?.details?.strDisplayName;
            if (name) {
              setResolvedNames((prev) => ({ ...prev, [config.appId]: name }));
              // persist the name so cloud sync picks it up
              addTrackedConfig({ ...config, appName: name });
            }
          })
          .catch(() => {});
      }
    }
  }, [configs]);

  const displayName = (config: TrackedConfig): string =>
    config.appName || resolvedNames[config.appId] || `App ${config.appId}`;

  const sorted = [...configs].sort((a, b) => {
    if (appId && a.appId === appId) return -1;
    if (appId && b.appId === appId) return 1;
    const nameA = (a.appName || resolvedNames[a.appId] || `App ${a.appId}`).toLowerCase();
    const nameB = (b.appName || resolvedNames[b.appId] || `App ${b.appId}`).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const handleDelete = (config: TrackedConfig) => {
    showModal(
      <ConfirmModal
        strTitle={t().configManager.deleteConfirmTitle}
        strDescription={t().configManager.deleteConfirm(displayName(config))}
        strOKButtonText={t().configManager.deleteAction}
        onOK={() => {
          // Delete everywhere in one shot: wipe launch options, drop the
          // tracked config, and remove any submitted report from the cloud.
          // deleteMyReport is a no-op if nothing was ever submitted, so
          // this is safe even for configs that never hit Proton Pulse
          void logFrontendEvent('INFO', 'Deleting tracked config', { appId: config.appId, appName: config.appName });
          SteamClient.Apps.SetAppLaunchOptions(config.appId, '');
          removeTrackedConfig(config.appId);
          refresh();
          void Promise.all([
            deleteMyReport(String(config.appId)),
            deleteCloudConfig(config.appId),
          ])
            .then(([reportResult, cloudResult]) => {
              if (!reportResult.ok) {
                void logFrontendEvent('WARNING', 'Supabase report delete failed during full delete', {
                  appId: config.appId, error: reportResult.error,
                });
              }
              if (!cloudResult) {
                void logFrontendEvent('WARNING', 'Cloud config delete failed during full delete', {
                  appId: config.appId,
                });
              }
              // refresh cloud state so the synced badge clears right away
              return refreshCloud();
            })
            .catch(() => {});
          toaster.toast({ title: 'Proton Pulse', body: t().toast.cleared });
        }}
        onCancel={() => {}}
      />,
    );
  };

  const handleEdit = (config: TrackedConfig) => {
    showModal(
      <ConfigEditorModal
        appId={config.appId}
        appName={displayName(config)}
        existingConfig={config}
        gpuVendor={gpuVendor}
        onSave={() => refresh()}
      />,
    );
  };

  const handleSubmitReport = async (config: TrackedConfig) => {
    if (isSteamShortcutApp(config.appId)) {
      toaster.toast({ title: 'Proton Pulse', body: extras.shortcutCannotSubmit() });
      return;
    }
    // Compute playtime bucket from whichever is higher: the plugin's tracked
    // minutes or Steam's lifetime playtime for this app. Using the max means
    // games played before the plugin was installed still auto-fill the picker
    const { minutes, trackedMinutes, steamMinutes } = await getEffectivePlaytimeMinutes(config.appId);
    const autoDuration = bucketPlaytimeMinutes(minutes);
    void logFrontendEvent('DEBUG', 'Submit report auto-duration resolved', {
      appId: config.appId, minutes, trackedMinutes, steamMinutes, autoDuration,
    });
    showModal(
      <NativePulseReportModal
        appId={config.appId}
        appName={displayName(config)}
        sysInfo={sysInfo}
        protonVersion={config.protonVersion}
        autoDuration={autoDuration}
        launchOptions={config.launchOptions}
      />,
    );
  };

  const handleCreate = () => {
    showModal(
      <ConfigEditorModal
        appId={appId}
        appName={appName}
        existingConfig={null}
        gpuVendor={gpuVendor}
        onSave={() => refresh()}
      />,
    );
  };

  const handleSyncAll = () => {
    setSyncing(true);
    void pushAllConfigs()
      .then((result) => {
        toaster.toast({
          title: 'Proton Pulse',
          body: t().configManager.cloudSyncSummary(result.succeeded, result.total),
        });
        return refreshCloud();
      })
      .catch((error) => {
        toaster.toast({
          title: 'Proton Pulse',
          body: t().configManager.cloudSyncFailed(error instanceof Error ? error.message : String(error)),
        });
      })
      .finally(() => setSyncing(false));
  };

  const handleRestoreCloud = () => {
    setRestoring(true);
    void restoreCloudConfigs()
      .then((result) => {
        toaster.toast({
          title: 'Proton Pulse',
          body: t().configManager.cloudRestoreSummary(result.restored, result.skipped),
        });
        refresh();
        return refreshCloud();
      })
      .catch((error) => {
        toaster.toast({
          title: 'Proton Pulse',
          body: t().configManager.cloudRestoreFailed(error instanceof Error ? error.message : String(error)),
        });
      })
      .finally(() => setRestoring(false));
  };

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  const handleUploadOne = (config: TrackedConfig) => {
    void pushConfig(config)
      .then(async (ok) => {
        toaster.toast({
          title: 'Proton Pulse',
          body: ok
            ? t().configManager.cloudUploadSuccess
            : t().configManager.cloudSyncFailed('push failed'),
        });
        if (ok) await refreshCloud();
      });
  };

  const handleRestoreOne = (config: TrackedConfig) => {
    const cloudRow = cloudConfigs.find((r) => r.app_id === config.appId);
    if (!cloudRow) {
      toaster.toast({ title: 'Proton Pulse', body: t().configManager.cloudRestoreNoBackup });
      return;
    }
    addTrackedConfig(cloudRow.config);
    refresh();
    toaster.toast({ title: 'Proton Pulse', body: t().configManager.cloudRestoreSuccess });
  };

  const openActionsMenu = (config: TrackedConfig, e: MouseEvent) => {
    const isShortcut = isSteamShortcutApp(config.appId);
    const menuSyncStatus: SyncStatus = cloudLoading
      ? 'not-synced'
      : getCloudSyncStatus(config.appId, cloudConfigs);
    const syncLabel = cloudLoading
      ? t().configManager.syncingCloud
      : (menuSyncStatus === 'synced' ? t().configManager.synced : t().configManager.notSynced);
    showContextMenu(
      <Menu label={displayName(config)}>
        {/* Informational header, disabled so it's not focusable but the
            user can still see whether this config is on the cloud */}
        <MenuItem disabled onSelected={() => {}}>
          <span style={{ color: menuSyncStatus === 'synced' ? '#4caf50' : '#f59e0b' }}>
            {`${t().configManager.cloudStatusLabel}: ${syncLabel}`}
          </span>
        </MenuItem>
        <MenuItem onClick={() => handleEdit(config)}>
          {t().common.edit}
        </MenuItem>
        <MenuItem onClick={() => handleUploadOne(config)}>
          {t().configManager.uploadToCloud}
        </MenuItem>
        <MenuItem onClick={() => handleRestoreOne(config)}>
          {t().configManager.restoreFromCloud}
        </MenuItem>
        {!isShortcut ? (
          <MenuItem onClick={() => { void handleSubmitReport(config); }}>
            {t().detail.uploadToProtonPulse}
          </MenuItem>
        ) : null}
        <MenuItem onClick={() => handleDelete(config)}>
          {t().configManager.deleteAction}
        </MenuItem>
      </Menu>,
      e.currentTarget ?? window,
    );
  };

  if (sorted.length === 0) {
    return (
      <Focusable onGamepadDirection={handleRootDirection} style={{ padding: 16 }}>
        <div style={{ color: '#888', fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
          {t().configManager.emptyState}
        </div>
        {appId && (
          <DialogButton onClick={handleCreate}>
            {t().configManager.configureCurrentGame}
          </DialogButton>
        )}
        <div style={{ marginTop: 12 }}>
          <DialogButton onClick={handleCreate}>
            {t().configManager.createConfig}
          </DialogButton>
        </div>
      </Focusable>
    );
  }

  return (
    <Focusable onGamepadDirection={handleRootDirection} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: 12 }}>
        <DialogButton onClick={handleCreate}>
          {t().configManager.createConfig}
        </DialogButton>
      </div>
      <Focusable flow-children="horizontal" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <DialogButton onClick={handleSyncAll} disabled={syncing || restoring} style={{ flex: 1 }}>
          {syncing ? t().configManager.syncingCloud : t().configManager.syncAllToCloud}
        </DialogButton>
        <DialogButton onClick={handleRestoreCloud} disabled={syncing || restoring} style={{ flex: 1 }}>
          {restoring ? t().configManager.restoringFromCloud : t().configManager.restoreFromCloud}
        </DialogButton>
      </Focusable>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map((config) => {
          const isCurrent = appId === config.appId;
          const name = displayName(config);
          const isShortcut = isSteamShortcutApp(config.appId);
          const syncStatus: SyncStatus = cloudLoading ? 'not-synced' : getCloudSyncStatus(config.appId, cloudConfigs);
          const metaParts = [
            isShortcut ? extras.nonSteamShortcut() : extras.appIdLabel(config.appId),
            config.protonVersion,
            t().configManager.appliedAgo(relativeTime(config.appliedAt)),
          ].filter(Boolean).join(' · ');
          return (
            <div
              key={config.appId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                marginBottom: 6,
                borderRadius: 6,
                borderLeft: isCurrent ? '3px solid #4c9eff' : '3px solid transparent',
                background: isCurrent ? 'rgba(76,158,255,0.08)' : 'rgba(255,255,255,0.03)',
              }}
            >
              <GameBanner
                appId={config.appId}
                style={{ height: 32, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e8f4ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                  {!cloudLoading && (
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 999,
                        marginLeft: 6,
                        verticalAlign: 'middle',
                        background: syncStatus === 'synced' ? 'rgba(76,175,80,0.18)' : 'rgba(245,158,11,0.18)',
                        color: syncStatus === 'synced' ? '#4caf50' : '#f59e0b',
                        textTransform: 'uppercase',
                        letterSpacing: 0.3,
                      }}
                    >
                      {syncStatus === 'synced' ? t().configManager.synced : t().configManager.notSynced}
                    </span>
                  )}
                </div>
                {config.profileName && (
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#4c9eff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {config.profileName}
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#7a9bb5' }}>
                  {metaParts}
                </div>
              </div>
              <Focusable style={{ display: 'flex', flexShrink: 0 }}>
                <DialogButton
                  style={{
                    height: 40,
                    width: 40,
                    minWidth: 40,
                    padding: '10px 12px',
                  }}
                  onClick={(e: MouseEvent) => openActionsMenu(config, e)}
                >
                  ...
                </DialogButton>
              </Focusable>
            </div>
          );
        })}

        {editedIndex.length > 0 && (
          <>
            <div style={{ padding: '12px 0 4px', fontSize: 11, fontWeight: 700, color: '#8fb4d5', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t().configManager.editedReportOverrides}
            </div>
            {[...editedIndex].sort((a, b) => (a.appName || `App ${a.appId}`).toLowerCase().localeCompare((b.appName || `App ${b.appId}`).toLowerCase())).map((entry) => {
              const eName = entry.appName || `App ${entry.appId}`;
              const eMetaParts = [
                extras.appIdLabel(entry.appId),
                entry.protonVersion,
                entry.label,
              ].filter(Boolean).join(' · ');
              const openEditedMenu = (e: MouseEvent) => showContextMenu(
                <Menu label={eName}>
                  <MenuItem onClick={() => showModal(
                    <ConfirmModal
                      strTitle={t().configManager.deleteConfirmTitle}
                      strDescription={t().configManager.deleteConfirm(eName)}
                      strOKButtonText={t().configManager.deleteAction}
                      onOK={() => { clearEditedReports(entry.appId); removeFromEditedReportIndex(entry.appId); refresh(); }}
                      onCancel={() => {}}
                    />,
                  )}>
                    {t().configManager.deleteAction}
                  </MenuItem>
                </Menu>,
                e.currentTarget ?? window,
              );
              return (
                <div
                  key={entry.appId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    marginBottom: 6,
                    borderRadius: 6,
                    borderLeft: '3px solid transparent',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  <GameBanner
                    appId={entry.appId}
                    style={{ height: 32, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#e8f4ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {eName}
                      <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, marginLeft: 6, verticalAlign: 'middle', background: 'rgba(74,159,208,0.18)', color: '#7ec8f0', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                        {t().reports.editedBadge}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: '#7a9bb5' }}>{eMetaParts}</div>
                  </div>
                  <Focusable style={{ display: 'flex', flexShrink: 0 }}>
                    <DialogButton
                      style={{ height: 40, width: 40, minWidth: 40, padding: '10px 12px' }}
                      onClick={(e: MouseEvent) => openEditedMenu(e)}
                    >
                      ...
                    </DialogButton>
                  </Focusable>
                </div>
              );
            })}
          </>
        )}
      </div>
    </Focusable>
  );
}
