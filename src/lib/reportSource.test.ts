import { describe, expect, it } from 'vitest';
import { getReportSourceLabel } from './reportSource';

const detail = {
  source: 'Source',
  sourceProtondb: 'ProtonDB',
  sourceProtondbEdited: 'ProtonDB (edited)',
  sourceProtonPulse: 'Proton Pulse',
} as const;

describe('getReportSourceLabel', () => {
  it('returns ProtonDB for an unedited ProtonDB report', () => {
    expect(getReportSourceLabel({ isPulse: false, isEdited: false }, detail)).toBe('ProtonDB');
  });

  it('returns ProtonDB (edited) for an edited ProtonDB report', () => {
    expect(getReportSourceLabel({ isPulse: false, isEdited: true }, detail)).toBe('ProtonDB (edited)');
  });

  it('prefers Proton Pulse when the report came from a pulse upload', () => {
    expect(getReportSourceLabel({ isPulse: true, isEdited: true }, detail)).toBe('Proton Pulse');
  });
});
