import { logFrontendEvent } from './logger';
import type { VoteTotals } from './cache';

const SUPABASE_URL = 'https://ilsgdshkaocrmibwdezk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Imlsc2dkc2hrYW9jcm1pYndkZXprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDM0NzMsImV4cCI6MjA5MDkxOTQ3M30.jMZ05zOPGupbWYQI4vEjxq05T0QETCpte7EN3uQzqaU';
const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;

const SALT_KEY = 'proton-pulse-voter-salt';
const VOTE_COOLDOWN_MS = 3000;

type VoteRow = {
  vote: 1 | -1;
};

type VoteTotalsRow = {
  report_key: string;
  upvotes: number | null;
  downvotes: number | null;
};

type SupabaseErrorPayload = {
  message?: string;
  error?: string;
  details?: string;
  hint?: string;
};

let cachedVoterId: string | null = null;
let lastVoteAt = 0;

function defaultHeaders(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
}

function buildRestUrl(path: string, query: Record<string, string> = {}): string {
  const url = new URL(`${SUPABASE_REST_URL}/${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    const err = payload as SupabaseErrorPayload;
    return err.message ?? err.error ?? err.details ?? err.hint ?? `HTTP ${status}`;
  }
  return `HTTP ${status}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function restRequest<T>(
  path: string,
  init: RequestInit = {},
  query: Record<string, string> = {},
): Promise<{ data: T | null; error: string | null; status: number }> {
  const response = await fetch(buildRestUrl(path, query), {
    ...init,
    headers: {
      ...defaultHeaders(),
      ...(init.headers ?? {}),
    },
  });

  const payload = await parseResponseBody(response);
  if (!response.ok) {
    return {
      data: null,
      error: extractErrorMessage(payload, response.status),
      status: response.status,
    };
  }

  return {
    data: payload as T | null,
    error: null,
    status: response.status,
  };
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getSalt(): string {
  let salt = localStorage.getItem(SALT_KEY);
  if (!salt) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    salt = bytesToHex(bytes);
    localStorage.setItem(SALT_KEY, salt);
    void logFrontendEvent('INFO', 'Generated new voter salt');
  }
  return salt;
}

function getSteamUsername(): string {
  try {
    const user = (SteamClient as any).User?.GetCurrentUser?.();
    return user?.strAccountName ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function getVoterId(): Promise<string> {
  if (cachedVoterId) {
    return cachedVoterId;
  }

  const salt = getSalt();
  const username = getSteamUsername();
  const data = new TextEncoder().encode(username + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  cachedVoterId = bytesToHex(new Uint8Array(hashBuffer));

  void logFrontendEvent('DEBUG', 'Voter ID computed', {
    usernameLength: username.length,
    idPrefix: cachedVoterId.slice(0, 8),
  });
  return cachedVoterId;
}

export async function submitVote(
  appId: string,
  reportKey: string,
  vote: 1 | -1,
): Promise<boolean> {
  const now = Date.now();
  if (now - lastVoteAt < VOTE_COOLDOWN_MS) {
    void logFrontendEvent('DEBUG', 'Vote cooldown active, ignoring', { appId, reportKey });
    return false;
  }

  const voterId = await getVoterId();
  void logFrontendEvent('INFO', 'Submitting vote', {
    appId, reportKey, vote, voterIdPrefix: voterId.slice(0, 8),
  });

  try {
    const { error } = await restRequest<null>('report_votes', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        voter_id: voterId,
        app_id: appId,
        report_key: reportKey,
        vote,
      }),
    }, {
      on_conflict: 'voter_id,app_id,report_key',
    });

    lastVoteAt = Date.now();

    if (error) {
      void logFrontendEvent('ERROR', 'Vote submission failed', {
        appId, reportKey, error,
      });
      return false;
    }

    void logFrontendEvent('INFO', 'Vote submitted', { appId, reportKey, vote });
    return true;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Vote submission threw', {
      appId,
      reportKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function getVoteTotals(appId: string): Promise<Record<string, VoteTotals>> {
  void logFrontendEvent('DEBUG', 'Fetching vote totals', { appId });

  try {
    const { data, error } = await restRequest<VoteTotalsRow[]>('report_vote_totals', {
      method: 'GET',
    }, {
      select: 'report_key,upvotes,downvotes',
      app_id: `eq.${appId}`,
    });

    if (error) {
      void logFrontendEvent('ERROR', 'Vote totals fetch failed', { appId, error });
      return {};
    }

    const totals: Record<string, VoteTotals> = {};
    for (const row of data ?? []) {
      totals[row.report_key] = {
        upvotes: row.upvotes ?? 0,
        downvotes: row.downvotes ?? 0,
      };
    }

    void logFrontendEvent('DEBUG', 'Vote totals fetched', {
      appId,
      reportCount: Object.keys(totals).length,
    });
    return totals;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Vote totals fetch threw', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

export async function getUserVote(
  appId: string,
  reportKey: string,
): Promise<1 | -1 | null> {
  try {
    const voterId = await getVoterId();
    const result = await restRequest<VoteRow>('report_votes', {
      method: 'GET',
      headers: { Accept: 'application/vnd.pgrst.object+json' },
    }, {
      select: 'vote',
      voter_id: `eq.${voterId}`,
      app_id: `eq.${appId}`,
      report_key: `eq.${reportKey}`,
    });

    if (result.status === 406) {
      return null;
    }

    if (result.error || !result.data) {
      return null;
    }

    return result.data.vote;
  } catch {
    return null;
  }
}

export function isVoteCooldownActive(): boolean {
  return Date.now() - lastVoteAt < VOTE_COOLDOWN_MS;
}
