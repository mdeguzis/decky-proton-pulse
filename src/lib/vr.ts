// src/lib/vr.ts
// Canonical VR vocabulary for Pulse reports, mirroring the web app's
// js/shared/vr.js (proton-pulse-web #246). Plugin and web reports land in the
// same user_configs columns, so the two lists must stay in step -- change one,
// change the other.
//
// Two separate axes, easy to conflate:
//
//   playMode        how the REPORTER played it: 'flat' | 'vr'
//   vrCapability    what the GAME supports:     null | 'supported' | 'only'
//
// A game can support VR while the reporter played it flat, so a VR report must
// never be aggregated as if it were flatscreen: "runs great" means something
// very different at 90Hz in stereo.
//
// Canonical values are lowercase and hyphen-separated, matching the DB CHECK
// regex on user_configs.vr_runtime (migration 20260814010000).

export type PlayMode = 'flat' | 'vr';

export const PLAY_MODES: readonly PlayMode[] = ['flat', 'vr'] as const;

/**
 * VR runtimes, ordered by how common they are in Linux VR reports. 'other' is
 * last and always available -- a new OpenXR implementation lands every few
 * months and a reporter should never be blocked on our list being stale.
 */
export const VR_RUNTIMES: { key: string; label: string; subtitle: string }[] = [
  { key: 'steamvr', label: 'SteamVR', subtitle: "Valve's runtime" },
  { key: 'wivrn',   label: 'WiVRn',   subtitle: 'Standalone streaming (Monado-based)' },
  { key: 'alvr',    label: 'ALVR',    subtitle: 'Air Light VR streaming' },
  { key: 'monado',  label: 'Monado',  subtitle: 'Open-source OpenXR runtime' },
  { key: 'other',   label: 'Other',   subtitle: 'Anything else' },
];

export const VR_RUNTIME_KEYS = VR_RUNTIMES.map((r) => r.key);

/**
 * Canonical headsets, most common first (ordering taken from the VRDB corpus).
 * Not exhaustive by design -- the form pairs this with an "Other" free-text
 * box. Keep in step with VR_HEADSETS in the web app's js/shared/vr.js.
 */
export const VR_HEADSETS: readonly string[] = [
  'Meta Quest 3',
  'Meta Quest 3S',
  'Meta Quest 2',
  'Meta Quest Pro',
  'Meta Quest 1',
  'Valve Index',
  'HTC Vive',
  'HTC Vive Pro',
  'Pico 4',
  'HP Reverb G2',
  'Bigscreen Beyond',
  'Pimax',
  'Oculus Rift',
];

/** Sentinel option value for "headset not on the list, type it in". */
export const VR_DEVICE_OTHER = '__other';

/**
 * Normalize a raw play-mode signal into 'flat' | 'vr'.
 *
 * Returns null for empty or unrecognized input so callers can treat it as
 * unknown rather than silently claiming the report was flatscreen.
 */
export function normalizePlayMode(raw: unknown): PlayMode | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === 'flat' || s === 'vr') return s;
  if (/^(virtual[-_\s]?reality|headset|hmd)$/.test(s)) return 'vr';
  if (/^(flatscreen|flat[-_\s]screen|2d|desktop|monitor|normal|pancake)$/.test(s)) return 'flat';
  return null;
}

/**
 * Normalize a raw VR runtime signal into a canonical key.
 *
 * Unknown-but-clean values pass through lowercased so a runtime we have not
 * registered yet can still be recorded rather than dropped. The shape of the
 * passthrough matches the DB CHECK constraint exactly, so anything this
 * returns is guaranteed to be storable.
 */
export function normalizeVrRuntime(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (VR_RUNTIME_KEYS.includes(s)) return s;
  if (/^steam\s*vr$/.test(s) || /\bsteamvr\b/.test(s)) return 'steamvr';
  if (/\bwivrn\b/.test(s)) return 'wivrn';
  if (/\balvr\b/.test(s)) return 'alvr';
  if (/\bmonado\b/.test(s)) return 'monado';
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 32) return s;
  return null;
}

/** Human label for a runtime key, falling back to the raw key. */
export function vrRuntimeLabel(key: string | null): string {
  if (!key) return 'Unknown';
  return VR_RUNTIMES.find((r) => r.key === key)?.label ?? key;
}

/**
 * The vr_* columns for a submission.
 *
 * On a flatscreen report the VR fields are explicitly null rather than
 * omitted, so an edit that switches VR back to Flatscreen clears the stale
 * values instead of leaving them behind. Same rule as vrFieldsFromForm in the
 * web app.
 */
export function vrFieldsForSubmission(
  playMode: PlayMode | null,
  runtime: string | null,
  device: string | null,
): { play_mode: PlayMode | null; vr_runtime: string | null; vr_device: string | null } {
  if (playMode !== 'vr') {
    return { play_mode: playMode ?? null, vr_runtime: null, vr_device: null };
  }
  return {
    play_mode: 'vr',
    vr_runtime: normalizeVrRuntime(runtime),
    vr_device: (device ?? '').trim().slice(0, 64) || null,
  };
}
