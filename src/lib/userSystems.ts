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

// Try several known Steam client internals to find the current user's id.
// The preferred SteamClient.User.GetCurrentUser() path can silently return
// an empty object on some builds, so we also check the long-standing App and
// loginStore globals as a fallback. See:
// https://github.com/SteamDeckHomebrew/decky-loader/issues/ (various reports)
function tryGetSteamIdFromAnySource(): { id: string | null; source: string } {
  const g = globalThis as any;

  try {
    const user = g.SteamClient?.User?.GetCurrentUser?.();
    if (typeof user?.strSteamID === 'string' && user.strSteamID.length > 0) {
      return { id: user.strSteamID, source: 'SteamClient.User.GetCurrentUser' };
    }
  } catch { /* fall through */ }

  try {
    const sid = g.App?.m_CurrentUser?.strSteamID;
    if (typeof sid === 'string' && sid.length > 0) {
      return { id: sid, source: 'App.m_CurrentUser' };
    }
  } catch { /* fall through */ }

  try {
    // loginStore is exposed by the Steam frontend, non-null after login
    const sid = g.loginStore?.m_strCurrentLoginSteamID;
    if (typeof sid === 'string' && sid.length > 0) {
      return { id: String(sid), source: 'loginStore' };
    }
  } catch { /* fall through */ }

  return { id: null, source: 'none' };
}

export function getSteamId(): string | null {
  const { id, source } = tryGetSteamIdFromAnySource();
  if (id) {
    void logFrontendEvent('DEBUG', 'Resolved Steam id', { source, idPrefix: id.slice(0, 8) });
    return id;
  }
  // log enough shape info to diagnose future "no Steam id" warnings
  const g = globalThis as any;
  void logFrontendEvent('WARNING', 'Could not resolve Steam id from any source', {
    hasSteamClient: !!g.SteamClient,
    hasSteamClientUser: !!g.SteamClient?.User,
    hasGetCurrentUser: typeof g.SteamClient?.User?.GetCurrentUser === 'function',
    currentUserKeys: (() => {
      try {
        return Object.keys(g.SteamClient?.User?.GetCurrentUser?.() ?? {});
      } catch { return ['<threw>']; }
    })(),
    hasApp: !!g.App,
    hasAppCurrentUser: !!g.App?.m_CurrentUser,
    hasLoginStore: !!g.loginStore,
  });
  return null;
}

// Treat the literal string "Unknown" as "we couldn't probe this", matching what
// protondb_systeminfo.py writes when a fallback hit. An all-whitespace or bracket
// wrapper like "[Unknown]" slips through here on purpose, the web-side parser
// still cleans those up before they reach the UI.
function dropUnknown(s: string): string {
  return /^unknown$/i.test(s.trim()) ? '' : s.trim();
}

// Pull Manufacturer/Model off the "Computer Information:" block so a Steam Deck
// (Valve Jupiter = LCD, Valve Galileo = OLED) doesn't need a GPU match to get a
// nice label. Falls through to '' if either field is missing.
function parseComputerInfo(text: string): { manufacturer: string; model: string } {
  const m = text.match(/Manufacturer:\s*(.+)/i);
  const mo = text.match(/Model:\s*(.+)/i);
  return {
    manufacturer: dropUnknown(m ? m[1] : ''),
    model: dropUnknown(mo ? mo[1] : ''),
  };
}

function guessGpuVendor(gpu: string): string {
  const s = gpu.toLowerCase();
  if (/(nvidia|geforce|quadro)/.test(s)) return 'NVIDIA';
  if (/(amd|radeon|rdna|vega|vangogh|\brx\s*\d)/.test(s)) return 'AMD';
  if (/(intel|arc\b|iris|uhd|\bxe\b)/.test(s)) return 'Intel';
  return '';
}

// Build a short label from Steam's system info blob. Priority order:
//   1) Steam Deck (Valve Jupiter/Galileo, or VanGogh/AMD Custom APU 0405 in the text)
//   2) "{os} · {gpu}" when both parsed cleanly
//   3) "{os}-{vendor}-{gpu}" fallback so a label always carries enough hints
//      to tell two uploaded systems apart
//   4) 'Uploaded system' as last resort
//
// The web profile lets users rename this inline, so parsing doesn't have to
// be perfect — we just don't want to leave them staring at "Unknown"
export function generateLabel(sysinfoText: string): string {
  // OS name lives on the line after the "Operating System Version:" header.
  // Windows Steam quotes it ("Arch Linux"), the Linux plugin writes it
  // unquoted with some indent. \s*\n\s* eats the newline plus any indent.
  let os = '';
  const osMatch = sysinfoText.match(/Operating System Version:\s*\n\s*(.+)/i);
  if (osMatch) {
    // strip trailing "(64 bit)" / "(build ...)" first so any wrapping
    // quotes end up at the actual end of the string, then peel those off
    os = dropUnknown(osMatch[1]
      .replace(/\s*\([^)]*\)\s*/g, '')
      .replace(/^"(.*)"$/, '$1'));
  }

  // Steam prints "Driver:  NVIDIA Corporation NVIDIA GeForce RTX 4070"
  // drop the corp/vendor prefix so the label stays short
  const gpuMatch = sysinfoText.match(/(?:^|\n)\s*Driver:\s*(.+)/i);
  let gpu = dropUnknown(gpuMatch ? gpuMatch[1] : '');
  gpu = gpu
    .replace(/^(NVIDIA Corporation|Advanced Micro Devices.*?Inc\.|AMD|Intel Corporation|Intel)\s+/i, '')
    .replace(/^NVIDIA\s+/i, ''); // "NVIDIA GeForce" -> "GeForce"

  // Deck detection first — saves every Deck upload from looking generic
  const { manufacturer, model } = parseComputerInfo(sysinfoText);
  const deckByBoard = /^valve$/i.test(manufacturer) && /^(jupiter|galileo)$/i.test(model);
  const deckByChips = /vangogh|amd custom apu 0405/i.test(sysinfoText);
  if (deckByBoard || deckByChips) {
    if (/galileo/i.test(model)) return 'Steam Deck OLED';
    if (/jupiter/i.test(model)) return 'Steam Deck LCD';
    return 'Steam Deck';
  }

  if (os && gpu) return `${os} · ${gpu}`;

  // Nothing pretty to show — build {os}-{vendor}-{gpu_model} from whatever we
  // do have. Skip empty segments so we never end up with stray dashes.
  const vendor = guessGpuVendor(gpu);
  const parts = [os, vendor, gpu].filter(Boolean);
  if (parts.length) return parts.join('-');
  return 'Uploaded system';
}

const SUPABASE_URL = 'https://ilsgdshkaocrmibwdezk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3Oqhm4JneafJNQw9BuUaxw_L9qZa-5V';
const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;

function supabaseHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export type UploadResult =
  | { ok: true }
  | { ok: false; error: string };

// Uploads the plugin's hardware row. Two-step to preserve web-edited label:
//  1. GET to check if the row exists
//  2a. row missing  -> POST with label + is_default (if first system for user)
//  2b. row present  -> PATCH only sysinfo_text + updated_at
export async function uploadSystem(sysinfoText: string): Promise<UploadResult> {
  const steamId = getSteamId();
  if (!steamId) return { ok: false, error: 'Not signed in to Steam' };
  const deviceId = getDeviceId();

  try {
    const existingUrl =
      `${SUPABASE_REST_URL}/user_systems?steam_id=eq.${encodeURIComponent(steamId)}` +
      `&device_id=eq.${encodeURIComponent(deviceId)}&select=device_id`;
    const existingRes = await fetch(existingUrl, { headers: supabaseHeaders() });
    if (!existingRes.ok) {
      return { ok: false, error: `Lookup failed: HTTP ${existingRes.status}` };
    }
    const existing = (await existingRes.json()) as unknown[];

    if (existing.length === 0) {
      // first upload for this device -> insert. Check if this is the first
      // system overall for the steam id so we can mark it default
      const anyUrl =
        `${SUPABASE_REST_URL}/user_systems?steam_id=eq.${encodeURIComponent(steamId)}&select=device_id`;
      const anyRes = await fetch(anyUrl, { headers: supabaseHeaders() });
      const anyRows = anyRes.ok ? ((await anyRes.json()) as unknown[]) : [];
      const isFirst = anyRows.length === 0;

      const body = {
        steam_id: steamId,
        device_id: deviceId,
        label: generateLabel(sysinfoText),
        sysinfo_text: sysinfoText,
        is_default: isFirst,
        updated_at: new Date().toISOString(),
      };
      const postRes = await fetch(
        `${SUPABASE_REST_URL}/user_systems?on_conflict=steam_id,device_id`,
        {
          method: 'POST',
          headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(body),
        },
      );
      if (!postRes.ok) {
        const err = await postRes.json().catch(() => ({}));
        return { ok: false, error: (err as any).message || `HTTP ${postRes.status}` };
      }
      void logFrontendEvent('INFO', 'Inserted new user_systems row', { isFirst });
      return { ok: true };
    }

    // row exists -> patch only mutable fields owned by the plugin
    const body = {
      sysinfo_text: sysinfoText,
      updated_at: new Date().toISOString(),
    };
    const patchRes = await fetch(
      `${SUPABASE_REST_URL}/user_systems?steam_id=eq.${encodeURIComponent(steamId)}` +
      `&device_id=eq.${encodeURIComponent(deviceId)}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify(body),
      },
    );
    if (!patchRes.ok) {
      const err = await patchRes.json().catch(() => ({}));
      return { ok: false, error: (err as any).message || `HTTP ${patchRes.status}` };
    }
    void logFrontendEvent('INFO', 'Updated existing user_systems row');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
