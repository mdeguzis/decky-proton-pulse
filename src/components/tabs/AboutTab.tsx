// src/components/tabs/AboutTab.tsx
import { useEffect, useRef, useState } from 'react';
import { callable } from '@decky/api';
import { Focusable, DialogButton, Dropdown, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { toaster } from '../../lib/notify';
import { BrandLogo } from '../BrandLogo';
import { t } from '../../lib/i18n';
import { openIssue, type IssueTemplate } from '../../lib/issueReport';
import { registerScreenshotAutomationHandler } from '../../lib/screenshotAutomation';
import { callWithTimeout } from '../../lib/logger';
import { buildInstallProgressDetails } from './settingsTabProgress';
import {
  shouldPollUpdateStatus,
  triggerReload,
  type UpdateCheckResult,
  type UpdateStatusResult,
} from './aboutTabUpdate';

const getPluginVersion = callable<[], string>('get_plugin_version');
const getPluginVersionSafe = () =>
  callWithTimeout(() => getPluginVersion(), 'get_plugin_version', 5000);

const checkForUpdate = callable<[string], UpdateCheckResult>('check_for_update');
const applyUpdate = callable<[string, string], { success: boolean; error?: string }>('apply_update');
const getUpdateStatus = callable<[], UpdateStatusResult>('get_update_status');

const ISSUE_TEMPLATES: { data: IssueTemplate; labelKey: keyof ReturnType<typeof t>['about'] }[] = [
  { data: 'game_report', labelKey: 'issueTemplateGameReport' },
  { data: 'missing_reports', labelKey: 'issueTemplateMissingReports' },
  { data: 'plugin_issue', labelKey: 'issueTemplatePluginIssue' },
  { data: 'other', labelKey: 'issueTemplateOther' },
];

export function AboutTab() {
  const extras = t().extras!;
  const [selectedTemplate, setSelectedTemplate] = useState<IssueTemplate>('plugin_issue');
  const [submitting, setSubmitting] = useState(false);
  const [version, setVersion] = useState('...');
  const templatePickerRef = useRef<HTMLDivElement>(null);

  // Update flow state
  const [updateChannel, setUpdateChannel] = useState<'release' | 'pre-release' | 'latest'>('release');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusResult | null>(null);
  const [reloading, setReloading] = useState(false);

  const aboutStrings = t().about;
  const compatStrings = t().compatTools;

  const progressLabels = {
    finalizing: aboutStrings.extractingUpdate,
    extracting: aboutStrings.extractingUpdate,
    downloading: aboutStrings.downloadingUpdate,
    estimating: compatStrings.estimating,
    timeLeft: compatStrings.timeLeft,
  };

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await openIssue(selectedTemplate);
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: extras.failedToOpenIssuePage() });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setCheckResult(null);
    try {
      const result = await callWithTimeout(() => checkForUpdate(updateChannel), 'check_for_update', 20000);
      setCheckResult(result);
    } catch {
      setCheckResult({ success: false, error: aboutStrings.checkUpdateFailed });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!checkResult?.zip_url || !checkResult.latest_version) return;
    const result = await callWithTimeout(
      () => applyUpdate(checkResult.zip_url!, checkResult.latest_version!),
      'apply_update',
      10000,
    );
    if (!result.success) {
      toaster.toast({ title: 'Proton Pulse', body: aboutStrings.updateFailed(result.error ?? '') });
    }
    // Refresh status immediately so polling picks up "running"
    try {
      const status = await getUpdateStatus();
      setUpdateStatus(status);
    } catch { /* poll will catch it */ }
  };

  const handleReload = async () => {
    setReloading(true);
    await triggerReload('Proton Pulse');
    // If hot-reload fires, this component will unmount. If it doesn't (Steam
    // restart path), we'll briefly show the button as disabled.
    setReloading(false);
  };

  // Poll backend status while download/extract is running
  useEffect(() => {
    if (!shouldPollUpdateStatus(updateStatus)) return;
    const id = window.setInterval(async () => {
      try {
        const status = await getUpdateStatus();
        setUpdateStatus(status);
      } catch { /* ignore transient errors */ }
    }, 3000);
    return () => window.clearInterval(id);
  }, [updateStatus]);

  useEffect(() => registerScreenshotAutomationHandler('about/issue-template-selector', async () => {
    const picker = templatePickerRef.current;
    const button = picker?.querySelector<HTMLElement>('button,[role="button"]');
    button?.click();
  }), []);

  useEffect(() => {
    void getPluginVersionSafe()
      .then(setVersion)
      .catch(() => setVersion('...'));
  }, []);

  // Derived state
  const isRunning = updateStatus?.state === 'running';
  const isDone = updateStatus?.state === 'success';
  const hasFailed = updateStatus?.state === 'error';
  const progress = isRunning || isDone
    ? buildInstallProgressDetails(
        {
          state: updateStatus!.state,
          tag_name: updateStatus!.version ?? null,
          message: null,
          stage: updateStatus!.stage ?? null,
          downloaded_bytes: updateStatus!.downloaded_bytes ?? null,
          total_bytes: updateStatus!.total_bytes ?? null,
          progress_fraction: updateStatus!.progress_fraction ?? null,
          started_at: updateStatus!.started_at ?? null,
          finished_at: updateStatus!.finished_at ?? null,
          install_as_latest: false,
        },
        checkResult?.asset_size ?? null,
        progressLabels,
      )
    : null;

  return (
    <Focusable onGamepadDirection={handleRootDirection} style={{ padding: 8, fontSize: 12, color: '#ccc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <BrandLogo size={42} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Proton Pulse</div>
          <div style={{ color: '#888' }}>{`v${version}`}</div>
        </div>
      </div>
      <div style={{ marginBottom: 16, lineHeight: 1.5 }}>
        {aboutStrings.description}
      </div>

      {/* --- Check for Updates --- */}
      <div style={{ borderTop: '1px solid #2a3a4a', paddingTop: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff', marginBottom: 8 }}>
          {aboutStrings.checkForUpdates}
        </div>

        {/* Status messages */}
        {checkResult && !checkResult.success && !isRunning && !isDone && (
          <div style={{ fontSize: 11, color: '#ef5350', marginBottom: 8 }}>
            {checkResult.error ?? aboutStrings.checkUpdateFailed}
          </div>
        )}
        {checkResult?.success && !checkResult.has_update && !isRunning && !isDone && (
          <div style={{ fontSize: 11, color: '#4caf50', marginBottom: 8 }}>
            {aboutStrings.upToDate}
          </div>
        )}
        {checkResult?.success && checkResult.has_update && !isRunning && !isDone && (
          <div style={{ fontSize: 11, color: '#ffb74d', marginBottom: 8 }}>
            {aboutStrings.updateAvailable(checkResult.latest_version!)}
          </div>
        )}
        {hasFailed && updateStatus?.error && (
          <div style={{ fontSize: 11, color: '#ef5350', marginBottom: 8 }}>
            {aboutStrings.updateFailed(updateStatus.error)}
          </div>
        )}

        {/* Progress bar -- visible while running or just finished */}
        {(isRunning || isDone) && progress && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center' }}>
              <div style={{ height: 8, borderRadius: 999, background: 'rgba(111,198,255,0.12)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.max(4, Math.round(Math.max(0, Math.min(100, (progress.progressRatio ?? 0.08) * 100))))}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: isDone
                      ? 'linear-gradient(90deg, rgba(76,175,80,0.9) 0%, rgba(129,199,132,0.98) 100%)'
                      : 'linear-gradient(90deg, rgba(82,173,235,0.9) 0%, rgba(122,213,255,0.98) 100%)',
                    transition: 'width 240ms ease',
                  }}
                />
              </div>
              <div style={{ minWidth: 88, textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#eef7ff', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {isDone ? '100%' : progress.progressLabel}
                </div>
                <div style={{ fontSize: 10, color: '#7f9bb2', marginTop: 2, whiteSpace: 'nowrap' }}>
                  {isDone ? aboutStrings.updateApplied : progress.progressMeta}
                </div>
                {!isDone && (
                  <div style={{ fontSize: 10, color: '#6faee8', marginTop: 2, whiteSpace: 'nowrap' }}>
                    {progress.etaLabel}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Channel selector + action buttons */}
        <Focusable style={{ display: 'flex', gap: 10, alignItems: 'center' }} flow-children="horizontal">
          {!isDone && !isRunning && (
            <select
              value={updateChannel}
              onChange={e => setUpdateChannel(e.target.value as any)}
              style={{
                background: 'rgba(11,17,22,0.6)', border: '1px solid #2f4a63',
                color: '#c7d5e0', fontSize: 11, padding: '6px 8px', borderRadius: 3,
                minWidth: 100,
              }}
            >
              <option value="release">Release</option>
              <option value="pre-release">Pre-release</option>
              <option value="latest">Latest commit</option>
            </select>
          )}
          {!isDone && (
            <DialogButton
              onClick={handleCheckUpdate}
              disabled={checkingUpdate || isRunning}
              style={{ flex: 1, fontSize: 12 }}
            >
              {checkingUpdate ? aboutStrings.checkingForUpdates : aboutStrings.checkForUpdates}
            </DialogButton>
          )}
          {checkResult?.success && checkResult.has_update && !isRunning && !isDone && (
            <DialogButton
              onClick={handleApplyUpdate}
              style={{ flex: 1, fontSize: 12 }}
            >
              {aboutStrings.applyUpdate(checkResult.latest_version!)}
            </DialogButton>
          )}
          {isRunning && (
            <DialogButton disabled style={{ flex: 1, fontSize: 12 }}>
              {updateStatus?.stage === 'extracting'
                ? aboutStrings.extractingUpdate
                : aboutStrings.applyingUpdate}
            </DialogButton>
          )}
          {isDone && (
            <DialogButton
              onClick={handleReload}
              disabled={reloading}
              style={{ flex: 1, fontSize: 12 }}
            >
              {reloading ? aboutStrings.reloading : aboutStrings.reloadPlugin}
            </DialogButton>
          )}
        </Focusable>
      </div>

      {/* External links. Plain <a> tags aren't reachable with the D-pad in
          Game Mode, so each link is wrapped in a Focusable that calls
          window.open on activation. Steam intercepts target=_blank too,
          so we open the URL imperatively. */}
      <Focusable
        style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}
        flow-children="horizontal"
      >
        {[
          { label: 'Proton Pulse Website', url: 'https://www.proton-pulse.com' },
          { label: aboutStrings.github, url: 'https://github.com/mdeguzis/decky-proton-pulse' },
          { label: aboutStrings.protondb, url: 'https://www.protondb.com' },
        ].map(({ label, url }) => (
          <Focusable
            key={url}
            onActivate={() => { try { window.open(url, '_blank'); } catch { /* noop */ } }}
            style={{
              color: '#4c9eff',
              padding: '4px 8px',
              borderRadius: 3,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {label} {'↗'}
          </Focusable>
        ))}
      </Focusable>

      {/* --- Submit Issue --- */}
      <div
        style={{
          borderTop: '1px solid #2a3a4a',
          paddingTop: 14,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff', marginBottom: 4 }}>
          {aboutStrings.submitIssue}
        </div>
        <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 10, lineHeight: 1.4 }}>
          {aboutStrings.submitIssueHint}
        </div>
        <Focusable style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          <div ref={templatePickerRef} style={{ flex: 1 }}>
            <Dropdown
              rgOptions={ISSUE_TEMPLATES.map((tpl) => ({
                data: tpl.data,
                label: aboutStrings[tpl.labelKey] as string,
              }))}
              selectedOption={selectedTemplate}
              onChange={(opt) => setSelectedTemplate(opt.data as IssueTemplate)}
            />
          </div>
          <DialogButton
            onClick={handleSubmit}
            disabled={submitting}
            style={{ flex: 1, fontSize: 12 }}
          >
            {submitting ? aboutStrings.openingIssue : aboutStrings.submitIssue}
          </DialogButton>
        </Focusable>
      </div>
    </Focusable>
  );
}
