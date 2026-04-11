import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyLocalDataBackupPayload,
  buildLocalDataBackupPayload,
} from './localDataBackup';

vi.mock('@decky/api', () => ({
  callable: () => vi.fn(),
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
});
