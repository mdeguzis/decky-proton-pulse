// src/lib/pageState.ts
// Shared state set by the sidebar before Router.Navigate('/proton-pulse').
// Read on mount by ProtonPulsePage to restore context.

export type PageId = 'configure' | 'manage' | 'logs' | 'settings' | 'about';

export const pageState: {
  initialPage: PageId;
  appId: number | null;
  appName: string;
} = {
  initialPage: 'configure',
  appId: null,
  appName: '',
};
