// src/lib/userSystems.ts
// Per-device hardware upload to Supabase, now owned by the linked Proton Pulse
// account instead of Steam identity.

import { logFrontendEvent } from './logger';
import { getInstallationId, getInstallationSecret, getLinkedProtonPulseUserId } from './protonPulseAccount';

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
const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`;

function supabaseHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export type UploadResult =
  | { ok: true }
  | { ok: false; error: string };

function formatUploadError(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const err = value as Record<string, unknown>;
    const parts = [
      err.message,
      err.error,
      err.details,
      err.hint,
      err.code,
    ]
      .filter((part): part is string | number => (
        (typeof part === 'string' && part.trim().length > 0) ||
        typeof part === 'number'
      ))
      .map(String);
    if (parts.length) return parts.join(' - ');
    if (Object.keys(err).length === 0) return fallback;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export async function uploadSystem(sysinfoText: string): Promise<UploadResult> {
  const protonPulseUserId = getLinkedProtonPulseUserId();
  if (!protonPulseUserId) {
    return { ok: false, error: 'Link your Proton Pulse account first' };
  }

  const deviceId = getDeviceId();
  const installationId = getInstallationId();
  const installationSecret = getInstallationSecret();
  const label = generateLabel(sysinfoText);

  void logFrontendEvent('DEBUG', 'User system upload request prepared', {
    deviceIdPrefix: deviceId.slice(0, 8),
    installationIdPrefix: installationId.slice(0, 8),
    label,
    linkedUserIdPrefix: protonPulseUserId.slice(0, 8),
    sysinfoBytes: sysinfoText.length,
  });

  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/user-system-upload`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        installationId,
        installationSecret,
        deviceId,
        label,
        sysinfoText,
      }),
    });
    const responseText = await res.text().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      void logFrontendEvent('WARNING', 'User system upload response body read failed', {
        error: msg,
        status: res.status,
      });
      return '';
    });
    let payload: Record<string, unknown> = {};
    if (responseText) {
      try {
        payload = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        payload = { message: responseText };
        void logFrontendEvent('WARNING', 'User system upload returned non-JSON response', {
          responsePreview: responseText.slice(0, 160),
          status: res.status,
        });
      }
    }
    if (!res.ok) {
      const error = formatUploadError(
        payload.error ?? payload.message ?? payload,
        `HTTP ${res.status}`,
      );
      void logFrontendEvent('ERROR', 'User system upload function failed', {
        error,
        status: res.status,
      });
      return { ok: false, error };
    }
    void logFrontendEvent('INFO', 'Uploaded user_systems row through link function', {
      inserted: Boolean(payload.inserted),
      isDefault: Boolean(payload.isDefault),
      status: res.status,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logFrontendEvent('ERROR', 'User system upload request threw', { error: msg });
    return { ok: false, error: msg };
  }
}
