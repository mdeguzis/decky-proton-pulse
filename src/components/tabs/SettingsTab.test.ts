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
// Source-scan tests for the new per-row Info modal. The menu now has two
// items: "Release Notes" (opens the release-body modal) and "Info" (opens
// the tool-details modal with install location, installed-on date, size,
// internal name, and the rolling-slot target when applicable).
// Source-scan test for the slot-row header/subtitle swap: friendly slot
// name in the header ("Proton-GE-Latest") and the active version in the
// subtitle ("GE-Proton11-1") -- matches Steam's Proton Experimental UX
// where the tool name is stable and the build is the subtitle.
// Match Valve's Proton Experimental UX: a single row in Steam's UI even
// though on-disk there is an unversioned tool + an underlying versioned
// binary. Once a rolling slot claims a versioned build as its target,
// the versioned build's row must disappear from the Settings list so
// the slot row is the one entry the user manages.
describe('SettingsTab hides versioned rows covered by a rolling slot', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(
    path.join(__dirname, 'SettingsTab.tsx'),
    'utf8',
  );

  it('collects the set of directory_names claimed by installed rolling slots', () => {
    // The set is built from managerState.installed_tools where
    // managed_slot === 'latest' and current_target_name is populated.
    expect(SRC).toMatch(/const targetsHiddenByRollingSlot = new Set<string>\(/);
    expect(SRC).toMatch(
      /\.filter\(\(t\) => t\.managed_slot === 'latest' && t\.current_target_name\)/,
    );
    expect(SRC).toMatch(/\.map\(\(t\) => t\.current_target_name as string\)/);
  });

  it('filters out release rows whose matched tool is covered by a rolling slot', () => {
    expect(SRC).toMatch(
      /\.filter\(\(release\)[\s\S]{0,600}targetsHiddenByRollingSlot\.has\(matched\.directory_name\)/,
    );
  });

  it('filters covered tools out of installed-only rows too (belt + braces)', () => {
    // Extra guard for versioned builds that do not correspond to any
    // known release -- they must still be hidden when a slot claims them.
    expect(SRC).toMatch(
      /\.filter\(\(tool\) => !targetsHiddenByRollingSlot\.has\(tool\.directory_name\)\)/,
    );
  });
});

describe('SettingsTab rolling-slot row header/subtitle shape', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(
    path.join(__dirname, 'SettingsTab.tsx'),
    'utf8',
  );

  it('slot row subtitle prefers current_target_name over old best-effort fields', () => {
    // The block that picks the subtitle:
    //   isSlotRow && tool.current_target_name
    //     ? formatReleaseVersion(tool.current_target_name)
    //     : <fallback>
    expect(SRC).toMatch(
      /isSlotRow && tool\.current_target_name[\s\S]{0,120}formatReleaseVersion\(tool\.current_target_name\)/,
    );
  });

  it('slot row header stays the friendly display_name from the custom VDF', () => {
    // No explicit displayName remap for slot rows -- the managed slot's
    // display_name ('Proton-GE-Latest' via our custom compatibilitytool.vdf)
    // is already the friendly label.
    expect(SRC).toMatch(/displayName: tool\.display_name/);
  });
});

describe('SettingsTab per-row Info menu wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(
    path.join(__dirname, 'SettingsTab.tsx'),
    'utf8',
  );

  it('renders a ToolDetailsModal component', () => {
    // The component exists and drives getCompatToolDetails on mount so
    // stat + du run backend-side only when the user opens the modal.
    expect(SRC).toMatch(/function ToolDetailsModal\(\{/);
    expect(SRC).toMatch(/getCompatToolDetails\(directoryName\)/);
  });

  it('shows the Info menu item only for installed tools with a directory_name', () => {
    // Uninstalled release rows have no on-disk tool, so the Info modal
    // would fail; guard behind row.installed && row.tool?.directory_name.
    expect(SRC).toMatch(/row\.installed && row\.tool\?\.directory_name && \(/);
    expect(SRC).toMatch(/<ToolDetailsModal[\s\S]{0,120}directoryName=\{row\.tool!\.directory_name\}/);
  });

  it('renames the current Info menu label to Release Notes', () => {
    // Regression guard for the earlier commit: the release-notes menu
    // item must use the renamed i18n key with an English fallback so
    // untranslated builds stay readable.
    expect(SRC).toContain('t().compatTools.releaseNotes ?? "Release Notes"');
    // The new Info menu item uses the original info key.
    expect(SRC).toMatch(/\{t\(\)\.compatTools\.info\}/);
  });

  it('gives the ToolDetailsModal the same top/bottom clearance as ReleaseInfoModal', () => {
    // Both modals must clear Steam's top status bar and bottom BPM nav
    // bar. Same CSS override, applied to the same className.
    expect(SRC).toMatch(/inset: 60px 0 70px 0 !important/);
  });
});

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
