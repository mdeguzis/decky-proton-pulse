// Shared "kind of Proton" taxonomy used by both the Create Config screen
// (CompatToolVersionPicker type dropdown) and the Submit Report modal
// (protonType question). Keeping one canonical list means new tools like
// Valve Proton only need to be added in a single place.
//
// Data tokens are stable and safe to persist. Labels resolve from the i18n
// tree at render time so language switches re-render correctly.

import { t } from './i18n';

export const PROTON_KIND_DATA = [
  'valve',
  'proton-ge',
  'proton-cachyos',
  'native',
  'notListed',
] as const;
export type ProtonKind = typeof PROTON_KIND_DATA[number];

// Backwards-compat mapping: earlier drafts and submitted reports carried the
// older tokens ('current', 'ge', 'older'). Load path normalizes them so the
// UI still shows a valid option and submission uses the new taxonomy.
export function normalizeProtonKind(raw: string | null | undefined): ProtonKind | null {
  if (!raw) return null;
  const map: Record<string, ProtonKind> = {
    current: 'valve',
    valve: 'valve',
    ge: 'proton-ge',
    'proton-ge': 'proton-ge',
    'proton-cachyos': 'proton-cachyos',
    older: 'notListed',
    native: 'native',
    notListed: 'notListed',
  };
  return map[raw] ?? null;
}

export function protonKindLabel(kind: ProtonKind): string {
  const extras = t().extras;
  switch (kind) {
    case 'valve':
      return extras?.reportFormProtonValve?.() ?? extras?.reportFormProtonDefault?.() ?? 'Valve Proton';
    case 'proton-ge':
      return extras?.reportFormProtonGE?.() ?? 'Proton-GE';
    case 'proton-cachyos':
      return extras?.reportFormProtonCachyOS?.() ?? 'Proton-CachyOS';
    case 'native':
      return extras?.reportFormProtonNative?.() ?? 'Native (no Proton)';
    case 'notListed':
      return extras?.reportFormProtonNotListed?.() ?? 'Not listed';
  }
}

export function protonKindOptions(): { data: ProtonKind; label: string }[] {
  return PROTON_KIND_DATA.map((data) => ({ data, label: protonKindLabel(data) }));
}
