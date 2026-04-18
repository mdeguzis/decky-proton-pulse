// src/lib/userSystems.ts
// Per-device hardware upload to Supabase, powers the "My Hardware" feature.
// One row per (steam_id, device_id). Plugin only writes its own row, never
// touches label or is_default on update (those are web-owned after insert)

import { logFrontendEvent } from './logger';

const DEVICE_ID_KEY = 'proton-pulse:device-id';

export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, fresh);
  void logFrontendEvent('INFO', 'Generated new plugin device id', {
    idPrefix: fresh.slice(0, 8),
  });
  return fresh;
}

export function getSteamId(): string | null {
  try {
    // SteamClient is a global injected by Steam's client. Typing is loose here.
    const user = (globalThis as any).SteamClient?.User?.GetCurrentUser?.();
    const sid = user?.strSteamID;
    return typeof sid === 'string' && sid.length > 0 ? sid : null;
  } catch {
    return null;
  }
}
