import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyLocalDataBackupPayload,
  applyPluginSettingsBackupPayload,
  buildLocalDataBackupPayload,
  buildPluginSettingsBackupPayload,
  exportLocalDataBackup,
  importLocalDataBackup,
  isPluginSettingsEntryKey,
} from './localDataBackup';

const { callableMock } = vi.hoisted(() => ({
  callableMock: vi.fn(),
}));

vi.mock('@decky/api', () => ({
  callable: () => callableMock,
}));
vi.mock('./i18n', () => ({
  setLanguage: vi.fn(),
}));

const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach((key) => delete localStorageStore[key]); },
  key: (index: number) => Object.keys(localStorageStore)[index] ?? null,
  get length() { return Object.keys(localStorageStore).length; },
};

vi.stubGlobal('localStorage', localStorageMock);
describe('localDataBackup', () => {
  beforeEach(() => {
    localStorageMock.clear();
    callableMock.mockReset();
  });

  it('captures only Proton Pulse local storage entries', () => {
    localStorageMock.setItem('proton-pulse:language', '"de"');
    localStorageMock.setItem('proton-pulse:tracked-configs', '[{"appId":1}]');
    localStorageMock.setItem('other-key', '"ignore-me"');

    const payload = buildLocalDataBackupPayload();

    expect(payload.format).toBe('proton-pulse-local-backup');
    expect(payload.entries).toEqual({
      language: '"de"',
      'tracked-configs': '[{"appId":1}]',
    });
  });

  it('replaces existing Proton Pulse entries on restore', () => {
    localStorageMock.setItem('proton-pulse:language', '"en"');
    localStorageMock.setItem('proton-pulse:notifications-enabled', 'true');

    const restoredCount = applyLocalDataBackupPayload({
      format: 'proton-pulse-local-backup',
      version: 1,
      exportedAt: '2026-04-10T00:00:00.000Z',
      entries: {
        language: '"fr"',
        'custom-toggles': '[{"id":"x"}]',
      },
    });

    expect(restoredCount).toBe(2);
    expect(localStorageMock.getItem('proton-pulse:language')).toBe('"fr"');
    expect(localStorageMock.getItem('proton-pulse:custom-toggles')).toBe('[{"id":"x"}]');
    expect(localStorageMock.getItem('proton-pulse:notifications-enabled')).toBeNull();
  });

  it('exports the serialized payload through the backend callable', async () => {
    callableMock.mockResolvedValue({
      success: true,
      message: 'Exported',
      path: '/tmp/backup.zip',
    });
    localStorageMock.setItem('proton-pulse:language', '"de"');

    await expect(exportLocalDataBackup()).resolves.toEqual({
      success: true,
      message: 'Exported',
      path: '/tmp/backup.zip',
    });

    expect(callableMock).toHaveBeenCalledTimes(1);
    expect(callableMock.mock.calls[0]?.[0]).toContain('"format":"proton-pulse-local-backup"');
    expect(callableMock.mock.calls[0]?.[0]).toContain('"language":"\\"de\\""');
  });

  it('imports a backend payload and returns the restored entry count', async () => {
    callableMock.mockResolvedValue({
      success: true,
      message: 'Imported',
      payload: JSON.stringify({
        format: 'proton-pulse-local-backup',
        version: 1,
        exportedAt: '2026-04-10T00:00:00.000Z',
        entries: {
          language: '"ja"',
          'custom-toggles': '[{"id":"x"}]',
        },
      }),
    });

    await expect(importLocalDataBackup('/tmp/backup.zip')).resolves.toEqual({
      success: true,
      message: 'Imported',
      restoredCount: 2,
    });
    expect(localStorageMock.getItem('proton-pulse:language')).toBe('"ja"');
  });

  it('returns the backend error when import fails before payload restore', async () => {
    callableMock.mockResolvedValue({
      success: false,
      message: 'Missing archive',
    });

    await expect(importLocalDataBackup('/tmp/missing.zip')).resolves.toEqual({
      success: false,
      message: 'Missing archive',
    });
  });

  it('rejects invalid backup payloads', () => {
    const invalidPayload = {
      format: 'proton-pulse-local-backup',
      version: 2,
      exportedAt: '2026-04-10T00:00:00.000Z',
      entries: {},
    } as unknown as Parameters<typeof applyLocalDataBackupPayload>[0];

    expect(() => applyLocalDataBackupPayload(invalidPayload)).toThrow(
      'Backup file is not a valid Proton Pulse local data export.',
    );
  });

  describe('isPluginSettingsEntryKey', () => {
    // tracked-configs and data-cache are the user-generated bits — they live in
    // localStorage under the same prefix but shouldn't travel with a plugin
    // settings backup. Same idea for edited-reports:* drafts
    it('rejects the exact non-plugin keys', () => {
      expect(isPluginSettingsEntryKey('tracked-configs')).toBe(false);
      expect(isPluginSettingsEntryKey('data-cache')).toBe(false);
    });

    it('rejects anything starting with edited-reports:', () => {
      expect(isPluginSettingsEntryKey('edited-reports:620')).toBe(false);
    });

    it('accepts regular plugin settings', () => {
      expect(isPluginSettingsEntryKey('language')).toBe(true);
      expect(isPluginSettingsEntryKey('notifications-enabled')).toBe(true);
    });
  });

  describe('plugin-settings subset backup', () => {
    it('buildPluginSettingsBackupPayload skips tracked-configs / data-cache / edited-reports:', () => {
      localStorageMock.setItem('proton-pulse:language', '"de"');
      localStorageMock.setItem('proton-pulse:tracked-configs', '[{"appId":1}]');
      localStorageMock.setItem('proton-pulse:data-cache', '{}');
      localStorageMock.setItem('proton-pulse:edited-reports:620', '{}');
      localStorageMock.setItem('proton-pulse:notifications-enabled', 'true');

      const payload = buildPluginSettingsBackupPayload();

      expect(payload.entries).toEqual({
        language: '"de"',
        'notifications-enabled': 'true',
      });
    });

    it('applyPluginSettingsBackupPayload restores only plugin keys and leaves user data alone', () => {
      localStorageMock.setItem('proton-pulse:tracked-configs', '[{"appId":1}]');
      localStorageMock.setItem('proton-pulse:language', '"en"');

      const restoredCount = applyPluginSettingsBackupPayload({
        format: 'proton-pulse-local-backup',
        version: 1,
        exportedAt: '2026-04-10T00:00:00.000Z',
        entries: {
          language: '"fr"',
          'tracked-configs': '[{"appId":99}]', // should be filtered out
        },
      });

      expect(restoredCount).toBe(1);
      expect(localStorageMock.getItem('proton-pulse:language')).toBe('"fr"');
      // user's own tracked-configs wasn't touched
      expect(localStorageMock.getItem('proton-pulse:tracked-configs')).toBe('[{"appId":1}]');
    });

    it('applyPluginSettingsBackupPayload rejects invalid payloads', () => {
      const bad = {
        format: 'nope',
        version: 1,
        exportedAt: '',
        entries: {},
      } as unknown as Parameters<typeof applyPluginSettingsBackupPayload>[0];
      expect(() => applyPluginSettingsBackupPayload(bad)).toThrow(
        /not a valid Proton Pulse local data export/,
      );
    });
  });
});
