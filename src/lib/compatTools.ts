import { callable } from '@decky/api';
import type { ProtonGeManagerState, ProtonVersionAvailability } from '../types';

const getProtonGeManagerStateCallable = callable<[force_refresh?: boolean], ProtonGeManagerState>('get_proton_ge_manager_state');
const checkProtonVersionAvailabilityCallable = callable<[version: string], ProtonVersionAvailability>('check_proton_version_availability');
const installProtonGeCallable = callable<[version?: string | null, installAsLatest?: boolean], { success: boolean; message: string; already_installed?: boolean }>('install_proton_ge');
const cancelProtonGeInstallCallable = callable<[], { success: boolean; message: string }>('cancel_proton_ge_install');
const uninstallCompatibilityToolCallable = callable<[directoryName: string], { success: boolean; message: string }>('uninstall_compatibility_tool');
const installCompatibilityToolArchiveCallable = callable<[archivePath: string], { success: boolean; message: string; already_installed?: boolean }>('install_compatibility_tool_archive');

export async function getProtonGeManagerState(forceRefresh = false): Promise<ProtonGeManagerState> {
  return getProtonGeManagerStateCallable(forceRefresh);
}

export async function checkProtonVersionAvailability(version: string): Promise<ProtonVersionAvailability> {
  return checkProtonVersionAvailabilityCallable(version);
}

export async function installProtonGe(
  version?: string | null,
  installAsLatest = false,
): Promise<{ success: boolean; message: string; already_installed?: boolean }> {
  return installProtonGeCallable(version ?? null, installAsLatest);
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
