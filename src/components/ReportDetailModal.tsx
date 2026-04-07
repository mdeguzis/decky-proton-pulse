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
} from '../lib/reportFormatters';
import { getSteamAppDetails, getLaunchOptionsFromDetails } from '../lib/steamApps';
import { checkProtonVersionAvailability } from '../lib/compatTools';
import { logFrontendEvent } from '../lib/logger';
import { t } from '../lib/i18n';

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

const SCROLL_STEP = 50;

function getVersionStatusStyles(): Record<string, { bg: string; label: string }> {
  return {
    installed:   { bg: '#4caf50', label: t().detail.installed },
    installable: { bg: '#f59e0b', label: t().detail.notInstalled },
    unavailable: { bg: '#6b7280', label: t().detail.unavailable },
    unmanaged:   { bg: '#4a6a8a', label: t().detail.valveProton },
  };
}

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
  onDownvote?: (report: DisplayReportCard) => Promise<void>;
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

  // Scroll to top on mount so D-pad scrolling starts from a known position
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, []);

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
      toaster.toast({ title: 'Proton Pulse', body: t().toast.cleared });
    } catch (e) {
      void logFrontendEvent('ERROR', 'ReportDetail: Failed to clear launch options', {
        appId, error: e instanceof Error ? e.message : String(e),
      });
      toaster.toast({
        title: 'Proton Pulse',
        body: t().toast.clearFailed(e instanceof Error ? e.message : String(e)),
      });
    }
  };

  const statusEntry = versionStatus !== 'loading'
    ? getVersionStatusStyles()[versionStatus]
    : null;

  // Handle all gamepad directions from the button bar.
  // UP/DOWN scroll the content area directly (Steam can't focus-navigate to
  // plain content, so we handle it here). LEFT/RIGHT navigate between buttons.
  const handleButtonBarDirection = (evt: GamepadEvent) => {
    const btn = evt.detail.button;
    void logFrontendEvent('DEBUG', 'ReportDetail: gamepad direction', { button: btn });

    if (btn === GamepadButton.DIR_DOWN || btn === GamepadButton.DIR_UP) {
      const el = scrollRef.current;
      if (!el) {
        void logFrontendEvent('DEBUG', 'ReportDetail: scrollRef is null');
        return;
      }
      void logFrontendEvent('DEBUG', 'ReportDetail: scroll state', {
        scrollTop: Math.round(el.scrollTop),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        canScroll: el.scrollHeight > el.clientHeight,
      });
      if (btn === GamepadButton.DIR_DOWN) {
        const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
        el.scrollBy({ top: remaining <= SCROLL_STEP ? remaining : SCROLL_STEP, behavior: 'auto' });
      } else {
        el.scrollBy({ top: el.scrollTop <= SCROLL_STEP ? -el.scrollTop : -SCROLL_STEP, behavior: 'auto' });
      }
    }
    // LEFT/RIGHT: don't interfere -- let Steam navigate between buttons
  };

  return (
    <ModalRoot
      onCancel={closeModal}
      bAllowFullSize
      className="proton-pulse-detail-modal"
      modalClassName="proton-pulse-detail-modal"
    >
      <style>{`
        .proton-pulse-detail-modal,
        .proton-pulse-detail-modal > div,
        .proton-pulse-detail-modal .DialogContent_InnerWidth {
          padding: 0 !important;
          margin: 0 !important;
          max-width: 100vw !important;
          width: 100vw !important;
          max-height: 100vh !important;
        }
        .proton-pulse-detail-modal .ModalPosition { inset: 0 !important; }
      `}</style>
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
              {(!sysInfo?.gpu_vendor || report.gpuTier === 'unknown')
                ? t().detail.unknownGpu
                : report.gpuTier === sysInfo.gpu_vendor
                  ? t().detail.matchesGpu
                  : t().detail.differentGpu}
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
                {t().detail.protonVersion}: {statusEntry.label}
              </span>
            )}
            {versionStatus === 'loading' && (
              <span style={{ fontSize: 9, color: '#7a9bb5' }}>{t().detail.checking}</span>
            )}
          </div>
        </div>

        {/* ── Action buttons (fixed, horizontal) ── */}
        <Focusable
          onGamepadDirection={handleButtonBarDirection}
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 6,
            padding: '6px 12px',
            borderBottom: '1px solid #2a3a4a',
          }}
        >
          <DialogButton
            onClick={handleApply}
            disabled={applying}
            style={{ flex: 1, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0 }}
          >
            {applying ? <SteamSpinner /> : t().detail.apply}
          </DialogButton>
          <DialogButton
            onClick={handleEditConfig}
            style={{ flex: 1, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0 }}
          >
            {t().detail.edit}
          </DialogButton>
          <DialogButton
            onClick={handleUpvote}
            disabled={upvoting}
            style={{ flex: 0.5, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          >
            {upvoting ? <SteamSpinner /> : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66a4.8 4.8 0 0 0-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84C7 18.95 8.05 20 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z" />
                </svg>
                <span>{report.upvotes}</span>
              </>
            )}
          </DialogButton>
          <DialogButton
            style={{ flex: 0.5, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: 0.35 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.5l-.92 4.65c-.05.22-.02.46.08.66.23.45.52.86.88 1.22L10 22l6.41-6.41c.38-.38.59-.89.59-1.42V6.34C17 5.05 15.95 4 14.66 4h-8.1c-.71 0-1.36.37-1.72.97l-2.67 6.15z" />
            </svg>
            <span>0</span>
          </DialogButton>
          <DialogButton
            onClick={() => {
              if (!launchOptionsDisplay) {
                toaster.toast({ title: 'Proton Pulse', body: t().toast.noOptionsSet });
                return;
              }
              void handleClearLaunchOptions();
            }}
            style={{ flex: 1, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0 }}
          >
            {t().detail.clear}
          </DialogButton>
        </Focusable>

        {/* ── Scrollable info area (scrolled by button bar D-pad) ── */}
        <div
          ref={scrollRef}
          tabIndex={0}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '0 16px 120px',
            outline: 'none',
          }}
        >
            <InfoSection title={t().detail.launchPreview}>
              <InfoRow
                label={t().detail.launchPreview}
                value={buildLaunchOptionPreview(report.protonVersion)}
              />
              <InfoRow
                label={t().detail.currentLaunchOptions}
                value={launchOptionsDisplay || t().detail.noLaunchOptions}
              />
            </InfoSection>

            <InfoSection title={t().detail.hardwareMatch}>
              <InfoRow label={t().detail.gpu} value={report.gpu || '-'} />
              <InfoRow label={t().detail.os} value={report.os || '-'} />
              <InfoRow label={t().detail.kernel} value={report.kernel || '-'} />
              <InfoRow label={t().detail.driver} value={report.gpuDriver || '-'} />
            </InfoSection>

            <InfoSection title={t().detail.report}>
              <InfoRow label={t().reports.confidence} value={`${confScore}/10`} />
              <InfoRow label={t().detail.gpuTier} value={report.gpuTier.toUpperCase()} />
              <InfoRow label={t().reports.votes} value={String(report.upvotes)} />
              <InfoRow label={t().reports.submitted} value={formatTimestamp(report.timestamp)} />
              {report.isEdited && (
                <InfoRow label={t().detail.edited} value={report.editLabel || t().detail.customVariant} />
              )}
              {report.notes && (
                <InfoRow label={t().reports.notes} value={report.notes} />
              )}
            </InfoSection>

            {/* End-of-content ruler */}
            <div style={{
              height: 2,
              background: 'rgba(255,255,255,0.4)',
              marginTop: 12,
              borderRadius: 1,
            }} />
        </div>

      </div>
    </ModalRoot>
  );
}
