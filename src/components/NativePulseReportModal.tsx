// src/components/NativePulseReportModal.tsx
// Submit a native Proton Pulse compatibility report, auto-capturing hardware.
// Form structure mirrors ProtonDB's submission flow so ratings are comparable.

import { useState } from 'react';
import { ModalRoot, Focusable, DialogButton, TextField, DropdownItem } from '@decky/ui';
import { toaster } from '../lib/notify';
import { submitUserConfig, VALID_OS, type ValidOS } from '../lib/userConfigs';
import type { SystemInfo, ProtonRating } from '../types';
import { t } from '../lib/i18n';
import { logFrontendEvent } from '../lib/logger';
import { isSteamShortcutApp } from '../lib/steamApps';
import { RATING_COLORS } from '../lib/reportFormatters';
import { deriveRating, FAULT_KEYS, type FaultKey, type YesNo } from '../lib/scoring';

interface Props {
  appId: number;
  appName: string;
  sysInfo: SystemInfo | null;
  protonVersion?: string;
  initialRating?: string;
  autoDuration?: string;
  launchOptions?: string;
  resolvedSteamAppId?: number | null;
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

const YES_NO_OPTIONS = [
  { data: 'yes', label: 'Yes' },
  { data: 'no',  label: 'No' },
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
        rgOptions={YES_NO_OPTIONS}
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

function TinkeringCheckbox({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        cursor: 'pointer',
        fontSize: 11,
        color: '#c8d4e0',
      }}
    >
      <div style={{
        width: 14,
        height: 14,
        border: `2px solid ${checked ? '#4fc3f7' : '#4a6a8a'}`,
        borderRadius: 3,
        background: checked ? '#4fc3f7' : 'transparent',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {checked && <span style={{ color: '#000', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>v</span>}
      </div>
      {label}
    </div>
  );
}

// --- Proton type options ---

const PROTON_TYPE_OPTIONS = [
  { data: 'current',   label: 'Default Proton (current)' },
  { data: 'ge',        label: 'Glorious Eggroll (GE)' },
  { data: 'older',     label: 'Switched to an older version' },
  { data: 'native',    label: 'Native - No Proton' },
  { data: 'notListed', label: 'Not Listed' },
] as const;
type ProtonType = typeof PROTON_TYPE_OPTIONS[number]['data'];

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
  autoDuration, launchOptions: initialLaunchOptions = '',
  resolvedSteamAppId,
  closeModal,
}: Props) {
  const isShortcut = isSteamShortcutApp(appId);
  const submitAppId = isShortcut && resolvedSteamAppId ? resolvedSteamAppId : appId;

  // --- Install & Startup ---
  const [canInstall, setCanInstall] = useState<YesNo | null>(null);
  const [canStart,   setCanStart]   = useState<YesNo | null>(null);
  const [canPlay,    setCanPlay]    = useState<YesNo | null>(null);

  // borked path: if any install/startup step fails, skip the rest of the form
  const installFailed = canInstall === 'no' || canStart === 'no' || canPlay === 'no';
  const installComplete = canInstall !== null && canStart !== null && canPlay !== null;

  // --- Proton + Tinkering ---
  const [proton,          setProton]          = useState(initialProton);
  const [protonType,      setProtonType]      = useState<ProtonType | null>(null);
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

  const autoDurationActive = !!autoDuration && autoDuration !== 'unreported';
  const ramStr = sysInfo?.ram_gb != null ? `${sysInfo.ram_gb} GB` : '';

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
    if (!canInstall) errs.canInstall = true;
    if (!canStart)   errs.canStart   = true;
    if (!canPlay)    errs.canPlay    = true;

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
      setError(installFailed
        ? 'Please answer all Install & Startup questions.'
        : 'Please answer all required questions. Concluding notes must be at least 10 characters.');
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
      title:             appName,
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
      source:            'user',
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
      closeModal?.();
    } else {
      void logFrontendEvent('ERROR', 'Native Pulse report failed', { appId, error: result.error });
      setError(result.error ?? 'Submission failed.');
    }
  };

  if (isShortcut && !resolvedSteamAppId) {
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
    <ModalRoot onCancel={closeModal}>
      <div style={{ padding: 16, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Header */}
        <div style={{ fontSize: 15, fontWeight: 700, color: '#e8f4ff', marginBottom: 3 }}>
          {t().nativeReport.title}
        </div>
        <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 12 }}>
          {appName}{isShortcut && resolvedSteamAppId
            ? ` . Non-Steam (Steam app id: ${resolvedSteamAppId})`
            : (appId ? ` . App ${appId}` : '')}
        </div>

        <Focusable style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Hardware summary */}
          <HardwareTable sysInfo={sysInfo} />

          {/* ===== Install & Startup ===== */}
          <SectionHeader label="Install and Startup" />
          <YesNoDropdown
            label="Were you able to install the game?"
            value={canInstall}
            onChange={(v) => { setCanInstall(v); setFieldErrors(p => ({ ...p, canInstall: false })); setError(null); }}
            hasError={!!fieldErrors.canInstall}
          />
          {canInstall === 'yes' && (
            <YesNoDropdown
              label="Were you able to start up the game and view its initial menu?"
              value={canStart}
              onChange={(v) => { setCanStart(v); setFieldErrors(p => ({ ...p, canStart: false })); setError(null); }}
              hasError={!!fieldErrors.canStart}
            />
          )}
          {canInstall === 'yes' && canStart === 'yes' && (
            <YesNoDropdown
              label="Were you able to begin playing?"
              value={canPlay}
              onChange={(v) => { setCanPlay(v); setFieldErrors(p => ({ ...p, canPlay: false })); setError(null); }}
              hasError={!!fieldErrors.canPlay}
            />
          )}

          {/* Borked short-circuit -- show rating and skip the rest */}
          {installFailed && installComplete && (
            <>
              <DerivedRatingBadge rating="borked" />
              <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.5 }}>
                The game failed to install or start. Your report will be submitted as Borked.
              </div>
              <div style={fieldErrors.notes ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
                <TextField
                  label="Notes (optional)"
                  description="Describe what went wrong during install or startup."
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
              <SectionHeader label="Proton and Tinkering" />
              <div style={fieldErrors.protonType ? { outline: '1px solid #f59e0b', borderRadius: 4 } : {}}>
                <div style={{ fontSize: 12, color: fieldErrors.protonType ? '#f59e0b' : '#c8d4e0', marginBottom: 4 }}>
                  Which Proton version did you use? <span style={{ color: '#ef4444' }}>*</span>
                </div>
                <DropdownItem
                  rgOptions={PROTON_TYPE_OPTIONS.map(o => ({ data: o.data, label: o.label }))}
                  selectedOption={protonType ?? null}
                  onChange={(opt) => { setProtonType(opt.data as ProtonType); setFieldErrors(p => ({ ...p, protonType: false })); }}
                  label="Proton type"
                />
              </div>

              <div style={fieldErrors.proton ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
                <TextField
                  label={`${t().nativeReport.protonVersion} *`}
                  description={t().nativeReport.protonVersionHint}
                  value={proton}
                  onChange={(e) => { setProton(e.target.value); setFieldErrors(p => ({ ...p, proton: false })); setError(null); }}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, color: '#c8d4e0', marginBottom: 4 }}>
                  Are you using any of these common tinkering methods?
                </div>
                {TINKERING_METHODS.map(m => (
                  <TinkeringCheckbox
                    key={m}
                    label={m}
                    checked={tinkeringMethods.has(m)}
                    onToggle={() => toggleTinkering(m)}
                  />
                ))}
              </div>

              {/* ===== Technical Details ===== */}
              <SectionHeader label="Technical Details" />
              {([
                ['performanceFaults', t().nativeReport.faultPerformance],
                ['graphicalFaults',   t().nativeReport.faultGraphical],
                ['windowingFaults',   t().nativeReport.faultWindowing],
                ['audioFaults',       t().nativeReport.faultAudio],
                ['inputFaults',       t().nativeReport.faultInput],
                ['stabilityFaults',   t().nativeReport.faultStability],
                ['saveGameFaults',    t().nativeReport.faultSaveGame],
                ['significantBugs',   t().nativeReport.faultSignificantBugs],
              ] as [FaultKey, string][]).map(([key, label]) => (
                <YesNoDropdown
                  key={key}
                  label={label}
                  value={faults[key]}
                  onChange={(v) => { setFault(key, v); setFieldErrors(p => ({ ...p, [key]: false })); setError(null); }}
                  hasError={!!fieldErrors[key]}
                />
              ))}

              {/* ===== Multiplayer (optional) ===== */}
              <SectionHeader label="Multiplayer (optional)" />
              <YesNoDropdown
                label="Did you try to play multiplayer online?"
                value={onlineMultiplayer}
                onChange={setOnlineMultiplayer}
                hasError={false}
                required={false}
              />
              <YesNoDropdown
                label="Did you try to play multiplayer locally (couch play)?"
                value={localMultiplayer}
                onChange={setLocalMultiplayer}
                hasError={false}
                required={false}
              />

              {/* ===== Verdict ===== */}
              <SectionHeader label="Verdict" />
              <YesNoDropdown
                label={t().nativeReport.verdictQuestion}
                value={verdict}
                onChange={(v) => { setVerdict(v); setFieldErrors(p => ({ ...p, verdict: false })); setError(null); }}
                hasError={!!fieldErrors.verdict}
              />

              {/* Summary field (ProtonDB-style, 140 chars) */}
              <div>
                <TextField
                  label="Summary (max 140 chars)"
                  description="One-line summary of your experience."
                  value={summary}
                  onChange={(e) => setSummary(e.target.value.slice(0, 140))}
                  bShowClearAction
                />
                <div style={{ fontSize: 10, color: '#4a6a8a', textAlign: 'right', marginTop: 2 }}>
                  {summary.length}/140
                </div>
              </div>

              {/* OOB - only shown when verdict=yes and 0 faults (platinum path) */}
              {verdict === 'yes' && !anyFaultForOob && (
                <YesNoDropdown
                  label="Did the game run out of the box without any tweaks required?"
                  value={verdictOob}
                  onChange={(v) => { setVerdictOob(v); setFieldErrors(p => ({ ...p, verdictOob: false })); setError(null); }}
                  hasError={!!fieldErrors.verdictOob}
                />
              )}

              {/* Tinker OOB confirmation - shown when tinkering and verdict=yes */}
              {verdict === 'yes' && isTinker && !anyFaultForOob && (
                <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.5, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 4 }}>
                  Your report will be classified as a tinker report.
                  Have you also tried playing with default Steam/Proton without any tinkering?
                </div>
              )}

              {/* Derived rating preview */}
              <DerivedRatingBadge rating={derivedRating} />

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
        </Focusable>

        {error && (
          <div style={{ fontSize: 11, color: '#ef4444', padding: '6px 10px', marginTop: 8, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4 }}>
            {error}
          </div>
        )}

        <Focusable style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <DialogButton
            onClick={handleSubmit}
            disabled={submitting || (canInstall === null)}
            style={{ flex: 1, minWidth: 120, padding: '8px 16px', fontSize: 12 }}
          >
            {submitting ? t().common.loading : t().nativeReport.submit}
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
