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

// Tools already prompted for in this Steam session. One install can reach
// this prompt twice: the Configure dialog prompts when its install finishes,
// then the Compatibility Tools tab sees the same finished install in the
// backend status on its next mount and prompted again. A Steam restart
// reloads the plugin, which clears this set, so the next install after a
// restart prompts as usual.
const _prompted = new Set<string>();

/**
 * "Restart Steam to use <tool>" with Restart Steam / Close. Shared by the
 * Configure dialog and the Compatibility Tools tab so both behave the same.
 * Shown at most once per tool per Steam session.
 */
export function promptSteamRestartForTool(toolName: string, source: string): void {
  const key = toolName.trim().toLowerCase();
  if (_prompted.has(key)) {
    void logFrontendEvent('DEBUG', 'Steam restart prompt already shown for this tool, skipping', { toolName, source });
    return;
  }
  _prompted.add(key);
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

/** Test hook. */
export function _resetSteamRestartPromptForTests(): void {
  _prompted.clear();
}
