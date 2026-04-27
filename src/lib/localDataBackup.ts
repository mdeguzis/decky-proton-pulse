import { callable } from '@decky/api';
import {
  getAllPrefixedSettingsRaw,
  getSetting,
  replaceAllPrefixedSettingsRaw,
  replacePrefixedSettingsSubsetRaw,
} from './settings';
import { setLanguage, type Language } from './i18n';

const exportLocalDataBackupCallable = callable<[payloadJson: string], {
  success: boolean;
  message: string;
  path?: string;
}>('export_local_data_backup');

const importLocalDataBackupCallable = callable<[archivePath: string], {
  success: boolean;
  message: string;
  payload?: string;
}>('import_local_data_backup');

export interface LocalDataBackupPayload {
  format: 'proton-pulse-local-backup';
  version: 1;
  exportedAt: string;
  entries: Record<string, string>;
}

const NON_PLUGIN_SETTINGS_EXACT_KEYS = new Set([
  'tracked-configs',
  'data-cache',
]);

const NON_PLUGIN_SETTINGS_PREFIXES = [
  'edited-reports:',
];

export function isPluginSettingsEntryKey(key: string): boolean {
  if (NON_PLUGIN_SETTINGS_EXACT_KEYS.has(key)) return false;
  return !NON_PLUGIN_SETTINGS_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function buildLocalDataBackupPayload(): LocalDataBackupPayload {
  return {
    format: 'proton-pulse-local-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: getAllPrefixedSettingsRaw(),
  };
}

export function buildPluginSettingsBackupPayload(): LocalDataBackupPayload {
  const entries = Object.fromEntries(
    Object.entries(getAllPrefixedSettingsRaw()).filter(([key]) => isPluginSettingsEntryKey(key)),
  );
  return {
    format: 'proton-pulse-local-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
}

export function applyLocalDataBackupPayload(payload: LocalDataBackupPayload): number {
  if (payload.format !== 'proton-pulse-local-backup' || payload.version !== 1 || !payload.entries) {
    throw new Error('Backup file is not a valid Proton Pulse local data export.');
  }
  replaceAllPrefixedSettingsRaw(payload.entries);
  const restoredLanguage = getSetting<Language | 'auto'>('language', 'auto');
  setLanguage(restoredLanguage);
  return Object.keys(payload.entries).length;
}

export function applyPluginSettingsBackupPayload(payload: LocalDataBackupPayload): number {
  if (payload.format !== 'proton-pulse-local-backup' || payload.version !== 1 || !payload.entries) {
    throw new Error('Backup file is not a valid Proton Pulse local data export.');
  }
  const filteredEntries = Object.fromEntries(
    Object.entries(payload.entries).filter(([key]) => isPluginSettingsEntryKey(key)),
  );
  replacePrefixedSettingsSubsetRaw(filteredEntries, isPluginSettingsEntryKey);
  const restoredLanguage = getSetting<Language | 'auto'>('language', 'auto');
  setLanguage(restoredLanguage);
  return Object.keys(filteredEntries).length;
}

export async function exportLocalDataBackup(): Promise<{ success: boolean; message: string; path?: string }> {
  const payload = buildLocalDataBackupPayload();
  return exportLocalDataBackupCallable(JSON.stringify(payload));
}

export async function importLocalDataBackup(archivePath: string): Promise<{ success: boolean; message: string; restoredCount?: number }> {
  const result = await importLocalDataBackupCallable(archivePath);
  if (!result.success || !result.payload) {
    return { success: false, message: result.message };
  }
  const restoredCount = applyLocalDataBackupPayload(JSON.parse(result.payload) as LocalDataBackupPayload);
  return {
    success: true,
    message: result.message,
    restoredCount,
  };
}
