import { describe, it, expect } from 'vitest';
import { formatVersion } from './formatVersion';

describe('formatVersion', () => {
  it('prefixes "v" to numeric versions', () => {
    expect(formatVersion('1.7.4')).toBe('v1.7.4');
    expect(formatVersion('2.0.0-beta')).toBe('v2.0.0-beta');
  });

  it('returns label-style versions verbatim', () => {
    // these are the strings the backend returns for the developer channel
    expect(formatVersion('Developer build (93ae260)')).toBe('Developer build (93ae260)');
    expect(formatVersion('main (abc1234)')).toBe('main (abc1234)');
  });

  it('handles empty + nullish inputs', () => {
    expect(formatVersion('')).toBe('');
    expect(formatVersion(null)).toBe('');
    expect(formatVersion(undefined)).toBe('');
  });

  it('trims whitespace', () => {
    expect(formatVersion('  1.7.4  ')).toBe('v1.7.4');
  });
});
