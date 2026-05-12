// src/lib/playtime.ts
// Polls SteamClient.GameSessions.GetRunningApps() to detect game start/stop,
// then submits session duration to Supabase config_playtime table.
// Uses the same anonymous voter_id from the voting system so playtime
// and votes are tied to the same identity.

import { getVoterId, restRequest } from './voting';
import { getTrackedConfig } from './trackedConfigs';
import type { TrackedConfig } from './trackedConfigs';
import { logFrontendEvent } from './logger';
import { getSteamPlaytimeForeverMinutes } from './steamApps';

const POLL_INTERVAL_MS = 30_000;

// tracks an in-flight game session so we can compute duration on stop
interface ActiveSession {
  appId: number;
  config: TrackedConfig;
  configKey: string;
  startedAt: number;        // Date.now() when we first saw the app running
  supabaseRowId: number | null;  // set after the initial insert lands
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeSession: ActiveSession | null = null;

// build a config_key that matches report_key for protondb configs,
// or a prefixed key for user-created configs
function buildConfigKey(cfg: TrackedConfig): string {
  if (cfg.source === 'user') {
    return `custom:${cfg.profileName || cfg.appName}`;
  }
  // for protondb / protondb-local, use appliedAt + protonVersion
  // same shape as report_key in voting: "{timestamp}_{protonVersion}"
  return `${cfg.appliedAt}_${cfg.protonVersion}`;
}

function getRunningAppIds(): number[] {
  try {
    const sessions = (SteamClient as any).GameSessions?.GetRunningApps?.();
    if (!Array.isArray(sessions)) return [];
    // each entry has an appid field
    return sessions
      .map((s: any) => typeof s === 'number' ? s : s?.appid ?? s?.appId ?? 0)
      .filter((id: number) => id > 0);
  } catch {
    return [];
  }
}

async function onGameStarted(appId: number, config: TrackedConfig): Promise<void> {
  const configKey = buildConfigKey(config);
  const voterId = await getVoterId();

  void logFrontendEvent('INFO', 'Playtime session started', {
    appId,
    configKey,
    protonVersion: config.protonVersion,
    source: config.source ?? 'protondb',
    voterIdPrefix: voterId.slice(0, 8),
  });

  // insert a new session row with duration_minutes=0
  // we'll PATCH it with the real duration when the game stops
  const { data, error } = await restRequest<{ id: number }[]>('config_playtime', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      voter_id: voterId,
      app_id: String(appId),
      config_key: configKey,
      proton_version: config.protonVersion,
      source: config.source ?? 'protondb',
      session_start: new Date().toISOString(),
      duration_minutes: 0,
    }),
  }, {
    select: 'id',
  });

  let rowId: number | null = null;
  if (error) {
    void logFrontendEvent('ERROR', 'Failed to insert playtime session', { appId, error });
  } else if (data && data.length > 0) {
    rowId = data[0].id;
  }

  activeSession = {
    appId,
    config,
    configKey,
    startedAt: Date.now(),
    supabaseRowId: rowId,
  };
}

async function onGameStopped(session: ActiveSession): Promise<void> {
  const elapsedMs = Date.now() - session.startedAt;
  const durationMin = Math.round(elapsedMs / 60_000);

  void logFrontendEvent('INFO', 'Playtime session ended', {
    appId: session.appId,
    configKey: session.configKey,
    durationMinutes: durationMin,
    supabaseRowId: session.supabaseRowId,
  });

  // skip super short sessions (< 1 min) to avoid noise
  if (durationMin < 1) {
    void logFrontendEvent('DEBUG', 'Playtime session too short, skipping submit', {
      appId: session.appId,
      elapsedMs,
    });
    return;
  }

  if (!session.supabaseRowId) {
    // initial insert failed, try a fresh insert with the full duration
    const voterId = await getVoterId();
    const { error } = await restRequest<null>('config_playtime', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        voter_id: voterId,
        app_id: String(session.appId),
        config_key: session.configKey,
        proton_version: session.config.protonVersion,
        source: session.config.source ?? 'protondb',
        session_start: new Date(session.startedAt).toISOString(),
        session_end: new Date().toISOString(),
        duration_minutes: durationMin,
      }),
    });
    if (error) {
      void logFrontendEvent('ERROR', 'Failed to insert completed playtime session', {
        appId: session.appId,
        error,
      });
    }
    return;
  }

  // update the existing row with session_end and computed duration
  const { error } = await restRequest<null>('config_playtime', {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      session_end: new Date().toISOString(),
      duration_minutes: durationMin,
    }),
  }, {
    id: `eq.${session.supabaseRowId}`,
  });

  if (error) {
    void logFrontendEvent('ERROR', 'Failed to update playtime session', {
      appId: session.appId,
      rowId: session.supabaseRowId,
      error,
    });
  }
}

function pollRunningApps(): void {
  const running = getRunningAppIds();

  if (activeSession) {
    // check if the tracked game stopped
    if (!running.includes(activeSession.appId)) {
      const session = activeSession;
      activeSession = null;
      void onGameStopped(session);
    }
    // already tracking a session, don't start another
    return;
  }

  // no active session, check if any running game has a tracked config
  for (const appId of running) {
    const cfg = getTrackedConfig(appId);
    if (cfg) {
      void onGameStarted(appId, cfg);
      break;  // only track one game at a time
    }
  }
}

export function startSessionTracking(): void {
  if (pollTimer) return;
  void logFrontendEvent('INFO', 'Playtime session tracking started');
  pollTimer = setInterval(pollRunningApps, POLL_INTERVAL_MS);
  // run immediately on start too
  pollRunningApps();
}

export function stopSessionTracking(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  // if a game is still running when the plugin unloads, finalize the session
  if (activeSession) {
    const session = activeSession;
    activeSession = null;
    void onGameStopped(session);
  }
  void logFrontendEvent('INFO', 'Playtime session tracking stopped');
}

// query how much playtime a specific config has accumulated across all users
export async function getConfigPlaytimeTotals(
  appId: string,
): Promise<Record<string, { totalMinutes: number; sessionCount: number; uniquePlayers: number }>> {
  try {
    const { data, error } = await restRequest<{
      config_key: string;
      total_minutes: number;
      session_count: number;
      unique_players: number;
    }[]>('config_playtime_totals', {
      method: 'GET',
    }, {
      select: 'config_key,total_minutes,session_count,unique_players',
      app_id: `eq.${appId}`,
    });

    if (error || !data) return {};

    const ret: Record<string, { totalMinutes: number; sessionCount: number; uniquePlayers: number }> = {};
    for (const row of data) {
      ret[row.config_key] = {
        totalMinutes: row.total_minutes,
        sessionCount: row.session_count,
        uniquePlayers: row.unique_players,
      };
    }
    return ret;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Failed to fetch playtime totals', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

// Total minutes THIS user has logged for a given app across all their sessions.
// Lets the publish flow auto-fill the duration bucket without prompting.
export async function getMyAccumulatedMinutes(appId: string | number): Promise<number> {
  try {
    const voterId = await getVoterId();
    const { data, error } = await restRequest<{ duration_minutes: number }[]>('config_playtime', {
      method: 'GET',
    }, {
      select: 'duration_minutes',
      voter_id: `eq.${voterId}`,
      app_id: `eq.${appId}`,
    });
    if (error || !data) return 0;
    return data.reduce((sum, r) => sum + (r.duration_minutes || 0), 0);
  } catch (err) {
    void logFrontendEvent('ERROR', 'Failed to fetch my accumulated playtime', {
      appId, error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

// Best-effort playtime for the duration picker. The plugin's own tracker only
// knows about sessions it observed, so for a game the user played before
// installing Proton Pulse we'd show 0. Steam's lifetime playtime (the "PLAY
// TIME" number on the library page) covers everything, so take the max of
// the two so the duration bucket auto-fills even on the first report.
export interface EffectivePlaytime {
  minutes: number;
  trackedMinutes: number;   // what config_playtime has for this user+app
  steamMinutes: number;     // Steam's minutes_playtime_forever
}

export async function getEffectivePlaytimeMinutes(appId: string | number): Promise<EffectivePlaytime> {
  const numericAppId = typeof appId === 'number' ? appId : Number(appId);
  const [trackedMinutes, steamMinutes] = await Promise.all([
    getMyAccumulatedMinutes(appId),
    Number.isFinite(numericAppId) && numericAppId > 0
      ? getSteamPlaytimeForeverMinutes(numericAppId)
      : Promise.resolve(0),
  ]);
  return {
    minutes: Math.max(trackedMinutes, steamMinutes),
    trackedMinutes,
    steamMinutes,
  };
}

// Map raw minutes into the duration enum the web form expects. Buckets
// match NativePulseReportModal: underOneHour / oneToFourHours /
// fourToTenHours / overTenHours, or 'unreported' for zero playtime
export function bucketPlaytimeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'unreported';
  if (minutes < 60)       return 'underOneHour';
  if (minutes < 4 * 60)   return 'oneToFourHours';
  if (minutes < 10 * 60)  return 'fourToTenHours';
  return 'overTenHours';
}
