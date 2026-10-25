// src/lib/steamRestartPrompt.tsx
//
// Steam only loads compatibility tools when it starts (#137). Measured on the
// October 2026 client: a tool extracted into compatibilitytools.d while Steam
// runs is rejected by SpecifyCompatTool (the game silently resets to the
// Steam default) until Steam restarts. So every finished install, from the
// Configure dialog or the Compatibility Tools tab, ends with this prompt.

import { createElement } from 'react';
import { ConfirmModal, showModal } from '@decky/ui';
import { logFrontendEvent } from './logger';
import { t } from './i18n';

/** True when an install "success" only means the version was already there. */
export function isAlreadyInstalledMessage(message: string | null | undefined): boolean {
  return /already (installed|points to)/i.test(message ?? '');
}

/** Ask Steam to restart. Returns false (and logs) when the API is missing or throws. */
export function restartSteam(source: string): boolean {
  const user = (globalThis as any).SteamClient?.User;
  if (typeof user?.StartRestart !== 'function') {
    void logFrontendEvent('ERROR', 'restartSteam: SteamClient.User.StartRestart missing', { source });
    return false;
  }
  try {
    user.StartRestart(false);
    void logFrontendEvent('INFO', 'restartSteam: restart requested', { source, api: 'SteamClient.User.StartRestart' });
    return true;
  } catch (err) {
    void logFrontendEvent('ERROR', 'restartSteam: StartRestart threw', {
      source, error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * "Restart Steam to use <tool>" with Restart Steam / Close. Shared by the
 * Configure dialog and the Compatibility Tools tab so both behave the same.
 */
export function promptSteamRestartForTool(toolName: string, source: string): void {
  const extras = t().extras!;
  void logFrontendEvent('INFO', 'Steam restart prompt shown after install', { toolName, source });
  // createElement rather than JSX keeps this a plain .ts module.
  const modal = showModal(
    createElement(ConfirmModal, {
      strTitle: extras.steamRestartTitle(toolName),
      strDescription: extras.steamRestartBody(toolName),
      strOKButtonText: extras.steamRestartNow(),
      strCancelButtonText: t().common.close,
      onOK: () => {
        restartSteam(source);
        modal.Close();
      },
      onCancel: () => {
        void logFrontendEvent('INFO', 'Steam restart prompt closed without restarting', { toolName, source });
        modal.Close();
      },
    }),
  );
}
