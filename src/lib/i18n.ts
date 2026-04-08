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
    notifications: string;
    notificationsDesc: string;
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
    notifications: string;
    notificationsDescription: string;
    general: string;
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
    voteSubmitted: string;
    voteFailed: string;
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
    entryCount: (count: number) => string;
  };
  about: {
    description: string;
    github: string;
    protondb: string;
    submitIssue: string;
    submitIssueHint: string;
    issueTemplateGameReport: string;
    issueTemplateMissingReports: string;
    issueTemplatePluginIssue: string;
    issueTemplateOther: string;
    openingIssue: string;
  };
  configManager: {
    title: string;
    createConfig: string;
    configureCurrentGame: string;
    emptyState: string;
    deleteConfirm: (gameName: string) => string;
    deleteConfirmTitle: string;
    applied: string;
    appliedAgo: (time: string) => string;
    noConfigs: string;
    livePreview: string;
    customVariables: string;
    addCustomVar: string;
    previewHint: string;
    profileName: string;
    profileNameHint: string;
    gpuFilter: string;
    toggleCategories: {
      nvidia: string;
      amd: string;
      intel: string;
      wrappers: string;
      performance: string;
      compatibility: string;
      debug: string;
    };
  };
  protondbSubmit: {
    title: string;
    instructions: string;
    generating: string;
    generateFailed: string;
    copyAndOpen: string;
    copyInfo: string;
    copied: string;
    copiedToClipboard: string;
    copyFailed: string;
    submitToProtonDB: string;
    confirmTitle: string;
    confirmChanges: string;
    confirmSubmit: string;
    noChanges: string;
    changed: (field: string, from: string, to: string) => string;
  };
  ratings: {
    platinum: string;
    gold: string;
    silver: string;
    bronze: string;
    borked: string;
    pending: string;
  };
  extras?: {
    exit: () => string;
    backendOfflineVersion: () => string;
    backendUnavailableTitle: () => string;
    backendUnavailableHint: () => string;
    pressBackAgainToExit: () => string;
    failedToOpenIssuePage: () => string;
    nonSteamShortcut: () => string;
    appIdLabel: (appId: number | string) => string;
    shortcutCannotSubmit: () => string;
    shortcutSubmissionHint: () => string;
    confidenceOutOfTen: (score: string | number) => string;
    alreadyUpvoted: () => string;
    alreadyDownvoted: () => string;
    all: () => string;
    other: () => string;
    cacheManagerTitle: () => string;
    clearEntireCacheTitle: () => string;
    clearEntireCacheDescription: (count: number) => string;
    clearAll: () => string;
    cacheCleared: (count: number) => string;
    cacheRefreshed: (gameName: string) => string;
    cacheRefreshFailed: (gameName: string, error: string) => string;
    cacheRemoved: (gameName: string) => string;
    cacheFilterPlaceholder: () => string;
    cacheEmpty: () => string;
    cacheNoMatches: () => string;
    cacheStatsSummary: (size: number, maxSize: number, oldest: string | null) => string;
    cacheRowSummary: (appId: string, reportCount: number, source: string, age: string) => string;
    advancedSettings: () => string;
    advancedSettingsDescription: () => string;
    cacheSection: () => string;
    cacheTtlHours: () => string;
    cacheTtlDescription: (hours: number) => string;
    manageCache: () => string;
    manageCacheDescription: () => string;
    performance: () => string;
    export: () => string;
    uptime: () => string;
    cacheHitRate: () => string;
    cachedGames: () => string;
    prefetched: () => string;
    totalFetches: () => string;
    cdnFetchAvg: () => string;
    prefetchAvg: () => string;
    evictions: () => string;
    hitsAndMisses: (hits: number, misses: number) => string;
    errorsSuffix: (errors: number) => string;
    notAvailable: () => string;
    compatVersionBrowserTitle: () => string;
    compatVersionBrowserDescription: () => string;
    compatNameColumn: () => string;
    compatVersionColumn: () => string;
    compatStatusColumn: () => string;
    compatActionColumn: () => string;
    compatNoVersionsMatched: () => string;
    compatInstallFromZipTitle: () => string;
    compatInstallFromZipDescription: () => string;
    compatInstallArchiveHint: () => string;
    compatInstallArchive: () => string;
    compatLatestInstalled: () => string;
    compatLatest: () => string;
    compatAvailable: () => string;
    compatLatestSlot: () => string;
    compatCustom: () => string;
    compatNotInstalled: () => string;
    compatLoadingReleaseFeed: () => string;
    compatNoReleasesReturned: () => string;
    compatRefreshed: () => string;
    compatLoadFailed: () => string;
    compatDownloading: () => string;
    compatExtracting: () => string;
    compatFinalizing: () => string;
    compatAutoUpdateCurrentVersion: () => string;
    customVarKey: () => string;
    customVarValue: () => string;
    liveSummaryUnavailable: () => string;
    diagnosticsTriedAppId: (appId: number) => string;
    diagnosticsPrimarySource: (source: string) => string;
    diagnosticsPrimarySourcePending: () => string;
    diagnosticsReportIndexResponse: (status: string) => string;
    diagnosticsReportIndexPending: () => string;
    diagnosticsLiveSummary: (status: string, total?: number, tier?: string) => string;
    diagnosticsLiveSummaryPending: () => string;
  };
}

// ---------------------------------------------------------------------------
// English canonical tree
// ---------------------------------------------------------------------------

export const en: TranslationTree = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    loading: 'Loading...',
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
    manageConfigurationsDesc: 'View and manage saved Proton Pulse setups',
    compatibilityTools: 'Compatibility Tools',
    compatibilityToolsDesc: 'Install, remove, and manage compatibility tools',
    settings: 'Settings',
    settingsDesc: 'Plugin preferences and advanced options',
    viewLogs: 'View Logs',
    viewLogsDesc: 'Open the live plugin log viewer',
    debugLogs: 'Debug Logs',
    debugLogsDesc: 'Turn on verbose logging without opening Settings',
    notifications: 'Notifications',
    notificationsDesc: 'Show Proton Pulse toast popups and sounds',
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
    detectingGpu: 'Detecting GPU tier...',
    detectingGpuHint: 'Detecting your GPU tier before narrowing the list. Showing all reports for now.',
    noReportsForTier: 'No reports for this GPU tier.',
    noReportsForGame: 'No ProtonDB reports showed up for this game.',
    loadingSystemInfo: 'Loading system info...',
    navigateToGame: 'Navigate to a game first.',
    hardwareUnavailable: 'Hardware details are unavailable',
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
    installing: (v) => `Proton Version (installing ${v}...)`,
    installed: 'Installed',
    notInstalled: 'Not Installed',
    unavailable: 'Unavailable',
    valveProton: 'Valve Proton',
    checking: 'Checking...',
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
    notifications: 'Notifications',
    notificationsDescription: 'Show Proton Pulse toast notifications and sounds',
    general: 'General',
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
    refreshing: 'Refreshing...',
    installed: 'Installed',
    title: 'Compatibility Tools',
    description: 'Manage Proton and GE compatibility tools.',
    filterPlaceholder: 'Filter versions...',
    zipPlaceholder: '/home/deck/Downloads/GE-Proton8-3.tar.gz',
    removing: 'Removing...',
    actions: 'Actions',
    restartHint: 'Steam may need a restart before the new compatibility tool appears everywhere.',
    unknownDate: 'Unknown date',
    estimating: 'estimating...',
    timeLeft: (time) => `${time} left`,
  },
  configure: {
    quitGameFirst: 'Please quit the game first',
    applyCancelled: 'Apply cancelled',
    noCompatTools: 'No compatibility tools are available',
    applyFailed: (msg) => `Could not apply launch options: ${msg}`,
    voteSubmitted: 'Vote sent',
    voteFailed: 'Could not send vote',
    requiredProtonVersion: 'Required Proton Version',
    requiresVersion: (v) => `This profile needs ${v}, but it is not installed right now.`,
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
    noCloseMatch: (v) => `No close match found. Using the latest installed version instead: ${v}`,
    installFailed: (v) => `Could not find a close installed match, and ${v} could not be installed either.`,
    installFailedFallback: (failedV, fallbackV) => `Could not install ${failedV}. Using ${fallbackV} instead.`,
    installFailedNoFallback: (v) => `Could not install ${v}. Applying the profile anyway with the requested version.`,
    appliedFor: (name) => `Applied to ${name}`,
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
    instructions: 'Right-click any game in your library, or use the settings gear, and select',
    protondbConfig: 'ProtonDB Config',
    currentLaunchOptions: 'Current launch options from Steam:',
    loadingLaunchOptions: 'Loading launch options...',
    noLaunchOptions: 'No launch options set.',
    clearLaunchOptions: 'Clear Launch Options',
  },
  logs: {
    focused: 'Logs focused. Right stick or D-pad scrolls.',
    moveRight: 'Move right to focus the logs.',
    manualScroll: 'Manual scroll active.',
    jumpHint: 'Manual scroll is active. Press A/OK to jump back to the latest log output.',
    noLogs: 'No logs yet.',
    entryCount: (count) => `${count} entries`,
  },
  about: {
    description: 'Finds the ProtonDB reports that best match your hardware and helps you apply the launch options that actually look useful, all from the Decky sidebar.',
    github: 'GitHub',
    protondb: 'ProtonDB',
    submitIssue: 'Submit Issue',
    submitIssueHint: 'Recent logs and system details are attached automatically.',
    issueTemplateGameReport: 'Game Report',
    issueTemplateMissingReports: 'Missing ProtonDB Reports',
    issueTemplatePluginIssue: 'Plugin Issue',
    issueTemplateOther: 'General Feedback',
    openingIssue: 'Opening issue...',
  },
  configManager: {
    title: 'Configurations',
    createConfig: 'Create Config',
    configureCurrentGame: 'Configure Current Game',
    emptyState: 'No saved configurations yet. Apply a report from Manage This Game to get started.',
    deleteConfirm: (name) => `Delete config for ${name}? This will clear the game's launch options.`,
    deleteConfirmTitle: 'Delete Configuration',
    applied: 'Applied',
    appliedAgo: (time) => `Applied ${time}`,
    noConfigs: 'No saved configurations',
    livePreview: 'Live Preview',
    customVariables: 'Custom Variables',
    addCustomVar: 'Add custom variable',
    previewHint: 'Toggle options below to build your launch command. The sections are already filtered to fit your hardware.',
    profileName: 'Profile Name',
    profileNameHint: 'Pick a short label for this configuration, like "High Performance" or "Compatible".',
    gpuFilter: 'GPU',
    toggleCategories: {
      nvidia: 'NVIDIA',
      amd: 'AMD',
      intel: 'Intel',
      wrappers: 'Wrappers',
      performance: 'Performance',
      compatibility: 'Compatibility',
      debug: 'Debug',
    },
  },
  protondbSubmit: {
    title: 'Submit to ProtonDB',
    instructions: 'Proton Pulse generated your system info in the format ProtonDB expects. Copy it, then paste it into the ProtonDB submission form when it asks for system details.',
    generating: 'Generating system info...',
    generateFailed: 'Could not generate system info',
    copyAndOpen: 'Copy & Open ProtonDB',
    copyInfo: 'Copy Info',
    copied: 'Copied!',
    copiedToClipboard: 'System info copied to clipboard.',
    copyFailed: 'Could not copy to clipboard.',
    submitToProtonDB: 'Submit to ProtonDB',
    confirmTitle: 'Submit to ProtonDB?',
    confirmChanges: 'The following changes will be included in your report:',
    confirmSubmit: 'Continue to ProtonDB',
    noChanges: 'No changes detected.',
    changed: (field, from, to) => `${field}: ${from} --> ${to}`,
  },
  ratings: {
    platinum: 'Platinum',
    gold: 'Gold',
    silver: 'Silver',
    bronze: 'Bronze',
    borked: 'Borked',
    pending: 'Pending',
  },
  extras: {
    exit: () => 'Exit',
    backendOfflineVersion: () => 'backend offline',
    backendUnavailableTitle: () => 'Backend unavailable:',
    backendUnavailableHint: () => 'Check the Logs tab for details. The Python backend may not have started cleanly.',
    pressBackAgainToExit: () => 'Press B again to exit',
    failedToOpenIssuePage: () => 'Could not open the issue page.',
    nonSteamShortcut: () => 'Non-Steam shortcut',
    appIdLabel: (appId) => `AppID ${appId}`,
    shortcutCannotSubmit: () => 'Non-Steam shortcuts cannot be submitted to ProtonDB.',
    shortcutSubmissionHint: () => 'ProtonDB only accepts Steam app submissions. You can still use a local config for this shortcut, but you should not submit it there.',
    confidenceOutOfTen: (score) => `${score}/10 confidence`,
    alreadyUpvoted: () => 'You already upvoted this report',
    alreadyDownvoted: () => 'You already downvoted this report',
    all: () => 'All',
    other: () => 'Other',
    cacheManagerTitle: () => 'Cache Manager',
    clearEntireCacheTitle: () => 'Clear Entire Cache',
    clearEntireCacheDescription: (count) => `Remove all ${count} cached entries? Proton Pulse will fetch them again the next time you open those games.`,
    clearAll: () => 'Clear All',
    cacheCleared: (count) => `Removed ${count} cached entr${count === 1 ? 'y' : 'ies'}`,
    cacheRefreshed: (gameName) => `Refreshed ${gameName}`,
    cacheRefreshFailed: (gameName, error) => `Could not refresh ${gameName}: ${error}`,
    cacheRemoved: (gameName) => `Removed ${gameName} from cache`,
    cacheFilterPlaceholder: () => 'Filter by name or app ID...',
    cacheEmpty: () => 'The cache is empty',
    cacheNoMatches: () => 'No matches',
    cacheStatsSummary: (size, maxSize, oldest) => `${size} of ${maxSize} cached${oldest ? ` | oldest ${oldest}` : ''}`,
    cacheRowSummary: (appId, reportCount, source, age) => `App ${appId} | ${reportCount} reports | ${source} | ${age}`,
    advancedSettings: () => 'Advanced Settings',
    advancedSettingsDescription: () => 'Show cache controls and developer tools',
    cacheSection: () => 'Cache',
    cacheTtlHours: () => 'Cache TTL (hours)',
    cacheTtlDescription: (hours) => `Data re-fetched after ${hours}h`,
    manageCache: () => 'Manage Cache...',
    manageCacheDescription: () => 'View, refresh, or remove cached game data',
    performance: () => 'Performance',
    export: () => 'Export',
    uptime: () => 'Uptime',
    cacheHitRate: () => 'Cache hit rate',
    cachedGames: () => 'Cached games',
    prefetched: () => 'Prefetched',
    totalFetches: () => 'Total fetches',
    cdnFetchAvg: () => 'CDN fetch avg',
    prefetchAvg: () => 'Prefetch avg',
    evictions: () => 'Evictions',
    hitsAndMisses: (hits, misses) => `${hits} hits / ${misses} misses`,
    errorsSuffix: (errors) => ` (${errors} errors)`,
    notAvailable: () => 'n/a',
    compatVersionBrowserTitle: () => 'Other Proton-GE Versions',
    compatVersionBrowserDescription: () => 'Browse and filter the full Proton-GE release list.',
    compatNameColumn: () => 'Name',
    compatVersionColumn: () => 'Version',
    compatStatusColumn: () => 'Status',
    compatActionColumn: () => 'Action',
    compatNoVersionsMatched: () => 'No versions matched that filter.',
    compatInstallFromZipTitle: () => 'Install From ZIP',
    compatInstallFromZipDescription: () => 'Enter a local archive path on the Deck. Proton Pulse accepts .zip files and tar-based archives.',
    compatInstallArchiveHint: () => 'Use this for older Proton-GE builds or custom compatibility tool archives you already copied to the Deck.',
    compatInstallArchive: () => 'Install Archive',
    compatLatestInstalled: () => 'Latest installed',
    compatLatest: () => 'Latest',
    compatAvailable: () => 'Available',
    compatLatestSlot: () => 'Latest Slot',
    compatCustom: () => 'Custom',
    compatNotInstalled: () => 'Not Installed',
    compatLoadingReleaseFeed: () => 'Loading release feed...',
    compatNoReleasesReturned: () => 'GitHub did not return any Proton-GE releases.',
    compatRefreshed: () => 'Compatibility tools refreshed.',
    compatLoadFailed: () => 'Could not load the Proton-GE manager state.',
    compatDownloading: () => 'Downloading...',
    compatExtracting: () => 'Extracting...',
    compatFinalizing: () => 'Finalizing...',
    compatAutoUpdateCurrentVersion: () => 'Auto-update Current Version',
    customVarKey: () => 'KEY',
    customVarValue: () => 'VALUE',
    liveSummaryUnavailable: () => 'ProtonDB has a live summary for this game, but the detailed report cards were not available from the CDN.',
    diagnosticsTriedAppId: (appId) => `Checked App ID ${appId}`,
    diagnosticsPrimarySource: (source) => `Primary source: ${source}`,
    diagnosticsPrimarySourcePending: () => 'Primary source: pending',
    diagnosticsReportIndexResponse: (status) => `Report index response: ${status}`,
    diagnosticsReportIndexPending: () => 'Report index response: pending',
    diagnosticsLiveSummary: (status, total, tier) =>
      total !== undefined && tier !== undefined
        ? `Live ProtonDB summary: ${status} · ${total} reports · ${tier} tier`
        : `Live ProtonDB summary: ${status}`,
    diagnosticsLiveSummaryPending: () => 'Live ProtonDB summary: pending',
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
      // Prefix match (e.g. 'de-DE' --> 'de')
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
// t() - resolved tree with English fallback proxy
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
