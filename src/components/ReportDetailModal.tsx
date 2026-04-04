// src/components/ReportDetailModal.tsx
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ModalRoot, Focusable, DialogButton, SteamSpinner, GamepadButton, showModal } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { toaster } from '@decky/api';
import type { SystemInfo } from '../types';
import type { DisplayReportCard } from './ReportCard';
import type { EditedReportEntry } from './tabs/ConfigureTab';
import { EditReportModal } from './EditReportModal';
import {
  RATING_COLORS,
  formatProtonLabel,
  formatTimestamp,
  buildLaunchOptionPreview,
  matchLabel,
} from '../lib/reportFormatters';
import { getSteamAppDetails, getLaunchOptionsFromDetails } from '../lib/steamApps';
import { checkProtonVersionAvailability } from '../lib/compatTools';
import { logFrontendEvent } from '../lib/logger';

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

const SCROLL_STEP = 120;

const VERSION_STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  installed:   { bg: '#4caf50', label: 'Installed' },
  installable: { bg: '#f59e0b', label: 'Not Installed' },
  unavailable: { bg: '#6b7280', label: 'Unavailable' },
  unmanaged:   { bg: '#4a6a8a', label: 'Valve Proton' },
};

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          fontSize: 10,
          color: '#7a9bb5',
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          padding: '10px 0 4px',
          borderBottom: '1px solid #2a3a4a',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '5px 0',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        fontSize: 12,
        gap: 12,
      }}
    >
      <span style={{ color: '#9db0c4', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#e8f4ff', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

export interface ReportDetailModalProps {
  closeModal?: () => void;
  report: DisplayReportCard;
  appId: number;
  appName: string;
  sysInfo: SystemInfo | null;
  currentLaunchOptions: string;
  onApply: (report: DisplayReportCard) => Promise<void>;
  onUpvote: (report: DisplayReportCard) => Promise<void>;
  onSaveEdit: (entry: EditedReportEntry) => void;
}

export function ReportDetailModal({
  closeModal,
  report,
  appId,
  appName,
  sysInfo,
  currentLaunchOptions,
  onApply,
  onUpvote,
  onSaveEdit,
}: ReportDetailModalProps) {
  const [applying, setApplying] = useState(false);
  const [upvoting, setUpvoting] = useState(false);
  const [launchOptionsDisplay, setLaunchOptionsDisplay] = useState(currentLaunchOptions);
  const [versionStatus, setVersionStatus] = useState<'loading' | 'installed' | 'installable' | 'unavailable' | 'unmanaged'>('loading');
  const scrollRef = useRef<HTMLDivElement>(null);
  const cappedScore = Math.min(100, report.score);
  const confScore = (cappedScore / 10).toFixed(1);
  const ratingColor = RATING_COLORS[report.rating] ?? '#888';

  useEffect(() => {
    void logFrontendEvent('DEBUG', 'Checking Proton version availability', {
      appId, protonVersion: report.protonVersion,
    });
    checkProtonVersionAvailability(report.protonVersion)
      .then((av) => {
        const status = !av.managed ? 'unmanaged'
          : av.installed ? 'installed'
          : av.release ? 'installable'
          : 'unavailable';
        void logFrontendEvent('INFO', 'Proton version availability resolved', {
          appId,
          protonVersion: report.protonVersion,
          normalized: av.normalized_version,
          status,
          matchedTool: av.matched_tool_name,
          closestTool: av.closest_tool_name,
          message: av.message,
        });
        setVersionStatus(status);
      })
      .catch((err) => {
        void logFrontendEvent('ERROR', 'Proton version availability check failed', {
          appId, protonVersion: report.protonVersion,
          error: err instanceof Error ? err.message : String(err),
        });
        setVersionStatus('unavailable');
      });
  }, [report.protonVersion, appId]);

  const handleApply = async () => {
    void logFrontendEvent('INFO', 'ReportDetail: Apply requested', {
      appId, appName, protonVersion: report.protonVersion,
    });
    setApplying(true);
    try {
      await onApply(report);
      const result = await getSteamAppDetails(appId);
      const newOptions = getLaunchOptionsFromDetails(result.details);
      setLaunchOptionsDisplay(newOptions);
      void logFrontendEvent('INFO', 'ReportDetail: Launch options refreshed after apply', {
        appId, launchOptions: newOptions,
      });
    } finally {
      setApplying(false);
    }
  };

  const handleUpvote = async () => {
    void logFrontendEvent('INFO', 'ReportDetail: Upvote requested', {
      appId, appName, protonVersion: report.protonVersion,
    });
    setUpvoting(true);
    try {
      await onUpvote(report);
    } finally {
      setUpvoting(false);
    }
  };

  const handleEditConfig = () => {
    void logFrontendEvent('INFO', 'ReportDetail: Opening edit modal', {
      appId, appName, protonVersion: report.protonVersion,
    });
    showModal(
      <EditReportModal
        report={report}
        onSave={(entry) => {
          onSaveEdit(entry);
          closeModal?.();
        }}
      />,
    );
  };

  const handleClearLaunchOptions = async () => {
    void logFrontendEvent('INFO', 'ReportDetail: Clearing launch options', { appId, appName });
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, '');
      setLaunchOptionsDisplay('');
      void logFrontendEvent('INFO', 'ReportDetail: Launch options cleared', { appId });
      toaster.toast({ title: 'Proton Pulse', body: 'Launch options cleared.' });
    } catch (e) {
      void logFrontendEvent('ERROR', 'ReportDetail: Failed to clear launch options', {
        appId, error: e instanceof Error ? e.message : String(e),
      });
      toaster.toast({
        title: 'Proton Pulse',
        body: `Failed to clear: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  };

  const statusEntry = versionStatus !== 'loading'
    ? VERSION_STATUS_STYLES[versionStatus]
    : null;

  const handleContentDirection = (evt: GamepadEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (evt.detail.button === GamepadButton.DIR_DOWN) {
      el.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
    } else if (evt.detail.button === GamepadButton.DIR_UP) {
      el.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
    }
  };

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>

        {/* ── Fixed header ── */}
        <div
          style={{
            flexShrink: 0,
            padding: '10px 16px 8px',
            borderBottom: '1px solid #2a3a4a',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <img
              src={STEAM_HEADER_URL(appId)}
              style={{ height: 36, borderRadius: 3, objectFit: 'cover' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#e8f4ff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {appName || `App ${appId}`}
              </div>
              <div style={{ fontSize: 10, color: '#7a9bb5' }}>AppID {appId}</div>
            </div>

            {/* Rating badge */}
            <span
              style={{
                background: ratingColor,
                color: '#111',
                borderRadius: 999,
                padding: '2px 9px',
                fontWeight: 700,
                fontSize: 10,
                textTransform: 'uppercase',
                flexShrink: 0,
              }}
            >
              {report.rating}
            </span>
          </div>

          {/* Proton version line + availability status */}
          <div style={{ fontSize: 11, color: '#ccc', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>
              {formatProtonLabel(report.protonVersion)}
              {' · '}
              {matchLabel(report.gpuTier, sysInfo?.gpu_vendor)}
              {' · '}
              {confScore}/10 confidence
            </span>
            {statusEntry && (
              <span
                style={{
                  background: statusEntry.bg,
                  color: '#fff',
                  borderRadius: 999,
                  padding: '1px 7px',
                  fontWeight: 700,
                  fontSize: 9,
                  whiteSpace: 'nowrap',
                }}
              >
                Proton version: {statusEntry.label}
              </span>
            )}
            {versionStatus === 'loading' && (
              <span style={{ fontSize: 9, color: '#7a9bb5' }}>checking…</span>
            )}
          </div>
        </div>

        {/* ── Action buttons (fixed, horizontal) ── */}
        <Focusable
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 8,
            padding: '8px 16px',
            borderBottom: '1px solid #2a3a4a',
          }}
        >
          <DialogButton
            onClick={handleApply}
            disabled={applying}
            style={{ flex: 1, fontSize: 11, padding: '6px 8px', minHeight: 0 }}
          >
            {applying ? <SteamSpinner /> : 'Apply Config'}
          </DialogButton>
          <DialogButton
            onClick={handleEditConfig}
            style={{ flex: 1, fontSize: 11, padding: '6px 8px', minHeight: 0 }}
          >
            Edit Config
          </DialogButton>
          <DialogButton
            onClick={handleUpvote}
            disabled={upvoting}
            style={{ flex: 1, fontSize: 11, padding: '6px 8px', minHeight: 0 }}
          >
            {upvoting ? <SteamSpinner /> : 'Upvote'}
          </DialogButton>
        </Focusable>

        {/* ── Scrollable info area ── */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '0 16px 16px',
          }}
        >
          <Focusable
            //@ts-expect-error -- focusWithin is valid at runtime but missing from type defs
            focusWithin={false}
            onGamepadDirection={handleContentDirection}
          >
            <InfoSection title="Launch">
              <InfoRow
                label="Launch Preview"
                value={buildLaunchOptionPreview(report.protonVersion)}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  padding: '5px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  fontSize: 12,
                  gap: 8,
                }}
              >
                <span style={{ color: '#9db0c4', flexShrink: 0 }}>Current Launch Options</span>
                <span style={{ color: '#e8f4ff', textAlign: 'right', wordBreak: 'break-word', flex: 1 }}>
                  {launchOptionsDisplay || 'No launch options set.'}
                </span>
                {launchOptionsDisplay && (
                  <DialogButton
                    onClick={handleClearLaunchOptions}
                    style={{
                      fontSize: 9,
                      padding: '2px 8px',
                      minWidth: 0,
                      width: 'auto',
                      flexShrink: 0,
                    }}
                  >
                    Clear
                  </DialogButton>
                )}
              </div>
            </InfoSection>

            <InfoSection title="Hardware Match">
              <InfoRow label="GPU" value={report.gpu || '—'} />
              <InfoRow label="OS" value={report.os || '—'} />
              <InfoRow label="Kernel" value={report.kernel || '—'} />
              <InfoRow label="Driver" value={report.gpuDriver || '—'} />
            </InfoSection>

            <InfoSection title="Report">
              <InfoRow label="Confidence" value={`${confScore}/10`} />
              <InfoRow label="GPU Tier" value={report.gpuTier.toUpperCase()} />
              <InfoRow label="Votes" value={String(report.upvotes)} />
              <InfoRow label="Submitted" value={formatTimestamp(report.timestamp)} />
              {report.isEdited && (
                <InfoRow label="Edited" value={report.editLabel || 'Custom variant'} />
              )}
              {report.notes && (
                <InfoRow label="Notes" value={report.notes} />
              )}
            </InfoSection>
          </Focusable>
        </div>

      </div>
    </ModalRoot>
  );
}
