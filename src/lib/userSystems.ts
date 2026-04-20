// src/lib/userSystems.ts
// Per-device hardware upload to Supabase, now owned by the linked Proton Pulse
// account instead of Steam identity.

import { logFrontendEvent } from './logger';
import { getInstallationId, getLinkedProtonPulseUserId } from './protonPulseAccount';

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

function dropUnknown(s: string): string {
  return /^unknown$/i.test(s.trim()) ? '' : s.trim();
}

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

export function generateLabel(sysinfoText: string): string {
  let os = '';
  const osMatch = sysinfoText.match(/Operating System Version:\s*\n\s*(.+)/i);
  if (osMatch) {
    os = dropUnknown(osMatch[1]
      .replace(/\s*\([^)]*\)\s*/g, '')
      .replace(/^"(.*)"$/, '$1'));
  }

  const gpuMatch = sysinfoText.match(/(?:^|\n)\s*Driver:\s*(.+)/i);
  let gpu = dropUnknown(gpuMatch ? gpuMatch[1] : '');
  gpu = gpu
    .replace(/^(NVIDIA Corporation|Advanced Micro Devices.*?Inc\.|AMD|Intel Corporation|Intel)\s+/i, '')
    .replace(/^NVIDIA\s+/i, '');

  const { manufacturer, model } = parseComputerInfo(sysinfoText);
  const deckByBoard = /^valve$/i.test(manufacturer) && /^(jupiter|galileo)$/i.test(model);
  const deckByChips = /vangogh|amd custom apu 0405/i.test(sysinfoText);
  if (deckByBoard || deckByChips) {
    if (/galileo/i.test(model)) return 'Steam Deck OLED';
    if (/jupiter/i.test(model)) return 'Steam Deck LCD';
    return 'Steam Deck';
  }

  if (os && gpu) return `${os} · ${gpu}`;

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

export async function uploadSystem(sysinfoText: string): Promise<UploadResult> {
  const protonPulseUserId = getLinkedProtonPulseUserId();
  if (!protonPulseUserId) {
    return { ok: false, error: 'Link your Proton Pulse account first' };
  }

  const deviceId = getDeviceId();
  const installationId = getInstallationId();

  try {
    const existingUrl =
      `${SUPABASE_REST_URL}/user_systems?proton_pulse_user_id=eq.${encodeURIComponent(protonPulseUserId)}` +
      `&device_id=eq.${encodeURIComponent(deviceId)}&select=device_id`;
    const existingRes = await fetch(existingUrl, { headers: supabaseHeaders() });
    if (!existingRes.ok) {
      return { ok: false, error: `Lookup failed: HTTP ${existingRes.status}` };
    }
    const existing = (await existingRes.json()) as unknown[];

    if (existing.length === 0) {
      const anyUrl =
        `${SUPABASE_REST_URL}/user_systems?proton_pulse_user_id=eq.${encodeURIComponent(protonPulseUserId)}&select=device_id`;
      const anyRes = await fetch(anyUrl, { headers: supabaseHeaders() });
      const anyRows = anyRes.ok ? ((await anyRes.json()) as unknown[]) : [];
      const isFirst = anyRows.length === 0;

      const body = {
        proton_pulse_user_id: protonPulseUserId,
        installation_id: installationId,
        device_id: deviceId,
        label: generateLabel(sysinfoText),
        sysinfo_text: sysinfoText,
        is_default: isFirst,
        updated_at: new Date().toISOString(),
      };
      const postRes = await fetch(
        `${SUPABASE_REST_URL}/user_systems?on_conflict=proton_pulse_user_id,device_id`,
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

    const body = {
      installation_id: installationId,
      sysinfo_text: sysinfoText,
      updated_at: new Date().toISOString(),
    };
    const patchRes = await fetch(
      `${SUPABASE_REST_URL}/user_systems?proton_pulse_user_id=eq.${encodeURIComponent(protonPulseUserId)}` +
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
