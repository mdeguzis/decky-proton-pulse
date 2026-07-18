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

// Source-scan regression guard for the "two progress bars for one install" bug.
// The Settings tab renders both a versioned "release row" and a slot "installed-
// only row" for the currently-installing target. Both read from the same
// managerState.install_status, so both used to render identical progress bars
// side-by-side when the user hit Install on the -Latest row (the ambient
// install_status.install_as_latest is true then).
//
// The fix guards the release-row's progress computation with a
// `!installStatus.install_as_latest` clause: the slot row is the one place
// the user sees progress in that mode. Pin the guard here so a future
// refactor cannot silently reintroduce the duplicate bars.
describe('SettingsTab release-row progress dedup guard', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(
    path.join(__dirname, 'SettingsTab.tsx'),
    'utf8',
  );

  it('release-row progress computation excludes install_as_latest installs', () => {
    // The relevant block sits right above the releaseRows.map call and reads
    // isInstalling + install_status.tag_name + !install_status.install_as_latest.
    expect(SRC).toMatch(
      /const\s+showProgressHere\s*=\s*isInstalling[\s\S]{0,200}!installStatus\.install_as_latest/,
    );
    expect(SRC).toMatch(/const\s+progress\s*=\s*showProgressHere\s*\?\s*buildInstallProgressDetails/);
  });

  it('does NOT keep the old unguarded progress ternary that fired for install_as_latest too', () => {
    // Regression guard: catches a copy/paste that reintroduces the pre-fix
    // condition (progress ternary with no install_as_latest clause on the
    // release-row builder).
    expect(SRC).not.toMatch(
      /const\s+progress\s*=\s*isInstalling\s*&&\s*installStatus\.tag_name\s*===\s*release\.tag_name\s*\n\s*\?\s*buildInstallProgressDetails/,
    );
  });
});
