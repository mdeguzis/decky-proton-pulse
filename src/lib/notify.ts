import { toaster as deckyToaster } from '@decky/api';
import { getSetting } from './settings';

export const NOTIFICATIONS_ENABLED_KEY = 'notifications-enabled';

export function notificationsEnabled(): boolean {
  return getSetting(NOTIFICATIONS_ENABLED_KEY, true);
}

type ToastArgs = Parameters<typeof deckyToaster.toast>[0];

export const toaster = {
  toast(args: ToastArgs): void {
    if (!notificationsEnabled()) return;
    deckyToaster.toast(args);
  },
};
