import { describe, expect, test } from 'vitest';

import { buildPluginLinkProfileUrl } from './protonPulseLinkUrl';

describe('buildPluginLinkProfileUrl', () => {
  test('returns the linked plugins section when no code is provided', () => {
    expect(buildPluginLinkProfileUrl()).toBe(
      'https://www.proton-pulse.com/plugin-link.html?ppv=20260420d',
    );
  });

  test('includes the link code in both search and hash for browser compatibility', () => {
    expect(buildPluginLinkProfileUrl(' abcd-1234 ')).toBe(
      'https://www.proton-pulse.com/plugin-link.html?ppv=20260420d&pluginLinkCode=ABCD-1234',
    );
  });
});
