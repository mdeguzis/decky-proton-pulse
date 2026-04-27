import { describe, expect, it } from 'vitest';

import {
  appendUniqueBullet,
  deckyLoaderReleaseBullet,
  filterAlreadyReleasedBullets,
  formatReleaseHeading,
  normalizeCommitSubject,
} from './sync-changelog.mjs';

describe('sync-changelog script helpers', () => {
  it('normalizes noisy commit subjects into clean changelog summaries', () => {
    expect(normalizeCommitSubject('fix(settings): repair dpad nav')).toBe('Repair dpad nav');
    expect(normalizeCommitSubject('[skip ci] chore: update generated assets')).toBe('Update generated assets');
    expect(normalizeCommitSubject('  upload hardware through linked install function  ')).toBe('Upload hardware through linked install function');
  });

  it('formats release headings with the v prefix', () => {
    expect(formatReleaseHeading('v0.8.9')).toBe('## v0.8.9');
    expect(formatReleaseHeading('0.9.0')).toBe('## v0.9.0');
  });

  it('formats prerelease headings with a clear pre-release suffix', () => {
    expect(formatReleaseHeading('v0.9.0-rc1')).toBe('## v0.9.0 pre-release');
    expect(formatReleaseHeading('v0.9.0', { prerelease: true })).toBe('## v0.9.0 pre-release');
  });

  it('formats Decky Loader release bullets for store-facing releases', () => {
    expect(deckyLoaderReleaseBullet()).toBe('- Decky Loader release submission.');
    expect(deckyLoaderReleaseBullet({ prerelease: true })).toBe('- Decky Loader pre-release submission.');
  });

  it('appends special release bullets once', () => {
    const body = '- Fix a thing';
    const bullet = deckyLoaderReleaseBullet({ prerelease: true });
    expect(appendUniqueBullet(body, bullet)).toBe(`${body}\n${bullet}`);
    expect(appendUniqueBullet(`${body}\n${bullet}`, bullet)).toBe(`${body}\n${bullet}`);
  });

  it('filters unreleased commit bullets already present in released sections', () => {
    const sections = [
      { heading: '## Unreleased', body: '- Keep pending work' },
      {
        heading: '## v0.9.1 pre-release',
        body: [
          '- Toast already linked when generating link code',
          '- Fix hardware upload and add CEF debug toggle',
        ].join('\n'),
      },
      { heading: '## v0.8.8', body: '- Older fix' },
    ];

    expect(
      filterAlreadyReleasedBullets(
        [
          '- Adjust release/pre-release mechanisms',
          '- toast already linked when generating link code',
          '- Fix hardware upload and add CEF debug toggle',
          '- Older fix',
        ],
        sections
      )
    ).toEqual(['- Adjust release/pre-release mechanisms']);
  });
});
