import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { detailsMock, setLaunchMock, removeMock, cloudDeleteMock, logMock, deleteReportMock } = vi.hoisted(() => ({
  detailsMock: vi.fn(), setLaunchMock: vi.fn(), removeMock: vi.fn(),
  cloudDeleteMock: vi.fn(), logMock: vi.fn(), deleteReportMock: vi.fn(),
}));
vi.mock('./steamApps', () => ({
  getSteamAppDetails: detailsMock,
  getLaunchOptionsFromDetails: (d: any) => (d && typeof d.strLaunchOptions === 'string' ? d.strLaunchOptions : ''),
  setSteamLaunchOptions: setLaunchMock,
}));
vi.mock('./trackedConfigs', () => ({ removeTrackedConfig: removeMock }));
vi.mock('./cloudSync', () => ({ deleteCloudConfig: cloudDeleteMock }));
vi.mock('./logger', () => ({ logFrontendEvent: logMock }));
vi.mock('./userConfigs', () => ({ deleteMyReport: deleteReportMock }));

import { deleteConfigProfile, normalizeForMatch } from './configDelete';
import type { TrackedConfig } from './trackedConfigs';

const CONFIG: TrackedConfig = {
  appId: 1593500, appName: 'God of War', profileName: '60fps',
  protonVersion: 'GE-Proton11-11', launchOptions: 'MANGOHUD=1 %command%',
  enabledVars: { MANGOHUD: '1' }, appliedAt: 1,
} as TrackedConfig;

const steamHas = (launchOptions: string | null) =>
  detailsMock.mockResolvedValue({ details: launchOptions === null ? null : { strLaunchOptions: launchOptions } });

beforeEach(() => {
  for (const m of [detailsMock, setLaunchMock, removeMock, cloudDeleteMock, logMock, deleteReportMock]) m.mockReset();
  setLaunchMock.mockResolvedValue(undefined);
  cloudDeleteMock.mockResolvedValue(true);
});

describe('deleteConfigProfile (#118, #134)', () => {
  it('clears launch options only when they are exactly what this profile applied', async () => {
    steamHas('MANGOHUD=1  %command%');
    await expect(deleteConfigProfile(CONFIG)).resolves.toEqual({
      clearedLaunchOptions: true, launchOptionsReason: 'matched', cloudDeleted: true,
    });
    expect(setLaunchMock).toHaveBeenCalledWith(1593500, '');
  });

  it('treats a leftover PROTON_VERSION as part of the same applied options', async () => {
    steamHas('MANGOHUD=1 PROTON_VERSION="GE-Proton11-11" %command%');
    await expect(deleteConfigProfile(CONFIG)).resolves.toMatchObject({ clearedLaunchOptions: true });
  });

  it('leaves launch options alone when another profile or the user set them', async () => {
    // Regression: the delete wiped whatever was there, e.g. ~/lsfg %command%.
    steamHas('~/lsfg %command%');
    await expect(deleteConfigProfile(CONFIG)).resolves.toEqual({
      clearedLaunchOptions: false, launchOptionsReason: 'different', cloudDeleted: true,
    });
    expect(setLaunchMock).not.toHaveBeenCalled();
  });

  it('does not guess when Steam cannot be read, and skips empty options', async () => {
    steamHas(null);
    await expect(deleteConfigProfile(CONFIG)).resolves.toMatchObject({ launchOptionsReason: 'unreadable', clearedLaunchOptions: false });
    steamHas('');
    await expect(deleteConfigProfile(CONFIG)).resolves.toMatchObject({ launchOptionsReason: 'empty', clearedLaunchOptions: false });
    detailsMock.mockRejectedValueOnce(new Error('steam busy'));
    await expect(deleteConfigProfile(CONFIG)).resolves.toMatchObject({ launchOptionsReason: 'unreadable' });
    expect(setLaunchMock).not.toHaveBeenCalled();
  });

  it('never deletes the published report, but removes the profile and its cloud backup', async () => {
    steamHas('MANGOHUD=1 %command%');
    await deleteConfigProfile(CONFIG);
    expect(deleteReportMock).not.toHaveBeenCalled();
    expect(removeMock).toHaveBeenCalledWith(1593500, '60fps');
    expect(cloudDeleteMock).toHaveBeenCalledWith(1593500, '60fps');
    expect(logMock).toHaveBeenCalledWith('INFO', 'Deleted config profile', expect.objectContaining({ publishedReport: 'kept' }));
  });

  it('still removes the profile when the launch-option write or cloud delete fails', async () => {
    steamHas('MANGOHUD=1 %command%');
    setLaunchMock.mockRejectedValueOnce(new Error('no api'));
    cloudDeleteMock.mockRejectedValueOnce(new Error('offline'));
    await expect(deleteConfigProfile(CONFIG)).resolves.toEqual({
      clearedLaunchOptions: false, launchOptionsReason: 'write-failed', cloudDeleted: false,
    });
    expect(removeMock).toHaveBeenCalled();
  });

  it('normalizeForMatch ignores spacing and PROTON_VERSION only', () => {
    expect(normalizeForMatch(' A=1   %command% ')).toBe('A=1 %command%');
    expect(normalizeForMatch('PROTON_VERSION="x" A=1 %command%')).toBe('A=1 %command%');
    expect(normalizeForMatch('A=2 %command%')).not.toBe(normalizeForMatch('A=1 %command%'));
    expect(normalizeForMatch(null)).toBe('');
  });
});

describe('Manage tab delete never deletes the published report (#118)', () => {
  it('ManageTab does not import or call deleteMyReport', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../components/tabs/ManageTab.tsx'), 'utf8');
    expect(src).not.toContain('deleteMyReport');
    expect(src).toContain('deleteConfigProfile(config)');
  });
});
