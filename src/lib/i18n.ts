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
    filters: string;
    sort: string;
    shown: (count: number) => string;
    daysAgo: (days: number) => string;
  };
  sidebar: {
    manageConfigurations: string;
    manageConfigurationsDesc: string;
    compatibilityTools: string;
    compatibilityToolsDesc: string;
    settings: string;
    settingsDesc: string;
    viewLogs: string;
    viewLogsDesc: string;
    debugLogs: string;
    debugLogsDesc: string;
    about: (version: string) => string;
  };
  nav: {
    manageThisGame: string;
    manageConfigurations: string;
    logs: string;
    compatibilityTools: string;
    settings: string;
    about: string;
  };
  reports: {
    found: (count: number) => string;
    communityReports: (count: number) => string;
    noReports: string;
    confidence: string;
    votes: string;
    submitted: string;
    notes: string;
    bestMatch: string;
    mostVotes: string;
    selectReport: string;
    detectingGpu: string;
    detectingGpuHint: string;
    noReportsForTier: string;
    noReportsForGame: string;
    loadingSystemInfo: string;
    navigateToGame: string;
    hardwareUnavailable: string;
    editedBadge: string;
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
    ram: string;
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
    reinstall: string;
    installing: string;
    otherVersion: string;
    installFromZip: string;
    autoUpdate: string;
    autoUpdateDescription: string;
    refresh: string;
    refreshing: string;
    installed: string;
    title: string;
    description: string;
    filterPlaceholder: string;
    zipPlaceholder: string;
    removing: string;
    actions: string;
    restartHint: string;
    unknownDate: string;
    estimating: string;
    timeLeft: (time: string) => string;
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
    requiredProtonVersion: string;
    requiresVersion: (version: string) => string;
    chooseApplyMethod: string;
    installVersion: (version: string) => string;
    pickInstalledVersion: string;
    searchClosestVersion: string;
    searchClosestWith: (version: string) => string;
    useLatestInstalled: string;
    useLatestInstalledWith: (version: string) => string;
    useSelectedVersion: string;
    chooseInstalledTool: string;
    usingClosest: (version: string) => string;
    noCloseMatch: (version: string) => string;
    installFailed: (version: string) => string;
    installFailedFallback: (failedVersion: string, fallbackVersion: string) => string;
    installFailedNoFallback: (version: string) => string;
    appliedFor: (appName: string) => string;
  };
  toast: {
    installed: (version: string) => string;
    alreadyInstalled: (version: string) => string;
    installFailed: (msg: string) => string;
    cleared: string;
    clearFailed: (msg: string) => string;
    noOptionsSet: string;
  };
  manage: {
    instructions: string;
    protondbConfig: string;
    currentLaunchOptions: string;
    loadingLaunchOptions: string;
    noLaunchOptions: string;
    clearLaunchOptions: string;
  };
  logs: {
    focused: string;
    moveRight: string;
    manualScroll: string;
    jumpHint: string;
    noLogs: string;
  };
  about: {
    description: string;
    github: string;
    protondb: string;
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
    filters: 'Filters',
    sort: 'Sort',
    shown: (n) => `${n} shown`,
    daysAgo: (d) => `${d}d ago`,
  },
  sidebar: {
    manageConfigurations: 'Manage Configurations',
    manageConfigurationsDesc: 'View and manage ProtonDB configurations',
    compatibilityTools: 'Compatibility Tools',
    compatibilityToolsDesc: 'Install, remove, and manage compatibility tools',
    settings: 'Settings',
    settingsDesc: 'Plugin preferences and tokens',
    viewLogs: 'View Logs',
    viewLogsDesc: 'Open the live plugin log viewer',
    debugLogs: 'Debug Logs',
    debugLogsDesc: 'Enable verbose logging without opening Settings',
    about: (v) => `About: Proton Pulse v${v}`,
  },
  nav: {
    manageThisGame: 'Manage This Game',
    manageConfigurations: 'Manage Configurations',
    logs: 'Logs',
    compatibilityTools: 'Compatibility Tools',
    settings: 'Settings',
    about: 'About',
  },
  reports: {
    found: (n) => n === 1 ? '1 report found' : `${n} reports found`,
    communityReports: (n) => n === 1 ? '1 community report' : `${n} community reports`,
    noReports: 'No reports found',
    confidence: 'Confidence',
    votes: 'Votes',
    submitted: 'Submitted',
    notes: 'Notes',
    bestMatch: 'Best Match',
    mostVotes: 'Most Votes',
    selectReport: 'Select a report card to view the full report.',
    detectingGpu: 'Detecting GPU tier…',
    detectingGpuHint: 'Detecting your GPU tier before narrowing the list. Showing all reports for now.',
    noReportsForTier: 'No reports for this GPU tier.',
    noReportsForGame: 'No ProtonDB reports found for this game.',
    loadingSystemInfo: 'Loading system info…',
    navigateToGame: 'Navigate to a game first.',
    hardwareUnavailable: 'Hardware details unavailable',
    editedBadge: 'Edited*',
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
    ram: 'RAM',
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
    reinstall: 'Reinstall',
    installing: 'Installing',
    otherVersion: 'Other Version',
    installFromZip: 'Install from ZIP',
    autoUpdate: 'Auto Update',
    autoUpdateDescription: 'Keep the pinned latest Proton-GE release installed whenever Settings opens and refreshes.',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    installed: 'Installed',
    title: 'Compatibility Tools',
    description: 'Proton-GE management inspired by Wine Cellar, tailored for Proton Pulse apply flow.',
    filterPlaceholder: 'Filter versions…',
    zipPlaceholder: '/home/deck/Downloads/GE-Proton8-3.tar.gz',
    removing: 'Removing…',
    actions: 'Actions',
    restartHint: 'Steam may need a restart before the new compatibility tool appears everywhere.',
    unknownDate: 'Unknown date',
    estimating: 'estimating…',
    timeLeft: (time) => `${time} left`,
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
    requiredProtonVersion: 'Required Proton Version',
    requiresVersion: (v) => `This profile config requires ${v}, but it is not currently installed.`,
    chooseApplyMethod: 'Choose how you want to apply this profile.',
    installVersion: (v) => `Install ${v}`,
    pickInstalledVersion: 'Pick Installed Version',
    searchClosestVersion: 'Search Closest Version',
    searchClosestWith: (v) => `Search Closest Version (${v})`,
    useLatestInstalled: 'Use Latest Installed',
    useLatestInstalledWith: (v) => `Use Latest Installed (${v})`,
    useSelectedVersion: 'Use Selected Version',
    chooseInstalledTool: 'Choose an installed compatibility tool for this profile.',
    usingClosest: (v) => `Using closest installed version: ${v}`,
    noCloseMatch: (v) => `No close match found. Using latest installed: ${v}`,
    installFailed: (v) => `Closest-version search failed, and install failed for ${v}.`,
    installFailedFallback: (failedV, fallbackV) => `Install failed for ${failedV}. Using ${fallbackV} instead.`,
    installFailedNoFallback: (v) => `Install failed for ${v}. Applying with the requested version anyway.`,
    appliedFor: (name) => `Applied for ${name}`,
  },
  toast: {
    installed: (v) => `Installed ${v}.`,
    alreadyInstalled: (v) => `${v} is already installed.`,
    installFailed: (msg) => `Install failed: ${msg}`,
    cleared: 'Launch options cleared.',
    clearFailed: (msg) => `Clear failed: ${msg}`,
    noOptionsSet: 'No launch options set.',
  },
  manage: {
    instructions: 'Right-click any game in your library (or use the settings gear) and select',
    protondbConfig: 'ProtonDB Config',
    currentLaunchOptions: 'Current launch options from Steam app details:',
    loadingLaunchOptions: 'Loading launch options…',
    noLaunchOptions: 'No launch options set.',
    clearLaunchOptions: 'Clear Launch Options',
  },
  logs: {
    focused: 'Logs focused. Right stick or D-pad scrolls.',
    moveRight: 'Move right to focus logs.',
    manualScroll: 'Manual scroll active.',
    jumpHint: 'Manual scroll active. Press A/OK to jump to latest log output.',
    noLogs: 'No logs yet.',
  },
  about: {
    description: 'Ranks ProtonDB community reports by system compatibility and applies the best-matching Proton launch options to your Steam games — all from the Decky sidebar.',
    github: 'GitHub',
    protondb: 'ProtonDB',
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
  import('./logger').then(({ logFrontendEvent }) =>
    logFrontendEvent('INFO', `[i18n] registered: ${lang}`),
  ).catch(() => {});  // silent in test env
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
  import('./logger').then(({ logFrontendEvent }) =>
    logFrontendEvent('INFO', '[i18n] setLanguage', {
      pref: lang,
      resolvedFrom: prev,
      resolvedTo: resolvedLang,
      listeners: listeners.size,
      registry: Object.keys(registry).filter(k => registry[k as Language]),
    }),
  ).catch(() => {});  // silent in test env
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

