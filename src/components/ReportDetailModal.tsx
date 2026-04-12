// src/components/ReportDetailModal.tsx
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ModalRoot, Focusable, DialogButton, SteamSpinner, GamepadButton, showModal } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { callable } from '@decky/api';
import { toaster } from '../lib/notify';
import type { SystemInfo } from '../types';
import type { DisplayReportCard } from './ReportCard';
import type { EditedReportEntry } from './tabs/ConfigureTab';
import { EditReportModal } from './EditReportModal';
import { ProtonDBSubmitModal } from './ProtonDBSubmitModal';
import {
  RATING_COLORS,
  formatProtonLabel,
  formatTimestamp,
  buildLaunchOptionPreview,
} from '../lib/reportFormatters';
import { getHardwareMatchPercent, getHardwareMatchBreakdown, matchColor, type FieldMatchInfo } from '../lib/scoring';
import { getSteamAppDetails, getLaunchOptionsFromDetails, isSteamShortcutApp } from '../lib/steamApps';
import { checkProtonVersionAvailability } from '../lib/compatTools';
import { logFrontendEvent } from '../lib/logger';
import { getUserVote } from '../lib/voting';
import { t } from '../lib/i18n';
import { registerScreenshotAutomationHandler } from '../lib/screenshotAutomation';

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

function SectionHeader({
  title,
  action,
  caption,
}: {
  title: string;
  action?: ReactNode;
  caption?: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '10px 0 4px',
          borderBottom: '1px solid #2a3a4a',
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: '#7a9bb5',
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            flex: 1,
          }}
        >
          {title}
        </div>
        {action}
      </div>
      {caption ? (
        <div style={{ fontSize: 10, color: '#8ea6bc', paddingTop: 6 }}>
          {caption}
        </div>
      ) : null}
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

const HW_SCROLL_STEP = 80;

const getGameRequirements = callable<[string], { min_ram_gb: number | null }>('get_game_requirements');

function HardwareCompareModal({
  closeModal,
  report,
  sysInfo,
}: {
  closeModal?: () => void;
  report: DisplayReportCard;
  sysInfo: SystemInfo | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gameMinRamGb, setGameMinRamGb] = useState<number | null>(null);

  useEffect(() => {
    if (!report.appId) return;
    getGameRequirements(report.appId)
      .then((reqs) => setGameMinRamGb(reqs.min_ram_gb))
      .catch(() => {}); // silently fall back to no game requirements
  }, [report.appId]);

  const systemRam = sysInfo?.ram_gb ? `${sysInfo.ram_gb} GB` : '-';
  const systemGpuTier = sysInfo?.gpu_vendor ? sysInfo.gpu_vendor.toUpperCase() : '-';
  const hardwareMatchPercent = getHardwareMatchPercent(report, sysInfo);
  const matchBadgeStyle = getHardwareMatchBadgeStyle(hardwareMatchPercent);
  const breakdown = getHardwareMatchBreakdown(report, sysInfo, gameMinRamGb);

  // confidence score for this report (same as the card shows)
  const cappedScore = Math.min(100, report.score);
  const confScore = (cappedScore / 10).toFixed(1);

  // GPU tier match: same vendor = 100%, unknown = 50%, mismatch = 0%
  const reportTier = report.gpuTier.toLowerCase();
  const sysTier = (sysInfo?.gpu_vendor ?? '').toLowerCase();
  const tierPercent = (!reportTier || reportTier === 'unknown' || !sysTier)
    ? 50
    : reportTier === sysTier ? 100 : 0;
  const tierMatch: FieldMatchInfo = { percent: tierPercent, color: matchColor(tierPercent) };

  return (
    <ModalRoot
      onCancel={closeModal}
      bAllowFullSize
      className="proton-pulse-hw-compare-modal"
      modalClassName="proton-pulse-hw-compare-modal"
    >
      <style>{`
        .proton-pulse-hw-compare-modal,
        .proton-pulse-hw-compare-modal > div,
        .proton-pulse-hw-compare-modal .DialogContent_InnerWidth {
          padding: 0 !important;
          margin: 0 !important;
          max-width: 100vw !important;
          width: 100vw !important;
          max-height: 100vh !important;
        }
        .proton-pulse-hw-compare-modal .ModalPosition { inset: 0 !important; }
      `}</style>
      {/* Focusable wraps the whole modal so D-pad events from the X button
           bubble up here. The DialogButton is the only focusable child, so
           Steam auto-focuses it on open and gamepad events always fire. */}
      <Focusable
        onGamepadDirection={(evt: GamepadEvent) => {
          const btn = evt.detail.button;
          void logFrontendEvent('DEBUG', 'HWCompare: gamepad direction', { button: btn });
          // block left/right so we don't navigate away from the modal
          if (btn === GamepadButton.DIR_LEFT || btn === GamepadButton.DIR_RIGHT) {
            evt.preventDefault();
            return;
          }
          const el = scrollRef.current;
          if (!el) {
            void logFrontendEvent('DEBUG', 'HWCompare: scrollRef is null');
            return;
          }
          void logFrontendEvent('DEBUG', 'HWCompare: scroll state', {
            scrollTop: Math.round(el.scrollTop),
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          });
          if (btn === GamepadButton.DIR_DOWN) {
            evt.preventDefault();
            el.scrollBy({ top: HW_SCROLL_STEP, behavior: 'auto' });
          } else if (btn === GamepadButton.DIR_UP) {
            evt.preventDefault();
            el.scrollBy({ top: -HW_SCROLL_STEP, behavior: 'auto' });
          }
        }}
        style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}
      >
        {/* fixed header */}
        <div
          style={{
            flexShrink: 0,
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            borderBottom: '1px solid #2a3a4a',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#e8f4ff' }}>
              {t().detail.hardwareComparisonTitle}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                borderRadius: 999,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                background: 'rgba(100, 149, 237, 0.15)',
                color: '#6495ed',
              }}
            >
              {t().extras!.confidenceOutOfTen(confScore)}
            </div>
            <div
              style={{
                ...matchBadgeStyle,
                borderRadius: 999,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {t().detail.hardwareMatchPercent(hardwareMatchPercent)}
            </div>
            <DialogButton
              onClick={closeModal}
              style={{
                height: 32,
                width: 32,
                minWidth: 32,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
              }}
            >
              X
            </DialogButton>
          </div>
        </div>

        {/* scrollable body */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <div style={{ fontSize: 12, color: '#9db0c4', marginBottom: 14, lineHeight: 1.5 }}>
            {t().detail.hardwareComparisonDescription}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '90px minmax(0, 1fr) minmax(0, 1fr) 60px',
              gap: 0,
              border: '1px solid #2a3a4a',
              borderRadius: 8,
              overflow: 'hidden',
              background: 'rgba(13, 19, 28, 0.96)',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ padding: '10px 12px', background: '#162333' }} />
            <div style={{ padding: '10px 12px', background: '#162333', color: '#e8f4ff', fontWeight: 700 }}>
              {t().detail.report}
            </div>
            <div style={{ padding: '10px 12px', background: '#162333', color: '#e8f4ff', fontWeight: 700 }}>
              {t().detail.ourSystem}
            </div>
            <div style={{ padding: '10px 12px', background: '#162333', color: '#e8f4ff', fontWeight: 700, textAlign: 'center', fontSize: 11 }}>
              {t().detail.match}
            </div>

            <InfoCompareRow label={t().detail.gpu} left={report.gpu || '-'} right={sysInfo?.gpu || '-'} match={breakdown.gpu} />
            <InfoCompareRow label={t().detail.gpuTier} left={report.gpuTier.toUpperCase()} right={systemGpuTier} match={tierMatch} />
            <InfoCompareRow label={t().detail.driver} left={report.gpuDriver || '-'} right={sysInfo?.driver_version || '-'} match={breakdown.gpuDriver} />
            <InfoCompareRow label={t().detail.cpu} left={report.cpu || '-'} right={sysInfo?.cpu || '-'} match={breakdown.cpu} />
            <InfoCompareRow label={t().detail.os} left={report.os || '-'} right={sysInfo?.distro || '-'} match={breakdown.os} />
            <InfoCompareRow label={t().detail.kernel} left={report.kernel || '-'} right={sysInfo?.kernel || '-'} match={breakdown.kernel} />
            <InfoCompareRow
              label={gameMinRamGb ? `${t().detail.ram} (min: ${gameMinRamGb}GB)` : t().detail.ram}
              left={report.ram || '-'}
              right={systemRam}
              match={breakdown.ram}
            />
          </div>
        </div>
      </Focusable>
    </ModalRoot>
  );
}

function InfoCompareRow({
  label,
  left,
  right,
  match,
}: {
  label: string;
  left: string;
  right: string;
  match?: FieldMatchInfo;
}) {
  return (
    <>
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          color: '#9db0c4',
          fontSize: 12,
        }}
      >
        {label}
      </div>
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderLeft: '1px solid rgba(255,255,255,0.04)',
          color: '#e8f4ff',
          fontSize: 12,
          wordBreak: 'break-word',
        }}
      >
        {left}
      </div>
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderLeft: '1px solid rgba(255,255,255,0.04)',
          color: '#e8f4ff',
          fontSize: 12,
          wordBreak: 'break-word',
        }}
      >
        {right}
      </div>
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderLeft: '1px solid rgba(255,255,255,0.04)',
          textAlign: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: match?.color ?? '#555',
        }}
      >
        {match ? `${match.percent}%` : ''}
      </div>
    </>
  );
}

function getHardwareMatchBadgeStyle(percent: number): { background: string; color: string } {
  if (percent >= 75) return { background: '#2f6f4f', color: '#ecfff1' };
  if (percent >= 45) return { background: '#7d6123', color: '#fff5dc' };
  return { background: '#7a2f34', color: '#ffe8ea' };
}

function buildEditedReportEntry(report: DisplayReportCard): EditedReportEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: '',
    baseReportKey: `${report.timestamp}_${report.protonVersion}`,
    report: {
      appId: report.appId,
      cpu: report.cpu,
      duration: report.duration,
      gpu: report.gpu,
      gpuDriver: report.gpuDriver,
      kernel: report.kernel,
      notes: report.notes,
      os: report.os,
      protonVersion: report.protonVersion,
      ram: report.ram,
      rating: report.rating,
      timestamp: report.timestamp,
      title: report.title,
    },
    updatedAt: Date.now(),
  };
}

function UploadDestinationModal({
  closeModal,
  onUploadToProtonDB,
  onUploadToProtonPulse,
  protonPulseDisabled,
}: {
  closeModal?: () => void;
  onUploadToProtonDB: () => void;
  onUploadToProtonPulse: () => void;
  protonPulseDisabled: boolean;
}) {
  return (
    <ModalRoot onCancel={closeModal}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 340 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e8f4ff' }}>
          {t().detail.uploadDestinationTitle}
        </div>
        <DialogButton onClick={onUploadToProtonDB}>
          {t().detail.uploadToProtonDB}
        </DialogButton>
        <DialogButton onClick={onUploadToProtonPulse} disabled={protonPulseDisabled}>
          {t().detail.uploadToProtonPulse}
        </DialogButton>
        <DialogButton onClick={closeModal} style={{ background: '#555' }}>
          {t().common.cancel}
        </DialogButton>
      </div>
    </ModalRoot>
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
  onUpvote: (report: DisplayReportCard) => Promise<boolean>;
  onDownvote?: (report: DisplayReportCard) => Promise<boolean>;
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
  onDownvote,
  onSaveEdit,
}: ReportDetailModalProps) {
  const strings = t();
  const extras = strings.extras!;
  const isShortcut = isSteamShortcutApp(appId);
  const [applying, setApplying] = useState(false);
  const [voting, setVoting] = useState(false);
  const [localUpvotes, setLocalUpvotes] = useState(report.upvotes);
  const [localDownvotes, setLocalDownvotes] = useState(report.downvotes);
  const [userVote, setUserVote] = useState<1 | -1 | null>(null);
  const [launchOptionsDisplay, setLaunchOptionsDisplay] = useState(currentLaunchOptions);
  const [versionStatus, setVersionStatus] = useState<'loading' | 'installed' | 'installable' | 'unavailable' | 'unmanaged'>('loading');
  const scrollRef = useRef<HTMLDivElement>(null);
  const compareButtonRef = useRef<HTMLElement | null>(null);
  const clearButtonRef = useRef<HTMLElement | null>(null);
  const hardwareSectionRef = useRef<HTMLDivElement>(null);
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

  // fetch user's existing vote on mount
  useEffect(() => {
    const key = `${report.timestamp}_${report.protonVersion}`;
    getUserVote(String(appId), key).then(v => {
      if (v) setUserVote(v);
    }).catch(() => {});
  }, [appId, report.timestamp, report.protonVersion]);

  const handleUpvote = async () => {
    if (userVote === 1) {
      toaster.toast({ title: 'Proton Pulse', body: extras.alreadyUpvoted() });
      return;
    }
    void logFrontendEvent('INFO', 'ReportDetail: Upvote requested', {
      appId, appName, protonVersion: report.protonVersion,
    });
    setVoting(true);
    try {
      const ok = await onUpvote(report);
      if (!ok) return;
      // if switching from downvote, adjust both counts
      if (userVote === -1) {
        setLocalDownvotes(prev => Math.max(0, prev - 1));
      }
      setLocalUpvotes(prev => prev + 1);
      setUserVote(1);
    } finally {
      setVoting(false);
    }
  };

  const handleDownvote = async () => {
    if (userVote === -1) {
      toaster.toast({ title: 'Proton Pulse', body: extras.alreadyDownvoted() });
      return;
    }
    if (!onDownvote) return;
    void logFrontendEvent('INFO', 'ReportDetail: Downvote requested', {
      appId, appName, protonVersion: report.protonVersion,
    });
    setVoting(true);
    try {
      const ok = await onDownvote(report);
      if (!ok) return;
      if (userVote === 1) {
        setLocalUpvotes(prev => Math.max(0, prev - 1));
      }
      setLocalDownvotes(prev => prev + 1);
      setUserVote(-1);
    } finally {
      setVoting(false);
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

  const handleOpenHardwareCompare = () => {
    showModal(
      <HardwareCompareModal
        report={report}
        sysInfo={sysInfo}
      />,
    );
  };

  const handleUploadToProtonDB = () => {
    void logFrontendEvent('INFO', 'ReportDetail: Opening ProtonDB submit modal', {
      appId,
      appName,
      reportTimestamp: report.timestamp,
      protonVersion: report.protonVersion,
    });
    showModal(
      <ProtonDBSubmitModal
        appId={appId}
        appName={appName || report.title}
      />,
    );
  };

  const handleUploadToProtonPulse = () => {
    if (report.isEdited) {
      toaster.toast({ title: 'Proton Pulse', body: t().toast.alreadyInProtonPulse });
      return;
    }
    onSaveEdit(buildEditedReportEntry(report));
    toaster.toast({ title: 'Proton Pulse', body: t().toast.savedToProtonPulse });
  };

  const handleUpload = () => {
    showModal(
      <UploadDestinationModal
        onUploadToProtonDB={handleUploadToProtonDB}
        onUploadToProtonPulse={handleUploadToProtonPulse}
        protonPulseDisabled={Boolean(report.isEdited)}
      />,
    );
  };

  useEffect(() => registerScreenshotAutomationHandler('manage-game/report-detail/edit-modal', async () => {
    handleEditConfig();
  }), [report, appId, appName]);

  useEffect(() => registerScreenshotAutomationHandler('manage-game/report-detail/hardware-compare', async () => {
    if (!sysInfo) {
      throw new Error('System info is not loaded for the hardware comparison screenshot.');
    }
    handleOpenHardwareCompare();
  }), [report, sysInfo]);

  const statusEntry = versionStatus !== 'loading'
    ? getVersionStatusStyles()[versionStatus]
    : null;

  // Handle all gamepad directions from the button bar.
  // UP/DOWN scroll the content area directly (Steam can't focus-navigate to
  // plain content, so we handle it here). LEFT/RIGHT navigate between buttons.
  const handleButtonBarDirection = (evt: GamepadEvent) => {
    const btn = evt.detail.button;
    void logFrontendEvent('DEBUG', 'ReportDetail: gamepad direction', { button: btn });

    if (btn === GamepadButton.DIR_DOWN && compareButtonRef.current) {
      evt.preventDefault();
      hardwareSectionRef.current?.scrollIntoView({ block: 'start' });
      compareButtonRef.current.focus();
      return;
    }

    if (btn === GamepadButton.DIR_UP) {
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
      el.scrollBy({ top: el.scrollTop <= SCROLL_STEP ? -el.scrollTop : -SCROLL_STEP, behavior: 'auto' });
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
              <div style={{ fontSize: 10, color: '#7a9bb5' }}>
                {isShortcut ? extras.nonSteamShortcut() : extras.appIdLabel(appId)}
              </div>
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
              {strings.ratings[report.rating]}
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
              {extras.confidenceOutOfTen(confScore)}
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
            onClick={handleUpload}
            style={{ flex: 1, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0 }}
          >
            {t().detail.upload}
          </DialogButton>
          <DialogButton
            onClick={() => {
              if (!launchOptionsDisplay) {
                toaster.toast({ title: 'Proton Pulse', body: t().toast.noOptionsSet });
                return;
              }
              void handleClearLaunchOptions();
            }}
            ref={(node) => {
              clearButtonRef.current = node;
            }}
            style={{ flex: 1, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0 }}
          >
            {t().detail.clear}
          </DialogButton>
          <DialogButton
            onClick={handleUpvote}
            disabled={voting || userVote === 1}
            style={{
              flex: 0.5, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              opacity: userVote === 1 ? 0.4 : 1,
            }}
          >
            {voting ? <SteamSpinner /> : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66a4.8 4.8 0 0 0-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84C7 18.95 8.05 20 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z" />
                </svg>
                <span>{localUpvotes}</span>
              </>
            )}
          </DialogButton>
          <DialogButton
            onClick={handleDownvote}
            disabled={voting || userVote === -1}
            style={{
              flex: 0.5, fontSize: 10, padding: '5px 4px', minHeight: 0, minWidth: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              opacity: userVote === -1 ? 0.4 : 1,
            }}
          >
            {voting ? <SteamSpinner /> : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.5l-.92 4.65c-.05.22-.02.46.08.66.23.45.52.86.88 1.22L10 22l6.41-6.41c.38-.38.59-.89.59-1.42V6.34C17 5.05 15.95 4 14.66 4h-8.1c-.71 0-1.36.37-1.72.97l-2.67 6.15z" />
                </svg>
                <span>{localDownvotes}</span>
              </>
            )}
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

            <div ref={hardwareSectionRef}>
              <SectionHeader
                title={t().detail.hardwareMatch}
                caption={t().detail.hardwareMatchCaption}
                action={(
                  <DialogButton
                    ref={(node) => {
                      compareButtonRef.current = node;
                    }}
                    onClick={handleOpenHardwareCompare}
                    onGamepadDirection={(evt) => {
                      if (evt.detail.button === GamepadButton.DIR_UP) {
                        evt.preventDefault();
                        clearButtonRef.current?.focus();
                      }
                    }}
                    disabled={!sysInfo}
                    style={{
                      flex: '0 0 auto',
                      width: 'fit-content',
                      minWidth: 116,
                      maxWidth: 132,
                      fontSize: 9,
                      minHeight: 0,
                      padding: '2px 12px',
                      whiteSpace: 'nowrap',
                      alignSelf: 'flex-start',
                    }}
                  >
                    {t().detail.systemComparison}
                  </DialogButton>
                )}
              />
            </div>
            <InfoSection title={t().detail.reportHardware}>
              <InfoRow label={t().detail.gpu} value={report.gpu || '-'} />
              <InfoRow label={t().detail.os} value={report.os || '-'} />
              <InfoRow label={t().detail.kernel} value={report.kernel || '-'} />
              <InfoRow label={t().detail.driver} value={report.gpuDriver || '-'} />
            </InfoSection>

            <InfoSection title={t().detail.report}>
              <InfoRow label={t().reports.confidence} value={`${confScore}/10`} />
              <InfoRow label={t().detail.gpuTier} value={report.gpuTier.toUpperCase()} />
              <InfoRow label={t().reports.votes} value={`+${localUpvotes} / -${localDownvotes}`} />
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
