// Shared post-install toast helper for the rolling latest-slot feature
// (#116). When a successful install refreshes the Proton-GE-Latest or
// Proton-CachyOS-Latest symlink, Steam's compat picker needs a client
// restart to see the new label -- surface that explicitly so users
// don't wonder why "Proton-GE-Latest" isn't showing up in Compat
// Properties for a game.

import { toaster } from './notify';

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
 * Fire the "Steam restart required" toast when the rolling-slot symlink
 * was actually re-pointed. Returns true if a toast was shown so callers
 * can suppress duplicate messaging.
 */
export function maybeToastRollingSlotChange(result: InstallResultWithSlot): boolean {
  if (!result.success) return false;
  const slot = result.rolling_slot;
  if (!slot?.ok || !slot.changed) return false;
  // Keep the toast short so Steam's toast bar doesn't truncate the
  // second sentence. Users reported the previous copy getting cut off.
  // Full detail lives in the plugin log for anyone debugging.
  toaster.toast({
    title: 'Proton Pulse',
    body: 'Please restart Steam for changes to take effect.',
  });
  return true;
}
