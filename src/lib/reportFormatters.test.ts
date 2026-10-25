import { afterEach, describe, expect, it, vi } from 'vitest';

// formatProtonLabel reads i18n (#115), which imports react's useSyncExternalStore.
vi.mock('react', () => ({
  useSyncExternalStore: (_s: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
import { setSteamDefaultTool } from './steamDefaultState';

import {
  RATING_COLORS,
  buildNotesPreview,
  launchOptionsAfterApply,
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
    // Apply never writes PROTON_VERSION (#92); the preview shows the user's
    // options as they will be after Apply.
    expect(launchOptionsAfterApply('~/lsfg %command%')).toBe('~/lsfg %command%');
    expect(launchOptionsAfterApply('PROTON_VERSION="GE-Proton10-1" ~/lsfg %command%')).toBe('~/lsfg %command%');
    expect(launchOptionsAfterApply('PROTON_VERSION="GE-Proton10-1" %command%')).toBe('');
    expect(launchOptionsAfterApply('')).toBe('');
  });

  it('builds note previews from the first non-empty line and truncates with brackets', () => {
    expect(buildNotesPreview('Runs great on Deck\nSecond line with details')).toBe('Runs great on Deck [...]');
    expect(buildNotesPreview('\n\nFirst useful line\n\nAnother line')).toBe('First useful line [...]');
    expect(buildNotesPreview('A'.repeat(140), 20)).toBe('AAAAAAAAAAAAAAAAAAAA [...]');
    expect(buildNotesPreview('Short one-liner')).toBe('Short one-liner');
    expect(buildNotesPreview('   \n\t  ')).toBe('');
  });

  it('describes GPU vendor matches clearly', () => {
    expect(matchLabel('amd', 'amd')).toBe('Matches your GPU vendor');
    expect(matchLabel('nvidia', 'amd')).toBe('Different GPU vendor');
    expect(matchLabel('unknown', null)).toBe('Unknown GPU match');
  });
});

describe('formatProtonLabel for "Default" reports (#115)', () => {
  afterEach(() => setSteamDefaultTool(null));

  it('says Steam default instead of "Proton Default" when the tool is unknown', () => {
    expect(formatProtonLabel('Default')).toBe('Steam default');
    expect(formatProtonLabel(' proton_default ')).toBe('Steam default');
  });

  it('names the tool Steam uses today once it has loaded', () => {
    setSteamDefaultTool({ toolName: 'proton_9', displayName: 'Proton 9.0-4' });
    expect(formatProtonLabel('Default')).toBe('Steam default (now Proton 9.0-4)');
    expect(formatProtonLabel('9.0-4')).toBe('Proton 9.0-4');
  });
});

