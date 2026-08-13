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
const VALID_APP_TYPES = ['steam', 'gog', 'epic', 'nonsteam'] as const;

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
  appType?: 'steam' | 'gog' | 'epic' | 'nonsteam';
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
  if (input.appType && !(VALID_APP_TYPES as readonly string[]).includes(input.appType)) {
    return `Invalid appType: ${input.appType}`;
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
        app_type: input.appType ?? 'steam',
        config_key: input.configKey ?? null,
        vram_mb: input.vramMb ?? null,
        cpu_cores: input.cpuCores ?? null,
        display_resolution: input.displayResolution ?? null,
        steam_deck_model: input.steamDeckModel ?? null,
        form_responses: input.formResponses ?? null,
        // Plugin-submitted reports come from a running Deck/Steam library
        // where the user has the game installed and playing. Set true so the
        // admin panel and stats don't misclassify plugin submissions as
        // "does not own" (the old default was null, which the admin renders
        // as "false" -- the Game Owned: false bug in the report detail view).
        game_owned: true,
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
  const { submitted } = await getMyReportStatuses();
  return submitted;
}

// Return the app_ids the current user has actually submitted as reports
// (rows in user_configs) AND the subset that have been approved by the
// pipeline (rows in report_approvals). Both sets drive the badges on the
// plugin's Manage Configurations screen: `submitted` -> Pending Approval,
// `approved` -> Published, neither -> Draft.
//
// Crucially, "submitted" here is REPORTS (user_configs), not synced configs
// (user_proton_configs). Merely syncing a config to the cloud must NOT
// count as a submission -- that was the #<TBD> "why does saving show
// Pending Approval when I never submitted" bug.
// Composite key for per-config lookup: `${appId}::${configKey}`. When
// config_key is null (legacy submissions from before multi-config), the
// composite falls back to a per-app match so at least one profile per game
// still lights up as submitted / approved. Keep the composite string form
// centralised so ManageTab and any other caller build the same key.
export function makeReportStatusKey(appId: string | number, configKey?: string | null): string {
  const c = (configKey || '').trim();
  return `${String(appId)}::${c}`;
}

export interface MyReportStatuses {
  // Per-app coarse sets (backward-compat for callers that only care about
  // "does this game have any submitted report").
  submitted: Set<string>;
  approved: Set<string>;
  // Per-config composite-key sets. Preferred for the Manage tab so two
  // profiles on the same game don't both read as pending/published just
  // because one of them was submitted.
  submittedKeys: Set<string>;
  approvedKeys: Set<string>;
}

export async function getMyReportStatuses(): Promise<MyReportStatuses> {
  try {
    const clientId = await getVoterId();
    const protonPulseUserId = getLinkedProtonPulseUserId();

    const reportRequests: Promise<{ data: { id: number; app_id: string; config_key: string | null }[] | null; error: string | null; status: number }>[] = [
      restRequest<{ id: number; app_id: string; config_key: string | null }[]>('user_configs', { method: 'GET' }, { select: 'id,app_id,config_key', client_id: `eq.${clientId}` }),
    ];
    if (protonPulseUserId) {
      reportRequests.push(
        restRequest<{ id: number; app_id: string; config_key: string | null }[]>('user_configs', { method: 'GET' }, { select: 'id,app_id,config_key', proton_pulse_user_id: `eq.${protonPulseUserId}` }),
      );
    }

    const results = await Promise.all(reportRequests);
    const submitted = new Set<string>();
    const submittedKeys = new Set<string>();
    // Map id -> {app_id, config_key} so the report_approvals lookup can
    // reconstruct the same composite keys for the approved set.
    const idToRow = new Map<number, { app_id: string; config_key: string | null }>();
    for (const { data } of results) {
      if (data) for (const r of data) {
        submitted.add(String(r.app_id));
        submittedKeys.add(makeReportStatusKey(r.app_id, r.config_key));
        idToRow.set(r.id, { app_id: String(r.app_id), config_key: r.config_key });
      }
    }

    // Fetch approvals only for the ids we actually own -- keeps the query
    // short and avoids scanning the whole report_approvals table.
    if (idToRow.size === 0) {
      return { submitted, approved: new Set(), submittedKeys, approvedKeys: new Set() };
    }
    const idList = [...idToRow.keys()].join(',');
    const approvals = await restRequest<{ report_id: number }[]>(
      'report_approvals',
      { method: 'GET' },
      { select: 'report_id', report_id: `in.(${idList})` },
    );
    const approved = new Set<string>();
    const approvedKeys = new Set<string>();
    if (approvals.data) {
      for (const a of approvals.data) {
        const row = idToRow.get(a.report_id);
        if (row) {
          approved.add(row.app_id);
          approvedKeys.add(makeReportStatusKey(row.app_id, row.config_key));
        }
      }
    }
    return { submitted, approved, submittedKeys, approvedKeys };
  } catch {
    return { submitted: new Set(), approved: new Set(), submittedKeys: new Set(), approvedKeys: new Set() };
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
