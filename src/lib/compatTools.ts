// Compatibility tool management patterns inspired by decky-wine-cellar by FlashyReese (MIT):
// https://github.com/FlashyReese/decky-wine-cellar
import { callable } from '@decky/api';
import type { CompatToolId, ProtonGeManagerState, ProtonVersionAvailability } from '../types';

const getCompatManagerStateCallable = callable<
  [tool_id: CompatToolId, force_refresh?: boolean],
  ProtonGeManagerState
>('get_compat_manager_state');
const installCompatToolCallable = callable<
  [tool_id: CompatToolId, version?: string | null, install_as_latest?: boolean, force_reinstall?: boolean],
  { success: boolean; message: string; already_installed?: boolean }
>('install_compat_tool');
const cancelCompatToolInstallCallable = callable<
  [tool_id?: CompatToolId],
  { success: boolean; message: string }
>('cancel_compat_tool_install');

const getProtonGeManagerStateCallable = callable<[force_refresh?: boolean], ProtonGeManagerState>('get_proton_ge_manager_state');
const checkProtonVersionAvailabilityCallable = callable<[version: string], ProtonVersionAvailability>('check_proton_version_availability');
const installProtonGeCallable = callable<
  [version?: string | null, installAsLatest?: boolean, forceReinstall?: boolean],
  { success: boolean; message: string; already_installed?: boolean }
>('install_proton_ge');
const cancelProtonGeInstallCallable = callable<[], { success: boolean; message: string }>('cancel_proton_ge_install');
const uninstallCompatibilityToolCallable = callable<[directoryName: string], { success: boolean; message: string }>('uninstall_compatibility_tool');
const installCompatibilityToolArchiveCallable = callable<[archivePath: string], { success: boolean; message: string; already_installed?: boolean }>('install_compatibility_tool_archive');

export async function getCompatManagerState(toolId: CompatToolId, forceRefresh = false): Promise<ProtonGeManagerState> {
  return getCompatManagerStateCallable(toolId, forceRefresh);
}

export async function installCompatTool(
  toolId: CompatToolId,
  version?: string | null,
  installAsLatest = false,
  forceReinstall = false,
): Promise<{ success: boolean; message: string; already_installed?: boolean }> {
  return installCompatToolCallable(toolId, version ?? null, installAsLatest, forceReinstall);
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
): Promise<{ success: boolean; message: string; already_installed?: boolean }> {
  return installProtonGeCallable(version ?? null, installAsLatest, forceReinstall);
}

export async function cancelProtonGeInstall(): Promise<{ success: boolean; message: string }> {
  return cancelProtonGeInstallCallable();
}

export async function uninstallCompatibilityTool(directoryName: string): Promise<{ success: boolean; message: string }> {
  return uninstallCompatibilityToolCallable(directoryName);
}

export async function installCompatibilityToolArchive(archivePath: string): Promise<{ success: boolean; message: string; already_installed?: boolean }> {
  return installCompatibilityToolArchiveCallable(archivePath);
}
