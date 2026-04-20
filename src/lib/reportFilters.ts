import type { DisplayReportCard } from '../components/ReportCard';

export type ConfigFilter = 'all' | 'pulse' | 'protondb' | 'protondb-edited';

export function matchesConfigFilter(
  report: Pick<DisplayReportCard, 'isPulse' | 'isEdited'>,
  filter: ConfigFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'pulse') return !!report.isPulse;
  if (filter === 'protondb-edited') return !report.isPulse && !!report.isEdited;
  return !report.isPulse && !report.isEdited;
}
