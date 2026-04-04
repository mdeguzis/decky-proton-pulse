// src/components/EditReportModal.tsx
import { useState } from 'react';
import {
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  TextField,
  DialogButton,
  DropdownItem,
} from '@decky/ui';
import type { DisplayReportCard } from './ReportCard';
import type { EditedReportEntry } from './ReportDetailModal';

const RATING_OPTIONS = ['platinum', 'gold', 'silver', 'bronze', 'borked', 'pending'] as const;

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

  const handleSave = () => {
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

  return (
    <ModalRoot onCancel={closeModal}>
      <PanelSection title="Edit Report">
        <PanelSectionRow>
          <TextField
            label="Label"
            description="Short name for this custom variant"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            bShowClearAction
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="Proton Version"
            value={protonVersion}
            onChange={(e) => setProtonVersion(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            label="Rating"
            rgOptions={RATING_OPTIONS.map((r) => ({ data: r, label: r }))}
            selectedOption={rating}
            onChange={(opt) => setRating(opt.data)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="GPU"
            value={gpu}
            onChange={(e) => setGpu(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="GPU Driver"
            value={gpuDriver}
            onChange={(e) => setGpuDriver(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="OS"
            value={os}
            onChange={(e) => setOs(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="Kernel"
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
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            bShowClearAction
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection>
        <PanelSectionRow>
          <DialogButton onClick={handleSave}>
            Save Edits
          </DialogButton>
        </PanelSectionRow>
      </PanelSection>
    </ModalRoot>
  );
}
