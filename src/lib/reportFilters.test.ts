import { describe, expect, it } from 'vitest';
import { matchesConfigFilter } from './reportFilters';

describe('matchesConfigFilter', () => {
  it('shows every report for the all filter', () => {
    expect(matchesConfigFilter({ isPulse: false, isEdited: false }, 'all')).toBe(true);
    expect(matchesConfigFilter({ isPulse: false, isEdited: true }, 'all')).toBe(true);
    expect(matchesConfigFilter({ isPulse: true, isEdited: false }, 'all')).toBe(true);
  });

  it('matches Proton Pulse reports only for the pulse filter', () => {
    expect(matchesConfigFilter({ isPulse: true, isEdited: false }, 'pulse')).toBe(true);
    expect(matchesConfigFilter({ isPulse: false, isEdited: true }, 'pulse')).toBe(false);
    expect(matchesConfigFilter({ isPulse: false, isEdited: false }, 'pulse')).toBe(false);
  });

  it('matches original ProtonDB reports only for the protondb filter', () => {
    expect(matchesConfigFilter({ isPulse: false, isEdited: false }, 'protondb')).toBe(true);
    expect(matchesConfigFilter({ isPulse: false, isEdited: true }, 'protondb')).toBe(false);
    expect(matchesConfigFilter({ isPulse: true, isEdited: false }, 'protondb')).toBe(false);
  });

  it('matches edited ProtonDB reports only for the protondb-edited filter', () => {
    expect(matchesConfigFilter({ isPulse: false, isEdited: true }, 'protondb-edited')).toBe(true);
    expect(matchesConfigFilter({ isPulse: false, isEdited: false }, 'protondb-edited')).toBe(false);
    expect(matchesConfigFilter({ isPulse: true, isEdited: true }, 'protondb-edited')).toBe(false);
  });
});
