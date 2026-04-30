import { toaster as deckyToaster } from '@decky/api';
import { logFrontendEvent } from './logger';
import { getSetting } from './settings';

export const NOTIFICATIONS_ENABLED_KEY = 'notifications-enabled';
export const TOAST_SOUND_KEY = 'toast-sound-enabled';

export function notificationsEnabled(): boolean {
  return getSetting(NOTIFICATIONS_ENABLED_KEY, true);
}

export function toastSoundEnabled(): boolean {
  return getSetting(TOAST_SOUND_KEY, true);
}

type ToastArgs = Parameters<typeof deckyToaster.toast>[0];

export const toaster = {
  toast(args: ToastArgs): void {
    if (!notificationsEnabled()) return;
    const soundOn = toastSoundEnabled();
    void logFrontendEvent('DEBUG', '[notify] toast fired', { playSound: soundOn, sound: soundOn ? undefined : 0, rawSetting: localStorage.getItem('proton-pulse:toast-sound-enabled') });
    // TODO: When https://github.com/SteamDeckHomebrew/decky-loader/pull/901 ships,
    // replace the eType:40 workaround below with the proper playSound arg it exposes.
    //
    // `playSound` and `info.sound` are both ignored by the toast React component.
    // It calls PlayNotificationSound(toastData) which looks up W[eType] in Steam's
    // hardcoded notification type map and uses W[eType].playSound to decide whether
    // to play the sound -- our info object is never consulted.
    // W[40] ("Steam Input Action Set") has playSound:false, so we use eType:40 to
    // silence the sound. Decky still shows our toast because it uses its own info
    // object (showToast:true, our title/body) -- eType only affects the sound lookup.
    deckyToaster.toast({ ...args, playSound: soundOn, ...(soundOn ? {} : { sound: 0, eType: 40 }) });
  },
};
