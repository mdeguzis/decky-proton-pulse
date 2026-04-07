// src/lib/voting.ts
//
// Supabase-backed voting system. Handles voter ID generation,
// vote submission (upsert), and fetching vote totals.
// No login required -- uses the Supabase anon key with RLS.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logFrontendEvent } from './logger';
import type { VoteTotals } from './cache';

// these are public by design -- RLS controls access
const SUPABASE_URL = 'https://ilsgdshkaocrmibwdezk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlsc2dkc2hrYW9jcm1pYndkZXprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDM0NzMsImV4cCI6MjA5MDkxOTQ3M30.jMZ05zOPGupbWYQI4vEjxq05T0QETCpte7EN3uQzqaU';

const SALT_KEY = 'proton-pulse-voter-salt';
const VOTE_COOLDOWN_MS = 3000;

let supabase: SupabaseClient | null = null;
let cachedVoterId: string | null = null;
let lastVoteAt = 0;

function getClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

// ── voter ID ──────────────────────────────────────────────────────────────

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
  if (cachedVoterId) return cachedVoterId;

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

// ── vote submission ───────────────────────────────────────────────────────

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
    const client = getClient();

    // delete any existing vote first, then insert the new one.
    // this avoids the RLS UPDATE policy issue with PostgREST upserts
    await client
      .from('report_votes')
      .delete()
      .eq('voter_id', voterId)
      .eq('app_id', appId)
      .eq('report_key', reportKey);

    const { error } = await client
      .from('report_votes')
      .insert({
        voter_id: voterId,
        app_id: appId,
        report_key: reportKey,
        vote,
      });

    lastVoteAt = Date.now();

    if (error) {
      void logFrontendEvent('ERROR', 'Vote submission failed', {
        appId, reportKey, error: error.message,
      });
      return false;
    }

    void logFrontendEvent('INFO', 'Vote submitted', { appId, reportKey, vote });
    return true;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Vote submission threw', {
      appId, reportKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ── fetch vote totals ─────────────────────────────────────────────────────

export async function getVoteTotals(
  appId: string,
): Promise<Record<string, VoteTotals>> {
  void logFrontendEvent('DEBUG', 'Fetching vote totals', { appId });

  try {
    const { data, error } = await getClient()
      .from('report_vote_totals')
      .select('report_key, upvotes, downvotes')
      .eq('app_id', appId);

    if (error) {
      void logFrontendEvent('ERROR', 'Vote totals fetch failed', {
        appId, error: error.message,
      });
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
      appId, reportCount: Object.keys(totals).length,
    });
    return totals;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Vote totals fetch threw', {
      appId, error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

// ── check user's existing vote on a report ───────────────────────────────

export async function getUserVote(
  appId: string,
  reportKey: string,
): Promise<1 | -1 | null> {
  try {
    const voterId = await getVoterId();
    const { data, error } = await getClient()
      .from('report_votes')
      .select('vote')
      .eq('voter_id', voterId)
      .eq('app_id', appId)
      .eq('report_key', reportKey)
      .maybeSingle();

    if (error || !data) return null;
    return data.vote as 1 | -1;
  } catch {
    return null;
  }
}

// ── cooldown check (for UI button state) ─────────────────────────────────

export function isVoteCooldownActive(): boolean {
  return Date.now() - lastVoteAt < VOTE_COOLDOWN_MS;
}
