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
    const sid = g.loginStore?.m_strCurrentLoginSteamID
      ?? g.loginStore?.m_strAccountName; // last resort, account name is unique too
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

// Build a short "OS · GPU" label from Steam's system info blob. Best-effort,
// whatever we can't parse we just leave out. The web profile lets users edit
// this inline so parsing doesn't have to be perfect
export function generateLabel(sysinfoText: string): string {
  // "Operating System Version:" is a header. The actual name sits on
  // the next line. Windows Steam quotes it ("Arch Linux"), the Linux
  // plugin writes it unquoted with some indent. \s*\n\s* eats the
  // newline plus any indent so (.+) grabs just the value line.
  let os = '';
  const osMatch = sysinfoText.match(/Operating System Version:\s*\n\s*(.+)/i);
  if (osMatch) {
    // strip trailing "(64 bit)" / "(build ...)" first so any wrapping
    // quotes end up at the actual end of the string, then drop them
    os = osMatch[1].trim()
      .replace(/\s*\([^)]*\)\s*/g, '')
      .replace(/^"(.*)"$/, '$1')
      .trim();
  }

  // Steam prints "Driver:  NVIDIA Corporation NVIDIA GeForce RTX 4070"
  // drop the corp/vendor prefix so the label stays short
  const gpuMatch = sysinfoText.match(/(?:^|\n)\s*Driver:\s*(.+)/i);
  let gpu = gpuMatch ? gpuMatch[1].trim() : '';
  if (/^unknown$/i.test(gpu)) gpu = ''; // backend places this when it can't probe
  gpu = gpu.replace(/^(NVIDIA Corporation|Advanced Micro Devices.*?Inc\.|AMD|Intel Corporation|Intel)\s+/i, '');
  gpu = gpu.replace(/^NVIDIA\s+/i, ''); // "NVIDIA GeForce" -> "GeForce"

  if (os && gpu) return `${os} · ${gpu}`;
  if (os) return os;
  if (gpu) return gpu;
  return 'Unknown system';
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
