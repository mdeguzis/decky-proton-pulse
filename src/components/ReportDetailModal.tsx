// src/components/ReportDetailModal.tsx
import { useState } from 'react';
import {
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  Field,
  DialogButton,
  SteamSpinner,
  showModal,
} from '@decky/ui';
import type { SystemInfo } from '../types';
import type { DisplayReportCard } from './ReportCard';
import { EditReportModal } from './EditReportModal';

// Temporary stub until ConfigureTab exports this in Task 3:
export interface EditedReportEntry {
  id: string;
  label: string;
  baseReportKey: string;
  report: import('../types').CdnReport;
  updatedAt: number;
}

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

const RATING_COLORS: Record<string, string> = {
  platinum: '#b0e0e6',
  gold: '#ffd700',
  silver: '#c0c0c0',
  bronze: '#cd7f32',
  borked: '#ff4444',
  pending: '#888888',
};

function formatProtonLabel(version: string): string {
  const trimmed = version.trim();
  if (/^ge-proton/i.test(trimmed)) return `Proton GE ${trimmed.replace(/^ge-proton/i, '')}`;
  return `Proton ${trimmed}`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function buildLaunchOptionPreview(protonVersion: string): string {
  return `PROTON_VERSION="${protonVersion}" %command%`;
}

function matchLabel(report: DisplayReportCard, sysInfo: SystemInfo | null): string {
  if (!sysInfo?.gpu_vendor || report.gpuTier === 'unknown') return 'Unknown GPU match';
  return report.gpuTier === sysInfo.gpu_vendor
    ? 'Matches your GPU vendor'
    : 'Different GPU vendor';
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

  const cappedScore = Math.min(100, report.score);
  const confScore = (cappedScore / 10).toFixed(1);
  const ratingColor = RATING_COLORS[report.rating] ?? '#888';

  const handleApply = async () => {
    setApplying(true);
    try {
      await onApply(report);
    } finally {
      setApplying(false);
    }
  };

  const handleUpvote = async () => {
    setUpvoting(true);
    try {
      await onUpvote(report);
    } finally {
      setUpvoting(false);
    }
  };

  const handleEditConfig = () => {
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

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <PanelSection>
        <PanelSectionRow>
          <Field
            label={appName || `App ${appId}`}
            description={`AppID ${appId}`}
            icon={
              <img
                src={STEAM_HEADER_URL(appId)}
                style={{ height: 40, borderRadius: 3, objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            }
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field
            label={formatProtonLabel(report.protonVersion)}
            description={`${matchLabel(report, sysInfo)} · ${confScore}/10 confidence`}
          >
            <span
              style={{
                background: ratingColor,
                color: '#111',
                borderRadius: 999,
                padding: '2px 9px',
                fontWeight: 700,
                fontSize: 10,
                textTransform: 'uppercase',
              }}
            >
              {report.rating}
            </span>
          </Field>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Actions">
        <PanelSectionRow>
          <DialogButton onClick={handleApply} disabled={applying}>
            {applying ? <SteamSpinner /> : 'Apply Config'}
          </DialogButton>
        </PanelSectionRow>
        <PanelSectionRow>
          <DialogButton onClick={handleEditConfig}>
            Edit Config
          </DialogButton>
        </PanelSectionRow>
        <PanelSectionRow>
          <DialogButton onClick={handleUpvote} disabled={upvoting}>
            {upvoting ? <SteamSpinner /> : 'Upvote'}
          </DialogButton>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Launch">
        <PanelSectionRow>
          <Field
            label="Launch Preview"
            description={buildLaunchOptionPreview(report.protonVersion)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field
            label="Current Launch Options"
            description={currentLaunchOptions || 'No launch options set.'}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Hardware Match">
        <PanelSectionRow>
          <Field label="GPU" description={report.gpu || '—'} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="OS" description={report.os || '—'} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Kernel" description={report.kernel || '—'} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Driver" description={report.gpuDriver || '—'} />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Report">
        <PanelSectionRow>
          <Field label="Confidence" description={`${confScore}/10`} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="GPU Tier" description={report.gpuTier.toUpperCase()} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Votes" description={String(report.upvotes)} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Submitted" description={formatTimestamp(report.timestamp)} />
        </PanelSectionRow>
        {report.isEdited && (
          <PanelSectionRow>
            <Field
              label="Edited"
              description={report.editLabel || 'Custom variant'}
            />
          </PanelSectionRow>
        )}
        {report.notes && (
          <PanelSectionRow>
            <Field label="Notes" description={report.notes} />
          </PanelSectionRow>
        )}
      </PanelSection>
    </ModalRoot>
  );
}
