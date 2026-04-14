// src/components/NativePulseReportModal.tsx
// Submit a native Proton Pulse compatibility report, auto-capturing hardware.

import { useState } from 'react';
import { ModalRoot, Focusable, DialogButton, TextField, DropdownItem } from '@decky/ui';
import { toaster } from '../lib/notify';
import { submitUserConfig, VALID_OS, type ValidOS } from '../lib/userConfigs';
import type { SystemInfo, ProtonRating } from '../types';
import { t } from '../lib/i18n';
import { logFrontendEvent } from '../lib/logger';
import { isSteamShortcutApp } from '../lib/steamApps';

interface Props {
  appId: number;
  appName: string;
  sysInfo: SystemInfo | null;
  protonVersion?: string;
  closeModal?: () => void;
}

// ── OS mapping ────────────────────────────────────────────────────────────────

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

// ── Hardware table (two-column, ProtonDB style) ───────────────────────────────

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
    ...(sysInfo?.steam_deck_model ? [['Steam Deck', sysInfo.steam_deck_model] as [string,string]] : []),
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

// ── Modal ─────────────────────────────────────────────────────────────────────

const getRatings = (): { data: ProtonRating; label: string }[] => [
  { data: 'platinum', label: t().nativeReport.ratingPlatinum },
  { data: 'gold',     label: t().nativeReport.ratingGold },
  { data: 'silver',   label: t().nativeReport.ratingSilver },
  { data: 'bronze',   label: t().nativeReport.ratingBronze },
  { data: 'borked',   label: t().nativeReport.ratingBorked },
];

const getDurations = (): { data: string; label: string }[] => [
  { data: 'unreported',      label: t().nativeReport.durationUnreported },
  { data: 'underOneHour',    label: t().nativeReport.durationUnderOneHour },
  { data: 'oneToFourHours',  label: t().nativeReport.durationOneToFour },
  { data: 'fourToTenHours',  label: t().nativeReport.durationFourToTen },
  { data: 'overTenHours',    label: t().nativeReport.durationOverTen },
];

export function NativePulseReportModal({ appId, appName, sysInfo, protonVersion: initialProton = '', closeModal }: Props) {
  const isShortcut = isSteamShortcutApp(appId);

  const [rating,   setRating]   = useState<ProtonRating | ''>('');
  const [proton,   setProton]   = useState(initialProton);
  const [duration, setDuration] = useState('unreported');
  const [notes,    setNotes]    = useState('');
  const [os,       setOs]       = useState<ValidOS | ''>(mapDistroToValidOS(sysInfo?.distro ?? null));
  const [submitting, setSubmitting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // tracks which fields were invalid on the last submit attempt
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

  const ramStr = sysInfo?.ram_gb != null ? `${sysInfo.ram_gb} GB` : '';

  const handleSubmit = async () => {
    const errs: Record<string, boolean> = {};
    if (!rating)                       errs.rating   = true;
    if (!proton.trim())                errs.proton   = true;
    if (!os)                           errs.os       = true;
    if (duration === 'unreported')     errs.duration = true;
    if (notes.trim().length < 30)      errs.notes    = true;

    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError('Please fill in all required fields. Notes must be at least 30 characters.');
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

    setSubmitting(true);
    setError(null);

    void logFrontendEvent('INFO', 'Native Pulse report submission started', { appId, appName, rating, proton });

    const result = await submitUserConfig({
      appId:             String(appId),
      title:             appName,
      cpu:               sysInfo.cpu,
      gpu:               sysInfo.gpu,
      gpuDriver:         sysInfo.driver_version ?? undefined,
      gpuVendor:         sysInfo.gpu_vendor ?? undefined,
      ram:               ramStr,
      os:                os as ValidOS,
      kernel:            sysInfo.kernel ?? undefined,
      protonVersion:     proton.trim(),
      duration,
      rating:            rating as ProtonRating,
      notes:             notes.trim(),
      source:            'user',
      vramMb:            sysInfo.vram_mb ?? null,
      cpuCores:          sysInfo.cpu_cores ?? null,
      displayResolution: sysInfo.display_resolution ?? null,
      steamDeckModel:    sysInfo.steam_deck_model ?? null,
    });

    setSubmitting(false);

    if (result.ok) {
      void logFrontendEvent('INFO', 'Native Pulse report submitted', { appId });
      toaster.toast({ title: 'Proton Pulse', body: t().nativeReport.submitted });
      closeModal?.();
    } else {
      void logFrontendEvent('ERROR', 'Native Pulse report failed', { appId, error: result.error });
      setError(result.error ?? 'Submission failed.');
    }
  };

  if (isShortcut) {
    return (
      <ModalRoot onCancel={closeModal}>
        <div style={{ padding: 16, color: '#9dc4e8', fontSize: 12 }}>
          {t().extras!.shortcutCannotSubmit()}
        </div>
      </ModalRoot>
    );
  }

  return (
    <ModalRoot onCancel={closeModal}>
      <div style={{ padding: 16, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Header */}
        <div style={{ fontSize: 15, fontWeight: 700, color: '#e8f4ff', marginBottom: 3 }}>
          {t().nativeReport.title}
        </div>
        <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 12 }}>
          {appName}{appId ? ` · App ${appId}` : ''}
        </div>

        <Focusable style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Hardware summary */}
          <HardwareTable sysInfo={sysInfo} />

          {/* Rating */}
          <div style={fieldErrors.rating ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#e8f4ff', marginBottom: 4 }}>
              {t().nativeReport.rating} <span style={{ color: '#ef4444' }}>*</span>
            </div>
            <DropdownItem
              rgOptions={getRatings().map(r => ({ data: r.data, label: r.label }))}
              selectedOption={rating || null}
              onChange={(opt) => { setRating(opt.data as ProtonRating); setFieldErrors(p => ({ ...p, rating: false })); setError(null); }}
              label={t().nativeReport.rating}
            />
          </div>

          {/* Proton version */}
          <div style={fieldErrors.proton ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
            <TextField
              label={`${t().nativeReport.protonVersion} *`}
              description={t().nativeReport.protonVersionHint}
              value={proton}
              onChange={(e) => { setProton(e.target.value); setFieldErrors(p => ({ ...p, proton: false })); setError(null); }}
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
          </div>

          {/* Duration */}
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

          {/* Notes */}
          <div style={fieldErrors.notes ? { outline: '1px solid #ef4444', borderRadius: 4 } : {}}>
            <TextField
              label={`${t().nativeReport.notes} * (min 30 chars)`}
              description={t().nativeReport.notesHint}
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setFieldErrors(p => ({ ...p, notes: false })); }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: 11, color: '#ef4444', padding: '6px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: 4 }}>
              {error}
            </div>
          )}
        </Focusable>

        {/* Actions */}
        <Focusable style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <DialogButton
            onClick={handleSubmit}
            disabled={submitting}
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
