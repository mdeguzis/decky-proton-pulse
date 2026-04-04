// src/components/EditReportModal.tsx
// Stub — full implementation in Task 2
import { ModalRoot } from '@decky/ui';
import type { DisplayReportCard } from './ReportCard';
import type { EditedReportEntry } from './ReportDetailModal';

export interface EditReportModalProps {
  closeModal?: () => void;
  report: DisplayReportCard;
  onSave: (entry: EditedReportEntry) => void;
}

export function EditReportModal({ closeModal }: EditReportModalProps) {
  return (
    <ModalRoot onCancel={closeModal}>
      <div>Edit Report — coming soon</div>
    </ModalRoot>
  );
}
