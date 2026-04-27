import { callable } from '@decky/api';
import type { LsfgVkManagerState } from '../types';

const getLsfgVkManagerStateCallable = callable<[force_refresh?: boolean], LsfgVkManagerState>('get_lsfg_vk_manager_state');
const installLsfgVkCallable = callable<
  [version?: string | null, installAsLatest?: boolean, forceReinstall?: boolean],
  { success: boolean; message: string; already_installed?: boolean }
>('install_lsfg_vk');
const cancelLsfgVkInstallCallable = callable<[], { success: boolean; message: string }>('cancel_lsfg_vk_install');
const uninstallLsfgVkCallable = callable<[directoryName: string], { success: boolean; message: string }>('uninstall_lsfg_vk');
const isLsfgVkAvailableCallable = callable<[], { available: boolean; path: string | null }>('is_lsfg_vk_available');

export async function getLsfgVkManagerState(forceRefresh = false): Promise<LsfgVkManagerState> {
  return getLsfgVkManagerStateCallable(forceRefresh);
}

export async function installLsfgVk(
  version?: string | null,
  installAsLatest = false,
  forceReinstall = false,
): Promise<{ success: boolean; message: string; already_installed?: boolean }> {
  return installLsfgVkCallable(version ?? null, installAsLatest, forceReinstall);
}

export async function cancelLsfgVkInstall(): Promise<{ success: boolean; message: string }> {
  return cancelLsfgVkInstallCallable();
}

export async function uninstallLsfgVk(directoryName: string): Promise<{ success: boolean; message: string }> {
  return uninstallLsfgVkCallable(directoryName);
}

export async function isLsfgVkAvailable(): Promise<{ available: boolean; path: string | null }> {
  return isLsfgVkAvailableCallable();
}
