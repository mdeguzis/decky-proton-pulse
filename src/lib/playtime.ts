// src/lib/playtime.ts
// Detects game start/stop via RegisterForAppLifetimeNotifications (event-based),
// with a poll fallback, then submits session duration to Supabase config_playtime table.
// Uses the same anonymous voter_id from the voting system so playtime
// and votes are tied to the same identity.

import { getVoterId, restRequest } from './voting';
import { getActiveConfigForApp, getTrackedConfigs } from './trackedConfigs';
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
let lifetimeUnregister: (() => void) | null = null;
let activeSession: ActiveSession | null = null;

// build a config_key that matches report_key for protondb configs,
// or a prefixed key for user-created configs
export function buildConfigKey(cfg: TrackedConfig): string {
  if (cfg.source === 'user') {
    return `custom:${cfg.profileName || cfg.appName}`;
  }
  // for protondb / protondb-local, use appliedAt + protonVersion
  // same shape as report_key in voting: "{timestamp}_{protonVersion}"
  return `${cfg.appliedAt}_${cfg.protonVersion}`;
}

// Tries every known API for fetching currently running app IDs.
// GetRunningApps is undefined on some Steam client builds; fall back to
// checking each tracked config's app overview running state.
function getRunningAppIds(): number[] {
  try {
    const sessions = (SteamClient as any).GameSessions?.GetRunningApps?.();
    if (Array.isArray(sessions)) {
      const ids = sessions
        .map((s: any) => typeof s === 'number' ? s : s?.appid ?? s?.appId ?? 0)
        .filter((id: number) => id > 0);
      void logFrontendEvent('DEBUG', 'getRunningAppIds: via GetRunningApps', { ids });
      return ids;
    }
  } catch (e) {
    void logFrontendEvent('DEBUG', 'getRunningAppIds: GetRunningApps threw', { error: e instanceof Error ? e.message : String(e) });
  }

  // Fallback: scan each tracked config's app overview for a running flag.
  try {
    const appStore = (globalThis as any).appStore;
    const tracked = getTrackedConfigs();
    const ids: number[] = [];
    for (const cfg of tracked) {
      const overview = appStore?.GetAppOverviewByAppID?.(cfg.appId)
        ?? appStore?.GetAppOverviewByGameID?.(cfg.appId);
      // bIsRunning or per_client_data[0].status indicates an active game process
      const running =
        overview?.bIsRunning === true ||
        overview?.per_client_data?.[0]?.status === 2 ||
        overview?.per_client_data?.[0]?.bIsLocallyInstalled === true && overview?.per_client_data?.[0]?.status === 2;
      if (running) ids.push(cfg.appId);
    }
    if (ids.length > 0) {
      void logFrontendEvent('DEBUG', 'getRunningAppIds: via appStore overview', { ids });
    }
    return ids;
  } catch (e) {
    void logFrontendEvent('DEBUG', 'getRunningAppIds: overview fallback threw', { error: e instanceof Error ? e.message : String(e) });
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
    // When the event listener is active it owns stop detection -- don't let
    // a failed/empty poll result falsely end the session.
    if (!lifetimeUnregister && !running.includes(activeSession.appId)) {
      const session = activeSession;
      activeSession = null;
      void onGameStopped(session);
    }
    // already tracking a session, don't start another
    return;
  }

  // no active session, check if any running game has a tracked config.
  // With multi-config-per-app, attribute the session to the ACTIVE config
  // (the one most recently applied via Save / setActiveConfig) so playtime
  // credits the profile the user actually has installed on Steam right now.
  for (const appId of running) {
    const cfg = getActiveConfigForApp(appId);
    if (cfg) {
      void onGameStarted(appId, cfg);
      break;  // only track one game at a time
    }
  }
  if (running.length > 0) {
    const trackedIds = running.filter((id) => !!getActiveConfigForApp(id));
    if (trackedIds.length === 0) {
      void logFrontendEvent('DEBUG', 'pollRunningApps: running games have no tracked config', { running });
    }
  }
}

export function startSessionTracking(): void {
  if (pollTimer) return;
  void logFrontendEvent('INFO', 'Playtime session tracking started');

  // Primary: event-based via RegisterForAppLifetimeNotifications.
  // Fires immediately when a game starts or stops -- no 30s poll lag.
  try {
    const reg = (SteamClient as any).GameSessions?.RegisterForAppLifetimeNotifications?.(
      (data: { unAppID: number; bRunning: boolean }) => {
        const appId = data.unAppID;
        void logFrontendEvent('DEBUG', 'AppLifetimeNotification', { appId, bRunning: data.bRunning });
        if (data.bRunning) {
          if (activeSession) return; // already tracking another game
          // Multi-config: attribute the session to whichever profile is
          // currently applied (max appliedAt for this appId), not just
          // "any tracked config".
          const cfg = getActiveConfigForApp(appId);
          if (cfg) void onGameStarted(appId, cfg);
        } else {
          if (activeSession?.appId === appId) {
            const session = activeSession;
            activeSession = null;
            void onGameStopped(session);
          }
        }
      },
    );
    lifetimeUnregister = reg?.unregister ?? null;
    void logFrontendEvent('INFO', 'Playtime: registered for AppLifetimeNotifications', {
      available: !!lifetimeUnregister,
    });
  } catch (e) {
    void logFrontendEvent('DEBUG', 'Playtime: RegisterForAppLifetimeNotifications unavailable', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Fallback: poll every 30s in case the event API is unavailable.
  pollTimer = setInterval(pollRunningApps, POLL_INTERVAL_MS);
  pollRunningApps();
}

export function stopSessionTracking(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (lifetimeUnregister) {
    try { lifetimeUnregister(); } catch { /* ignore */ }
    lifetimeUnregister = null;
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

// Minutes THIS user has logged for a specific config (voter_id + app_id + config_key).
// Used by the config info modal to show "time played with this config active".
export async function getMyConfigPlaytimeMinutes(appId: string | number, configKey: string): Promise<number> {
  try {
    const voterId = await getVoterId();
    const { data, error } = await restRequest<{ duration_minutes: number }[]>('config_playtime', {
      method: 'GET',
    }, {
      select: 'duration_minutes',
      voter_id: `eq.${voterId}`,
      app_id: `eq.${appId}`,
      config_key: `eq.${configKey}`,
    });
    if (error || !data) return 0;
    const total = data.reduce((sum, r) => sum + (r.duration_minutes || 0), 0);
    void logFrontendEvent('DEBUG', 'getMyConfigPlaytimeMinutes', { appId, configKey, total });
    return total;
  } catch (err) {
    void logFrontendEvent('ERROR', 'Failed to fetch config playtime', {
      appId, configKey, error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

// Best-effort playtime for the duration picker. The plugin's own tracker only
// knows about sessions it observed, so for a game the user played before
// installing Proton Pulse we'd show 0. Steam's lifetime playtime (the "PLAY
// TIME" number on the library page) covers everything, so take the max of
// the sources so the duration bucket auto-fills even on the first report.
//
// configKey is optional. When provided, config-specific playtime is fetched
// and weighted 1.25x because time spent with this exact config is more
// meaningful than overall game playtime across all setups.
export interface EffectivePlaytime {
  minutes: number;
  trackedMinutes: number;   // what config_playtime has for this user+app (all configs)
  steamMinutes: number;     // Steam's minutes_playtime_forever
  configMinutes: number;    // minutes with this specific config active (0 if no configKey given)
}

export async function getEffectivePlaytimeMinutes(
  appId: string | number,
  configKey?: string,
): Promise<EffectivePlaytime> {
  const numericAppId = typeof appId === 'number' ? appId : Number(appId);
  const [trackedMinutes, steamMinutes, configMinutes] = await Promise.all([
    getMyAccumulatedMinutes(appId),
    Number.isFinite(numericAppId) && numericAppId > 0
      ? getSteamPlaytimeForeverMinutes(numericAppId)
      : Promise.resolve(0),
    configKey ? getMyConfigPlaytimeMinutes(appId, configKey) : Promise.resolve(0),
  ]);
  // Config-specific playtime weighted 1.25x -- time with this exact setup is
  // more relevant than total game time across all configs and Proton versions.
  const weightedConfig = configMinutes > 0 ? Math.round(configMinutes * 1.25) : 0;
  return {
    minutes: Math.max(weightedConfig, trackedMinutes, steamMinutes),
    trackedMinutes,
    steamMinutes,
    configMinutes,
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

// Human-readable playtime label for display. Mirrors js/app/utils.js::fmtMinutes
// on the web so plugin + web read the same way. When the caller has actual
// tracked minutes we prefer this over the bucket enum -- users would rather see
// "2.3 hr" than "1-4 hrs" (task #12).
export function formatPlaytimeMinutes(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m) || m < 1) return '< 1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  return h < 10 ? `${h.toFixed(1)} hr` : `${Math.round(h)} hr`;
}

// Short bucket-enum label for display when we ONLY have a bucket (no minutes).
// Matches js/app/utils.js::fmtDuration (short form). Returns null on unknown.
export function formatDurationBucket(bucket: string | null | undefined): string | null {
  switch (bucket) {
    case 'underOneHour':   return '< 1hr';
    case 'oneToFourHours': return '1-4 hrs';
    case 'fourToTenHours': return '4-10 hrs';
    case 'overTenHours':   return '10+ hrs';
    default:               return bucket || null;
  }
}
