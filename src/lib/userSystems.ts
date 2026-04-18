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

// Build a short "OS · GPU" label from Steam's system info blob. Best-effort,
// whatever we can't parse we just leave out. The web profile lets users edit
// this inline so parsing doesn't have to be perfect
export function generateLabel(sysinfoText: string): string {
  const osMatch = sysinfoText.match(/Operating System Version:[\s\S]{0,80}?"([^"]+)"/i);
  const os = osMatch ? osMatch[1].replace(/\s*\([^)]*\)\s*/g, '').trim() : '';

  // Steam prints "Driver:  NVIDIA Corporation NVIDIA GeForce RTX 4070"
  // drop the corp/vendor prefix so the label stays short
  const gpuMatch = sysinfoText.match(/(?:^|\n)\s*Driver:\s*(.+)/i);
  let gpu = gpuMatch ? gpuMatch[1].trim() : '';
  gpu = gpu.replace(/^(NVIDIA Corporation|Advanced Micro Devices.*?Inc\.|AMD|Intel Corporation|Intel)\s+/i, '');
  gpu = gpu.replace(/^NVIDIA\s+/i, ''); // "NVIDIA GeForce" -> "GeForce"

  if (os && gpu) return `${os} · ${gpu}`;
  if (os) return os;
  if (gpu) return gpu;
  return 'Unknown system';
}
