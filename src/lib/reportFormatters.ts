// src/lib/reportFormatters.ts

export const RATING_COLORS: Record<string, string> = {
  platinum: '#b0e0e6',
  gold: '#ffd700',
  silver: '#c0c0c0',
  bronze: '#cd7f32',
  borked: '#ff4444',
  pending: '#888888',
};

export function formatProtonLabel(version: string): string {
  const trimmed = version.trim();
  if (/^ge-proton/i.test(trimmed)) return `Proton GE ${trimmed.replace(/^ge-proton/i, '')}`;
  return `Proton ${trimmed}`;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function buildLaunchOptionPreview(protonVersion: string): string {
  return `PROTON_VERSION="${protonVersion}" %command%`;
}

export function matchLabel(gpuTier: string, gpuVendor: string | null | undefined): string {
  if (!gpuVendor || gpuTier === 'unknown') return 'Unknown GPU match';
  return gpuTier === gpuVendor ? 'Matches your GPU vendor' : 'Different GPU vendor';
}
