// src/lib/compatInstallWait.ts
//
// Install a Proton-GE release and wait for it to finish (#92).
//
// install_proton_ge only queues a background install and returns at once.
// The Configure tab used to apply the config right after queueing, so the
// switch ran before the build existed ("no installed tool matches") and the
// download finished ~40s later with nothing applying it. This waits for that
// specific run to end, reporting progress so the caller can show it the same
// way the Compatibility Tools tab does.

import { getProtonGeManagerState, installProtonGe } from './compatTools';
import { logFrontendEvent } from './logger';
import type { ProtonGeManagerState } from '../types';

export type InstallStatus = ProtonGeManagerState['install_status'];

export interface InstallWaitResult {
  success: boolean;
  message: string;
  alreadyInstalled?: boolean;
}

export interface InstallWaitOptions {
  onProgress?: (status: InstallStatus) => void;
  pollMs?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_MS = 1000;
// A GE build is ~560 MB; 20 minutes covers a slow connection.
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export async function installProtonGeAndWait(version: string, opts: InstallWaitOptions = {}): Promise<InstallWaitResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // started_at is in whole seconds; allow for rounding so this run's status
  // is accepted but a finished earlier run (same tag) is not.
  const requestedAtSec = Math.floor(now() / 1000) - 2;
  const queued = await installProtonGe(version);
  if (!queued.success) {
    void logFrontendEvent('WARNING', 'installProtonGeAndWait: install was not queued', { version, message: queued.message });
    return { success: false, message: queued.message };
  }
  if (queued.already_installed) {
    void logFrontendEvent('INFO', 'installProtonGeAndWait: already installed', { version });
    return { success: true, message: queued.message, alreadyInstalled: true };
  }

  const deadline = now() + timeoutMs;
  for (;;) {
    let status: InstallStatus | null = null;
    try {
      status = (await getProtonGeManagerState(false)).install_status;
    } catch (err) {
      void logFrontendEvent('WARNING', 'installProtonGeAndWait: status poll failed, retrying', {
        version, error: err instanceof Error ? err.message : String(err),
      });
    }
    const thisRun = !!status && (status.started_at ?? 0) >= requestedAtSec;
    if (status && thisRun) {
      opts.onProgress?.(status);
      if (status.state === 'success' || status.state === 'error') {
        const success = status.state === 'success';
        void logFrontendEvent(success ? 'INFO' : 'WARNING', 'installProtonGeAndWait: install finished', {
          version, state: status.state, tag: status.tag_name, message: status.message,
        });
        return { success, message: status.message ?? (success ? version : `Install of ${version} failed`) };
      }
    }
    if (now() >= deadline) {
      void logFrontendEvent('ERROR', 'installProtonGeAndWait: timed out waiting for install', {
        version, timeoutMs, lastState: status?.state ?? null, lastStage: status?.stage ?? null,
      });
      return { success: false, message: `Timed out waiting for ${version} to install` };
    }
    await sleep(pollMs);
  }
}
