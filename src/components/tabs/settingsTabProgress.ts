import type { ProtonGeManagerState } from '../../types';

let lastConsumedInstallToastStamp: string | null = null;

export interface InstallProgressLabels {
  finalizing: string;
  extracting: string;
  downloading: string;
  estimating: string;
  timeLeft: (value: string) => string;
}

export function buildInstallProgressDetails(
  installStatus: ProtonGeManagerState['install_status'] | null,
  assetSize: number | null | undefined,
  labels: InstallProgressLabels,
  nowSeconds = Math.round(Date.now() / 1000),
): {
  progressRatio: number | null;
  progressLabel: string;
  progressMeta: string;
  etaLabel: string;
} {
  const elapsedSeconds = installStatus?.started_at
    ? Math.max(1, nowSeconds - installStatus.started_at)
    : null;
  const progressRatio = installStatus?.progress_fraction ?? null;
  const progressPercent = Math.round(
    Math.max(0, Math.min(100, (progressRatio ?? 0.08) * 100)),
  );
  const isFinalizing =
    installStatus?.stage === 'finalizing'
    || (
      progressPercent >= 100
      && !!installStatus?.total_bytes
      && installStatus.downloaded_bytes !== null
      && installStatus.downloaded_bytes >= installStatus.total_bytes
    );
  const etaSeconds =
    installStatus?.total_bytes
    && installStatus.downloaded_bytes !== null
    && elapsedSeconds
    && installStatus.downloaded_bytes > 0
      ? (
        (installStatus.total_bytes - installStatus.downloaded_bytes)
        / (installStatus.downloaded_bytes / elapsedSeconds)
      )
      : null;
  const progressMeta =
    installStatus?.total_bytes && installStatus.downloaded_bytes !== null
      ? `${formatByteCount(installStatus.downloaded_bytes)} / ${formatByteCount(installStatus.total_bytes)}`
      : assetSize
        ? `${formatByteCount(installStatus?.downloaded_bytes)} / ${formatByteCount(assetSize)}`
        : `${
          installStatus?.stage === 'finalizing'
            ? labels.finalizing
            : installStatus?.stage === 'extracting'
              ? labels.extracting
              : labels.downloading
        }`;

  return {
    progressRatio,
    progressLabel: `${progressPercent}%`,
    progressMeta,
    etaLabel: isFinalizing ? labels.finalizing : formatEta(etaSeconds, labels),
  };
}

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

function formatByteCount(value: number | null | undefined): string {
  if (!value || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function formatEta(seconds: number | null | undefined, labels: InstallProgressLabels): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return labels.estimating;
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return labels.timeLeft(`${rounded}s`);
  const minutes = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (minutes < 60) return secs ? labels.timeLeft(`${minutes}m ${secs}s`) : labels.timeLeft(`${minutes}m`);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? labels.timeLeft(`${hours}h ${mins}m`) : labels.timeLeft(`${hours}h`);
}
