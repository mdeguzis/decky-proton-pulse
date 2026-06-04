import { describe, it, expect } from 'vitest';
import { formatVersion, extractDevBuildSha } from './formatVersion';

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

  it('returns the new version-tagged dev label verbatim', () => {
    expect(formatVersion('Developer build (v1.7.5-3d7e659)')).toBe('Developer build (v1.7.5-3d7e659)');
  });
});

describe('extractDevBuildSha', () => {
  it('pulls the sha from the legacy commit-only label', () => {
    expect(extractDevBuildSha('Developer build (abc1234)')).toBe('abc1234');
  });

  it('pulls the sha from the new version-commit label', () => {
    expect(extractDevBuildSha('Developer build (v1.7.5-3d7e659)')).toBe('3d7e659');
  });

  it('ignores a +uncommitted suffix in either format', () => {
    expect(extractDevBuildSha('Developer build (abc1234+uncommitted)')).toBe('abc1234');
    expect(extractDevBuildSha('Developer build (v1.7.5-3d7e659+uncommitted)')).toBe('3d7e659');
  });

  it('does not mistake a plain semver for a sha', () => {
    expect(extractDevBuildSha('v1.7.5')).toBeNull();
    expect(extractDevBuildSha('1.7.5')).toBeNull();
  });

  it('returns null for empty or nullish input', () => {
    expect(extractDevBuildSha('')).toBeNull();
    expect(extractDevBuildSha(null)).toBeNull();
    expect(extractDevBuildSha(undefined)).toBeNull();
  });
});
