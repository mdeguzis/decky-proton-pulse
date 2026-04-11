import { describe, expect, it } from 'vitest';

import {
  RATING_COLORS,
  buildLaunchOptionPreview,
  formatProtonLabel,
  formatTimestamp,
  matchLabel,
} from './reportFormatters';

describe('reportFormatters', () => {
  it('exposes the expected ProtonDB rating colors', () => {
    expect(RATING_COLORS.gold).toBe('#ffd700');
    expect(RATING_COLORS.borked).toBe('#ff4444');
  });

  it('formats Proton labels for stock and GE builds', () => {
    expect(formatProtonLabel('  GE-Proton10-1  ')).toBe('Proton GE 10-1');
    expect(formatProtonLabel('9.0-4')).toBe('Proton 9.0-4');
  });

  it('formats timestamps and launch option previews', () => {
    expect(formatTimestamp(1712707200)).toBe('2024-04-10');
    expect(buildLaunchOptionPreview('GE-Proton10-1')).toBe('PROTON_VERSION="GE-Proton10-1" %command%');
  });

  it('describes GPU vendor matches clearly', () => {
    expect(matchLabel('amd', 'amd')).toBe('Matches your GPU vendor');
    expect(matchLabel('nvidia', 'amd')).toBe('Different GPU vendor');
    expect(matchLabel('unknown', null)).toBe('Unknown GPU match');
  });
});
