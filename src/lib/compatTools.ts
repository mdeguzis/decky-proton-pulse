import { callable } from '@decky/api';
import type { ProtonGeManagerState, ProtonVersionAvailability } from '../types';

const getProtonGeManagerStateCallable = callable<[force_refresh?: boolean], ProtonGeManagerState>('get_proton_ge_manager_state');
const checkProtonVersionAvailabilityCallable = callable<[version: string], ProtonVersionAvailability>('check_proton_version_availability');
const installProtonGeCallable = callable<[version?: string | null], { success: boolean; message: string; already_installed?: boolean }>('install_proton_ge');

export async function getProtonGeManagerState(forceRefresh = false): Promise<ProtonGeManagerState> {
  return getProtonGeManagerStateCallable(forceRefresh);
}

export async function checkProtonVersionAvailability(version: string): Promise<ProtonVersionAvailability> {
  return checkProtonVersionAvailabilityCallable(version);
}

export async function installProtonGe(version?: string | null): Promise<{ success: boolean; message: string; already_installed?: boolean }> {
  return installProtonGeCallable(version ?? null);
}
