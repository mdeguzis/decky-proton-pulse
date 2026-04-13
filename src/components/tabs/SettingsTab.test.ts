import { describe, expect, it } from 'vitest';
import {
  buildInstallProgressDetails,
  getInstallStatusToastStamp,
  resetInstallStatusToastMemory,
  shouldPollInstallStatus,
  shouldShowInstallStatusToast,
} from './settingsTabProgress';
import type { ProtonGeManagerState } from '../../types';

function makeManagerState(
  installStatus: Partial<ProtonGeManagerState['install_status']> = {},
): ProtonGeManagerState {
  return {
    current_release: null,
    current_installed: false,
    current_latest_slot_installed: false,
    installed_tools: [],
    releases: [],
    install_status: {
      state: 'idle',
      tag_name: null,
      message: null,
      stage: null,
      downloaded_bytes: null,
      total_bytes: null,
      progress_fraction: null,
      started_at: null,
      finished_at: null,
      install_as_latest: false,
      ...installStatus,
    },
  };
}

describe('shouldPollInstallStatus', () => {
  it('polls while backend status is running', () => {
    expect(shouldPollInstallStatus(
      makeManagerState({ state: 'running', tag_name: 'GE-Proton10-1' }),
      null,
    )).toBe(true);
  });

  it('polls immediately after a local install starts before manager state catches up', () => {
    expect(shouldPollInstallStatus(
      makeManagerState({ state: 'idle' }),
      'GE-Proton10-1',
    )).toBe(true);
  });

  it('stops polling when nothing is installing', () => {
    expect(shouldPollInstallStatus(
      makeManagerState({ state: 'idle' }),
      null,
    )).toBe(false);
  });
});

describe('install status toast memory', () => {
  it('creates a stable stamp for finished installs only', () => {
    expect(getInstallStatusToastStamp(makeManagerState({
      state: 'success',
      tag_name: 'GE-Proton10-1',
      finished_at: 123,
    }).install_status)).toBe('success:GE-Proton10-1:123');

    expect(getInstallStatusToastStamp(makeManagerState({
      state: 'running',
      tag_name: 'GE-Proton10-1',
      finished_at: null,
    }).install_status)).toBeNull();
  });

  it('shows a finished install toast only once across remounts', () => {
    resetInstallStatusToastMemory();
    const installStatus = makeManagerState({
      state: 'success',
      tag_name: 'GE-Proton10-1',
      finished_at: 123,
      message: 'GE-Proton10-1 installed.',
    }).install_status;

    expect(shouldShowInstallStatusToast(installStatus)).toBe(true);
    expect(shouldShowInstallStatusToast(installStatus)).toBe(false);

    resetInstallStatusToastMemory();
  });
});

describe('buildInstallProgressDetails', () => {
  it('switches eta text to finalizing once download reaches 100%', () => {
    const progress = buildInstallProgressDetails(
      makeManagerState({
        state: 'running',
        stage: 'downloading',
        downloaded_bytes: 1024,
        total_bytes: 1024,
        progress_fraction: 1,
        started_at: Math.round(Date.now() / 1000) - 20,
      }).install_status,
      1024,
      {
        finalizing: 'Finalizing...',
        extracting: 'Extracting...',
        downloading: 'Downloading...',
        estimating: 'Estimating...',
        timeLeft: (value) => `${value} left`,
      },
    );

    expect(progress.progressLabel).toBe('100%');
    expect(progress.etaLabel).toBe('Finalizing...');
  });
});
