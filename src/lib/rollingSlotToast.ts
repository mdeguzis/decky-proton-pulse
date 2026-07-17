// Shared post-install toast helper for the rolling latest-slot feature
// (#116). When a successful install refreshes the Proton-GE-Latest or
// Proton-CachyOS-Latest symlinks, Steam's compat picker needs a client
// restart to see the new label -- surface that explicitly so users
// don't wonder why "Proton-GE-Latest" isn't showing up in Compat
// Properties for a game.

import { toaster } from './notify';
import { ensureToastWrapStylesInstalled, PP_TOAST_WRAP_CLASS } from './toastStyles';

export interface InstallResultWithSlot {
  success: boolean;
  message: string;
  already_installed?: boolean;
  rolling_slot?: {
    ok: boolean;
    changed?: boolean;
    reason?: string;
    target?: string;
    slot?: string;
  };
}

/**
 * Fire the "Steam restart required" toast when the rolling-slot symlinks
 * were actually re-pointed. Returns true if a toast was shown so callers
 * can suppress duplicate messaging.
 */
export function maybeToastRollingSlotChange(result: InstallResultWithSlot): boolean {
  if (!result.success) return false;
  const slot = result.rolling_slot;
  if (!slot?.ok || !slot.changed) return false;
  // Install our stylesheet BEFORE emitting the toast so the wrap class is
  // matched from the moment Steam renders it. contentClassName ties this
  // specific toast to the wrap CSS scope.
  ensureToastWrapStylesInstalled();
  toaster.toast({
    title: 'Proton Pulse',
    body: 'Please restart Steam for changes to take effect.',
    contentClassName: PP_TOAST_WRAP_CLASS,
    duration: 6000,
  });
  return true;
}
