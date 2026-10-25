// src/lib/compatToolSelect.ts
//
// Tell Steam which compatibility tool to run a game with (#92).
//
// PROTON_VERSION="..." in launch options does nothing: no Proton build (GE,
// CachyOS, Valve) or the Steam Linux Runtime reads it (only protontricks
// does). The only way to pick the tool is SteamClient.Apps.SpecifyCompatTool,
// the call the game's Properties > Compatibility page makes.
//
// Verified live on the October 2026 Steam client:
// - Apps.GetAvailableCompatTools and Settings.GetGlobalCompatTools are gone,
//   so the tool list falls back to the backend's view of what is installed
//   (get_compat_tool_choices), which knows each tool's exact Steam name.
// - SpecifyCompatTool with a name Steam does not know does NOT throw: it
//   silently clears the game back to Steam's default. So every switch is
//   read back through RegisterForAppDetails (strCompatToolName) and rolled
//   back to the previous tool if Steam did not take it.

import { callable } from '@decky/api';
import { toaster } from './notify';
import { logFrontendEvent } from './logger';
import { t } from './i18n';
import { isSteamDefaultProton, setSteamDefaultTool, steamDefaultToolSync, type SteamDefaultTool } from './steamDefaultState';

export interface CompatToolOption {
  strToolName: string;
  strDisplayName: string;
}

export type CompatToolApplyResult =
  | { status: 'set'; toolName: string; displayName: string }
  | { status: 'steam-default' }
  | { status: 'no-version' }
  | { status: 'no-match'; available: number }
  | { status: 'not-applied'; requested: string; actual: string | null; restored: boolean }
  | { status: 'unavailable'; reason: string };

const LIST_TIMEOUT_MS = 5000;
// Steam reflects a SpecifyCompatTool change in the app details within ~1.5s
// on a Deck; give it a little longer before calling it a failure.
const VERIFY_TIMEOUT_MS = 4000;
const VERIFY_STEP_MS = 400;

interface BackendToolChoice {
  tool_name: string;
  display_name: string;
  directory_name: string;
  source?: string | null;
}
const getCompatToolChoicesCallable = callable<[], BackendToolChoice[]>('get_compat_tool_choices');

async function backendToolOptions(): Promise<CompatToolOption[]> {
  const choices = await getCompatToolChoicesCallable();
  if (!Array.isArray(choices)) throw new Error('get_compat_tool_choices returned a non-array');
  return choices.map((c) => ({ strToolName: c.tool_name, strDisplayName: c.display_name }));
}

// --- Steam default (#115) ---
//
// ProtonDB reports often list the version as "Default": the reporter ran
// whatever Steam's default tool was at the time. That is not a tool name, so
// it can neither be matched nor shown as "Proton Default". Applying it means
// "follow Steam's default" (clear the per-game override, as Wine Cellar and
// armada-control do with SpecifyCompatTool(appId, "")), and showing it means
// naming the tool Steam would use today. The global default lives in
// settingsStore.settings.strCompatTool (read the same way by junkstore and
// GameVault); GetGlobalCompatTools maps it to a display name.

export { isSteamDefaultProton, steamDefaultToolSync };
export type { SteamDefaultTool };

let _steamDefaultLoaded = false;
let _steamDefaultPending: Promise<SteamDefaultTool | null> | null = null;

async function readSteamDefaultTool(): Promise<SteamDefaultTool | null> {
  const toolName: unknown = (globalThis as any).settingsStore?.settings?.strCompatTool;
  if (typeof toolName !== 'string' || !toolName) {
    void logFrontendEvent('DEBUG', 'compatTool: no global default tool in settingsStore', {
      source: 'settingsStore.settings.strCompatTool', value: toolName ?? null,
    });
    return null;
  }
  let displayName = toolName;
  const getGlobal = (globalThis as any).SteamClient?.Settings?.GetGlobalCompatTools;
  if (typeof getGlobal !== 'function') {
    // Removed from the October 2026 client; the backend knows the names.
    try {
      const hit = (await backendToolOptions()).find((t) => t.strToolName === toolName);
      if (hit?.strDisplayName) displayName = hit.strDisplayName;
    } catch (err) {
      void logFrontendEvent('WARNING', 'compatTool: backend tool list failed, showing internal name', {
        toolName, reason: err instanceof Error ? err.message : String(err), source: 'get_compat_tool_choices',
      });
    }
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const tools = await Promise.race([
        getGlobal() as Promise<CompatToolOption[]>,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`GetGlobalCompatTools timed out after ${LIST_TIMEOUT_MS}ms`)), LIST_TIMEOUT_MS);
        }),
      ]);
      const hit = Array.isArray(tools) ? tools.find((t) => t.strToolName === toolName) : undefined;
      if (hit?.strDisplayName) displayName = hit.strDisplayName;
    } catch (err) {
      void logFrontendEvent('WARNING', 'compatTool: GetGlobalCompatTools failed, showing internal name', {
        toolName, reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  void logFrontendEvent('DEBUG', 'compatTool: Steam default tool loaded', {
    toolName, displayName, source: 'settingsStore.settings.strCompatTool',
  });
  return { toolName, displayName };
}

/** Load (once per session) the tool Steam uses by default. Never throws. */
export function loadSteamDefaultTool(): Promise<SteamDefaultTool | null> {
  if (_steamDefaultLoaded) return Promise.resolve(steamDefaultToolSync());
  if (!_steamDefaultPending) {
    _steamDefaultPending = readSteamDefaultTool().then((d) => {
      setSteamDefaultTool(d);
      _steamDefaultLoaded = true;
      _steamDefaultPending = null;
      return d;
    });
  }
  return _steamDefaultPending;
}

/** Test hook. */
export function _resetSteamDefaultForTests(): void {
  setSteamDefaultTool(null);
  _steamDefaultLoaded = false;
  _steamDefaultPending = null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '');
}

// Builds named for their CPU target ("GE-Proton11-11-x86_64") are the same
// release as the tag reports use ("GE-Proton11-11").
const ARCH_SUFFIX = /[-_](?:x86_64(?:[-_]v\d)?|aarch64|arm64)$/i;
// Valve stable Proton as reports spell it: "Proton 11.0-2", "proton-11.0-2c",
// or a bare "11.0-2" (ProtonDB's usual form for Valve stable).
const VALVE_VERSION = /^(?:proton[\s_-]*)?(\d+)\.(\d+)(?:[-.\s][0-9a-z.-]*)?$/i;

function stripArch(s: string): string {
  return s.trim().replace(ARCH_SUFFIX, '');
}

/** Valve's short tool name for a stable version string, e.g. "Proton 11.0-2" -> "proton_11", "5.13-6" -> "proton_513". */
export function valveToolNameForVersion(version: string): string | null {
  const m = version.trim().match(VALVE_VERSION);
  if (!m) return null;
  const [, major, minor] = m;
  return minor === '0' ? `proton_${major}` : `proton_${major}${minor}`;
}

export type CompatMatchRule = 'internal' | 'display' | 'normalized' | 'arch-suffix' | 'valve-family';

/**
 * Pick the installed tool that is the requested version, and say which rule
 * matched. In order: exact internal name, exact display name, the two with
 * spaces/dashes/underscores ignored, the same ignoring a CPU-target suffix
 * (-x86_64), then a Valve stable version mapped to Valve's short name
 * (Steam keeps one build per Valve major version, so "Proton 11.0-2" is
 * proton_11). Nothing looser: picking a different Proton than the report
 * used would be worse than leaving Steam's choice alone.
 */
export function matchCompatToolWithRule(
  version: string,
  tools: CompatToolOption[],
): { tool: CompatToolOption; rule: CompatMatchRule } | null {
  const v = version.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  const pick = (rule: CompatMatchRule, f: (t: CompatToolOption) => boolean) => {
    const tool = tools.find(f);
    return tool ? { tool, rule } : null;
  };
  return pick('internal', (t) => t.strToolName.toLowerCase() === lower)
    ?? pick('display', (t) => t.strDisplayName.toLowerCase() === lower)
    ?? pick('normalized', (t) => norm(t.strToolName) === norm(v) || norm(t.strDisplayName) === norm(v))
    ?? pick('arch-suffix', (t) => norm(stripArch(t.strToolName)) === norm(stripArch(v))
      || norm(stripArch(t.strDisplayName)) === norm(stripArch(v)))
    ?? (() => {
      const valve = valveToolNameForVersion(v);
      return valve ? pick('valve-family', (t) => t.strToolName.toLowerCase() === valve) : null;
    })();
}

export function matchCompatTool(version: string, tools: CompatToolOption[]): CompatToolOption | null {
  return matchCompatToolWithRule(version, tools)?.tool ?? null;
}

async function listTools(appId: number): Promise<{ tools: CompatToolOption[]; source: string }> {
  const apps = (globalThis as any).SteamClient?.Apps;
  if (typeof apps?.GetAvailableCompatTools !== 'function') {
    return { tools: await backendToolOptions(), source: 'get_compat_tool_choices' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const tools = await Promise.race([
      apps.GetAvailableCompatTools(appId) as Promise<CompatToolOption[]>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`GetAvailableCompatTools timed out after ${LIST_TIMEOUT_MS}ms`)), LIST_TIMEOUT_MS);
      }),
    ]);
    if (!Array.isArray(tools)) throw new Error('GetAvailableCompatTools returned a non-array');
    return { tools, source: 'SteamClient.Apps.GetAvailableCompatTools' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The game's current per-game tool name from Steam ('' = Steam default), or null if unreadable. */
export function readCompatToolName(appId: number, timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    const apps = (globalThis as any).SteamClient?.Apps;
    if (typeof apps?.RegisterForAppDetails !== 'function') {
      resolve(null);
      return;
    }
    let settled = false;
    let reg: { unregister?: () => void } | undefined;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { reg?.unregister?.(); } catch { /* already gone */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      reg = apps.RegisterForAppDetails(appId, (details: any) => {
        finish(typeof details?.strCompatToolName === 'string' ? details.strCompatToolName : null);
      });
      // A synchronous callback may have fired before reg was assigned.
      if (settled) { try { reg?.unregister?.(); } catch { /* ignore */ } }
    } catch {
      finish(null);
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll Steam until the game's tool reads `expected` or the timeout passes; returns the last value read. */
async function waitForCompatTool(appId: number, expected: string): Promise<string | null> {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  let last: string | null = null;
  for (;;) {
    last = await readCompatToolName(appId);
    if (last === expected || Date.now() >= deadline) return last;
    await sleep(VERIFY_STEP_MS);
  }
}

/**
 * SpecifyCompatTool + read-back. If Steam ends up on anything other than the
 * requested tool, put the previous tool back so a failed switch never leaves
 * the game silently on Steam's default.
 */
async function specifyVerified(
  appId: number,
  version: string,
  toolName: string,
  previous: string | null,
): Promise<{ ok: true } | { ok: false; actual: string | null; restored: boolean }> {
  const apps = (globalThis as any).SteamClient.Apps;
  apps.SpecifyCompatTool(appId, toolName);
  const actual = await waitForCompatTool(appId, toolName);
  if (actual === toolName) return { ok: true };
  if (actual === null) {
    // Could not read details at all: nothing to compare, trust the call but say so.
    void logFrontendEvent('WARNING', 'compatTool: could not read back the tool after SpecifyCompatTool', {
      appId, version, toolName, source: 'RegisterForAppDetails.strCompatToolName',
    });
    return { ok: true };
  }
  let restored = false;
  if (previous !== null && previous !== actual) {
    try {
      apps.SpecifyCompatTool(appId, previous);
      restored = (await waitForCompatTool(appId, previous)) === previous;
    } catch { /* reported below */ }
  }
  void logFrontendEvent('ERROR', 'compatTool: Steam did not take the requested tool', {
    appId, version, requested: toolName, actual, previous, restored, source: 'RegisterForAppDetails.strCompatToolName',
  });
  return { ok: false, actual, restored };
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
  const previous = await readCompatToolName(appId);
  if (isSteamDefaultProton(version)) {
    // "Default" means follow Steam's default, which is no per-game override.
    try {
      const res = await specifyVerified(appId, version, '', previous);
      if (!res.ok) return { status: 'not-applied', requested: '', actual: res.actual, restored: res.restored };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      void logFrontendEvent('ERROR', 'compatTool: clearing per-game override threw', { appId, version, reason });
      return { status: 'unavailable', reason };
    }
    void logFrontendEvent('INFO', 'compatTool: config says Steam default, cleared per-game override', {
      appId, version, previous, source: 'SteamClient.Apps.SpecifyCompatTool("")',
    });
    return { status: 'steam-default' };
  }
  let tools: CompatToolOption[];
  let listSource: string;
  try {
    ({ tools, source: listSource } = await listTools(appId));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void logFrontendEvent('WARNING', 'compatTool: could not list compat tools', { appId, version, reason });
    return { status: 'unavailable', reason };
  }
  const matched = matchCompatToolWithRule(version, tools);
  const match = matched?.tool ?? null;
  if (!match) {
    void logFrontendEvent('WARNING', 'compatTool: no installed tool matches the config version', {
      appId, version, listSource, available: tools.map((t) => t.strToolName),
    });
    return { status: 'no-match', available: tools.length };
  }
  if (previous === match.strToolName) {
    void logFrontendEvent('DEBUG', 'compatTool: game already on the requested tool', { appId, version, toolName: previous });
    return { status: 'set', toolName: match.strToolName, displayName: match.strDisplayName };
  }
  try {
    const res = await specifyVerified(appId, version, match.strToolName, previous);
    if (!res.ok) return { status: 'not-applied', requested: match.strToolName, actual: res.actual, restored: res.restored };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void logFrontendEvent('ERROR', 'compatTool: SpecifyCompatTool threw', { appId, version, toolName: match.strToolName, reason });
    return { status: 'unavailable', reason };
  }
  void logFrontendEvent('INFO', 'compatTool: set Steam compat tool for app', {
    appId, version, previous, toolName: match.strToolName, displayName: match.strDisplayName,
    matchRule: matched?.rule, listSource, source: 'SteamClient.Apps.SpecifyCompatTool',
  });
  return { status: 'set', toolName: match.strToolName, displayName: match.strDisplayName };
}

/**
 * applyCompatToolForVersion + a toast when the tool could not be set, so a
 * user is not left thinking the game now runs on the config's Proton.
 */
export async function applyCompatToolAndNotify(appId: number, version: string | null | undefined): Promise<CompatToolApplyResult> {
  const result = await applyCompatToolForVersion(appId, version);
  if (result.status === 'no-match' || result.status === 'unavailable' || result.status === 'not-applied') {
    toaster.toast({ title: 'Proton Pulse', body: t().extras!.compatToolNotSet!(String(version)) });
  }
  return result;
}
