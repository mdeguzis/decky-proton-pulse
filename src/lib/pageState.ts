// src/lib/pageState.ts
// pageState holds fallback values for the initial mount of ProtonPulsePage.
// For re-entries (when the page is already mounted), use dispatchNavigate()
// which fires a CustomEvent that the mounted component listens for.

export type PageId = 'manage-game' | 'manage' | 'logs' | 'compatibility-tools' | 'settings' | 'about';

export interface NavigatePayload {
  tab: PageId;
  appId: number | null;
  appName: string;
}

export const NAVIGATE_EVENT = 'proton-pulse:navigate';

function collapseRepeatedRoutesPrefix(pathname: string): string {
  return pathname.replace(/^\/routes(?:\/routes)+/u, '/routes');
}

export function normalizeDeckRoutePath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const trimmed = pathname.trim();
  if (!trimmed) return null;
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return collapseRepeatedRoutesPrefix(withLeadingSlash);
}

export function toNavigationPath(pathname: string | null | undefined): string | null {
  const normalized = normalizeDeckRoutePath(pathname);
  if (!normalized) return null;
  return normalized.startsWith('/routes/')
    ? normalized.slice('/routes'.length)
    : normalized;
}

function rememberNavigate(payload: NavigatePayload): void {
  pageState.initialPage = payload.tab;
  pageState.appId = payload.appId;
  pageState.appName = payload.appName;
  pageState.pendingNavigate = payload;
  pageState.pendingNavigateVersion += 1;
}

export function rememberReturnPath(pathname: string | null | undefined): void {
  const normalized = normalizeDeckRoutePath(pathname);
  if (!normalized || normalized.includes('/proton-pulse')) return;
  pageState.returnPath = normalized;
}

export function dispatchNavigate(payload: NavigatePayload): void {
  rememberNavigate(payload);
  window.dispatchEvent(new CustomEvent<NavigatePayload>(NAVIGATE_EVENT, { detail: payload }));
}

// Fallback for initial mount only -- do not read after first render.
export const pageState: {
  initialPage: PageId;
  appId: number | null;
  appName: string;
  focusedAppId: number | null;
  focusedAppName: string;
  returnPath: string | null;
  pendingNavigate: NavigatePayload | null;
  pendingNavigateVersion: number;
} = {
  initialPage: 'manage',
  appId: null,
  appName: '',
  focusedAppId: null,
  focusedAppName: '',
  returnPath: null,
  pendingNavigate: null,
  pendingNavigateVersion: 0,
};
