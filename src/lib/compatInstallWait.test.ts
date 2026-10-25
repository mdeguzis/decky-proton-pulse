import { describe, it, expect, vi, beforeEach } from 'vitest';

const { installMock, stateMock, logMock } = vi.hoisted(() => ({
  installMock: vi.fn(), stateMock: vi.fn(), logMock: vi.fn(),
}));
vi.mock('./compatTools', () => ({ installProtonGe: installMock, getProtonGeManagerState: stateMock }));
vi.mock('./logger', () => ({ logFrontendEvent: logMock }));

import { installProtonGeAndWait } from './compatInstallWait';

const NOW_MS = 1_800_000_000_000; // fixed clock
const status = (over: Record<string, unknown>) => ({
  state: 'running', tag_name: 'GE-Proton11-5', message: null, stage: 'downloading',
  downloaded_bytes: null, total_bytes: 560, progress_fraction: null,
  started_at: NOW_MS / 1000, finished_at: null, install_as_latest: false, ...over,
});

let clock: number;
const opts = (extra = {}) => ({ now: () => clock, sleep: async (ms: number) => { clock += ms; }, pollMs: 1000, ...extra });

beforeEach(() => {
  installMock.mockReset().mockResolvedValue({ success: true, message: 'Installing GE-Proton11-5...' });
  stateMock.mockReset();
  logMock.mockReset();
  clock = NOW_MS;
});

describe('installProtonGeAndWait (#92)', () => {
  it('waits for this run to finish and reports progress on the way', async () => {
    stateMock
      .mockResolvedValueOnce({ install_status: status({ progress_fraction: 0.4 }) })
      .mockResolvedValueOnce({ install_status: status({ stage: 'extracting', progress_fraction: 1 }) })
      .mockResolvedValueOnce({ install_status: status({ state: 'success', stage: null, message: 'Installed GE-Proton11-5-x86_64.' }) });
    const onProgress = vi.fn();
    await expect(installProtonGeAndWait('GE-Proton11-5', opts({ onProgress })))
      .resolves.toEqual({ success: true, message: 'Installed GE-Proton11-5-x86_64.' });
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls[0][0]).toMatchObject({ stage: 'downloading', progress_fraction: 0.4 });
  });

  it('ignores the finished status of an earlier run of the same tag', async () => {
    // The status dict still holds the previous install's "success" until the
    // new run stamps a fresh started_at.
    stateMock
      .mockResolvedValueOnce({ install_status: status({ state: 'success', started_at: NOW_MS / 1000 - 120 }) })
      .mockResolvedValueOnce({ install_status: status({ state: 'success', message: 'new run' }) });
    await expect(installProtonGeAndWait('GE-Proton11-5', opts())).resolves.toEqual({ success: true, message: 'new run' });
    expect(stateMock).toHaveBeenCalledTimes(2);
  });

  it('accepts a finished status with no started_at when it finished after the request', async () => {
    // Regression: the backend cleared started_at on success, and the dialog
    // sat on "Finalizing" after the install had completed.
    stateMock
      .mockResolvedValueOnce({ install_status: status({ stage: 'finalizing', progress_fraction: 1 }) })
      .mockResolvedValueOnce({ install_status: status({ state: 'success', started_at: null, finished_at: NOW_MS / 1000 + 40, message: 'done' }) });
    await expect(installProtonGeAndWait('GE-Proton11-5', opts())).resolves.toEqual({ success: true, message: 'done' });
  });

  it('returns the failure when the install errors', async () => {
    stateMock.mockResolvedValueOnce({ install_status: status({ state: 'error', message: 'download failed' }) });
    await expect(installProtonGeAndWait('GE-Proton11-5', opts())).resolves.toEqual({ success: false, message: 'download failed' });
  });

  it('returns straight away when the version is already installed or cannot be queued', async () => {
    installMock.mockResolvedValueOnce({ success: true, message: 'GE-Proton11-5 is already installed.', already_installed: true });
    await expect(installProtonGeAndWait('GE-Proton11-5', opts()))
      .resolves.toEqual({ success: true, message: 'GE-Proton11-5 is already installed.', alreadyInstalled: true });
    installMock.mockResolvedValueOnce({ success: false, message: 'GE-Proton11-6 is already installing.' });
    await expect(installProtonGeAndWait('GE-Proton11-5', opts())).resolves.toEqual({ success: false, message: 'GE-Proton11-6 is already installing.' });
    expect(stateMock).not.toHaveBeenCalled();
  });

  it('keeps polling through a failed status read and gives up at the timeout', async () => {
    stateMock.mockRejectedValueOnce(new Error('backend busy')).mockResolvedValue({ install_status: status({}) });
    await expect(installProtonGeAndWait('GE-Proton11-5', opts({ timeoutMs: 5000 })))
      .resolves.toEqual({ success: false, message: 'Timed out waiting for GE-Proton11-5 to install' });
    expect(logMock).toHaveBeenCalledWith('WARNING', 'installProtonGeAndWait: status poll failed, retrying', expect.anything());
    expect(logMock).toHaveBeenCalledWith('ERROR', 'installProtonGeAndWait: timed out waiting for install', expect.objectContaining({ lastState: 'running' }));
  });
});
