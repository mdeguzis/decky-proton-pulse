import { logFrontendEvent } from './logger';

const SUPABASE_URL = 'https://ilsgdshkaocrmibwdezk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3Oqhm4JneafJNQw9BuUaxw_L9qZa-5V';
const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`;
const INSTALLATION_ID_KEY = 'proton-pulse:installation-id';
const INSTALLATION_SECRET_KEY = 'proton-pulse:installation-secret';
const LINKED_USER_ID_KEY = 'proton-pulse:linked-proton-pulse-user-id';

export interface PluginLinkStatus {
  installationId: string;
  linked: boolean;
  linkedUserId: string | null;
  linkedAt: string | null;
  linkCode: string | null;
  linkCodeExpiresAt: string | null;
}

function functionHeaders(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/${name}`, {
    method: 'POST',
    headers: functionHeaders(),
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse<Record<string, unknown>>(response).catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    throw new Error(
      String(payload.error || payload.message || `HTTP ${response.status}`),
    );
  }
  return payload as T;
}

function persistLinkedUserId(linkedUserId: string | null): void {
  if (linkedUserId) localStorage.setItem(LINKED_USER_ID_KEY, linkedUserId);
  else localStorage.removeItem(LINKED_USER_ID_KEY);
}

function normalizeStatus(raw: Partial<PluginLinkStatus> & { installationId?: string }): PluginLinkStatus {
  const installationId = raw.installationId || getInstallationId();
  const status: PluginLinkStatus = {
    installationId,
    linked: !!raw.linked,
    linkedUserId: raw.linkedUserId ?? null,
    linkedAt: raw.linkedAt ?? null,
    linkCode: raw.linkCode ?? null,
    linkCodeExpiresAt: raw.linkCodeExpiresAt ?? null,
  };
  persistLinkedUserId(status.linked ? status.linkedUserId : null);
  return status;
}

export function getInstallationId(): string {
  const existing = localStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(INSTALLATION_ID_KEY, fresh);
  void logFrontendEvent('INFO', 'Generated Proton Pulse installation id', {
    idPrefix: fresh.slice(0, 8),
  });
  return fresh;
}

export function getInstallationSecret(): string {
  const existing = localStorage.getItem(INSTALLATION_SECRET_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(INSTALLATION_SECRET_KEY, fresh);
  void logFrontendEvent('INFO', 'Generated Proton Pulse installation secret', {
    secretPrefix: fresh.slice(0, 8),
  });
  return fresh;
}

export function getLinkedProtonPulseUserId(): string | null {
  return localStorage.getItem(LINKED_USER_ID_KEY);
}

export async function fetchPluginLinkStatus(): Promise<PluginLinkStatus> {
  const installationId = getInstallationId();
  const installationSecret = getInstallationSecret();
  const payload = await callFunction<Partial<PluginLinkStatus>>('plugin-link-status', {
    installationId,
    installationSecret,
  });
  return normalizeStatus({ installationId, ...payload });
}

export async function startPluginLink(): Promise<PluginLinkStatus> {
  const installationId = getInstallationId();
  const installationSecret = getInstallationSecret();
  const payload = await callFunction<Partial<PluginLinkStatus>>('plugin-link-start', {
    installationId,
    installationSecret,
  });
  return normalizeStatus({ installationId, ...payload });
}
