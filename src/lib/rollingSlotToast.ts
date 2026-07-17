// Shared post-install toast helper for the rolling latest-slot feature
// (#116). When a successful install refreshes the Proton-GE-Latest or
// Proton-CachyOS-Latest symlink, Steam's compat picker needs a client
// restart to see the new label -- surface that explicitly so users
// don't wonder why "Proton-GE-Latest" isn't showing up in Compat
// Properties for a game.

import { createElement, type CSSProperties } from 'react';
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

// Style overrides that break the Deck popup-toast body out of Valve's
// ShortTemplate.Body class -- that CSS caps height + white-space: nowrap
// + text-overflow: ellipsis, so a two-sentence body reads as one clipped
// line. Since @decky/api's `body` is a ReactNode we can wrap the text in
// a <div> with inline styles that override every constraint that would
// cause the clip. Verified against SteamDeckHomebrew/decky-loader
// frontend/src/components/Toast.tsx (GamepadUIPopupToast renders the
// body through templateClasses.Body).
const _bodyStyle: CSSProperties = {
  whiteSpace: 'normal',
  overflow: 'visible',
  textOverflow: 'clip',
  display: 'block',
  height: 'auto',
  maxHeight: 'none',
  WebkitLineClamp: 'unset' as unknown as number,
  lineHeight: 1.25,
};

/**
 * Fire the "Steam restart required" toast when the rolling-slot symlink
 * was actually re-pointed. Returns true if a toast was shown so callers
 * can suppress duplicate messaging.
 */
export function maybeToastRollingSlotChange(result: InstallResultWithSlot): boolean {
  if (!result.success) return false;
  const slot = result.rolling_slot;
  if (!slot?.ok || !slot.changed) return false;
  // body is a React node (not a plain string) so the inline style can
  // override Valve's ShortTemplate.Body single-line clip. duration is
  // 6s so users have time to read the full sentence.
  toaster.toast({
    title: 'Proton Pulse',
    body: createElement(
      'div',
      { style: _bodyStyle },
      'Please restart Steam for changes to take effect.'
    ),
    duration: 6000,
  });
  return true;
}
