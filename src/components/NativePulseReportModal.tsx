// src/components/NativePulseReportModal.tsx
// Submit a native Proton Pulse compatibility report, auto-capturing hardware.
// Form structure mirrors ProtonDB's submission flow so ratings are comparable.

import { useEffect, useState, useRef } from 'react';
import { ModalRoot, Focusable, DialogButton, DialogCheckbox, TextField, DropdownItem, showModal } from '@decky/ui';
import { ScoringGuideModal } from './ScoringGuideModal';
import { toaster } from '../lib/notify';
import { submitUserConfig, VALID_OS, type ValidOS } from '../lib/userConfigs';
import type { SystemInfo, ProtonRating } from '../types';
import { t } from '../lib/i18n';
import { logFrontendEvent } from '../lib/logger';
import { isSteamShortcutApp, resolveAppName } from '../lib/steamApps';
import { RATING_COLORS } from '../lib/reportFormatters';
import { deriveRating, FAULT_KEYS, type FaultKey, type YesNo } from '../lib/scoring';
import { type GameSourceInfo, appTypeFromSource, nativeAppIdFromSource } from '../lib/gameSource';
import { saveReportDraft, loadReportDraft, clearReportDraft } from '../lib/reportDraft';

interface Props {
  appId: number;
  appName: string;
  sysInfo: SystemInfo | null;
  protonVersion?: string;
  autoDuration?: string;
  autoDurationMinutes?: number;
  launchOptions?: string;
  configKey?: string;
  gameSource?: GameSourceInfo | null;
  closeModal?: () => void;
}

// --- OS mapping ---

function mapDistroToValidOS(distro: string | null): ValidOS | '' {
  if (!distro) return '';
  if ((VALID_OS as readonly string[]).includes(distro)) return distro as ValidOS;
  const d = distro.toLowerCase();
  if (d.includes('steamos 3.6') || d.includes('holo 3.6')) return 'SteamOS 3.6';
  if (d.includes('steamos 3.5')) return 'SteamOS 3.5';
  if (d.includes('steamos'))     return 'SteamOS 3.6';
  if (d.includes('ubuntu 24'))   return 'Ubuntu 24.04';
  if (d.includes('ubuntu 22'))   return 'Ubuntu 22.04';
  if (d.includes('fedora') && d.includes('41')) return 'Fedora 41';
  if (d.includes('fedora') && d.includes('40')) return 'Fedora 40';
  if (d.includes('fedora'))      return 'Fedora 41';
  if (d.includes('arch'))        return 'Arch Linux';
  if (d.includes('manjaro'))     return 'Manjaro';
  if (d.includes('nobara') && d.includes('41')) return 'Nobara 41';
  if (d.includes('nobara') && d.includes('40')) return 'Nobara 40';
  if (d.includes('nobara'))      return 'Nobara 41';
  if (d.includes('mint'))        return 'Linux Mint 22';
  if (d.includes('pop'))         return 'Pop!_OS 22.04';
  if (d.includes('debian'))      return 'Debian 12';
  if (d.includes('opensuse') || d.includes('tumbleweed')) return 'openSUSE Tumbleweed';
  if (d.includes('bazzite'))     return 'Bazzite';
  if (d.includes('chimeraos') || d.includes('chimera'))   return 'ChimeraOS';
  return '';
}

const NA = 'Not available';

// --- Hardware table ---

function HardwareTable({ sysInfo }: { sysInfo: SystemInfo | null }) {
  const ramStr = sysInfo?.ram_gb != null ? `${sysInfo.ram_gb} GB` : NA;
  const vramStr = sysInfo?.vram_mb != null
    ? sysInfo.vram_mb >= 1024
      ? `${(sysInfo.vram_mb / 1024).toFixed(1)} GB`
      : `${sysInfo.vram_mb} MB`
    : NA;

  const rows: [string, string][] = [
    ['CPU',        sysInfo?.cpu          || NA],
    ['GPU',        sysInfo?.gpu          || NA],
    ['RAM',        ramStr],
    ['VRAM',       vramStr],
    ['OS',         sysInfo?.distro       || NA],
    ['Kernel',     sysInfo?.kernel       || NA],
    ['Driver',     sysInfo?.driver_version || NA],
    ['Resolution', sysInfo?.display_resolution || NA],
    ...(sysInfo?.steam_deck_model ? [['Steam Deck', sysInfo.steam_deck_model] as [string, string]] : []),
  ];

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#7a9bb5', marginBottom: 6 }}>
        {t().nativeReport.hardware}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr',
        rowGap: 4,
        columnGap: 10,
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 11,
      }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <span style={{ color: '#7a9bb5', fontWeight: 600, alignSelf: 'start', paddingTop: 1 }}>{label}</span>
            <span style={{
              color: value === NA ? '#4a5f70' : '#c8d4e0',
              fontFamily: 'monospace',
              fontSize: 10,
              wordBreak: 'break-all',
              fontStyle: value === NA ? 'italic' : 'normal',
            }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Section header ---

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#7a9bb5', marginTop: 8, marginBottom: 2 }}>
      {label}
    </div>
  );
}

// --- Yes/No dropdown ---

// Function so labels stay reactive to the active language. Cheap to call.
const yesNoOptions = () => [
  { data: 'yes', label: t().common.yes },
  { data: 'no',  label: t().common.no },
];

function YesNoDropdown({
  label,
  value,
  onChange,
  hasError,
  required = true,
}: {
  label: string;
  value: YesNo | null;
  onChange: (v: YesNo) => void;
  hasError: boolean;
  required?: boolean;
}) {
  return (
    <div style={{
      marginBottom: 2,
      ...(hasError ? { outline: '1px solid #f59e0b', borderRadius: 4 } : {}),
    }}>
      <div style={{
        fontSize: 12,
        color: hasError ? '#f59e0b' : '#c8d4e0',
        marginBottom: 4,
        lineHeight: 1.4,
      }}>
        {label} {required && <span style={{ color: '#ef4444' }}>*</span>}
      </div>
      <DropdownItem
        rgOptions={yesNoOptions()}
        selectedOption={value ?? null}
        onChange={(opt) => onChange(opt.data as YesNo)}
        label={label}
      />
    </div>
  );
}

// --- Tinkering method checkboxes ---

const TINKERING_METHODS = [
  'Changed game config files',
  'winetricks',
  'protontricks',
  'protonfixes',
  'Media Foundation DLL (mf-install)',
  'Lutris install script',
  'Launch options / env vars',
] as const;
type TinkeringMethod = typeof TINKERING_METHODS[number];

// --- Proton type options ---

// Stable data tokens. Labels live in the translation tree (extras.reportFormProton*)
// and are resolved at render time so language switches re-render correctly
const PROTON_TYPE_DATA = ['current', 'ge', 'older', 'native', 'notListed'] as const;
type ProtonType = typeof PROTON_TYPE_DATA[number];
const protonTypeOptions = () => {
  const labels: Record<ProtonType, () => string> = {
    current:   t().extras!.reportFormProtonDefault!,
    ge:        t().extras!.reportFormProtonGE!,
    older:     t().extras!.reportFormProtonOlder!,
    native:    t().extras!.reportFormProtonNative!,
    notListed: t().extras!.reportFormProtonNotListed!,
  };
  return PROTON_TYPE_DATA.map(data => ({ data, label: labels[data]() }));
};

// --- Derived rating badge ---

const TIER_TEXT_COLOR: Record<string, string> = {
  platinum: '#1a1a2e',
  gold: '#1a1a00',
  silver: '#1a1a1a',
  bronze: '#fff',
  borked: '#fff',
};

function DerivedRatingBadge({ rating }: { rating: ProtonRating | null }) {
  if (!rating) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <span style={{ fontSize: 11, color: '#7a9bb5' }}>{t().nativeReport.derivedRatingLabel}:</span>
      <span style={{
        background: RATING_COLORS[rating] ?? '#555',
        color: TIER_TEXT_COLOR[rating] ?? '#fff',
        fontWeight: 700,
        fontSize: 12,
        padding: '3px 10px',
        borderRadius: 4,
        letterSpacing: '0.05em',
      }}>
        {rating.toUpperCase()}
      </span>
    </div>
  );
}

// --- Duration options ---

const getDurations = (): { data: string; label: string }[] => [
  { data: 'unreported',      label: t().nativeReport.durationUnreported },
  { data: 'underOneHour',    label: t().nativeReport.durationUnderOneHour },
  { data: 'oneToFourHours',  label: t().nativeReport.durationOneToFour },
  { data: 'fourToTenHours',  label: t().nativeReport.durationFourToTen },
  { data: 'overTenHours',    label: t().nativeReport.durationOverTen },
];

// --- Modal ---

export function NativePulseReportModal({
  appId, appName, sysInfo,
  protonVersion: initialProton = '',
  autoDuration, autoDurationMinutes,
  launchOptions: initialLaunchOptions = '',
  configKey,
  gameSource,
  closeModal,
}: Props) {
  const isShortcut = isSteamShortcutApp(appId);
  const submitAppId = gameSource && !gameSource.is_steam
    ? nativeAppIdFromSource(gameSource, appId)
    : String(appId);
  const submitAppType = gameSource ? appTypeFromSource(gameSource) : 'steam';

  // --- Install & Startup ---
  const [canInstall, setCanInstall] = useState<YesNo | null>(null);
  const [canStart,   setCanStart]   = useState<YesNo | null>(null);
  const [canPlay,    setCanPlay]    = useState<YesNo | null>(null);

  // Scroll-to-next: refs for conditional questions, scroll container ref
  // NOTE: scrollContainerRef must point to a plain div, NOT Focusable -- Focusable does not forward refs to the DOM node
  const scrollContainerRef  = useRef<HTMLDivElement>(null);
  const refCanStart         = useRef<HTMLDivElement | null>(null);
  const refCanPlay          = useRef<HTMLDivElement | null>(null);
  const refProtonType       = useRef<HTMLDivElement | null>(null);
  const refProtonVersion    = useRef<HTMLDivElement | null>(null);
  const refMultiplayer         = useRef<HTMLDivElement | null>(null);
  const refLocalMultiplayer    = useRef<HTMLDivElement | null>(null);
  const refVerdict             = useRef<HTMLDivElement | null>(null);
  // One ref per fault question, same order as FAULT_KEYS
  const faultRefs           = useRef<(HTMLDivElement | null)[]>([]);

  const scrollToRef = (ref: { current: HTMLDivElement | null }, label: string) => {
    setTimeout(() => {
      const el = ref.current;
      const container = scrollContainerRef.current;
      if (!el) { void logFrontendEvent('WARNING', `NativePulseReport: scrollToRef [${label}] -- ref.current is null`); return; }
      if (!container) { void logFrontendEvent('WARNING', `NativePulseReport: scrollToRef [${label}] -- scrollContainerRef is null`); return; }
      const elTop = el.getBoundingClientRect().top;
      const containerTop = container.getBoundingClientRect().top;
      const delta = elTop - containerTop - 20;
      // TextField renders <input>, dropdowns render <button role=combobox>
      const focusEl = el.querySelector<HTMLElement>('button, [role="button"], input');
      void logFrontendEvent('DEBUG', `NativePulseReport: scrollToRef [${label}]`, {
        elTop, containerTop, delta,
        containerScrollTop: container.scrollTop,
        focusTarget: focusEl
          ? focusEl.tagName + (focusEl.getAttribute('role') ? `[role=${focusEl.getAttribute('role')}]` : '')
          : 'none',
      });
      container.scrollBy({ top: delta, behavior: 'smooth' });
      focusEl?.focus();
    }, 300);
  };

  // borked path: if any install/startup step fails, skip the rest of the form
  const installFailed = canInstall === 'no' || canStart === 'no' || canPlay === 'no';
  const installComplete = canInstall !== null && canStart !== null && canPlay !== null;

  // --- Proton + Tinkering ---
  const [proton,          setProton]          = useState(initialProton);
  const [protonType,      setProtonType]      = useState<ProtonType | null>(() => {
    const v = initialProton.toLowerCase();
    if (v.includes('ge-proton') || v.includes('proton-ge')) return 'ge';
    if (v.startsWith('proton ') || v.match(/^proton\d/i)) return 'current';
    if (v.includes('proton')) return 'current';
    if (v === 'native' || v === 'no proton') return 'native';
    return null;
  });
  const [tinkeringMethods, setTinkeringMethods] = useState<Set<TinkeringMethod>>(new Set());
  const isTinker = (protonType && protonType !== 'current') || tinkeringMethods.size > 0;

  const toggleTinkering = (method: TinkeringMethod) =>
    setTinkeringMethods(prev => {
      const next = new Set(prev);
      if (next.has(method)) next.delete(method); else next.add(method);
      return next;
    });

  // --- Fault questions (all required unless installFailed) ---
  const [faults, setFaults] = useState<Record<FaultKey, YesNo | null>>({
    performanceFaults: null,
    graphicalFaults:   null,
    windowingFaults:   null,
    audioFaults:       null,
    inputFaults:       null,
    stabilityFaults:   null,
    saveGameFaults:    null,
    significantBugs:   null,
  });
  const setFault = (key: FaultKey, v: YesNo) =>
    setFaults(prev => ({ ...prev, [key]: v }));

  // --- Multiplayer (optional) ---
  const [onlineMultiplayer, setOnlineMultiplayer] = useState<YesNo | null>(null);
  const [localMultiplayer,  setLocalMultiplayer]  = useState<YesNo | null>(null);

  // --- Verdict + Notes ---
  const [verdict,    setVerdict]    = useState<YesNo | null>(null);
  const [verdictOob, setVerdictOob] = useState<YesNo | null>(null);
  const [summary,    setSummary]    = useState('');       // ProtonDB "Summary" field (140 chars)
  const [notes,      setNotes]      = useState('');       // ProtonDB "Concluding Notes"

  // --- Other fields ---
  const [duration, setDuration] = useState(autoDuration || 'unreported');
  const [os,       setOs]       = useState<ValidOS | ''>(mapDistroToValidOS(sysInfo?.distro ?? null));
  const [submitting, setSubmitting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [scoringBtnFocused, setScoringBtnFocused] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

  const autoDurationActive = !!autoDuration && autoDuration !== 'unreported';
  const ramStr = sysInfo?.ram_gb != null ? `${sysInfo.ram_gb} GB` : '';

  // Draft persistence. Restore any saved answers on mount so a submission
  // that failed for a fixable reason (missing title, network flake) does
  // not force the user to re-fill the entire form. Draft is cleared on
  // successful submit and can be manually written with the Save draft
  // button below.
  const [draftSavedNote, setDraftSavedNote] = useState<string | null>(null);
  useEffect(() => {
    const loaded = loadReportDraft(appId, configKey ?? null);
    if (!loaded) return;
    const d = loaded.draft as any;
    if (d.canInstall !== undefined) setCanInstall(d.canInstall);
    if (d.canStart !== undefined) setCanStart(d.canStart);
    if (d.canPlay !== undefined) setCanPlay(d.canPlay);
    if (typeof d.proton === 'string') setProton(d.proton);
    if (d.protonType !== undefined) setProtonType(d.protonType);
    if (Array.isArray(d.tinkeringMethods)) setTinkeringMethods(new Set(d.tinkeringMethods));
    if (d.faults && typeof d.faults === 'object') setFaults(d.faults);
    if (d.onlineMultiplayer !== undefined) setOnlineMultiplayer(d.onlineMultiplayer);
    if (d.localMultiplayer !== undefined) setLocalMultiplayer(d.localMultiplayer);
    if (d.verdict !== undefined) setVerdict(d.verdict);
    if (d.verdictOob !== undefined) setVerdictOob(d.verdictOob);
    if (typeof d.summary === 'string') setSummary(d.summary);
    if (typeof d.notes === 'string') setNotes(d.notes);
    if (typeof d.duration === 'string') setDuration(d.duration);
    if (typeof d.os === 'string') setOs(d.os as ValidOS);
    const when = new Date(loaded.savedAt).toLocaleString();
    setDraftSavedNote(`Draft restored from ${when}. Continue where you left off, or press Save draft again to refresh it.`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveDraft = () => {
    saveReportDraft(appId, configKey ?? null, {
      canInstall, canStart, canPlay,
      proton, protonType,
      tinkeringMethods: [...tinkeringMethods],
      faults,
      onlineMultiplayer, localMultiplayer,
      verdict, verdictOob,
      summary, notes,
      duration, os,
    });
    const when = new Date().toLocaleTimeString();
    setDraftSavedNote(`Draft saved at ${when}. Answers will be restored next time you open this report.`);
  };

  const derivedRating = deriveRating({
    canInstall,
    canStart,
    canPlay,
    verdict: installFailed ? 'no' : verdict,
    verdictOob: installFailed ? null : verdictOob,
    performanceFaults: faults.performanceFaults,
    graphicalFaults:   faults.graphicalFaults,
    windowingFaults:   faults.windowingFaults,
    audioFaults:       faults.audioFaults,
    inputFaults:       faults.inputFaults,
    stabilityFaults:   faults.stabilityFaults,
    saveGameFaults:    faults.saveGameFaults,
    significantBugs:   faults.significantBugs,
  });

  const handleSubmit = async () => {
    const errs: Record<string, boolean> = {};

    // Install & Startup always required
    if (canInstall === null) errs.canInstall = true;
    if (canStart === null)   errs.canStart   = true;
    if (canPlay === null)    errs.canPlay    = true;

    if (!installFailed) {
      // Proton type required
      if (!protonType) errs.protonType = true;

      // All fault questions required
      for (const k of FAULT_KEYS) {
        if (faults[k] === null) errs[k] = true;
      }

      // Verdict required
      if (!verdict) errs.verdict = true;
      // OOB required when no faults (platinum path)
      if (verdict === 'yes' && !installFailed) {
        const anyFault = FAULT_KEYS.some(k => faults[k] === 'yes');
        if (!anyFault && !verdictOob) errs.verdictOob = true;
      }

      if (!proton.trim()) errs.proton = true;
      if (!os)            errs.os     = true;
      if (!autoDurationActive && duration === 'unreported') errs.duration = true;
      if (notes.trim().length < 10) errs.notes = true;
    }

    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError('Please fill in all highlighted fields before submitting.');
      return;
    }
    setFieldErrors({});

    if (!sysInfo?.cpu || !sysInfo?.gpu) {
      setError('Hardware info (CPU/GPU) could not be detected. Cannot submit.');
      return;
    }
    if (!ramStr) {
      setError('RAM info could not be detected. Cannot submit.');
      return;
    }
    if (!derivedRating) {
      setError('Could not derive rating from answers. Please answer all questions.');
      return;
    }

    // Title is required so reports always carry the human-readable game name.
    // Steam usually gives us appName via GetAppOverviewByAppID, but the lookup
    // can fall back to empty for unrecognized shortcuts. Do a last-resort
    // lookup here against SteamClient + appStore + collectionStore before
    // failing the submission -- covers the case where the caller opened the
    // modal before Steam populated the overview for a freshly added game.
    const resolvedName = resolveAppName(appId, appName);
    if (!resolvedName) {
      setError('Game title is missing - this usually means Steam did not recognize the game. Save your draft with the button below, then set the title on the game properties in Steam and re-open this dialog to resume.');
      return;
    }

    setSubmitting(true);
    setError(null);

    void logFrontendEvent('INFO', 'Native Pulse report submission started', { appId, appName, derivedRating });

    // Store all form answers in formResponses so we can apply the same
    // algorithm in the future and compare directly with ProtonDB responses
    const formResponses: Record<string, unknown> = {
      canInstall,
      canStart,
      canPlay,
      protonType,
      tinkeringMethods: [...tinkeringMethods],
      isTinker: !!isTinker,
      ...Object.fromEntries(FAULT_KEYS.map(k => [k, faults[k]])),
      onlineMultiplayer,
      localMultiplayer,
      verdict: installFailed ? 'no' : verdict,
      verdictOob: installFailed ? null : verdictOob,
      summary: summary.trim() || null,
    };

    const result = await submitUserConfig({
      appId:             String(submitAppId),
      title:             resolvedName,
      cpu:               sysInfo.cpu,
      gpu:               sysInfo.gpu,
      gpuDriver:         sysInfo.driver_version ?? undefined,
      gpuVendor:         sysInfo.gpu_vendor ?? undefined,
      ram:               ramStr,
      os:                installFailed ? os as ValidOS || 'SteamOS 3.6' : os as ValidOS,
      kernel:            sysInfo.kernel ?? undefined,
      protonVersion:     installFailed ? (proton.trim() || 'Unknown') : proton.trim(),
      duration,
      rating:            derivedRating,
      notes:             installFailed ? (summary.trim() || 'Game failed to install or start.') : notes.trim(),
      launchOptions:     initialLaunchOptions || undefined,
      configKey:         configKey || undefined,
      durationMinutes:   autoDurationMinutes ?? null,
      source:            'user',
      appType:           submitAppType,
      vramMb:            sysInfo.vram_mb ?? null,
      cpuCores:          sysInfo.cpu_cores ?? null,
      displayResolution: sysInfo.display_resolution ?? null,
      steamDeckModel:    sysInfo.steam_deck_model ?? null,
      formResponses,
    });

    setSubmitting(false);

    if (result.ok) {
      void logFrontendEvent('INFO', 'Native Pulse report submitted', { appId, derivedRating });
      toaster.toast({ title: 'Proton Pulse', body: t().nativeReport.submitted });
      clearReportDraft(appId, configKey ?? null);
      closeModal?.();
    } else {
      void logFrontendEvent('ERROR', 'Native Pulse report failed', { appId, error: result.error });
      setError(result.error ?? 'Submission failed.');
    }
  };

  if (isShortcut && !gameSource?.gog_product_id && !gameSource?.epic_game_id) {
    return (
      <ModalRoot onCancel={closeModal}>
        <div style={{ padding: 16, color: '#9dc4e8', fontSize: 12 }}>
          {t().extras!.shortcutCannotSubmit()}
        </div>
      </ModalRoot>
    );
  }

  const anyFaultForOob = FAULT_KEYS.some(k => faults[k] === 'yes');

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize
      className="proton-pulse-native-report-modal"
      modalClassName="proton-pulse-native-report-modal"
    >
      <style>{`
        .proton-pulse-native-report-modal,
        .proton-pulse-native-report-modal > div,
        .proton-pulse-native-report-modal .DialogContent_InnerWidth {
          padding: 0 !important; margin: 0 !important;
          max-width: 100vw !important; width: 100vw !important; max-height: 100vh !important;
        }
        .proton-pulse-native-report-modal .ModalPosition { inset: 0 !important; }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)', padding: '12px 16px 0' }}>
        {/* Header -- pinned, always visible as user scrolls questions */}
        <div style={{ flexShrink: 0, padding: '10px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2a3a4a', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e8f4ff' }}>{t().nativeReport.title}</div>
            <div style={{ fontSize: 11, color: '#7a9bb5', marginTop: 2 }}>
              {appName}{isShortcut
                ? ` . ${submitAppType.toUpperCase()} (id: ${submitAppId})`
                : (appId ? ` . App ${appId}` : '')}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {(() => {
              const r = installFailed ? 'borked' : derivedRating;
              return (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 4,
                  background: r ? (RATING_COLORS[r] ?? '#555') : '#2a3a4a',
                  color: r ? (TIER_TEXT_COLOR[r] ?? '#fff') : '#7a9bb5',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  border: r ? 'none' : '1px solid #3a4a5a',
                  display: 'inline-flex', alignItems: 'center',
                }}>
                  {r ? `Rating: ${r}` : 'Rating: Pending'}
                </span>
              );
            })()}
            <div
              onFocus={() => setScoringBtnFocused(true)}
              onBlur={() => setScoringBtnFocused(false)}
              style={{
                borderRadius: 4,
                border: `1px solid ${scoringBtnFocused ? '#7ec8f8' : 'transparent'}`,
                boxShadow: scoringBtnFocused ? '0 0 0 2px #7ec8f8, 0 0 8px #3a8fd0' : 'none',
                transition: 'box-shadow 0.15s, border-color 0.15s',
              }}
            >
              <DialogButton
                onClick={() => showModal(<ScoringGuideModal />)}
                style={{ fontSize: 11, padding: '2px 8px', minWidth: 0, width: 'auto', fontWeight: 700, letterSpacing: '0.03em', background: '#1e4a7a', color: '#7ec8f8', border: '1px solid #2a6aaa' }}
              >
                {t().extras!.scoringGuideTitle!()}
              </DialogButton>
            </div>
          </div>
        </div>

        {/* Focusable provides gamepad right-stick scroll; plain inner div holds the ref for programmatic scroll */}
        <Focusable style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div ref={scrollContainerRef} style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 48 }}>
          {/* Hardware summary */}
          <HardwareTable sysInfo={sysInfo} />

          {/* ===== Install & Startup ===== */}
          <SectionHeader label={t().extras!.reportFormInstallStartupSection!()} />
          <YesNoDropdown
            label={t().extras!.reportFormInstallQuestion!()}
            value={canInstall}
            onChange={(v) => { setCanInstall(v); setFieldErrors(p => ({ ...p, canInstall: false })); setError(null); if (v === 'yes') scrollToRef(refCanStart, 'canStart'); }}
            hasError={!!fieldErrors.canInstall}
          />
          {canInstall === 'yes' && (
            <div ref={refCanStart}>
              <YesNoDropdown
                label={t().extras!.reportFormStartupQuestionWithMenu!()}
                value={canStart}
                onChange={(v) => { setCanStart(v); setFieldErrors(p => ({ ...p, canStart: false })); setError(null); if (v === 'yes') scrollToRef(refCanPlay, 'canPlay'); }}
                hasError={!!fieldErrors.canStart}
              />
            </div>
          )}
          {canInstall === 'yes' && canStart === 'yes' && (
            <div ref={refCanPlay}>
              <YesNoDropdown
                label={t().extras!.reportFormPlayQuestion!()}
                value={canPlay}
                onChange={(v) => { setCanPlay(v); setFieldErrors(p => ({ ...p, canPlay: false })); setError(null); if (v === 'yes') scrollToRef(refProtonType, 'protonType'); }}
                hasError={!!fieldErrors.canPlay}
              />
            </div>
          )}

          {/* Borked short-circuit -- show rating and skip the rest */}
          {installFailed && installComplete && (
            <>
              <DerivedRatingBadge rating="borked" />
              <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.5 }}>
                {t().extras!.reportFormBorkedNotice!()}
              </div>
              <div style={fieldErrors.notes ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
                <TextField
                  label={t().extras!.reportFormBorkedNotesLabel!()}
                  description={t().extras!.reportFormBorkedNotesDescription!()}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value.slice(0, 140))}
                  bShowClearAction
                />
              </div>
            </>
          )}

          {/* ===== Proton + Tinkering ===== */}
          {!installFailed && canPlay === 'yes' && (
            <>
              <SectionHeader label={t().extras!.reportFormProtonTinkering!()} />
              {/* refProtonType on the wrapper div so querySelector('button') finds the DropdownItem button for focus */}
              <div ref={refProtonType} style={fieldErrors.protonType ? { outline: '1px solid #f59e0b', borderRadius: 4 } : {}}>
                <DropdownItem
                  rgOptions={protonTypeOptions()}
                  selectedOption={protonType ?? null}
                  onChange={(opt) => { setProtonType(opt.data as ProtonType); setFieldErrors(p => ({ ...p, protonType: false })); scrollToRef(refProtonVersion, 'protonVersion'); }}
                  label={t().extras!.reportFormProtonVersion!()}
                />
              </div>

              {/* Proton version: 50/50 label left / input right; hint below the row */}
              <div ref={refProtonVersion} style={fieldErrors.proton ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 12, color: fieldErrors.proton ? '#ef4444' : '#c8d4e0', lineHeight: 1.4 }}>
                    {t().nativeReport.protonVersion} <span style={{ color: '#ef4444' }}>*</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      value={proton}
                      onChange={(e) => { setProton(e.target.value); setFieldErrors(p => ({ ...p, proton: false })); setError(null); }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: 10, color: '#7a9bb5', marginTop: 4 }}>{t().nativeReport.protonVersionHint}</div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: '#c8d4e0', marginBottom: 4 }}>
                  {t().extras!.reportFormTinkeringMethods!()}
                </div>
                {TINKERING_METHODS.map(m => (
                  <DialogCheckbox
                    key={m}
                    label={m}
                    checked={tinkeringMethods.has(m)}
                    onChange={() => toggleTinkering(m)}
                    bottomSeparator="none"
                  />
                ))}
              </div>

              {/* ===== Technical Details ===== */}
              <SectionHeader label={t().extras!.reportFormTechnicalDetails!()} />
              {([
                ['performanceFaults', t().nativeReport.faultPerformance],
                ['graphicalFaults',   t().nativeReport.faultGraphical],
                ['windowingFaults',   t().nativeReport.faultWindowing],
                ['audioFaults',       t().nativeReport.faultAudio],
                ['inputFaults',       t().nativeReport.faultInput],
                ['stabilityFaults',   t().nativeReport.faultStability],
                ['saveGameFaults',    t().nativeReport.faultSaveGame],
                ['significantBugs',   t().nativeReport.faultSignificantBugs],
              ] as [FaultKey, string][]).map(([key, label], i) => (
                <div key={key} ref={(el) => { faultRefs.current[i] = el; }}>
                  <YesNoDropdown
                    label={label}
                    value={faults[key]}
                    onChange={(v) => {
                      setFault(key, v);
                      setFieldErrors(p => ({ ...p, [key]: false }));
                      setError(null);
                      if (faultRefs.current[i + 1]) scrollToRef({ current: faultRefs.current[i + 1] }, `fault[${i + 1}]`);
                      else scrollToRef(refMultiplayer, 'multiplayer');
                    }}
                    hasError={!!fieldErrors[key]}
                  />
                </div>
              ))}

              {/* ===== Multiplayer (optional) ===== */}
              <div ref={refMultiplayer}>
                <SectionHeader label={t().extras!.reportFormMultiplayerSection!()} />
                <YesNoDropdown
                  label={t().extras!.reportFormMultiplayerOnline!()}
                  value={onlineMultiplayer}
                  onChange={(v) => { setOnlineMultiplayer(v); scrollToRef(refLocalMultiplayer, 'localMultiplayer'); }}
                  hasError={false}
                  required={false}
                />
              </div>
              <div ref={refLocalMultiplayer}>
                <YesNoDropdown
                  label={t().extras!.reportFormMultiplayerLocal!()}
                  value={localMultiplayer}
                  onChange={(v) => { setLocalMultiplayer(v); scrollToRef(refVerdict, 'verdict'); }}
                  hasError={false}
                  required={false}
                />
              </div>

              {/* ===== Verdict ===== */}
              <SectionHeader label={t().extras!.reportFormVerdictSection!()} />
              <div ref={refVerdict}>
                <YesNoDropdown
                  label={t().nativeReport.verdictQuestion}
                  value={verdict}
                  onChange={(v) => { setVerdict(v); setFieldErrors(p => ({ ...p, verdict: false })); setError(null); }}
                  hasError={!!fieldErrors.verdict}
                />
              </div>

              {/* OOB - only shown when verdict=yes and 0 faults (platinum path) */}
              {verdict === 'yes' && !anyFaultForOob && (
                <YesNoDropdown
                  label={t().extras!.reportFormOutOfBoxQuestion!()}
                  value={verdictOob}
                  onChange={(v) => { setVerdictOob(v); setFieldErrors(p => ({ ...p, verdictOob: false })); setError(null); }}
                  hasError={!!fieldErrors.verdictOob}
                />
              )}

              {/* Tinker OOB confirmation - shown when tinkering and verdict=yes */}
              {verdict === 'yes' && isTinker && !anyFaultForOob && (
                <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.5, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 4 }}>
                  {t().extras!.reportFormTinkerReportNote!()}
                </div>
              )}

              {/* Concluding Notes */}
              <div style={fieldErrors.notes ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
                <TextField
                  label={`Concluding Notes * (min 10 chars)`}
                  description={t().nativeReport.notesHint}
                  value={notes}
                  onChange={(e) => { setNotes(e.target.value); setFieldErrors(p => ({ ...p, notes: false })); }}
                />
              </div>

              {/* OS */}
              <div style={fieldErrors.os ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#e8f4ff', marginBottom: 4 }}>
                  {t().nativeReport.os} <span style={{ color: '#ef4444' }}>*</span>
                </div>
                <DropdownItem
                  rgOptions={VALID_OS.map(o => ({ data: o, label: o }))}
                  selectedOption={os || null}
                  onChange={(opt) => { setOs(opt.data as ValidOS); setFieldErrors(p => ({ ...p, os: false })); setError(null); }}
                  label={t().nativeReport.os}
                />
                <div style={{ fontSize: 10, color: '#7a9bb5', marginTop: 4, lineHeight: 1.4 }}>
                  {t().nativeReport.osAutoDetectedHint}
                </div>
              </div>

              {/* Duration */}
              {!autoDurationActive && (
                <div style={fieldErrors.duration ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#e8f4ff', marginBottom: 4 }}>
                    {t().nativeReport.duration} <span style={{ color: '#ef4444' }}>*</span>
                  </div>
                  <DropdownItem
                    rgOptions={getDurations().map(d => ({ data: d.data, label: d.label }))}
                    selectedOption={duration}
                    onChange={(opt) => { setDuration(opt.data as string); setFieldErrors(p => ({ ...p, duration: false })); }}
                    label={t().nativeReport.duration}
                  />
                </div>
              )}
            </>
          )}
          </div>
        </Focusable>

        {error && (
          <div style={{ fontSize: 11, color: '#ef4444', padding: '6px 10px', marginTop: 8, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4 }}>
            {error}
          </div>
        )}
        {draftSavedNote && (
          <div style={{ fontSize: 11, color: '#9dc4e8', padding: '6px 10px', marginTop: 8, background: 'rgba(157,196,232,0.10)', border: '1px solid rgba(157,196,232,0.35)', borderRadius: 4 }}>
            {draftSavedNote}
          </div>
        )}

        <Focusable style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          <DialogButton
            onClick={handleSubmit}
            disabled={submitting}
            style={{ flex: 1, minWidth: 120, padding: '8px 16px', fontSize: 12 }}
          >
            {submitting ? t().common.loading : t().nativeReport.submit}
          </DialogButton>
          <DialogButton
            onClick={handleSaveDraft}
            disabled={submitting}
            style={{ minWidth: 100, padding: '8px 12px', fontSize: 12, background: '#3a4a5a' }}
          >
            Save draft
          </DialogButton>
          <DialogButton
            onClick={() => closeModal?.()}
            style={{ minWidth: 70, padding: '8px 12px', fontSize: 12, background: '#555' }}
          >
            {t().common.close}
          </DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
}
