import { useState, useEffect } from 'react';
import { Focusable, DialogButton, SteamSpinner, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';

const PpDialogButton = DialogButton as React.ComponentType<React.ComponentProps<typeof DialogButton> & { onFocus?: (e: React.FocusEvent<HTMLElement>) => void; onBlur?: () => void }>;
import { callable } from '@decky/api';
import type { SystemInfo } from '../../types';
import { t } from '../../lib/i18n';

interface GameReqField { label: string; value: string }
interface GameReqResponse {
  min_ram_gb: number | null;
  min_cpu: string | null;
  min_gpu: string | null;
  fields: GameReqField[] | null;
}
interface PlatformFlags { windows?: boolean; mac?: boolean; linux?: boolean }
interface PlatformsResponse {
  platforms: PlatformFlags;
  release_date: string | null;
  last_updated: string | null;
  storage_free_gb: number | null;
}

const getGameRequirements = callable<[string], GameReqResponse>('get_game_requirements');
const getGamePlatforms   = callable<[string], PlatformsResponse>('get_game_platforms');

function buildOurValue(f: GameReqField, sysInfo: SystemInfo | null, storageFreeGb: number | null): string {
  const label = f.label.toLowerCase();
  if (label.includes('memory') || label === 'ram')
    return sysInfo?.ram_gb != null ? `${sysInfo.ram_gb} GB RAM` : '-';
  if (label === 'vram' || (label.includes('video') && label.includes('mem')))
    return sysInfo?.vram_mb != null ? `${(sysInfo.vram_mb / 1024).toFixed(1)} GB` : '-';
  if (label.includes('processor') || label === 'cpu')
    return sysInfo?.cpu ?? '-';
  if (label.includes('graphic') || label.includes('video card') || label === 'gpu') {
    const gpu = sysInfo?.gpu ?? null;
    const vram = sysInfo?.vram_mb != null ? `${(sysInfo.vram_mb / 1024).toFixed(0)} GB VRAM` : null;
    return [gpu, vram].filter(Boolean).join(', ') || '-';
  }
  if (label === 'os' || label.includes('operating system'))
    return sysInfo?.distro ?? '-';
  if (label.includes('kernel'))
    return sysInfo?.kernel ?? '-';
  if (label.includes('storage') || label.includes('disk') || label.includes('hard drive') || label.includes('hard disk'))
    return storageFreeGb != null ? `${storageFreeGb} GB free` : '-';
  return '-';
}

const ROW_BTN: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  alignItems: 'center',
  width: '100%',
  minHeight: 44,
  padding: '6px 12px',
  background: 'transparent',
  textAlign: 'left',
  fontSize: 12,
  color: '#e8f4ff',
  gap: 8,
};

const SECTION_HDR: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#7a9bb5',
  padding: '14px 16px 4px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

interface Props { appId: number | null; appName: string; sysInfo: SystemInfo | null }

export function SystemRequirementsTab({ appId, sysInfo }: Props) {
  const [reqs, setReqs]                 = useState<GameReqResponse | null>(null);
  const [platformData, setPlatformData] = useState<PlatformsResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [focusedRow, setFocusedRow]   = useState<string | null>(null);

  useEffect(() => {
    if (!appId) { setLoading(false); return; }
    setLoading(true);
    setReqs(null);
    setPlatformData(null);
    Promise.all([
      getGameRequirements(String(appId)).then(setReqs).catch(() => {}),
      getGamePlatforms(String(appId)).then(setPlatformData).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [appId]);


  const platforms = platformData?.platforms ?? {};
  const releaseDate = platformData?.release_date ?? null;
  const lastUpdated = platformData?.last_updated ?? null;
  const storageFreeGb = platformData?.storage_free_gb ?? null;

  const platformBadge = platforms.linux
    ? { text: 'NATIVE', bg: '#2f6f4f', color: '#ecfff1' }
    : platforms.windows && !platforms.linux
    ? { text: 'PROTON REQUIRED', bg: '#7d6123', color: '#fff5dc' }
    : null;

  const platformRows = [
    { name: 'Windows', available: !!platforms.windows },
    { name: 'macOS',   available: !!platforms.mac },
    { name: 'Linux',   available: !!platforms.linux },
  ];

  const reqFields = reqs?.fields ?? [];

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) evt.preventDefault();
  };

  // Set focused-row marker AND scroll the focused row to viewport center.
  // Default Steam behaviour only scrolls when the focused element is
  // off-screen which makes early D-pad presses feel "dead". Centering on
  // every focus change gives immediate motion feedback
  const onRowFocus = (id: string) => (e: React.FocusEvent<HTMLElement>) => {
    setFocusedRow(id);
    e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  if (loading) {
    // Wrap the spinner in a Focusable that ALSO has a focusable child (DialogButton).
    // Without a focusable child, the gamepad input has nowhere to land and
    // gets routed to whatever Steam UI sits behind the plugin -- which is
    // why pressing buttons here used to open Steam settings or weird routes.
    // Adding a hidden but focusable wrapper keeps input contained
    return (
      <Focusable style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
        <DialogButton
          onClick={() => {}}
          style={{
            position: 'absolute', width: 1, height: 1,
            padding: 0, border: 'none', background: 'transparent',
            clip: 'rect(0 0 0 0)', overflow: 'hidden',
          }}
        >loading</DialogButton>
        <SteamSpinner />
      </Focusable>
    );
  }

  return (
    <Focusable onGamepadDirection={handleRootDirection} style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>

      {/* badge absolute top-right */}
      {platformBadge && (
        <div style={{ position: 'absolute', top: 0, right: 16, zIndex: 10 }}>
          <div style={{ borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 700, background: platformBadge.bg, color: platformBadge.color }}>
            {platformBadge.text}
          </div>
        </div>
      )}
      <div style={{ padding: '6px 16px 2px', fontSize: 10, color: '#4a6070', textAlign: 'left' }}>
        {t().detail.sysReqFocusHint}
      </div>

      {/* --- Platform availability --- */}
      <PpDialogButton onClick={() => {}}
        onFocus={onRowFocus('hdr-platform')}
        onBlur={() => setFocusedRow(null)}
        style={{ ...SECTION_HDR, background: 'transparent', border: 'none', boxShadow: 'none', textAlign: 'left', borderRight: focusedRow === 'hdr-platform' ? '3px solid #1a9fff' : '3px solid transparent', paddingLeft: 13 }}
      >{t().detail.platformAvailability}</PpDialogButton>

      {/* column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '2px 12px 4px', fontSize: 10, color: '#556a7a', fontWeight: 700, textTransform: 'uppercase' }}>
        <span>{t().detail.platformColumn}</span><span>{t().detail.statusColumn}</span>
      </div>

      {platformRows.map((row, i) => (
        <PpDialogButton key={row.name} onClick={() => {}}
          onFocus={onRowFocus(`plat-${row.name}`)}
          onBlur={() => setFocusedRow(null)}
          style={{
            ...ROW_BTN,
            borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
            borderRight: focusedRow === `plat-${row.name}` ? '3px solid #1a9fff' : '3px solid transparent',
          }}>
          <span style={{ fontSize: 12, color: '#c8dcea', fontWeight: 600 }}>{row.name}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: row.available ? '#4caf50' : '#555' }}>
              {row.available ? '✓ Available' : '✗ Not available'}
            </span>
            {row.name === 'Windows' && releaseDate && (
              <span style={{ fontSize: 10, color: '#9db0c4' }}>{t().detail.releasedLabel} {releaseDate}</span>
            )}
            {lastUpdated && (
              <span style={{ fontSize: 10, color: '#9db0c4' }}>{t().detail.updatedLabel} {lastUpdated}</span>
            )}
          </div>
        </PpDialogButton>
      ))}

      {/* --- Minimum requirements vs our system --- */}
      <PpDialogButton onClick={() => {}}
        onFocus={onRowFocus('hdr-min')}
        onBlur={() => setFocusedRow(null)}
        style={{ ...SECTION_HDR, background: 'transparent', border: 'none', boxShadow: 'none', textAlign: 'left', borderRight: focusedRow === 'hdr-min' ? '3px solid #1a9fff' : '3px solid transparent', paddingLeft: 13 }}
      >{t().detail.minimumRequirements}</PpDialogButton>

      {/* column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '2px 12px 4px', fontSize: 10, color: '#556a7a', fontWeight: 700, textTransform: 'uppercase' }}>
        <span>{t().detail.requirementColumn}</span><span>{t().detail.minOursColumn}</span>
      </div>

      {reqFields.length === 0 ? (
        <div style={{ padding: '8px 16px', color: '#9db0c4', fontSize: 12 }}>
          {t().detail.noGameRequirementsFound}
        </div>
      ) : reqFields.map((f, i) => {
        const ourValue = buildOurValue(f, sysInfo, storageFreeGb);
        return (
          <PpDialogButton key={i} onClick={() => {}}
            onFocus={onRowFocus(`req-${i}`)}
            onBlur={() => setFocusedRow(null)}
            style={{ ...ROW_BTN, borderRight: focusedRow === `req-${i}` ? '3px solid #1a9fff' : '3px solid transparent' }}>
            <span style={{ color: '#c8dcea', fontWeight: 600 }}>{f.label}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 11, color: '#9db0c4' }}>{f.value}</span>
              {ourValue !== '-' && (
                <span style={{ fontSize: 11, color: '#7ecfff' }}>{t().detail.oursLabel} {ourValue}</span>
              )}
            </div>
          </PpDialogButton>
        );
      })}

      {/* Bottom spacer: clears the ~64px Steam BPM footer so the last row
          can scroll into view with onFocus's scrollIntoView({block:'center'}) */}
      <div style={{ height: 80, flexShrink: 0 }} aria-hidden="true" />
    </Focusable>
  );
}
