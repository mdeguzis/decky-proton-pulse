// src/components/tabs/SettingsTab.tsx
import { useEffect, useMemo, useState } from 'react';
import { ToggleField, Focusable, GamepadButton, DialogButton, Menu, MenuItem, showContextMenu } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { callable, toaster } from '@decky/api';
import { getSetting, setSetting } from '../../lib/settings';
import { logFrontendEvent } from '../../lib/logger';
import { getProtonGeManagerState, installProtonGe } from '../../lib/compatTools';
import type { CompatToolRelease, InstalledCompatTool, ProtonGeManagerState } from '../../types';

const setLogLevel = callable<[level: string], boolean>('set_log_level');

const AUTO_UPDATE_KEY = 'compat-auto-update-proton-ge';

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

function rowStyle(): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) auto',
    gap: 12,
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
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

function matchesRelease(tool: InstalledCompatTool, release: CompatToolRelease): boolean {
  const tag = release.tag_name.toLowerCase();
  return [tool.directory_name, tool.display_name, tool.internal_name].some((field) => field.toLowerCase().includes(tag));
}

function CompactActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <DialogButton
      disabled={disabled}
      onClick={onClick}
      style={{
        minWidth: 110,
        height: 34,
        padding: '0 12px',
        fontSize: 12,
      }}
    >
      {label}
    </DialogButton>
  );
}

function SelectMenuButton({
  label,
  options,
  onSelect,
}: {
  label: string;
  options: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
}) {
  return (
    <DialogButton
      onClick={(e: MouseEvent) =>
        showContextMenu(
          <Menu label="Select Version">
            {options.map((option) => (
              <MenuItem key={option.value} onClick={() => onSelect(option.value)}>
                {option.label}
              </MenuItem>
            ))}
          </Menu>,
          e.currentTarget ?? window,
        )
      }
      style={{
        minWidth: 210,
        height: 34,
        padding: '0 12px',
        fontSize: 12,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 10 }}>▼</span>
    </DialogButton>
  );
}

export function SettingsTab() {
  const [debugEnabled, setDebugEnabled] = useState(() => getSetting('debugEnabled', false));
  const [ghToken, setGhToken] = useState(() => getSetting<string>('gh-votes-token', ''));
  const [autoUpdateCurrent, setAutoUpdateCurrent] = useState(() => getSetting(AUTO_UPDATE_KEY, false));
  const [managerState, setManagerState] = useState<ProtonGeManagerState | null>(null);
  const [loadingManager, setLoadingManager] = useState(true);
  const [installingTag, setInstallingTag] = useState<string | null>(null);
  const [autoUpdateTriggered, setAutoUpdateTriggered] = useState(false);
  const [selectedInstallTag, setSelectedInstallTag] = useState<string | null>(null);

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
      setSelectedInstallTag((current) => current ?? nextState.current_release?.tag_name ?? nextState.releases[0]?.tag_name ?? null);
      void logFrontendEvent('INFO', 'Loaded Proton-GE manager state', {
        releases: nextState.releases.length,
        installedTools: nextState.installed_tools.length,
        currentRelease: nextState.current_release?.tag_name ?? null,
        currentInstalled: nextState.current_installed,
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

  useEffect(() => {
    void setLogLevel(debugEnabled ? 'DEBUG' : 'INFO').catch((error) => {
      console.error('Proton Pulse: failed to sync debug setting from Settings tab', error);
    });
  }, [debugEnabled]);

  useEffect(() => {
    void refreshManager(false);
  }, []);

  useEffect(() => {
    if (!autoUpdateCurrent || autoUpdateTriggered || loadingManager || !managerState?.current_release || managerState.current_installed) {
      return;
    }

    setAutoUpdateTriggered(true);
    void (async () => {
      setInstallingTag(managerState.current_release!.tag_name);
      const result = await installProtonGe(managerState.current_release!.tag_name);
      toaster.toast({
        title: 'Proton Pulse',
        body: result.success
          ? `Auto-updated ${managerState.current_release!.tag_name}.`
          : result.message,
      });
      setInstallingTag(null);
      await refreshManager(true);
    })();
  }, [autoUpdateCurrent, autoUpdateTriggered, loadingManager, managerState]);

  const handleDebugToggle = async (enabled: boolean) => {
    void logFrontendEvent('INFO', 'Debug logging toggle changed', {
      previousValue: debugEnabled,
      nextValue: enabled,
    });
    setDebugEnabled(enabled);
    setSetting('debugEnabled', enabled);
  };

  const handleTokenChange = (value: string) => {
    void logFrontendEvent('DEBUG', 'GitHub token field updated', {
      hasToken: value.trim().length > 0,
      length: value.length,
    });
    setGhToken(value);
    setSetting('gh-votes-token', value);
  };

  const handleAutoUpdateToggle = (enabled: boolean) => {
    setAutoUpdateCurrent(enabled);
    setAutoUpdateTriggered(false);
    setSetting(AUTO_UPDATE_KEY, enabled);
    void logFrontendEvent('INFO', 'Current Proton-GE auto-update toggle changed', {
      nextValue: enabled,
    });
  };

  const handleInstallRelease = async (tagName?: string | null) => {
    const nextTag = tagName ?? managerState?.current_release?.tag_name ?? null;
    if (!nextTag) return;

    setInstallingTag(nextTag);
    const result = await installProtonGe(nextTag);
    toaster.toast({
      title: 'Proton Pulse',
      body: result.success ? result.message : `Install failed: ${result.message}`,
    });
    setInstallingTag(null);
    await refreshManager(true);
  };

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      return;
    }
  };

  return (
    <Focusable onGamepadDirection={handleRootDirection}>
      <div style={sectionStyle()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff', marginBottom: 8 }}>
          General
        </div>
        <div style={focusClipRowStyle()}>
          <ToggleField
            label="Debug Logs"
            description="Enable verbose logging in plugin activity log"
            checked={debugEnabled}
            onChange={handleDebugToggle}
          />
        </div>
        <div style={{ padding: '8px 16px 0 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e8f4ff', marginBottom: 2 }}>
            GitHub Votes Token
          </div>
          <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 6 }}>
            GitHub token for the `proton-pulse-data` repo with permission to trigger the upvote workflow
          </div>
          <input
            type="password"
            value={ghToken}
            onChange={(e) => handleTokenChange(e.target.value)}
            placeholder="ghp_…"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#1a2a3a',
              border: '1px solid #2a3a4a',
              borderRadius: 6,
              color: '#e8f4ff',
              fontSize: 12,
              padding: '6px 10px',
            }}
          />
        </div>
      </div>

      <div style={sectionStyle()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff' }}>
              Compatibility Tools
            </div>
            <div style={{ fontSize: 11, color: '#7a9bb5', marginTop: 2 }}>
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
          />
        </div>

        <div
          style={{
            padding: '12px 0',
            borderRadius: 0,
            background: 'transparent',
            border: 0,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#dbe8f4', marginBottom: 6, padding: '0 18px' }}>
            Proton versions available
          </div>
          <div style={{ fontSize: 11, color: '#9eb7cc', lineHeight: 1.7, padding: '0 18px' }}>
            {managerState && managerState.releases.length > 0
              ? managerState.releases.slice(0, 10).map((release) => release.tag_name).join('  ·  ')
              : loadingManager
                ? 'Loading available Proton-GE versions…'
                : 'No Proton-GE versions available right now.'}
          </div>
        </div>

        <div
          style={{
            padding: '12px 0 6px',
            borderRadius: 0,
            background: 'transparent',
            border: 0,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 14,
          }}
        >
          <div style={{ ...rowStyle(), gridTemplateColumns: 'minmax(0, 1fr) auto', padding: '0 18px 12px' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#eef7ff' }}>Install Version</div>
              <div style={{ fontSize: 11, color: '#9eb7cc', marginTop: 4 }}>
                Choose a Proton-GE release to install manually.
              </div>
            </div>
            <SelectMenuButton
              label={selectedInstallTag ?? 'Select Proton-GE version'}
              options={(managerState?.releases ?? []).slice(0, 20).map((release) => ({
                label: release.tag_name,
                value: release.tag_name,
              }))}
              onSelect={(value) => setSelectedInstallTag(value)}
            />
          </div>
          <div style={{ ...rowStyle(), gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr) auto', padding: '12px 18px' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#eef7ff' }}>Current Version</div>
              <div style={{ fontSize: 11, color: '#9eb7cc', marginTop: 4 }}>
                {managerState?.current_release?.tag_name ?? (loadingManager ? 'Loading latest Proton-GE…' : 'No release available')}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#9eb7cc' }}>
                {managerState?.current_installed ? 'Installed' : 'Not installed'}
              </div>
              <div style={{ fontSize: 10, color: '#7492ad', marginTop: 4 }}>
                {managerState?.current_release?.published_at ? formatReleaseDate(managerState.current_release.published_at) : ''}
              </div>
            </div>
            <CompactActionButton
              label={
                installingTag === (selectedInstallTag ?? managerState?.current_release?.tag_name)
                  ? 'Installing…'
                  : selectedInstallTag && installedReleaseTags.has(selectedInstallTag)
                    ? 'Reinstall'
                    : 'Install'
              }
              onClick={() => void handleInstallRelease(selectedInstallTag ?? managerState?.current_release?.tag_name)}
              disabled={(!managerState?.current_release && !selectedInstallTag) || installingTag !== null}
            />
          </div>
          <div style={{ ...focusClipRowStyle(), margin: '6px 10px 0' }}>
            <ToggleField
              label="Auto-update Current Version"
              description="Keep the pinned latest Proton-GE release installed whenever Settings opens and refreshes."
              checked={autoUpdateCurrent}
              onChange={handleAutoUpdateToggle}
            />
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: '#dbe8f4', marginBottom: 8 }}>
          Installed Proton Versions
        </div>
        <div style={{ marginBottom: 14 }}>
          {!managerState || managerState.installed_tools.length === 0 ? (
            <div style={{ fontSize: 11, color: '#8fa9bf', padding: '6px 0 12px 0' }}>
              No Proton compatibility tools were detected on this system.
            </div>
          ) : (
            managerState.installed_tools.map((tool, index) => (
              <div
                key={`${tool.directory_name}-${index}`}
                style={{
                  ...rowStyle(),
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  borderBottom: index === managerState.installed_tools.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: '#eef7ff', fontWeight: 600 }}>{tool.display_name}</div>
                  <div style={{ fontSize: 10, color: '#7f9bb2', marginTop: 3 }}>{tool.directory_name}</div>
                </div>
                <div style={{ fontSize: 10, color: '#93b2c8' }}>
                  {tool.source === 'valve'
                    ? 'Valve built-in'
                    : Array.from(installedReleaseTags).find((tag) => tag.toLowerCase().includes(tool.directory_name.toLowerCase()))
                      ? 'Managed'
                      : 'Local'}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: '#dbe8f4', marginBottom: 8 }}>
          Available Proton-GE Releases
        </div>
        {!managerState || managerState.releases.length === 0 ? (
          <div style={{ fontSize: 11, color: '#8fa9bf' }}>
            {loadingManager ? 'Loading release feed…' : 'No Proton-GE releases were returned from GitHub.'}
          </div>
        ) : (
          managerState.releases.slice(0, 12).map((release, index) => {
            const installed = installedReleaseTags.has(release.tag_name);
            const isCurrent = managerState.current_release?.tag_name === release.tag_name;
            return (
              <div
                key={release.tag_name}
                style={{
                  ...rowStyle(),
                  borderBottom: index === Math.min(managerState.releases.length, 12) - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: '#eef7ff', fontWeight: 600 }}>
                    {release.tag_name}
                    {isCurrent ? ' · Current' : ''}
                  </div>
                  <div style={{ fontSize: 10, color: '#7f9bb2', marginTop: 3 }}>
                    {release.name} · {formatReleaseDate(release.published_at)}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: installed ? '#aee2be' : '#8fa9bf' }}>
                  {installed ? 'Installed' : 'Not installed'}
                </div>
                <CompactActionButton
                  label={installingTag === release.tag_name ? 'Installing…' : installed ? 'Reinstall' : 'Install'}
                  onClick={() => void handleInstallRelease(release.tag_name)}
                  disabled={installingTag !== null}
                />
              </div>
            );
          })
        )}
      </div>
    </Focusable>
  );
}
