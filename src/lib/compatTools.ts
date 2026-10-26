// Compatibility tool management patterns inspired by decky-wine-cellar by FlashyReese (MIT):
// https://github.com/FlashyReese/decky-wine-cellar
import { callable } from '@decky/api';
import { getSetting } from './settings';
import type { CompatToolId, ProtonGeManagerState, ProtonVersionAvailability } from '../types';

// #133: "Auto-trim unused older Proton tool versions" setting. Off by default
// because it deletes installed builds. Read here, in the one wrapper every
// install goes through, so no caller can forget to pass it.
export const COMPAT_AUTO_TRIM_KEY = 'compat-auto-trim-unused';

const getCompatManagerStateCallable = callable<
  [tool_id: CompatToolId, force_refresh?: boolean],
  ProtonGeManagerState
>('get_compat_manager_state');
const installCompatToolCallable = callable<
  [tool_id: CompatToolId, version?: string | null, install_as_latest?: boolean, force_reinstall?: boolean, prune_unused?: boolean],
  { success: boolean; message: string; already_installed?: boolean; rolling_slot?: { ok: boolean; changed?: boolean; reason?: string; target?: string; slot?: string } }
>('install_compat_tool');
const cancelCompatToolInstallCallable = callable<
  [tool_id?: CompatToolId],
  { success: boolean; message: string }
>('cancel_compat_tool_install');

const getProtonGeManagerStateCallable = callable<[force_refresh?: boolean], ProtonGeManagerState>('get_proton_ge_manager_state');
const checkProtonVersionAvailabilityCallable = callable<[version: string], ProtonVersionAvailability>('check_proton_version_availability');
const installProtonGeCallable = callable<
  [version?: string | null, installAsLatest?: boolean, forceReinstall?: boolean],
  { success: boolean; message: string; already_installed?: boolean; rolling_slot?: { ok: boolean; changed?: boolean; reason?: string; target?: string; slot?: string } }
>('install_proton_ge');
const cancelProtonGeInstallCallable = callable<[], { success: boolean; message: string }>('cancel_proton_ge_install');
const uninstallCompatibilityToolCallable = callable<[directoryName: string], { success: boolean; message: string }>('uninstall_compatibility_tool');
// #138 Clean up unused: list, then remove the confirmed names (re-checked backend-side).
export interface CompatCleanupCandidate {
  directory_name: string;
  display_name: string;
  // Set when the whole family (slot + every build) is unused and offered together.
  family?: string | null;
  family_tool_id?: CompatToolId | null;
  is_slot?: boolean;
}

/**
 * Dialog lines for the cleanup confirm (#138): a whole unused family is one
 * line ("Proton-CachyOS (all versions)"), other builds are listed by name.
 * Families with auto-update on are left out (auto-update would just
 * reinstall them); `kept` reports which.
 */
export function planCompatCleanup(
  candidates: CompatCleanupCandidate[],
  autoUpdateOn: (toolId: CompatToolId) => boolean,
  familyLabel: (family: string) => string,
): { names: string[]; lines: string[]; kept: string[] } {
  const names: string[] = [];
  const lines: string[] = [];
  const kept = new Set<string>();
  const shown = new Set<string>();
  for (const c of candidates) {
    if (c.family && c.family_tool_id) {
      if (autoUpdateOn(c.family_tool_id)) { kept.add(c.family); continue; }
      names.push(c.directory_name);
      if (!shown.has(c.family)) { shown.add(c.family); lines.push(familyLabel(c.family)); }
      continue;
    }
    names.push(c.directory_name);
    lines.push(c.display_name || c.directory_name);
  }
  return { names, lines, kept: [...kept] };
}
export interface CompatCleanupResult { removed: string[]; failed: { directory_name: string; message: string }[]; skipped: string[] }
const getCompatCleanupCandidatesCallable = callable<[toolId: CompatToolId, autoUpdate: boolean], CompatCleanupCandidate[]>('get_compat_cleanup_candidates');
const cleanupUnusedCompatToolsCallable = callable<[directoryNames: string[], toolId: CompatToolId, autoUpdate: boolean], CompatCleanupResult>('cleanup_unused_compat_tools');
const installCompatibilityToolArchiveCallable = callable<[archivePath: string], { success: boolean; message: string; already_installed?: boolean; rolling_slot?: { ok: boolean; changed?: boolean; reason?: string; target?: string; slot?: string } }>('install_compatibility_tool_archive');

export async function getCompatManagerState(toolId: CompatToolId, forceRefresh = false): Promise<ProtonGeManagerState> {
  return getCompatManagerStateCallable(toolId, forceRefresh);
}

export async function installCompatTool(
  toolId: CompatToolId,
  version?: string | null,
  installAsLatest = false,
  forceReinstall = false,
): Promise<{ success: boolean; message: string; already_installed?: boolean; rolling_slot?: { ok: boolean; changed?: boolean; reason?: string; target?: string; slot?: string } }> {
  const pruneUnused = getSetting<unknown>(COMPAT_AUTO_TRIM_KEY, false) === true;
  return installCompatToolCallable(toolId, version ?? null, installAsLatest, forceReinstall, pruneUnused);
}

export interface CompatTrimOutcome {
  ok: boolean;
  removed: string[];
  failed: Record<string, string>;
  reason?: string;
}

const trimUnusedCompatVersionsCallable = callable<[], { tools: Record<string, CompatTrimOutcome> }>('trim_unused_compat_versions');

// Run auto-trim right away (the setting was just switched on). Same rules as
// the post-install trim: only unused builds the latest process installed.
export async function trimUnusedCompatVersions(): Promise<Record<string, CompatTrimOutcome>> {
  const res = await trimUnusedCompatVersionsCallable();
  return res.tools;
}

// Flatten per-tool outcomes into the removed directory names, for the toast.
export function trimmedDirectories(outcomes: Record<string, CompatTrimOutcome>): string[] {
  return Object.values(outcomes).flatMap((o) => o.removed ?? []);
}

export async function cancelCompatToolInstall(toolId: CompatToolId): Promise<{ success: boolean; message: string }> {
  return cancelCompatToolInstallCallable(toolId);
}

export async function getProtonGeManagerState(forceRefresh = false): Promise<ProtonGeManagerState> {
  return getProtonGeManagerStateCallable(forceRefresh);
}

export async function checkProtonVersionAvailability(version: string): Promise<ProtonVersionAvailability> {
  return checkProtonVersionAvailabilityCallable(version);
}

export async function installProtonGe(
  version?: string | null,
  installAsLatest = false,
  forceReinstall = false,
): Promise<{ success: boolean; message: string; already_installed?: boolean; rolling_slot?: { ok: boolean; changed?: boolean; reason?: string; target?: string; slot?: string } }> {
  return installProtonGeCallable(version ?? null, installAsLatest, forceReinstall);
}

export async function cancelProtonGeInstall(): Promise<{ success: boolean; message: string }> {
  return cancelProtonGeInstallCallable();
}

export async function uninstallCompatibilityTool(directoryName: string): Promise<{ success: boolean; message: string }> {
  return uninstallCompatibilityToolCallable(directoryName);
}

// Scoped to the tool selected in the Compatibility Tools picker (#138).
// autoUpdate is that tool's toggle; when on, the backend protects its
// latest build and slot.
export async function getCompatCleanupCandidates(toolId: CompatToolId, autoUpdate: boolean): Promise<CompatCleanupCandidate[]> {
  const result = await getCompatCleanupCandidatesCallable(toolId, autoUpdate);
  if (!Array.isArray(result)) throw new Error('get_compat_cleanup_candidates returned a non-array');
  return result;
}

export async function cleanupUnusedCompatTools(directoryNames: string[], toolId: CompatToolId, autoUpdate: boolean): Promise<CompatCleanupResult> {
  return cleanupUnusedCompatToolsCallable(directoryNames, toolId, autoUpdate);
}

export async function installCompatibilityToolArchive(archivePath: string): Promise<{ success: boolean; message: string; already_installed?: boolean; rolling_slot?: { ok: boolean; changed?: boolean; reason?: string; target?: string; slot?: string } }> {
  return installCompatibilityToolArchiveCallable(archivePath);
}

// Details shown in the per-row Info modal on the Settings tab. Field
// nullability mirrors main.py:get_compat_tool_details: the backend
// always returns { ok: false, error } on a lookup failure, everything
// else is populated only on ok:true.
export interface CompatToolDetails {
  ok: boolean;
  error?: string;
  directory_name?: string;
  display_name?: string | null;
  internal_name?: string | null;
  tool_id?: string | null;
  managed_slot?: string | null;
  is_rolling_slot?: boolean;
  current_target?: string | null;
  path?: string;
  installed_at_iso?: string | null;
  size_bytes?: number;
  source?: string | null;
  used_by_app_ids?: string[] | null;
  is_steam_default?: boolean;
}

const getCompatToolDetailsCallable = callable<
  [directory_name: string],
  CompatToolDetails
>('get_compat_tool_details');

export async function getCompatToolDetails(directoryName: string): Promise<CompatToolDetails> {
  return getCompatToolDetailsCallable(directoryName);
}
