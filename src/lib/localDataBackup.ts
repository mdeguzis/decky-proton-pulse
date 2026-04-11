import { callable } from '@decky/api';
import { getAllPrefixedSettingsRaw, getSetting, replaceAllPrefixedSettingsRaw } from './settings';
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

export function buildLocalDataBackupPayload(): LocalDataBackupPayload {
  return {
    format: 'proton-pulse-local-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: getAllPrefixedSettingsRaw(),
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
