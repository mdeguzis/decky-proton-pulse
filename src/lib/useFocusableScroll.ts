// Shared scrollable-tab focus hook for Decky plugin pages.
//
// Why this exists:
//   Decky tabs don't get scrolled by D-pad input automatically. Steam scrolls
//   whichever focusable child is currently focused into view, and only when
//   that child is OFF-screen. That makes early D-pad pushes feel "dead" --
//   focus moves between visible rows with no page motion until you reach the
//   bottom. To get the page to scroll as the focus indicator moves, every
//   focus change has to call scrollIntoView() directly.
//
//   Both AnalysisTab and SystemRequirementsTab were duplicating this logic.
//   Putting it in one hook lets us tune the scroll feel (block: 'center' vs
//   'start', behavior: 'auto' vs 'smooth', margin) for all tabs at once.
//
// Used by: src/components/tabs/AnalysisTab.tsx, src/components/tabs/SystemRequirementsTab.tsx
//          Any new scrollable tab should reach for this hook before reimplementing.

import { useState, useCallback } from 'react';
import type React from 'react';

export interface FocusableScrollOptions {
  // Where to position the focused row in the viewport. 'center' keeps the
  // focused row pinned to the middle so users see context above and below
  // ('start' would push it to the top, 'nearest' would only scroll when
  // off-screen which is Steam's default and feels laggy)
  block?: ScrollLogicalPosition;
  // 'auto' = instant jump (snappiest D-pad feel). 'smooth' = CSS animated
  // scroll, which can feel laggy on the Deck because the GPU compositor
  // queues the animation behind input events
  behavior?: ScrollBehavior;
}

export interface FocusableScrollApi {
  // Currently focused row id, or null if nothing in this tab is focused
  focusedRow: string | null;
  // Build an onFocus handler bound to a specific row id. Hand the returned
  // function to PpDialogButton's onFocus prop
  onRowFocus: (id: string) => (e: React.FocusEvent<HTMLElement>) => void;
  // onBlur handler that clears the focused-row marker
  onRowBlur: () => void;
  // Build the focus-indicator border style for a row by id. Returns the
  // CSS value for the row's `borderRight` field
  focusBorder: (id: string) => string;
}

// Single source of truth for the indicator color. Bumping it here updates
// every tab.
const FOCUS_BORDER_COLOR = '#1a9fff';

export function useFocusableScroll(opts: FocusableScrollOptions = {}): FocusableScrollApi {
  const { block = 'center', behavior = 'auto' } = opts;
  const [focusedRow, setFocusedRow] = useState<string | null>(null);

  const onRowFocus = useCallback(
    (id: string) => (e: React.FocusEvent<HTMLElement>) => {
      setFocusedRow(id);
      e.currentTarget.scrollIntoView({ block, behavior });
    },
    [block, behavior],
  );

  const onRowBlur = useCallback(() => setFocusedRow(null), []);

  const focusBorder = useCallback(
    (id: string) =>
      focusedRow === id ? `3px solid ${FOCUS_BORDER_COLOR}` : '3px solid transparent',
    [focusedRow],
  );

  return { focusedRow, onRowFocus, onRowBlur, focusBorder };
}
