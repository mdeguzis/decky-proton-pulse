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
  // Extract "Proton-GE-Latest" or "Proton-CachyOS-Latest" from the slot
  // path (last path segment) so the toast names the specific slot the
  // user should look for in Steam's compat picker.
  const slotName = (slot.slot || '').split('/').pop() || 'the rolling slot';
  toaster.toast({
    title: 'Proton Pulse',
    body:
      `${slotName} was updated. Restart the Steam client so the new ` +
      `version shows up in Compatibility Properties.`,
  });
  return true;
}
