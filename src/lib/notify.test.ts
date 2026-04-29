import { beforeEach, describe, expect, it, vi } from 'vitest';

const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach((key) => delete localStorageStore[key]); },
};

const deckyToastMock = vi.fn();

vi.mock('@decky/api', () => ({
  toaster: {
    toast: deckyToastMock,
  },
  callable: () => vi.fn().mockResolvedValue(true),
}));

vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
  deckyToastMock.mockReset();
  vi.resetModules();
});

describe('notificationsEnabled', () => {
  it('defaults to true when no setting is stored', async () => {
    const { notificationsEnabled } = await import('./notify');
    expect(notificationsEnabled()).toBe(true);
  });

  it('returns false when notifications are disabled in settings', async () => {
    localStorageMock.setItem('proton-pulse:notifications-enabled', JSON.stringify(false));
    const { notificationsEnabled } = await import('./notify');
    expect(notificationsEnabled()).toBe(false);
  });
});

describe('toaster', () => {
  it('forwards toast calls when notifications are enabled', async () => {
    const { toaster } = await import('./notify');

    toaster.toast({ title: 'Proton Pulse', body: 'Hello' });

    expect(deckyToastMock).toHaveBeenCalledTimes(1);
    expect(deckyToastMock).toHaveBeenCalledWith({ playSound: true, title: 'Proton Pulse', body: 'Hello' });
  });

  it('uses eType:40 (playSound:false in Steam W map) and sound:0 when toast sound is disabled', async () => {
    localStorageMock.setItem('proton-pulse:toast-sound-enabled', JSON.stringify(false));
    const { toaster } = await import('./notify');

    toaster.toast({ title: 'Proton Pulse', body: 'Silent' });

    expect(deckyToastMock).toHaveBeenCalledTimes(1);
    expect(deckyToastMock).toHaveBeenCalledWith({ playSound: false, sound: 0, eType: 40, title: 'Proton Pulse', body: 'Silent' });
  });

  it('suppresses toast calls when notifications are disabled', async () => {
    localStorageMock.setItem('proton-pulse:notifications-enabled', JSON.stringify(false));
    const { toaster } = await import('./notify');

    toaster.toast({ title: 'Proton Pulse', body: 'Muted' });

    expect(deckyToastMock).not.toHaveBeenCalled();
  });
});
