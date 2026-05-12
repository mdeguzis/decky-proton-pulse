// src/lib/userConfigs.ts
// Supabase-backed custom user config reports (ProtonDB-style).
// Only stores user-submitted custom configs - never imported data.

import { logFrontendEvent } from './logger';
import { getVoterId } from './voting';
import { getInstallationId, getLinkedProtonPulseUserId } from './protonPulseAccount';
import type { ProtonRating } from '../types';

// --- Constants ---

const SUPABASE_URL = 'https://ilsgdshkaocrmibwdezk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3Oqhm4JneafJNQw9BuUaxw_L9qZa-5V';
const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;

const SUBMIT_COOLDOWN_MS = 5000;
let lastSubmitAt = 0;

// --- Allowed values (must match SQL CHECK constraints) ---

const VALID_RATINGS: readonly ProtonRating[] = [
  'platinum', 'gold', 'silver', 'bronze', 'borked',
] as const;

const VALID_OS = [
  'SteamOS 3.0', 'SteamOS 3.5', 'SteamOS 3.6',
  'Ubuntu 22.04', 'Ubuntu 24.04',
  'Fedora 40', 'Fedora 41',
  'Arch Linux',
  'Linux Mint 22',
  'Nobara 40', 'Nobara 41',
  'Pop!_OS 22.04',
  'Manjaro',
  'openSUSE Tumbleweed',
  'Debian 12',
  'ChimeraOS',
  'Bazzite',
] as const;

// Accepts numbered builds ("Proton 10.0-3", "Proton-10.0-3", "GE-Proton10-1")
// plus Steam's named branches ("Proton - Experimental", "Proton Experimental",
// "Proton - Hotfix", "Proton - Next"). Steam pre-fills the Experimental branch
// with the " - " separator so that shape has to validate or the plugin submit
// silently rejects whatever Steam handed us
const PROTON_VERSION_RE = /^(Proton |GE-Proton|Proton-)(\d|-?\s*(Experimental|Hotfix|Next)\b)/i;
const RAM_RE = /^\d+ GB$/;

const VALID_GPU_VENDORS = ['nvidia', 'amd', 'intel', 'other'] as const;
const VALID_SOURCES = ['user', 'web', 'protondb', 'protondb-local'] as const;

// --- Types ---

export type ValidOS = (typeof VALID_OS)[number];

export interface UserConfigInput {
  appId: string;
  title: string;
  cpu: string;
  gpu: string;
  gpuDriver?: string;
  gpuVendor?: 'nvidia' | 'amd' | 'intel' | 'other';
  ram: string;
  os: ValidOS;
  kernel?: string;
  protonVersion: string;
  duration?: string;
  durationMinutes?: number | null;
  rating: ProtonRating;
  notes?: string;
  launchOptions?: string;
  enabledVars?: Record<string, string>;
  confidenceScore?: number | null;
  source?: 'user' | 'protondb' | 'protondb-local';
  configKey?: string;
  vramMb?: number | null;
  cpuCores?: number | null;
  displayResolution?: string | null;
  steamDeckModel?: string | null;
  formResponses?: Record<string, unknown>; // ProtonDB-format form answers for algorithm replay
}

export interface UserConfigRow {
  id: number;
  client_id: string;
  app_id: string;
  title: string;
  cpu: string;
  gpu: string;
  gpu_driver: string;
  gpu_vendor: string;
  ram: string;
  os: string;
  kernel: string;
  proton_version: string;
  duration: string;
  duration_minutes?: number | null;
  rating: ProtonRating;
  notes: string;
  launch_options: string;
  enabled_vars: Record<string, string>;
  confidence_score: number | null;
  source: string;
  config_key?: string | null;
  created_at: string;
  form_responses?: Record<string, unknown> | null;
}

// --- Validation ---

export function validateUserConfig(input: UserConfigInput): string | null {
  if (!input.appId || !input.title || !input.cpu || !input.gpu) {
    return 'appId, title, cpu, and gpu are required';
  }
  if (!(VALID_RATINGS as readonly string[]).includes(input.rating)) {
    return `Invalid rating: ${input.rating}`;
  }
  if (!(VALID_OS as readonly string[]).includes(input.os)) {
    return `Invalid OS: ${input.os}`;
  }
  if (!PROTON_VERSION_RE.test(input.protonVersion)) {
    return `Invalid protonVersion format: ${input.protonVersion}`;
  }
  if (!RAM_RE.test(input.ram)) {
    return `Invalid ram format (expected "N GB"): ${input.ram}`;
  }
  if (input.gpuVendor && !(VALID_GPU_VENDORS as readonly string[]).includes(input.gpuVendor)) {
    return `Invalid gpuVendor: ${input.gpuVendor}`;
  }
  if (input.source && !(VALID_SOURCES as readonly string[]).includes(input.source)) {
    return `Invalid source: ${input.source}`;
  }
  if (input.confidenceScore != null && (input.confidenceScore < 0 || input.confidenceScore > 200)) {
    return `confidenceScore must be 0-200, got ${input.confidenceScore}`;
  }
  return null;
}

// --- REST helpers (mirrors voting.ts) ---

function headers(extra: HeadersInit = {}): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function restUrl(path: string, query: Record<string, string> = {}): string {
  const url = new URL(`${SUPABASE_REST_URL}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

async function restRequest<T>(
  path: string,
  init: RequestInit = {},
  query: Record<string, string> = {},
): Promise<{ data: T | null; error: string | null; status: number }> {
  const res = await fetch(restUrl(path, query), {
    ...init,
    headers: headers(init.headers as Record<string, string> ?? {}),
  });
  const text = await res.text();
  const payload = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const msg = typeof payload === 'object' && payload
      ? (payload as any).message ?? (payload as any).error ?? `HTTP ${res.status}`
      : `HTTP ${res.status}`;
    return { data: null, error: msg, status: res.status };
  }
  return { data: payload as T | null, error: null, status: res.status };
}

// --- Public API ---

export async function submitUserConfig(input: UserConfigInput): Promise<{ ok: boolean; error?: string }> {
  if (Date.now() - lastSubmitAt < SUBMIT_COOLDOWN_MS) {
    return { ok: false, error: 'Cooldown active' };
  }

  const validationError = validateUserConfig(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const clientId = await getVoterId();
  const installationId = getInstallationId();
  const protonPulseUserId = getLinkedProtonPulseUserId();
  void logFrontendEvent('INFO', 'Submitting user config', { appId: input.appId });

  try {
    const { error } = await restRequest<null>('user_configs', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        client_id: clientId,
        proton_pulse_user_id: protonPulseUserId,
        installation_id: installationId,
        app_id: input.appId,
        title: input.title,
        cpu: input.cpu,
        gpu: input.gpu,
        gpu_driver: input.gpuDriver ?? '',
        gpu_vendor: input.gpuVendor ?? 'other',
        ram: input.ram,
        os: input.os,
        kernel: input.kernel ?? '',
        proton_version: input.protonVersion,
        duration: input.duration ?? 'unreported',
        duration_minutes: input.durationMinutes ?? null,
        rating: input.rating,
        notes: input.notes ?? '',
        launch_options: input.launchOptions ?? '',
        enabled_vars: input.enabledVars ?? {},
        confidence_score: input.confidenceScore ?? null,
        source: input.source ?? 'user',
        config_key: input.configKey ?? null,
        vram_mb: input.vramMb ?? null,
        cpu_cores: input.cpuCores ?? null,
        display_resolution: input.displayResolution ?? null,
        steam_deck_model: input.steamDeckModel ?? null,
        form_responses: input.formResponses ?? null,
      }),
    }, { on_conflict: 'client_id,app_id' });

    lastSubmitAt = Date.now();

    if (error) {
      void logFrontendEvent('ERROR', 'User config submit failed', { error });
      return { ok: false, error };
    }

    void logFrontendEvent('INFO', 'User config submitted', { appId: input.appId });
    return { ok: true };
  } catch (err) {
    void logFrontendEvent('ERROR', 'User config submit threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getUserConfigs(appId: string): Promise<UserConfigRow[]> {
  try {
    const { data, error } = await restRequest<UserConfigRow[]>('user_configs', {
      method: 'GET',
    }, {
      select: '*',
      app_id: `eq.${appId}`,
      order: 'created_at.desc',
    });

    if (error) {
      void logFrontendEvent('ERROR', 'User configs fetch failed', { appId, error });
      return [];
    }
    return data ?? [];
  } catch (err) {
    void logFrontendEvent('ERROR', 'User configs fetch threw', {
      appId, error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function getMyConfig(appId: string): Promise<UserConfigRow | null> {
  try {
    const clientId = await getVoterId();
    const { data, error, status } = await restRequest<UserConfigRow>('user_configs', {
      method: 'GET',
      headers: { Accept: 'application/vnd.pgrst.object+json' },
    }, {
      select: '*',
      client_id: `eq.${clientId}`,
      app_id: `eq.${appId}`,
    });

    if (status === 406 || error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

export async function getMySubmittedAppIds(): Promise<Set<string>> {
  try {
    const clientId = await getVoterId();
    const protonPulseUserId = getLinkedProtonPulseUserId();

    const requests: Promise<{ data: { app_id: string }[] | null; error: string | null; status: number }>[] = [
      restRequest<{ app_id: string }[]>('user_configs', { method: 'GET' }, { select: 'app_id', client_id: `eq.${clientId}` }),
    ];
    if (protonPulseUserId) {
      requests.push(
        restRequest<{ app_id: string }[]>('user_configs', { method: 'GET' }, { select: 'app_id', proton_pulse_user_id: `eq.${protonPulseUserId}` }),
      );
    }

    const results = await Promise.all(requests);
    const appIds = new Set<string>();
    for (const { data } of results) {
      if (data) for (const r of data) appIds.add(r.app_id);
    }
    return appIds;
  } catch {
    return new Set();
  }
}

export { VALID_OS, VALID_RATINGS, VALID_GPU_VENDORS, VALID_SOURCES };

// --- Owner delete (RLS via x-client-id header) ---

export async function deleteMyReport(appId: string): Promise<{ ok: boolean; error?: string }> {
  const clientId = await getVoterId();
  void logFrontendEvent('INFO', 'Deleting own report from Supabase', { appId });
  try {
    const { error } = await restRequest<null>('user_configs', {
      method: 'DELETE',
      headers: { 'x-client-id': clientId },
    }, {
      client_id: `eq.${clientId}`,
      app_id: `eq.${appId}`,
    });
    if (error) {
      void logFrontendEvent('ERROR', 'Report delete failed', { appId, error });
      return { ok: false, error };
    }
    void logFrontendEvent('INFO', 'Report deleted', { appId });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void logFrontendEvent('ERROR', 'Report delete threw', { appId, error: msg });
    return { ok: false, error: msg };
  }
}
