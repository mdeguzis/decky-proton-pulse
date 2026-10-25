import { stripProtonVersion } from './launchVars';
// src/lib/reportFormatters.ts

import { isSteamDefaultProton, steamDefaultToolSync } from './steamDefaultState';
import { t } from './i18n';

export const RATING_COLORS: Record<string, string> = {
  platinum: '#e5e4e2',
  gold: '#ffd700',
  silver: '#c0c0c0',
  bronze: '#cd7f32',
  borked: '#ff4444',
  pending: '#888888',
};

export function formatProtonLabel(version: string): string {
  const trimmed = version.trim();
  // "Default" is Steam's default tool at report time, not a version (#115).
  if (isSteamDefaultProton(trimmed)) {
    const now = steamDefaultToolSync();
    return now ? t().extras!.steamDefaultProtonNow!(now.displayName) : t().extras!.steamDefaultProton!();
  }
  if (/^ge-proton/i.test(trimmed)) return `Proton GE ${trimmed.replace(/^ge-proton/i, '')}`;
  return `Proton ${trimmed}`;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

// What Apply will leave in the game's launch options (#92, #134): the
// current options with any legacy PROTON_VERSION token removed. Apply sets
// the Proton version through SpecifyCompatTool, never through launch options.
export function launchOptionsAfterApply(currentLaunchOptions: string): string {
  const cleaned = stripProtonVersion(currentLaunchOptions);
  return cleaned === '%command%' ? '' : cleaned;
}

export function buildNotesPreview(notes: string, maxLength = 120): string {
  const firstLine = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return '';
  }

  const hasMoreContent = notes
    .split(/\r?\n/)
    .slice(1)
    .some((line) => line.trim().length > 0);

  if (firstLine.length <= maxLength) {
    return hasMoreContent ? `${firstLine} [...]` : firstLine;
  }

  return `${firstLine.slice(0, Math.max(0, maxLength)).trimEnd()} [...]`;
}

export function matchLabel(gpuTier: string, gpuVendor: string | null | undefined): string {
  if (!gpuVendor || gpuTier === 'unknown') return 'Unknown GPU match';
  return gpuTier === gpuVendor ? 'Matches your GPU vendor' : 'Different GPU vendor';
}
