// src/lib/i18n.ts
import { useSyncExternalStore } from 'react';
import { getSetting, setSetting } from './settings';

// ---------------------------------------------------------------------------
// Language registry
// ---------------------------------------------------------------------------

export const LANGUAGES = ['en', 'zh-CN', 'ru', 'pt-BR', 'de', 'es', 'fr', 'ja', 'ko', 'tr'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = {
  'en': 'English',
  'zh-CN': '简体中文',
  'ru': 'Русский',
  'pt-BR': 'Português',
  'de': 'Deutsch',
  'es': 'Español',
  'fr': 'Français',
  'ja': '日本語',
  'ko': '한국어',
  'tr': 'Türkçe',
};

// ---------------------------------------------------------------------------
// TranslationTree
// ---------------------------------------------------------------------------

export interface TranslationTree {
  common: {
    save: string;
    cancel: string;
    loading: string;
    error: string;
    apply: string;
    edit: string;
    clear: string;
    reset: string;
    close: string;
  };
  reports: {
    found: (count: number) => string;
    noReports: string;
    confidence: string;
    votes: string;
    submitted: string;
    notes: string;
  };
  detail: {
    apply: string;
    edit: string;
    upvote: string;
    clear: string;
    launchPreview: string;
    currentLaunchOptions: string;
    noLaunchOptions: string;
    hardwareMatch: string;
    gpu: string;
    os: string;
    kernel: string;
    driver: string;
    report: string;
    gpuTier: string;
    edited: string;
    customVariant: string;
    protonVersion: string;
    installing: (version: string) => string;
    installed: string;
    notInstalled: string;
    unavailable: string;
    valveProton: string;
    checking: string;
    matchesGpu: string;
    differentGpu: string;
    unknownGpu: string;
  };
  editReport: {
    title: string;
    resetToOriginal: string;
    label: string;
    labelDescription: string;
    rating: string;
    saveEdits: string;
  };
  settings: {
    language: string;
    autoDetected: (lang: string) => string;
    debugLogs: string;
    debugLogsDescription: string;
    general: string;
    ghToken: string;
    ghTokenDescription: string;
  };
  compatTools: {
    install: string;
    uninstall: string;
    otherVersion: string;
    installFromZip: string;
    autoUpdate: string;
  };
  configure: {
    quitGameFirst: string;
    applyCancelled: string;
    noCompatTools: string;
    applyFailed: (msg: string) => string;
    setTokenToUpvote: string;
    voteSubmitted: string;
    voteFailed: string;
    upvoteFailed: string;
  };
  toast: {
    installed: (version: string) => string;
    alreadyInstalled: (version: string) => string;
    installFailed: (msg: string) => string;
    cleared: string;
    clearFailed: (msg: string) => string;
    noOptionsSet: string;
  };
  ratings: {
    platinum: string;
    gold: string;
    silver: string;
    bronze: string;
    borked: string;
    pending: string;
  };
}

// ---------------------------------------------------------------------------
// English canonical tree
// ---------------------------------------------------------------------------

export const en: TranslationTree = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    loading: 'Loading…',
    error: 'Error',
    apply: 'Apply',
    edit: 'Edit',
    clear: 'Clear',
    reset: 'Reset',
    close: 'Close',
  },
  reports: {
    found: (n) => n === 1 ? '1 report found' : `${n} reports found`,
    noReports: 'No reports found',
    confidence: 'Confidence',
    votes: 'Votes',
    submitted: 'Submitted',
    notes: 'Notes',
  },
  detail: {
    apply: 'Apply',
    edit: 'Edit',
    upvote: 'Upvote',
    clear: 'Clear',
    launchPreview: 'Launch Preview',
    currentLaunchOptions: 'Current Launch Options',
    noLaunchOptions: 'No launch options set',
    hardwareMatch: 'Hardware Match',
    gpu: 'GPU',
    os: 'OS',
    kernel: 'Kernel',
    driver: 'Driver',
    report: 'Report',
    gpuTier: 'GPU Tier',
    edited: 'Edited',
    customVariant: 'Custom Variant',
    protonVersion: 'Proton Version',
    installing: (v) => `Proton Version (installing ${v}…)`,
    installed: 'Installed',
    notInstalled: 'Not Installed',
    unavailable: 'Unavailable',
    valveProton: 'Valve Proton',
    checking: 'Checking…',
    matchesGpu: 'Matches your GPU',
    differentGpu: 'Different GPU',
    unknownGpu: 'Unknown GPU',
  },
  editReport: {
    title: 'Edit Report',
    resetToOriginal: 'Reset to Original',
    label: 'Label',
    labelDescription: 'A short label for this report',
    rating: 'Rating',
    saveEdits: 'Save Edits',
  },
  settings: {
    language: 'Language',
    autoDetected: (lang) => `Auto (detected: ${lang})`,
    debugLogs: 'Debug Logs',
    debugLogsDescription: 'Enable verbose debug logging',
    general: 'General',
    ghToken: 'GitHub Token',
    ghTokenDescription: 'Personal access token for submitting votes',
  },
  compatTools: {
    install: 'Install',
    uninstall: 'Uninstall',
    otherVersion: 'Other Version',
    installFromZip: 'Install from ZIP',
    autoUpdate: 'Auto Update',
  },
  configure: {
    quitGameFirst: 'Please quit the game first',
    applyCancelled: 'Apply cancelled',
    noCompatTools: 'No compatibility tools available',
    applyFailed: (msg) => `Apply failed: ${msg}`,
    setTokenToUpvote: 'Set a GitHub token to upvote',
    voteSubmitted: 'Vote submitted',
    voteFailed: 'Vote failed',
    upvoteFailed: 'Upvote failed',
  },
  toast: {
    installed: (v) => `Installed ${v}.`,
    alreadyInstalled: (v) => `${v} is already installed.`,
    installFailed: (msg) => `Install failed: ${msg}`,
    cleared: 'Launch options cleared.',
    clearFailed: (msg) => `Clear failed: ${msg}`,
    noOptionsSet: 'No launch options set.',
  },
  ratings: {
    platinum: 'Platinum',
    gold: 'Gold',
    silver: 'Silver',
    bronze: 'Bronze',
    borked: 'Borked',
    pending: 'Pending',
  },
};

// ---------------------------------------------------------------------------
// Translation registry
// ---------------------------------------------------------------------------

const registry: Partial<Record<Language, TranslationTree>> = { en };

export function registerTranslation(lang: Language, tree: TranslationTree): void {
  registry[lang] = tree;
  console.log(`[i18n] registered: ${lang}`);
}

// ---------------------------------------------------------------------------
// Steam language map
// ---------------------------------------------------------------------------

const STEAM_LANG_MAP: Record<string, Language> = {
  english: 'en',
  schinese: 'zh-CN',
  russian: 'ru',
  brazilian: 'pt-BR',
  german: 'de',
  spanish: 'es',
  french: 'fr',
  japanese: 'ja',
  koreana: 'ko',
  turkish: 'tr',
};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectLanguage(): Language {
  // 1. Try SteamClient
  try {
    const steamLang = (globalThis as any).SteamClient?.Settings?.GetCurrentLanguage?.();
    if (typeof steamLang === 'string' && steamLang in STEAM_LANG_MAP) {
      return STEAM_LANG_MAP[steamLang];
    }
  } catch {
    // ignore
  }

  // 2. Try navigator.language
  try {
    const navLang = globalThis.navigator?.language;
    if (typeof navLang === 'string') {
      // Exact match
      if ((LANGUAGES as readonly string[]).includes(navLang)) {
        return navLang as Language;
      }
      // Prefix match (e.g. 'de-DE' → 'de')
      const prefix = navLang.split('-')[0];
      const match = LANGUAGES.find((l) => l === prefix || l.startsWith(prefix + '-'));
      if (match) return match;
    }
  } catch {
    // ignore
  }

  return 'en';
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let languageVersion = 0;
let resolvedLang: Language = resolveLanguage();

function resolveLanguage(): Language {
  const stored = getSetting<string>('language', 'auto');
  if (stored === 'auto') return detectLanguage();
  if ((LANGUAGES as readonly string[]).includes(stored)) return stored as Language;
  return 'en';
}

function notifyListeners(): void {
  languageVersion++;
  resolvedLang = resolveLanguage();
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// setLanguage / getActiveLanguage
// ---------------------------------------------------------------------------

export function setLanguage(lang: 'auto' | Language): void {
  const prev = resolvedLang;
  setSetting('language', lang);
  notifyListeners();
  console.log(`[i18n] setLanguage: pref=${lang}, resolved=${prev}→${resolvedLang}, listeners=${listeners.size}, registry=[${Object.keys(registry).filter(k => registry[k as Language]).join(',')}]`);
}

export function getActiveLanguage(): Language {
  return resolvedLang;
}

export function getLanguageVersion(): number {
  return languageVersion;
}

// ---------------------------------------------------------------------------
// useLanguage hook
// ---------------------------------------------------------------------------

export function useLanguage(): Language {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    getActiveLanguage,
  );
}

// ---------------------------------------------------------------------------
// t() — resolved tree with English fallback proxy
// ---------------------------------------------------------------------------

const IS_DEV = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

function makeFallbackProxy(translated: TranslationTree, fallback: TranslationTree): TranslationTree {

  return new Proxy(translated, {
    get(target, sectionKey: string) {
      const translatedSection = (target as any)[sectionKey];
      const fallbackSection = (fallback as any)[sectionKey];

      if (translatedSection === undefined) {
        return fallbackSection;
      }

      // Proxy the inner section object to catch missing leaf keys
      return new Proxy(translatedSection, {
        get(sTarget, leafKey: string) {
          const val = sTarget[leafKey];
          if (val !== undefined) return val;
          // Fall back to English
          const fbVal = fallbackSection?.[leafKey];
          if (IS_DEV && fbVal !== undefined) {
            if (typeof fbVal === 'function') {
              return (...args: any[]) => {
                console.warn(`[i18n] missing key ${String(sectionKey)}.${String(leafKey)} in ${getActiveLanguage()}`);
                return '[!]' + fbVal(...args);
              };
            }
            console.warn(`[i18n] missing key ${String(sectionKey)}.${String(leafKey)} in ${getActiveLanguage()}`);
            return '[!]' + fbVal;
          }
          return fbVal;
        },
      });
    },
  }) as TranslationTree;
}

export function t(): TranslationTree {
  const lang = getActiveLanguage();
  if (lang === 'en') return en;
  const tree = registry[lang];
  if (!tree) return en;
  return makeFallbackProxy(tree, en);
}

