import { describe, it, expect, vi } from 'vitest';

// protonTypes imports ./i18n for label lookup. i18n imports react
// (useSyncExternalStore), which vitest cannot resolve in CI's node-only
// environment for a lib-only test. Stub the surface protonTypes actually
// touches so the test stays lib-only and doesn't depend on the React tree.
vi.mock('./i18n', () => ({
  t: () => ({
    extras: {
      reportFormProtonValve: () => 'Valve Proton',
      reportFormProtonDefault: () => 'Default Proton (current)',
      reportFormProtonGE: () => 'Proton-GE',
      reportFormProtonCachyOS: () => 'Proton-CachyOS',
      reportFormProtonNative: () => 'Native (no Proton)',
      reportFormProtonNotListed: () => 'Not listed',
    },
  }),
}));

import { PROTON_KIND_DATA, normalizeProtonKind, protonKindLabel, protonKindOptions } from './protonTypes';

describe('protonTypes', () => {
  it('exposes the expected canonical tokens including valve', () => {
    expect(PROTON_KIND_DATA).toEqual(['valve', 'proton-ge', 'proton-cachyos', 'native', 'notListed']);
  });

  describe('normalizeProtonKind', () => {
    it('maps legacy tokens to the new taxonomy', () => {
      expect(normalizeProtonKind('current')).toBe('valve');
      expect(normalizeProtonKind('ge')).toBe('proton-ge');
      expect(normalizeProtonKind('older')).toBe('notListed');
    });

    it('passes new tokens through unchanged', () => {
      expect(normalizeProtonKind('valve')).toBe('valve');
      expect(normalizeProtonKind('proton-ge')).toBe('proton-ge');
      expect(normalizeProtonKind('proton-cachyos')).toBe('proton-cachyos');
      expect(normalizeProtonKind('native')).toBe('native');
      expect(normalizeProtonKind('notListed')).toBe('notListed');
    });

    it('returns null for unknown or empty input', () => {
      expect(normalizeProtonKind('')).toBeNull();
      expect(normalizeProtonKind(null)).toBeNull();
      expect(normalizeProtonKind(undefined)).toBeNull();
      expect(normalizeProtonKind('made-up')).toBeNull();
    });
  });

  it('emits an option per kind, each with a non-empty label', () => {
    const opts = protonKindOptions();
    expect(opts.map((o) => o.data)).toEqual([...PROTON_KIND_DATA]);
    for (const opt of opts) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  it('protonKindLabel resolves a label for every kind', () => {
    for (const kind of PROTON_KIND_DATA) {
      expect(protonKindLabel(kind).length).toBeGreaterThan(0);
    }
  });
});
