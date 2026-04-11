import type { ProtonGeManagerState } from '../../types';

let lastConsumedInstallToastStamp: string | null = null;

export function shouldPollInstallStatus(
  managerState: ProtonGeManagerState | null,
  installingTag: string | null,
): boolean {
  return Boolean(
    managerState?.install_status.state === 'running'
    || installingTag,
  );
}

export function getInstallStatusToastStamp(
  installStatus: ProtonGeManagerState['install_status'],
): string | null {
  if (
    installStatus.state === 'idle'
    || installStatus.state === 'running'
    || !installStatus.finished_at
  ) {
    return null;
  }

  return `${installStatus.state}:${installStatus.tag_name ?? 'unknown'}:${installStatus.finished_at}`;
}

export function shouldShowInstallStatusToast(
  installStatus: ProtonGeManagerState['install_status'],
): boolean {
  const stamp = getInstallStatusToastStamp(installStatus);
  if (!stamp) {
    return false;
  }

  if (lastConsumedInstallToastStamp === stamp) {
    return false;
  }

  lastConsumedInstallToastStamp = stamp;
  return true;
}

export function resetInstallStatusToastMemory(): void {
  lastConsumedInstallToastStamp = null;
}
