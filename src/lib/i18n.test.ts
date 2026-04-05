// src/lib/i18n.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock react so useSyncExternalStore doesn't require the real package in tests.
vi.mock('react', () => ({
  useSyncExternalStore: (subscribe: (cb: () => void) => () => void, getSnapshot: () => unknown) => {
    // In tests we just call getSnapshot synchronously; no subscription needed.
    return getSnapshot();
  },
}));

import {
  LANGUAGES,
  detectLanguage,
  setLanguage,
  getActiveLanguage,
  registerTranslation,
  t,
} from './i18n';
import type { TranslationTree } from './i18n';
import { de as deTranslation } from './translations/de';
import './translations/index';

// ---------------------------------------------------------------------------
// Mock localStorage (same pattern as settings.test.ts)
// ---------------------------------------------------------------------------

const localStorageStore: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); },
};

vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
  // Reset to auto so each test starts fresh
  setLanguage('auto');
  // Reset globalThis mocks
  vi.stubGlobal('SteamClient', undefined);
  vi.stubGlobal('navigator', undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LANGUAGES', () => {
  it('has exactly 10 codes', () => {
    expect(LANGUAGES).toHaveLength(10);
  });

  it('includes all expected locale codes', () => {
    const expected = ['en', 'zh-CN', 'ru', 'pt-BR', 'de', 'es', 'fr', 'ja', 'ko', 'tr'];
    for (const code of expected) {
      expect(LANGUAGES).toContain(code);
    }
  });
});

describe('t() — English strings by default', () => {
  it('returns common.save = "Save"', () => {
    expect(t().common.save).toBe('Save');
  });

  it('returns common.cancel = "Cancel"', () => {
    expect(t().common.cancel).toBe('Cancel');
  });

  it('returns common.loading = "Loading…"', () => {
    expect(t().common.loading).toBe('Loading…');
  });
});

describe('t() — rating strings', () => {
  it('returns ratings.platinum = "Platinum"', () => {
    expect(t().ratings.platinum).toBe('Platinum');
  });

  it('returns ratings.borked = "Borked"', () => {
    expect(t().ratings.borked).toBe('Borked');
  });
});

describe('t() — dynamic functions', () => {
  it('reports.found(1) = "1 report found"', () => {
    expect(t().reports.found(1)).toBe('1 report found');
  });

  it('reports.found(5) = "5 reports found"', () => {
    expect(t().reports.found(5)).toBe('5 reports found');
  });
});

describe('setLanguage()', () => {
  it('persists to localStorage key "proton-pulse:language"', () => {
    setLanguage('de');
    expect(localStorageMock.getItem('proton-pulse:language')).toBe('"de"');
  });

  it('switches t() to registered German stub', () => {
    registerTranslation('de', deTranslation);
    setLanguage('de');

    expect(t().common.save).toBe('Speichern');
    expect(t().ratings.platinum).toBe('Platin');
  });

  it('setLanguage("auto") resets to auto-detect (falls back to English)', () => {
    setLanguage('auto');
    expect(getActiveLanguage()).toBe('en');
    expect(t().common.save).toBe('Save');
  });
});

describe('detectLanguage()', () => {
  it('returns "en" when no Steam or navigator is available', () => {
    expect(detectLanguage()).toBe('en');
  });

  it('maps navigator.language "de-DE" to "de"', () => {
    vi.stubGlobal('navigator', { language: 'de-DE' });
    expect(detectLanguage()).toBe('de');
  });

  it('maps SteamClient language "german" to "de"', () => {
    vi.stubGlobal('SteamClient', {
      Settings: {
        GetCurrentLanguage: () => 'german',
      },
    });
    expect(detectLanguage()).toBe('de');
  });
});

describe('translation completeness', () => {
  it('all registered languages have the same top-level keys as English', () => {
    const enTree = t();
    const enKeys = Object.keys(enTree).sort();

    for (const lang of LANGUAGES) {
      if (lang === 'en') continue;
      setLanguage(lang);
      const tree = t();
      const keys = Object.keys(tree).sort();
      expect(keys).toEqual(enKeys);
    }

    setLanguage('auto');
  });
});

describe('fallback proxy', () => {
  it('returns English string for missing keys in non-English language', () => {
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      const tree = t();
      // Every language should return a string for common.save (never undefined)
      expect(typeof tree.common.save).toBe('string');
      expect(tree.common.save.length).toBeGreaterThan(0);
      // Dynamic functions should also work
      expect(typeof tree.reports.found(3)).toBe('string');
    }
    setLanguage('auto');
  });
});

describe('pluralization', () => {
  it('Russian reports.found handles plural forms correctly', () => {
    setLanguage('ru');
    const tree = t();
    expect(tree.reports.found(1)).toContain('1');
    expect(tree.reports.found(5)).toContain('5');
    expect(tree.reports.found(21)).toContain('21');
    setLanguage('auto');
  });

  it('Japanese reports.found works without plural forms', () => {
    setLanguage('ja');
    const tree = t();
    expect(tree.reports.found(1)).toContain('1');
    expect(tree.reports.found(5)).toContain('5');
    setLanguage('auto');
  });
});
