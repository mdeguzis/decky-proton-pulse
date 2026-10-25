// src/lib/compatToolSelect.ts
//
// Tell Steam which compatibility tool to run a game with (#92).
//
// Applying a config used to only write PROTON_VERSION="..." into the launch
// options. Neither Steam nor Proton reads that variable, so the game kept
// running on whatever tool Steam already had. The variable stays as the
// plugin's own record of the intended version (launchVars.ts parses it); the
// actual switch is SteamClient.Apps.SpecifyCompatTool, the same call the
// game's Properties > Compatibility page makes.
//
// Same pattern as other Decky plugins (decky-wine-cellar, armada-control):
// take strToolName from GetAvailableCompatTools(appId), pass it to
// SpecifyCompatTool. GetAvailableCompatTools can hang, so it is raced against
// a timeout. A tool installed this session may not be listed until Steam
// restarts, which is the usual 'no-match' cause.

import { toaster } from './notify';
import { logFrontendEvent } from './logger';
import { t } from './i18n';

export interface CompatToolOption {
  strToolName: string;
  strDisplayName: string;
}

export type CompatToolApplyResult =
  | { status: 'set'; toolName: string; displayName: string }
  | { status: 'no-version' }
  | { status: 'no-match'; available: number }
  | { status: 'unavailable'; reason: string };

const LIST_TIMEOUT_MS = 5000;

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Pick the installed tool that is exactly the requested version. Exact
 * internal name first, then exact display name, then the two compared with
 * spaces, dashes and underscores ignored ("Proton 9.0-4" == "proton_9.0-4").
 * No prefix or fuzzy matching: picking a different Proton than the report
 * used would be worse than leaving Steam's choice alone.
 */
export function matchCompatTool(version: string, tools: CompatToolOption[]): CompatToolOption | null {
  const v = version.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  return tools.find((t) => t.strToolName.toLowerCase() === lower)
    ?? tools.find((t) => t.strDisplayName.toLowerCase() === lower)
    ?? tools.find((t) => norm(t.strToolName) === norm(v) || norm(t.strDisplayName) === norm(v))
    ?? null;
}

async function listTools(appId: number): Promise<CompatToolOption[]> {
  const apps = (globalThis as any).SteamClient?.Apps;
  if (!apps?.GetAvailableCompatTools) throw new Error('GetAvailableCompatTools missing');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const tools = await Promise.race([
      apps.GetAvailableCompatTools(appId) as Promise<CompatToolOption[]>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`GetAvailableCompatTools timed out after ${LIST_TIMEOUT_MS}ms`)), LIST_TIMEOUT_MS);
      }),
    ]);
    if (!Array.isArray(tools)) throw new Error('GetAvailableCompatTools returned a non-array');
    return tools;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Set Steam's per-game compat tool to `version`. Never throws; the result says what happened. */
export async function applyCompatToolForVersion(appId: number, version: string | null | undefined): Promise<CompatToolApplyResult> {
  if (!version || !version.trim()) {
    void logFrontendEvent('DEBUG', 'compatTool: no version on config, leaving Steam setting alone', { appId });
    return { status: 'no-version' };
  }
  const apps = (globalThis as any).SteamClient?.Apps;
  if (!apps?.SpecifyCompatTool) {
    void logFrontendEvent('WARNING', 'compatTool: SpecifyCompatTool missing on SteamClient.Apps', { appId, version });
    return { status: 'unavailable', reason: 'SpecifyCompatTool missing' };
  }
  let tools: CompatToolOption[];
  try {
    tools = await listTools(appId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void logFrontendEvent('WARNING', 'compatTool: could not list compat tools', { appId, version, reason, source: 'SteamClient.Apps.GetAvailableCompatTools' });
    return { status: 'unavailable', reason };
  }
  const match = matchCompatTool(version, tools);
  if (!match) {
    void logFrontendEvent('WARNING', 'compatTool: no installed tool matches the config version', {
      appId, version, available: tools.map((t) => t.strToolName),
    });
    return { status: 'no-match', available: tools.length };
  }
  try {
    apps.SpecifyCompatTool(appId, match.strToolName);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void logFrontendEvent('ERROR', 'compatTool: SpecifyCompatTool threw', { appId, version, toolName: match.strToolName, reason });
    return { status: 'unavailable', reason };
  }
  void logFrontendEvent('INFO', 'compatTool: set Steam compat tool for app', {
    appId, version, toolName: match.strToolName, displayName: match.strDisplayName, source: 'SteamClient.Apps.SpecifyCompatTool',
  });
  return { status: 'set', toolName: match.strToolName, displayName: match.strDisplayName };
}

/**
 * applyCompatToolForVersion + a toast when the tool could not be set, so a
 * user is not left thinking the game now runs on the config's Proton.
 */
export async function applyCompatToolAndNotify(appId: number, version: string | null | undefined): Promise<CompatToolApplyResult> {
  const result = await applyCompatToolForVersion(appId, version);
  if (result.status === 'no-match' || result.status === 'unavailable') {
    toaster.toast({ title: 'Proton Pulse', body: t().extras!.compatToolNotSet!(String(version)) });
  }
  return result;
}
