// src/components/EditReportModal.tsx
import { useState, useEffect } from 'react';
import {
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  TextField,
  DialogButton,
  DropdownItem,
  SteamSpinner,
} from '@decky/ui';
import { toaster } from '@decky/api';
import type { DisplayReportCard } from './ReportCard';
import type { EditedReportEntry } from './tabs/ConfigureTab';
import { getProtonGeManagerState, installProtonGe } from '../lib/compatTools';
import { formatProtonLabel } from '../lib/reportFormatters';
import { logFrontendEvent } from '../lib/logger';
import { t } from '../lib/i18n';

const RATING_OPTIONS = ['platinum', 'gold', 'silver', 'bronze', 'borked', 'pending'] as const;

interface VersionOption {
  value: string;          // tag_name or internal_name — used as dropdown data
  displayName: string;    // human label, e.g. "Proton GE 9-27"
  installed: boolean;
  managed: boolean;       // true for GE releases we can install; false for Valve/custom
}

function buildVersionOptions(
  releases: { tag_name: string }[],
  installedTools: { directory_name: string; display_name: string; internal_name: string }[],
): VersionOption[] {
  // Build a lookup of installed tag_names for fast matching
  const installedTagSet = new Set<string>();
  for (const tool of installedTools) {
    if (tool.internal_name) installedTagSet.add(tool.internal_name.toLowerCase());
    if (tool.directory_name) installedTagSet.add(tool.directory_name.toLowerCase());
  }
  const isInstalled = (tag: string) => installedTagSet.has(tag.toLowerCase());

  // Releases → options (all GE releases are managed/installable)
  const releaseOptions: VersionOption[] = releases.map((r) => ({
    value: r.tag_name,
    displayName: formatProtonLabel(r.tag_name),
    installed: isInstalled(r.tag_name),
    managed: true,
  }));

  // Always include Proton-GE-Latest at the top if installed
  const geLatest = installedTools.find(
    (t) => t.directory_name === 'Proton-GE-Latest' || (t as any).managed_slot === 'latest',
  );
  const geLatestOption: VersionOption[] = geLatest
    ? [{
        value: 'Proton-GE-Latest',
        displayName: 'Proton-GE-Latest',
        installed: true,
        managed: true, // treated as managed — always use latest GE
      }]
    : [];

  // Installed tools that don't appear in releases (custom / Valve builds)
  const releaseTagSet = new Set(releases.map((r) => r.tag_name.toLowerCase()));
  const extraInstalled: VersionOption[] = installedTools
    .filter((t) =>
      !releaseTagSet.has((t.internal_name || t.directory_name).toLowerCase())
      && t.directory_name !== 'Proton-GE-Latest'
      && (t as any).managed_slot !== 'latest',
    )
    .map((t) => ({
      value: t.internal_name || t.directory_name,
      displayName: t.display_name || t.directory_name,
      installed: true,
      managed: false, // Valve/custom builds — not installable via GE manager
    }));

  // Combine: GE-Latest first, then installed, then available
  const combined = [...geLatestOption, ...extraInstalled, ...releaseOptions];
  combined.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return 0;
  });
  return combined;
}

function VersionOptionLabel({ name, installed, managed }: { name: string; installed: boolean; managed: boolean }) {
  const statusLabel = installed ? t().detail.installed : managed ? t().detail.notInstalled : t().detail.valveProton;
  const statusColor = installed ? '#4caf50' : managed ? '#f59e0b' : '#4a6a8a';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 8 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: statusColor,
          flexShrink: 0,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
        }}
      >
        {statusLabel}
      </span>
    </div>
  );
}

export interface EditReportModalProps {
  closeModal?: () => void;
  report: DisplayReportCard;
  onSave: (entry: EditedReportEntry) => void;
}

export function EditReportModal({ closeModal, report, onSave }: EditReportModalProps) {
  const [label, setLabel]               = useState('');
  const [protonVersion, setProtonVersion] = useState(report.protonVersion);
  const [rating, setRating]             = useState(report.rating);
  const [gpu, setGpu]                   = useState(report.gpu);
  const [gpuDriver, setGpuDriver]       = useState(report.gpuDriver);
  const [os, setOs]                     = useState(report.os);
  const [kernel, setKernel]             = useState(report.kernel);
  const [ram, setRam]                   = useState(report.ram);
  const [notes, setNotes]               = useState(report.notes);

  const [versionOptions, setVersionOptions] = useState<VersionOption[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    getProtonGeManagerState(false)
      .then((state) => {
        const opts = buildVersionOptions(state.releases, state.installed_tools);

        // If the report's current version isn't in the list, add it at the top
        const currentNorm = report.protonVersion.toLowerCase();
        const found = opts.some((o) => o.value.toLowerCase() === currentNorm);
        if (!found) {
          const isGe = /ge/i.test(report.protonVersion);
          opts.unshift({
            value: report.protonVersion,
            displayName: formatProtonLabel(report.protonVersion),
            installed: false,
            managed: isGe, // only GE versions are installable
          });
        }

        setVersionOptions(opts);
        setLoadingVersions(false);
      })
      .catch((err) => {
        void logFrontendEvent('WARNING', 'Failed to load Proton versions for EditReportModal', {
          error: err instanceof Error ? err.message : String(err),
        });
        // Fallback: just the report's current version
        setVersionOptions([{
          value: report.protonVersion,
          displayName: formatProtonLabel(report.protonVersion),
          installed: false,
          managed: /ge/i.test(report.protonVersion),
        }]);
        setLoadingVersions(false);
      });
  }, [report.protonVersion]);

  const handleVersionChange = (nextVersion: string) => {
    void logFrontendEvent('DEBUG', 'EditReport: Proton version changed', {
      previousVersion: protonVersion, nextVersion,
    });
    setProtonVersion(nextVersion);
    const opt = versionOptions.find((o) => o.value === nextVersion);
    if (opt && !opt.installed && opt.managed) {
      setInstalling(nextVersion);
      void logFrontendEvent('INFO', 'Auto-installing Proton version from edit modal', {
        version: nextVersion,
      });
      installProtonGe(nextVersion)
        .then((result) => {
          if (result.success) {
            toaster.toast({
              title: 'Proton Pulse',
              body: result.already_installed
                ? t().toast.alreadyInstalled(nextVersion)
                : t().toast.installed(nextVersion),
            });
            setVersionOptions((prev) =>
              prev.map((o) => (o.value === nextVersion ? { ...o, installed: true } : o)),
            );
          } else {
            toaster.toast({
              title: 'Proton Pulse',
              body: t().toast.installFailed(result.message),
            });
          }
        })
        .catch((err) => {
          toaster.toast({
            title: 'Proton Pulse',
            body: t().toast.installFailed(err instanceof Error ? err.message : String(err)),
          });
        })
        .finally(() => setInstalling(null));
    }
  };

  const handleClearEdits = () => {
    void logFrontendEvent('INFO', 'EditReport: Reset to original values', {
      protonVersion: report.protonVersion,
    });
    setLabel('');
    setProtonVersion(report.protonVersion);
    setRating(report.rating);
    setGpu(report.gpu);
    setGpuDriver(report.gpuDriver);
    setOs(report.os);
    setKernel(report.kernel);
    setRam(report.ram);
    setNotes(report.notes);
  };

  const handleSave = () => {
    void logFrontendEvent('INFO', 'EditReport: Saving edited report', {
      label: label.trim(), protonVersion, rating,
    });
    const entry: EditedReportEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim(),
      baseReportKey: `${report.timestamp}_${report.protonVersion}`,
      report: {
        appId: report.appId,
        cpu: report.cpu,
        duration: report.duration,
        gpu,
        gpuDriver,
        kernel,
        notes,
        os,
        protonVersion,
        ram,
        rating,
        timestamp: report.timestamp,
        title: report.title,
      },
      updatedAt: Date.now(),
    };
    onSave(entry);
    closeModal?.();
  };

  const dropdownOptions = versionOptions.map((opt) => ({
    data: opt.value,
    label: <VersionOptionLabel name={opt.displayName} installed={opt.installed} managed={opt.managed} />,
  }));

  return (
    <ModalRoot onCancel={closeModal}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#e8f4ff' }}>{t().editReport.title}</div>
        <DialogButton
          onClick={handleClearEdits}
          style={{ fontSize: 10, padding: '3px 10px', minWidth: 0, width: 'auto' }}
        >
          {t().editReport.resetToOriginal}
        </DialogButton>
      </div>
      <PanelSection>
        <PanelSectionRow>
          <TextField
            label={t().editReport.label}
            description={t().editReport.labelDescription}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            bShowClearAction
          />
        </PanelSectionRow>
        <PanelSectionRow>
          {loadingVersions ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <SteamSpinner style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 11, color: '#7a9bb5' }}>{t().common.loading}</span>
            </div>
          ) : (
            <DropdownItem
              label={installing ? t().detail.installing(installing) : t().detail.protonVersion}
              rgOptions={dropdownOptions}
              selectedOption={protonVersion}
              onChange={(opt) => handleVersionChange(opt.data)}
              disabled={!!installing}
            />
          )}
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            label={t().editReport.rating}
            rgOptions={RATING_OPTIONS.map((r) => ({ data: r, label: r }))}
            selectedOption={rating}
            onChange={(opt) => setRating(opt.data)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label={t().detail.gpu}
            value={gpu}
            onChange={(e) => setGpu(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label={t().detail.driver}
            value={gpuDriver}
            onChange={(e) => setGpuDriver(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label={t().detail.os}
            value={os}
            onChange={(e) => setOs(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label={t().detail.kernel}
            value={kernel}
            onChange={(e) => setKernel(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="RAM"
            value={ram}
            onChange={(e) => setRam(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label={t().reports.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            bShowClearAction
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection>
        <PanelSectionRow>
          <DialogButton onClick={handleSave} disabled={!!installing}>
            {installing ? t().common.loading : t().editReport.saveEdits}
          </DialogButton>
        </PanelSectionRow>
      </PanelSection>
    </ModalRoot>
  );
}
