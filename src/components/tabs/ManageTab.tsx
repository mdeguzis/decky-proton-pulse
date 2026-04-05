// src/components/tabs/ManageTab.tsx
import { useState, useEffect } from 'react';
import { Focusable, DialogButton, ConfirmModal, showModal, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { toaster } from '@decky/api';
import { getTrackedConfigs, removeTrackedConfig, type TrackedConfig } from '../../lib/trackedConfigs';
import { logFrontendEvent } from '../../lib/logger';
import { t } from '../../lib/i18n';
import { ConfigEditorModal } from '../ConfigEditorModal';

interface Props {
  appId: number | null;
  appName: string;
}

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

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

export function ManageTab({ appId, appName }: Props) {
  const [configs, setConfigs] = useState<TrackedConfig[]>([]);

  const refresh = () => setConfigs(getTrackedConfigs());

  useEffect(() => { refresh(); }, []);

  const sorted = [...configs].sort((a, b) => {
    if (appId && a.appId === appId) return -1;
    if (appId && b.appId === appId) return 1;
    return b.appliedAt - a.appliedAt;
  });

  const handleDelete = (config: TrackedConfig) => {
    showModal(
      <ConfirmModal
        strTitle={t().configManager.deleteConfirmTitle}
        strDescription={t().configManager.deleteConfirm(config.appName)}
        strOKButtonText={t().common.clear}
        onOK={() => {
          void logFrontendEvent('INFO', 'Deleting tracked config', { appId: config.appId, appName: config.appName });
          SteamClient.Apps.SetAppLaunchOptions(config.appId, '');
          removeTrackedConfig(config.appId);
          refresh();
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
        appName={config.appName}
        existingConfig={config}
        onSave={() => refresh()}
      />,
    );
  };

  const handleCreate = () => {
    showModal(
      <ConfigEditorModal
        appId={appId}
        appName={appName}
        existingConfig={null}
        onSave={() => refresh()}
      />,
    );
  };

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
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
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map((config) => {
          const isCurrent = appId === config.appId;
          return (
            <Focusable
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
              <img
                src={STEAM_HEADER_URL(config.appId)}
                style={{ height: 32, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e8f4ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {config.appName || `App ${config.appId}`}
                </div>
                <div style={{ fontSize: 10, color: '#7a9bb5' }}>
                  {config.protonVersion} · {t().configManager.appliedAgo(relativeTime(config.appliedAt))}
                </div>
              </div>
              <Focusable style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <DialogButton
                  onClick={() => handleEdit(config)}
                  style={{ minWidth: 50, padding: '4px 10px', fontSize: 11 }}
                >
                  {t().common.edit}
                </DialogButton>
                <DialogButton
                  onClick={() => handleDelete(config)}
                  style={{ minWidth: 50, padding: '4px 10px', fontSize: 11, background: '#555' }}
                >
                  {t().common.clear}
                </DialogButton>
              </Focusable>
            </Focusable>
          );
        })}
      </div>
    </Focusable>
  );
}
