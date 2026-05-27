/**
 * Helpers for the About-tab self-update flow.
 *
 * Mirrors the pattern used in settingsTabProgress.ts for the Proton-GE
 * installer: the backend writes progress to a shared status dict that
 * the frontend polls every 3 seconds while state === 'running'.
 */

export interface UpdateStatusResult {
  state: 'idle' | 'running' | 'success' | 'error';
  stage: 'downloading' | 'extracting' | null;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  progress_fraction: number | null;
  version: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export interface UpdateCheckResult {
  success: boolean;
  current_version?: string;
  latest_version?: string;
  has_update?: boolean;
  zip_url?: string | null;
  asset_size?: number | null;
  release_url?: string;
  error?: string;
}

export function shouldPollUpdateStatus(status: UpdateStatusResult | null): boolean {
  return status?.state === 'running';
}

/**
 * Attempt a hot-reload of the named plugin via DeckyPluginLoader.
 * Falls back to restarting the plugin_loader systemd service (via a backend
 * callable), which properly reloads the Python backend with new files.
 * Last resort: full Steam client restart.
 */
export async function triggerReload(_pluginName: string): Promise<'reloaded' | 'restarting' | 'failed'> {
  try {
    const loader = (window as any).DeckyPluginLoader;
    if (typeof loader?.reloadPlugin === 'function') {
      await loader.reloadPlugin(_pluginName);
      return 'reloaded';
    }
  } catch {
    // fall through to service restart
  }
  // Restart plugin_loader service -- this reloads the Python backend with the
  // newly installed files. The callable fires a delayed subprocess and returns
  // immediately; the backend dies ~1.5s later and Decky revives it.
  try {
    const { callable } = await import('@decky/api');
    const restartLoader = callable<[], { success: boolean }>('restart_plugin_loader');
    await restartLoader();
    return 'restarting';
  } catch {
    // fall through to Steam restart
  }
  try {
    (window as any).SteamClient?.System?.RestartSteamClient?.();
    return 'restarting';
  } catch {
    return 'failed';
  }
}
