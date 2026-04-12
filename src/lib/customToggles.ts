import { getSetting, setSetting } from './settings';

const STORAGE_KEY = 'custom-toggles';

export type CustomToggleScope = 'global' | 'game';
export type CustomToggleValueType = 'string' | 'bool' | 'int' | 'float' | 'toggle';

export interface StoredCustomToggle {
  id: string;
  title: string;
  key: string;
  scope: CustomToggleScope;
  appId?: number;
  valueType: CustomToggleValueType;
  value: string;
}

function sanitizeStoredToggle(toggle: StoredCustomToggle): StoredCustomToggle {
  return {
    ...toggle,
    title: toggle.title.trim(),
    key: toggle.key.trim(),
    value: toggle.value.trim(),
  };
}

// a toggle is valid if it has a title and either a key (env var) or a value (raw arg)
function isValidToggle(toggle: StoredCustomToggle): boolean {
  return !!toggle.title && (!!toggle.key || !!toggle.value);
}

export function getCustomToggles(): StoredCustomToggle[] {
  const raw = getSetting<StoredCustomToggle[]>(STORAGE_KEY, []);
  return raw
    .map(sanitizeStoredToggle)
    .filter(isValidToggle);
}

export function setCustomToggles(toggles: StoredCustomToggle[]): void {
  setSetting(
    STORAGE_KEY,
    toggles
      .map(sanitizeStoredToggle)
      .filter(isValidToggle),
  );
}

export function getScopedCustomToggles(appId: number | null): StoredCustomToggle[] {
  return getCustomToggles().filter((toggle) =>
    toggle.scope === 'global' || (appId !== null && toggle.scope === 'game' && toggle.appId === appId),
  );
}

export function syncScopedCustomToggles(appId: number | null, scopedToggles: StoredCustomToggle[]): void {
  const preserved = getCustomToggles().filter((toggle) =>
    toggle.scope === 'game' && toggle.appId !== undefined && toggle.appId !== appId,
  );
  setCustomToggles([...preserved, ...scopedToggles]);
}

export function normalizeCustomToggleValue(valueType: CustomToggleValueType, rawValue: string): string {
  const trimmed = rawValue.trim();
  if (valueType === 'bool') {
    const normalized = trimmed.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return '1';
    if (['0', 'false', 'no', 'off'].includes(normalized)) return '0';
    return trimmed || '0';
  }
  if (valueType === 'int') {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? trimmed : String(parsed);
  }
  if (valueType === 'float') {
    const parsed = Number.parseFloat(trimmed);
    return Number.isNaN(parsed) ? trimmed : String(parsed);
  }
  if (valueType === 'toggle') {
    return trimmed;
  }
  return rawValue;
}

export function inferCustomToggleValueType(value: string): CustomToggleValueType {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('-')) return 'toggle';
  if (['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'].includes(trimmed)) return 'bool';
  if (/^-?\d+$/.test(trimmed)) return 'int';
  if (/^-?\d+\.\d+$/.test(trimmed)) return 'float';
  return 'string';
}
