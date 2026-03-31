// src/lib/pageState.ts
// pageState holds fallback values for the initial mount of ProtonPulsePage.
// For re-entries (when the page is already mounted), use dispatchNavigate()
// which fires a CustomEvent that the mounted component listens for.

export type PageId = 'configure' | 'manage' | 'logs' | 'settings' | 'about';

export interface NavigatePayload {
  tab: PageId;
  appId: number | null;
  appName: string;
}

export const NAVIGATE_EVENT = 'proton-pulse:navigate';

export function dispatchNavigate(payload: NavigatePayload): void {
  window.dispatchEvent(new CustomEvent<NavigatePayload>(NAVIGATE_EVENT, { detail: payload }));
}

// Fallback for initial mount only — do not read after first render.
export const pageState: {
  initialPage: PageId;
  appId: number | null;
  appName: string;
} = {
  initialPage: 'configure',
  appId: null,
  appName: '',
};
