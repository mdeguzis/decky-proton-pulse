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

const LANGUAGE_ALIASES: Record<string, Language> = {
  zh: 'zh-CN',
  cn: 'zh-CN',
  jp: 'ja',
  br: 'pt-BR',
};

// ---------------------------------------------------------------------------
// TranslationTree
// ---------------------------------------------------------------------------

export interface TranslationTree {
  common: {
    save: string;
    cancel: string;
    remove: string;
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
    originalNotesInDetail: string;
    gpuMismatchBadgeHint: (gpuTier: string) => string;
  };
  detail: {
    apply: string;
    edit: string;
    upload: string;
    uploadDestinationTitle: string;
    uploadToProtonDB: string;
    uploadToProtonPulse: string;
    upvote: string;
    clear: string;
    hardwareComparisonTitle: string;
    hardwareComparisonDescription: string;
    launchPreview: string;
    currentLaunchOptions: string;
    noLaunchOptions: string;
    hardwareMatch: string;
    hardwareMatchPercent: (percent: number) => string;
    hardwareMatchCaption: string;
    gpu: string;
    cpu: string;
    os: string;
    kernel: string;
    driver: string;
    report: string;
    reportHardware: string;
    ourSystem: string;
    match: string;
    systemComparison: string;
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
    systemRequirements: string;
    noGameRequirementsFound: string;
    viewOnPCGamingWiki: string;
    matchingGuideTitle: string;
    matchingGuideButton: string;
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
    cloudPluginSettingsAutoSync: string;
    cloudPluginSettingsAutoSyncDescription: string;
    experimental: string;
    experimentalGamePageShortcut: string;
    experimentalGamePageShortcutDescription: string;
    gamePageBadge: string;
    gamePageBadgeDescription: string;
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
    archivePickerFailed: string;
  };
  configure: {
    quitGameFirst: string;
    applyCancelled: string;
    noCompatTools: string;
    applyFailed: (msg: string) => string;
    voteSubmitted: string;
    voteRemoved: string;
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
    launchOptionConflictTitle: string;
    launchOptionConflictDescription: (appName: string) => string;
    launchOptionConflictWarning: string;
    launchOptionConflictCurrent: string;
    launchOptionConflictIncoming: string;
    launchOptionConflictAppend: string;
    launchOptionConflictReplace: string;
    renderErrorIntro: string;
  };
  toast: {
    installed: (version: string) => string;
    alreadyInstalled: (version: string) => string;
    installFailed: (msg: string) => string;
    cleared: string;
    clearFailed: (msg: string) => string;
    noOptionsSet: string;
    savedToProtonPulse: string;
    alreadyInProtonPulse: string;
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
    openViewer: string;
    openHint: string;
    viewerTitle: string;
    viewerHint: string;
    copyLogs: string;
    copied: string;
    copiedToClipboard: string;
    copyFailed: string;
    jumpToLatest: string;
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
    deleteAction: string;
    applied: string;
    appliedAgo: (time: string) => string;
    noConfigs: string;
    livePreview: string;
    customVariables: string;
    addCustomVar: string;
    customToggleButton: string;
    customToggleBadge: string;
    customToggleManager: string;
    customToggleHint: string;
    customToggleTitle: string;
    customToggleKey: string;
    customToggleScope: string;
    customToggleScopeGame: string;
    customToggleScopeGlobal: string;
    customToggleScopeLocalShort: string;
    customToggleScopeGlobalShort: string;
    customToggleType: string;
    customToggleTypeString: string;
    customToggleTypeBool: string;
    customToggleTypeInt: string;
    customToggleTypeFloat: string;
    customToggleTypeToggle: string;
    customToggleValue: string;
    customToggleAdd: string;
    customToggleSaveButton: string;
    customToggleSavedSection: string;
    customToggleEmpty: string;
    customToggleValidation: string;
    customToggleSaved: string;
    customToggleEditing: string;
    customToggleDisabledHint: string;
    previewHint: string;
    profileName: string;
    profileNameHint: string;
    profileNameRequired: string;
    protonVersionToggleHint: string;
    protonVersionNone: string;
    gpuFilter: string;
    synced: string;
    notSynced: string;
    uploadToCloud: string;
    uploadingToCloud: string;
    cloudUploadSuccess: string;
    syncAllToCloud: string;
    syncingCloud: string;
    restoreFromCloud: string;
    restoringFromCloud: string;
    cloudSyncSummary: (succeeded: number, total: number) => string;
    cloudRestoreSummary: (restored: number, skipped: number) => string;
    cloudSyncFailed: (error: string) => string;
    cloudRestoreFailed: (error: string) => string;
    cloudRestoreSuccess: string;
    cloudRestoreNoBackup: string;
    cloudRestoreAvailable: string;
    cloudAutoSync: string;
    cloudAutoSyncDescription: string;
    uploadPreviewTitle: string;
    uploadPreviewHint: string;
    uploadPreviewApply: string;
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
  nativeReport: {
    title: string;
    rating: string;
    protonVersion: string;
    protonVersionHint: string;
    os: string;
    duration: string;
    notes: string;
    notesHint: string;
    submit: string;
    submitted: string;
    hardware: string;
    ratingPlatinum: string;
    ratingGold: string;
    ratingSilver: string;
    ratingBronze: string;
    ratingBorked: string;
    durationUnreported: string;
    durationUnderOneHour: string;
    durationOneToFour: string;
    durationFourToTen: string;
    durationOverTen: string;
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
    cacheSourceLabel: (source: string) => string;
    cacheAgeMinutesAgo: (minutes: number) => string;
    cacheAgeHoursAgo: (hours: number) => string;
    cacheAgeDaysAgo: (days: number) => string;
    advancedSettings: () => string;
    advancedSettingsDescription: () => string;
    localDataSection: () => string;
    localDataSectionDescription: () => string;
    backupLocalData: () => string;
    backupLocalDataDescription: () => string;
    importLocalData: () => string;
    importLocalDataDescription: () => string;
    importLocalDataConfirmTitle: () => string;
    importLocalDataConfirmDescription: (path: string) => string;
    anonymousClientId: () => string;
    anonymousClientIdDescription: () => string;
    anonymousClientIdLoading: () => string;
    copyAnonymousClientId: () => string;
    anonymousClientIdCopied: () => string;
    anonymousClientIdCopyFailed: () => string;
    backupExported: (path: string) => string;
    backupImported: (count: number) => string;
    backupPickerFailed: () => string;
    cacheSection: () => string;
    cacheTtlHours: () => string;
    cacheTtlDescription: (hours: number) => string;
    manageCache: () => string;
    manageCacheDescription: () => string;
    performance: () => string;
    installedCoverage: () => string;
    prefetchStatus: () => string;
    prefetchStatusWarming: (ready: number, total: number, remaining: number) => string;
    prefetchStatusComplete: (ready: number, total: number) => string;
    prefetchStatusCompleteWithMisses: (ready: number, total: number, misses: number) => string;
    localGames: () => string;
    fetchIssues: () => string;
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
    skippedCount: (count: number) => string;
    gamesCount: (count: number) => string;
    prefetchFailuresSummary: (
      total: number,
      topReason?: string,
      topCount?: number,
    ) => string;
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
    // My Hardware modal
    myHardwareTitle: () => string;
    myHardwareSubtitle: () => string;
    myHardwareCopy: () => string;
    myHardwareCopied: () => string;
    myHardwareCopyFailed: () => string;
    myHardwareLoading: () => string;
    myHardwareLoadFailed: (err: string) => string;
    // My Hardware section in Settings
    myHardwareSection: () => string;
    myHardwareSectionDescription: () => string;
    myHardwareView: () => string;
    myHardwareViewDescription: () => string;
    myHardwareUpload: () => string;
    myHardwareUploadDescription: () => string;
    myHardwareUploadSuccess: () => string;
    myHardwareUploadFailed: (err: string) => string;
    myHardwareUploadNoSteam: () => string;
    myHardwareOpenProfile: () => string;
    myHardwareOpenProfileDescription: () => string;
    publishToPulse: () => string;
    publishToPulseFailed: (err: string) => string;
  };
}

// ---------------------------------------------------------------------------
// English canonical tree
// ---------------------------------------------------------------------------

export const en: TranslationTree = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    remove: 'Remove',
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
    originalNotesInDetail: 'Open the full report to read the original note.',
    gpuMismatchBadgeHint: (gpuTier) => `Rating is from a ${String(gpuTier).toUpperCase()} user — may not reflect your GPU's experience`,
  },
  detail: {
    apply: 'Apply',
    edit: 'Edit',
    upload: 'Upload',
    uploadDestinationTitle: 'Choose Upload Destination',
    uploadToProtonDB: 'Upload to ProtonDB',
    uploadToProtonPulse: 'Upload to Proton Pulse',
    upvote: 'Upvote',
    clear: 'Clear',
    hardwareComparisonTitle: 'Hardware Comparison',
    hardwareComparisonDescription: 'Left side is the ProtonDB report. Right side is our current system.',
    launchPreview: 'Launch Preview',
    currentLaunchOptions: 'Current Launch Options',
    noLaunchOptions: 'No launch options set',
    hardwareMatch: 'Hardware Match',
    hardwareMatchPercent: (percent) => `${percent}% match`,
    hardwareMatchCaption: 'These rows come from the report itself.',
    gpu: 'GPU',
    cpu: 'CPU',
    os: 'OS',
    kernel: 'Kernel',
    driver: 'Driver',
    report: 'Report',
    reportHardware: 'Report Hardware',
    ourSystem: 'Our System',
    match: 'Match',
    systemComparison: 'System Comparison',
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
    systemRequirements: 'System Requirements',
    noGameRequirementsFound: 'No system requirements found from the Steam Store for this game.',
    viewOnPCGamingWiki: 'View on PCGamingWiki',
    matchingGuideTitle: 'How Matching Works',
    matchingGuideButton: 'How Scoring Works',
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
    cloudPluginSettingsAutoSync: 'Auto-sync plugin settings to cloud',
    cloudPluginSettingsAutoSyncDescription: 'Automatically back up Proton Pulse settings, preferences, and custom toggles when they change.',
    experimental: 'Experimental',
    experimentalGamePageShortcut: 'Game page shortcut button',
    experimentalGamePageShortcutDescription: 'Show a best-effort Proton Pulse shortcut next to the game page action buttons. Experimental and off by default.',
    gamePageBadge: 'ProtonDB badge on game page',
    gamePageBadgeDescription: 'Show the ProtonDB compatibility tier badge on the game page.',
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
    archivePickerFailed: 'Could not open the file picker. You can still enter a path manually.',
  },
  configure: {
    quitGameFirst: 'Please quit the game first',
    applyCancelled: 'Apply cancelled',
    noCompatTools: 'No compatibility tools are available',
    applyFailed: (msg) => `Could not apply launch options: ${msg}`,
    voteSubmitted: 'Vote sent',
    voteRemoved: 'Vote removed',
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
    launchOptionConflictTitle: 'Existing launch options detected',
    launchOptionConflictDescription: (name) => `${name} already has launch options set in Steam.`,
    launchOptionConflictWarning: 'Proton Pulse can append its options to the existing string or replace it entirely. Appending keeps the current options first and adds Proton Pulse after them.',
    launchOptionConflictCurrent: 'Current Steam launch options',
    launchOptionConflictIncoming: 'Proton Pulse launch options',
    launchOptionConflictAppend: 'Append',
    launchOptionConflictReplace: 'Replace',
    renderErrorIntro: 'Manage This Game hit a render error in the current Steam UI environment.',
  },
  toast: {
    installed: (v) => `Installed ${v}.`,
    alreadyInstalled: (v) => `${v} is already installed.`,
    installFailed: (msg) => `Install failed: ${msg}`,
    cleared: 'Launch options cleared.',
    clearFailed: (msg) => `Clear failed: ${msg}`,
    noOptionsSet: 'No launch options set.',
    savedToProtonPulse: 'Saved to Proton Pulse.',
    alreadyInProtonPulse: 'This report is already saved in Proton Pulse.',
  },
  manage: {
    instructions: 'Right-click any game in your library, or use the settings gear, and select',
    protondbConfig: 'Proton Pulse',
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
    openViewer: 'Open Log Viewer',
    openHint: 'Press A to open',
    viewerTitle: 'Log Viewer',
    viewerHint: 'Open logs in a dedicated modal for cleaner scrolling and back behavior.',
    copyLogs: 'Copy Logs',
    copied: 'Copied!',
    copiedToClipboard: 'Logs copied to clipboard.',
    copyFailed: 'Could not copy logs to clipboard.',
    jumpToLatest: 'Jump to Latest',
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
    deleteAction: 'Delete',
    applied: 'Applied',
    appliedAgo: (time) => `Applied ${time}`,
    noConfigs: 'No saved configurations',
    livePreview: 'Live Preview',
    customVariables: 'Custom Variables',
    addCustomVar: 'Add custom variable',
    customToggleButton: 'Custom Toggle',
    customToggleBadge: 'Custom',
    customToggleManager: 'Custom Toggles',
    customToggleHint: 'Save reusable launch variables for this game or every game.',
    customToggleTitle: 'Title',
    customToggleKey: 'Env Variable (optional)',
    customToggleScope: 'Apply Scope',
    customToggleScopeGame: 'Apply to this game',
    customToggleScopeGlobal: 'Apply globally',
    customToggleScopeLocalShort: 'Local',
    customToggleScopeGlobalShort: 'Global',
    customToggleType: 'Type',
    customToggleTypeString: 'String',
    customToggleTypeBool: 'Boolean',
    customToggleTypeInt: 'Integer',
    customToggleTypeFloat: 'Float',
    customToggleTypeToggle: 'Toggle Arg',
    customToggleValue: 'Value',
    customToggleAdd: 'Add Custom Toggle',
    customToggleSaveButton: 'Save Custom Toggle',
    customToggleSavedSection: 'Saved custom toggles',
    customToggleEmpty: 'No custom toggles saved yet.',
    customToggleValidation: 'Fill in a title and at least a variable or value before saving.',
    customToggleSaved: 'Custom toggles updated.',
    customToggleEditing: 'Editing custom toggle',
    customToggleDisabledHint: 'Saved custom toggles start off. Turn them on from the Custom section when you want to use them.',
    previewHint: 'Toggle options below to build your launch command. The sections are already filtered to fit your hardware. Expand any section to apply toggles.',
    profileName: 'Profile Name',
    profileNameHint: 'Pick a short label for this configuration, like "High Performance" or "Compatible".',
    profileNameRequired: 'A Profile Name is required before saving.',
    protonVersionToggleHint: 'Enable or disable a pinned Proton version for this configuration.',
    protonVersionNone: 'None',
    gpuFilter: 'GPU',
    synced: 'Synced',
    notSynced: 'Not synced',
    uploadToCloud: 'Upload to Cloud',
    uploadingToCloud: 'Uploading...',
    cloudUploadSuccess: 'Config uploaded to cloud',
    syncAllToCloud: 'Sync All to Cloud',
    syncingCloud: 'Syncing...',
    restoreFromCloud: 'Restore from Cloud',
    restoringFromCloud: 'Restoring...',
    cloudSyncSummary: (succeeded, total) => `Synced ${succeeded}/${total} configs to cloud`,
    cloudRestoreSummary: (restored, skipped) => `Restored ${restored} configs (${skipped} already local)`,
    cloudSyncFailed: (error) => `Cloud sync failed: ${error}`,
    cloudRestoreFailed: (error) => `Cloud restore failed: ${error}`,
    cloudRestoreSuccess: 'Config restored from cloud',
    cloudRestoreNoBackup: 'No cloud backup found for this game',
    cloudRestoreAvailable: 'Cloud backups found. Restore them from Configurations.',
    cloudAutoSync: 'Auto-sync configs to cloud',
    cloudAutoSyncDescription: 'Automatically back up your configurations when they are saved.',
    uploadPreviewTitle: 'Config Upload Preview',
    uploadPreviewHint: 'Review what will be saved and synced to the cloud.',
    uploadPreviewApply: 'Apply & Upload',
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
  nativeReport: {
    title: 'Submit Compatibility Report',
    rating: 'Rating',
    protonVersion: 'Proton Version',
    protonVersionHint: 'e.g. "Proton 10.0-3" or "GE-Proton10-1"',
    os: 'Operating System',
    duration: 'Play Time',
    notes: 'Notes',
    notesHint: 'Describe any issues, tweaks, or tips for running this game.',
    submit: 'Submit Report',
    submitted: 'Report submitted to Proton Pulse!',
    hardware: 'Hardware',
    ratingPlatinum: 'Platinum — Works perfectly out of the box',
    ratingGold: 'Gold — Works with tweaks',
    ratingSilver: 'Silver — Some issues, still playable',
    ratingBronze: 'Bronze — Runs but with significant issues',
    ratingBorked: 'Borked — Does not run',
    durationUnreported: 'Not reported',
    durationUnderOneHour: 'Under 1 hour',
    durationOneToFour: '1 – 4 hours',
    durationFourToTen: '4 – 10 hours',
    durationOverTen: 'Over 10 hours',
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
    cacheRowSummary: (appId, reportCount, source, age) => `AppID ${appId} | ${reportCount} reports | ${source} | ${age}`,
    cacheSourceLabel: (source) => {
      switch (source) {
        case 'prefetch': return 'Prefetch';
        case 'live-detailed': return 'Live detailed';
        case 'live-summary': return 'Live summary';
        case 'cdn':
        default:
          return 'CDN';
      }
    },
    cacheAgeMinutesAgo: (minutes) => `${minutes}m ago`,
    cacheAgeHoursAgo: (hours) => `${hours}h ago`,
    cacheAgeDaysAgo: (days) => `${days}d ago`,
    advancedSettings: () => 'Advanced Settings',
    advancedSettingsDescription: () => 'Show cache controls and developer tools',
    localDataSection: () => 'Backup & Restore',
    localDataSectionDescription: () => 'Export or import your local Proton Pulse settings, configs, and custom toggles.',
    backupLocalData: () => 'Backup Local Data',
    backupLocalDataDescription: () => 'Create a zip backup in Downloads so you can move to a new Deck or reinstall SteamOS.',
    importLocalData: () => 'Import Local Data',
    importLocalDataDescription: () => 'Restore settings, saved configs, and custom toggles from a previous backup zip.',
    importLocalDataConfirmTitle: () => 'Import Local Data',
    importLocalDataConfirmDescription: (path) => `Import local Proton Pulse data from ${path}? This will replace your current saved settings, configs, and custom toggles.`,
    anonymousClientId: () => 'Anonymous Client ID',
    anonymousClientIdDescription: () => 'Cloud config and settings backups are tied to this anonymous Proton Pulse identity.',
    anonymousClientIdLoading: () => 'Loading anonymous client ID...',
    copyAnonymousClientId: () => 'Copy',
    anonymousClientIdCopied: () => 'Anonymous client ID copied to clipboard.',
    anonymousClientIdCopyFailed: () => 'Could not copy anonymous client ID.',
    backupExported: (path) => `Local backup exported to ${path}`,
    backupImported: (count) => `Imported ${count} local data entries. Proton Pulse will refresh to apply them.`,
    backupPickerFailed: () => 'Could not open the file picker. You can still choose a backup zip later.',
    cacheSection: () => 'Cache',
    cacheTtlHours: () => 'Cache TTL (hours)',
    cacheTtlDescription: (hours) => `Data re-fetched after ${hours}h`,
    manageCache: () => 'Manage Cache...',
    manageCacheDescription: () => 'View, refresh, or remove cached game data',
    performance: () => 'Performance',
    installedCoverage: () => 'Installed coverage',
    prefetchStatus: () => 'Prefetch status',
    prefetchStatusWarming: (ready, total, remaining) => `Warming installed games: ${ready}/${total} ready, ${remaining} remaining`,
    prefetchStatusComplete: (ready, total) => `Prefetch complete: ${ready}/${total} installed games ready`,
    prefetchStatusCompleteWithMisses: (ready, total, misses) => `Prefetch complete: ${ready}/${total} ready, ${misses} CDN misses`,
    localGames: () => 'Local games',
    fetchIssues: () => 'Fetch issues',
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
    skippedCount: (count) => `${count} skipped`,
    gamesCount: (count) => `${count} games`,
    prefetchFailuresSummary: (total, topReason, topCount) =>
      topReason && typeof topCount === 'number'
        ? `${total} prefetch failures, mostly ${topReason} (${topCount})`
        : `${total} prefetch failures`,
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
    // My Hardware modal
    myHardwareTitle: () => 'My Hardware',
    myHardwareSubtitle: () => 'ProtonDB-compatible system info generated from your Steam client',
    myHardwareCopy: () => 'Copy',
    myHardwareCopied: () => 'Copied',
    myHardwareCopyFailed: () => 'Failed to copy system info',
    myHardwareLoading: () => 'Loading system info...',
    myHardwareLoadFailed: (err) => `Could not load system info: ${err}`,
    // My Hardware section in Settings
    myHardwareSection: () => 'My Hardware',
    myHardwareSectionDescription: () => 'View your system info, upload it to Pulse, or open your web profile to manage defaults and multiple systems.',
    myHardwareView: () => 'View my hardware',
    myHardwareViewDescription: () => 'Scrollable view of the full ProtonDB-style system info blob',
    myHardwareUpload: () => 'Upload to Pulse',
    myHardwareUploadDescription: () => 'Sync this system to your Pulse profile so the web app can pre-fill reports',
    myHardwareUploadSuccess: () => 'Uploaded to Pulse',
    myHardwareUploadFailed: (err) => `Upload failed: ${err}`,
    myHardwareUploadNoSteam: () => 'Sign in to Steam first, then try again',
    myHardwareOpenProfile: () => 'Open my profile',
    myHardwareOpenProfileDescription: () => 'Open your Pulse profile on the web to manage systems and defaults',
    publishToPulse: () => 'Publish to Pulse',
    publishToPulseFailed: (err) => `Publish failed: ${err}`,
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

export function normalizeLanguagePreference(value: string | null | undefined): Language | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if ((LANGUAGES as readonly string[]).includes(trimmed)) return trimmed as Language;
  return LANGUAGE_ALIASES[trimmed.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let languageVersion = 0;
let resolvedLang: Language = resolveLanguage();
let storageListenerInstalled = false;

function resolveLanguage(): Language {
  const stored = getSetting<string>('language', 'auto');
  if (stored === 'auto') return detectLanguage();
  const normalized = normalizeLanguagePreference(stored);
  if (normalized) return normalized;
  return 'en';
}

function notifyListeners(): void {
  languageVersion++;
  resolvedLang = resolveLanguage();
  listeners.forEach((l) => l());
}

function installStorageListener(): void {
  if (storageListenerInstalled || typeof globalThis.addEventListener !== 'function') {
    return;
  }
  globalThis.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== 'proton-pulse:language') return;
    notifyListeners();
  });
  storageListenerInstalled = true;
}

installStorageListener();

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
