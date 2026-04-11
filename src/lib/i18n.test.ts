// src/lib/i18n.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock react so useSyncExternalStore doesn't require the real package in tests.
vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: (cb: () => void) => () => void, getSnapshot: () => unknown) => {
    // In tests we just call getSnapshot synchronously; no subscription needed.
    return getSnapshot();
  },
}));

import {
  LANGUAGES,
  detectLanguage,
  setLanguage,
  getActiveLanguage,
  normalizeLanguagePreference,
  registerTranslation,
  t,
  useLanguage,
} from './i18n';
import { de as deTranslation } from './translations/de';
import { de } from './translations/de';
import { es } from './translations/es';
import { fr } from './translations/fr';
import { ja } from './translations/ja';
import { ko } from './translations/ko';
import { ptBR } from './translations/pt-BR';
import { ru } from './translations/ru';
import { tr } from './translations/tr';
import { zhCN } from './translations/zh-CN';
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

function invokeAllTranslationFunctions(tree: unknown): void {
  if (!tree || typeof tree !== 'object') return;
  for (const value of Object.values(tree as Record<string, unknown>)) {
    if (typeof value === 'function') {
      for (const sample of [0, 1, 2, 5, 21]) {
        expect(typeof value(sample)).toBe('string');
      }
      continue;
    }
    invokeAllTranslationFunctions(value);
  }
}

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

describe('t() -- English strings by default', () => {
  it('returns common.save = "Save"', () => {
    expect(t().common.save).toBe('Save');
  });

  it('returns common.cancel = "Cancel"', () => {
    expect(t().common.cancel).toBe('Cancel');
  });

  it('returns common.loading = "Loading..."', () => {
    expect(t().common.loading).toBe('Loading...');
  });
});

describe('t() -- rating strings', () => {
  it('returns ratings.platinum = "Platinum"', () => {
    expect(t().ratings.platinum).toBe('Platinum');
  });

  it('returns ratings.borked = "Borked"', () => {
    expect(t().ratings.borked).toBe('Borked');
  });
});

describe('t() -- dynamic functions', () => {
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

describe('normalizeLanguagePreference()', () => {
  it('maps short aliases to supported language codes', () => {
    expect(normalizeLanguagePreference('cn')).toBe('zh-CN');
    expect(normalizeLanguagePreference('jp')).toBe('ja');
    expect(normalizeLanguagePreference('br')).toBe('pt-BR');
  });

  it('returns exact supported codes unchanged', () => {
    expect(normalizeLanguagePreference('de')).toBe('de');
    expect(normalizeLanguagePreference('zh-CN')).toBe('zh-CN');
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

  it('warns and prefixes fallback values for missing function keys in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerTranslation('de', {
      ...deTranslation,
      reports: {
        ...deTranslation.reports,
        found: undefined as unknown as typeof deTranslation.reports.found,
      },
    });
    setLanguage('de');

    expect(t().reports.found(3)).toBe('[!]3 reports found');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    setLanguage('auto');
  });

  it('warns and prefixes fallback values for missing string keys and whole sections', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerTranslation('de', {
      ...deTranslation,
      common: {
        ...deTranslation.common,
        save: undefined as unknown as typeof deTranslation.common.save,
      },
      ratings: undefined as unknown as typeof deTranslation.ratings,
    });
    setLanguage('de');

    expect(t().common.save).toBe('[!]Save');
    expect(t().ratings.platinum).toBe('Platinum');
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    setLanguage('auto');
  });

  it('returns undefined for truly unknown leaf keys without fabricating a fallback', () => {
    setLanguage('de');
    expect((t().common as Record<string, unknown>).totallyMissingKey).toBeUndefined();
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

describe('translation function coverage', () => {
  it('invokes every translation helper function across all locales', () => {
    for (const tree of [de, es, fr, ja, ko, ptBR, ru, tr, zhCN]) {
      invokeAllTranslationFunctions(tree);
    }
  });
});

describe('useLanguage', () => {
  it('returns the same active language snapshot used by the store', () => {
    setLanguage('fr');
    expect(useLanguage()).toBe('fr');
    setLanguage('auto');
  });
});
