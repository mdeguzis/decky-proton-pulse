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
    const deStub: TranslationTree = {
      common: {
        save: 'Speichern', cancel: 'Abbrechen', loading: 'Laden…', error: 'Fehler',
        apply: 'Anwenden', edit: 'Bearbeiten', clear: 'Löschen', reset: 'Zurücksetzen',
        close: 'Schließen',
      },
      reports: {
        found: (n) => n === 1 ? '1 Bericht gefunden' : `${n} Berichte gefunden`,
        noReports: 'Keine Berichte gefunden',
        confidence: 'Konfidenz', votes: 'Stimmen', submitted: 'Eingereicht', notes: 'Notizen',
      },
      detail: {
        apply: 'Anwenden', edit: 'Bearbeiten', upvote: 'Upvote', clear: 'Löschen',
        launchPreview: 'Startvorschau', currentLaunchOptions: 'Aktuelle Startoptionen',
        noLaunchOptions: 'Keine Startoptionen gesetzt', hardwareMatch: 'Hardware-Übereinstimmung',
        gpu: 'GPU', os: 'Betriebssystem', kernel: 'Kernel', driver: 'Treiber',
        report: 'Bericht', gpuTier: 'GPU-Stufe', edited: 'Bearbeitet',
        customVariant: 'Benutzerdefinierte Variante', protonVersion: 'Proton-Version',
        installing: (v) => `Proton-Version (installiere ${v}…)`,
        installed: 'Installiert', notInstalled: 'Nicht installiert', unavailable: 'Nicht verfügbar',
        valveProton: 'Valve Proton', checking: 'Überprüfen…', matchesGpu: 'Passt zu Ihrer GPU',
        differentGpu: 'Andere GPU', unknownGpu: 'Unbekannte GPU',
      },
      editReport: {
        title: 'Bericht bearbeiten', resetToOriginal: 'Auf Original zurücksetzen',
        label: 'Bezeichnung', labelDescription: 'Eine kurze Bezeichnung für diesen Bericht',
        rating: 'Bewertung', saveEdits: 'Änderungen speichern',
      },
      settings: {
        language: 'Sprache', autoDetected: (lang) => `Auto (erkannt: ${lang})`,
        debugLogs: 'Debug-Protokolle', debugLogsDescription: 'Ausführliche Debug-Protokollierung aktivieren',
        general: 'Allgemein', ghToken: 'GitHub-Token',
        ghTokenDescription: 'Persönliches Zugriffstoken zum Einreichen von Stimmen',
      },
      compatTools: {
        install: 'Installieren', uninstall: 'Deinstallieren', otherVersion: 'Andere Version',
        installFromZip: 'Aus ZIP installieren', autoUpdate: 'Automatisches Update',
      },
      configure: {
        quitGameFirst: 'Bitte beende zuerst das Spiel', applyCancelled: 'Anwenden abgebrochen',
        noCompatTools: 'Keine Kompatibilitätstools verfügbar',
        applyFailed: (msg) => `Anwenden fehlgeschlagen: ${msg}`,
        setTokenToUpvote: 'Setze ein GitHub-Token zum Upvoten',
        voteSubmitted: 'Stimme eingereicht', voteFailed: 'Abstimmung fehlgeschlagen',
        upvoteFailed: 'Upvote fehlgeschlagen',
      },
      toast: {
        installed: (v) => `${v} installiert.`, alreadyInstalled: (v) => `${v} ist bereits installiert.`,
        installFailed: (msg) => `Installation fehlgeschlagen: ${msg}`,
        cleared: 'Startoptionen gelöscht.', clearFailed: (msg) => `Löschen fehlgeschlagen: ${msg}`,
        noOptionsSet: 'Keine Startoptionen gesetzt.',
      },
      ratings: {
        platinum: 'Platin', gold: 'Gold', silver: 'Silber', bronze: 'Bronze',
        borked: 'Kaputt', pending: 'Ausstehend',
      },
    };

    registerTranslation('de', deStub);
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
