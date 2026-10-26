// src/lib/configDelete.ts
//
// Deleting a profile in Manage Configurations (#118, #134).
//
// It used to do three destructive things on top of removing the profile:
// - clear the game's Steam launch options, even when the deleted profile
//   wasn't the one applied (another profile, or options the user typed in
//   Steam, were wiped)
// - delete the user's published report from user_configs, which is what
//   their proton-pulse.com profile shows
// Now it removes the profile locally and its cloud backup
// (user_proton_configs), clears launch options only when they are exactly
// what this profile applied, and never touches the published report.

import { deleteCloudConfig } from './cloudSync';
import { logFrontendEvent } from './logger';
import { stripProtonVersion } from './launchVars';
import { getLaunchOptionsFromDetails, getSteamAppDetails, setSteamLaunchOptions } from './steamApps';
import { removeTrackedConfig, type TrackedConfig } from './trackedConfigs';

export interface ConfigDeleteResult {
  clearedLaunchOptions: boolean;
  /** Why launch options were or were not cleared, for logs and tests. */
  launchOptionsReason: 'matched' | 'different' | 'empty' | 'unreadable' | 'write-failed';
  cloudDeleted: boolean;
}

/** Launch options compared for "is this what the profile applied": legacy PROTON_VERSION and spacing ignored. */
export function normalizeForMatch(launchOptions: string | null | undefined): string {
  return stripProtonVersion(launchOptions ?? '').replace(/\s+/g, ' ').trim();
}

export async function deleteConfigProfile(config: TrackedConfig): Promise<ConfigDeleteResult> {
  const { appId, profileName } = config;
  let clearedLaunchOptions = false;
  let launchOptionsReason: ConfigDeleteResult['launchOptionsReason'];

  let current: string | null = null;
  try {
    const { details } = await getSteamAppDetails(appId);
    // null details means Steam didn't answer, not "no launch options".
    current = details ? getLaunchOptionsFromDetails(details) : null;
  } catch (err) {
    void logFrontendEvent('WARNING', 'deleteConfigProfile: could not read current launch options', {
      appId, profileName, error: err instanceof Error ? err.message : String(err),
    });
  }

  if (current === null) {
    // Can't tell what is applied: leave the game alone rather than guess.
    launchOptionsReason = 'unreadable';
  } else if (!normalizeForMatch(current)) {
    launchOptionsReason = 'empty';
  } else if (normalizeForMatch(current) === normalizeForMatch(config.launchOptions)) {
    try {
      await setSteamLaunchOptions(appId, '');
      clearedLaunchOptions = true;
      launchOptionsReason = 'matched';
    } catch (err) {
      launchOptionsReason = 'write-failed';
      void logFrontendEvent('ERROR', 'deleteConfigProfile: clearing launch options failed', {
        appId, profileName, error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    launchOptionsReason = 'different';
  }

  removeTrackedConfig(appId, profileName);
  const cloudDeleted = await deleteCloudConfig(appId, profileName).catch(() => false);
  if (!cloudDeleted) {
    void logFrontendEvent('WARNING', 'deleteConfigProfile: cloud config delete failed', { appId, profileName });
  }

  void logFrontendEvent('INFO', 'Deleted config profile', {
    appId, appName: config.appName, profileName,
    clearedLaunchOptions, launchOptionsReason, cloudDeleted,
    publishedReport: 'kept',
  });
  return { clearedLaunchOptions, launchOptionsReason, cloudDeleted };
}
