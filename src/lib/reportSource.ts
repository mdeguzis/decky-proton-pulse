import type { DisplayReportCard } from '../components/ReportCard';
import type { TranslationTree } from './i18n';

type ReportSourceDetailLabels = Pick<
  TranslationTree['detail'],
  'source' | 'sourceProtondb' | 'sourceProtondbEdited' | 'sourceProtonPulse'
>;

export function getReportSourceLabel(
  report: Pick<DisplayReportCard, 'isPulse' | 'isEdited'>,
  detail: ReportSourceDetailLabels,
): string {
  if (report.isPulse) return detail.sourceProtonPulse;
  if (report.isEdited) return detail.sourceProtondbEdited;
  return detail.sourceProtondb;
}
