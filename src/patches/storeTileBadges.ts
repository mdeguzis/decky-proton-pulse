// src/patches/storeTileBadges.ts
// Paint Proton Pulse tier badges onto Steam store artwork (#123).
//
// The library grid scanner does the same job by walking Big Picture's DOM.
// That is not available here: the store renders in its own CEF target, so the
// only way in is Steam's debugger port. The plugin attaches to the store tab,
// asks the page which app ids are on screen, resolves those to tiers using the
// same cache the rest of the plugin fills, and sends a tier map back to paint.
//
// No setup is required. Decky Loader cannot inject into SteamUI without CEF
// remote debugging, and its installer enables it, so if this plugin is running
// the debugger is already listening.
//
// Loop shape, and why it is a poll rather than an observer: the store lazy
// loads as you scroll and swaps its whole body on navigation, so an observer
// installed in the page would need re-installing constantly and would fire
// hundreds of times per scroll. One cheap Runtime.evaluate on a timer is less
// code and less traffic, and the scan already skips anything already badged.

import { fetchNoCors } from '@decky/api';
import {
  buildApplyBadgesScript,
  buildBadgeStyleScript,
  buildClearBadgesScript,
  buildFocusedAppScript,
  buildTileScanScript,
  TILE_TIER_COLORS,
  parseApplyReport,
  parseFocusedApp,
  parseScanResult,
} from '../lib/storeTileScript';
import { isOnStoreRoute } from '../lib/storeAppId';
import { getProtonDBSummary } from '../lib/protondb';
import { getSetting } from '../lib/settings';
import { logFrontendEvent } from '../lib/logger';

/**
 * Steam's CEF target listings, in probe order.
 *
 * Both confirmed serving on a settled Deck. 8080 is first because
 * scripts/take_cef_screenshot.py drives it and is what `make take-screenshot`
 * runs; 8081 is what main.py and the Makefile reference. During Steam startup
 * neither answers for a while, which is why a failed probe retries rather than
 * disabling the feature.
 */
const CDP_TARGET_LIST_URLS = [
  'http://localhost:8080/json/list',
  'http://localhost:8081/json/list',
] as const;

const SCAN_INTERVAL_MS = 1500;
// Focus is polled far more often than tiles are painted. Moving the stick has
// to update the footer hint immediately -- a 1.5s lag there reads as broken --
// but the query is a dozen DOM hops and costs nothing.
const FOCUS_INTERVAL_MS = 300;
const RECONNECT_DELAY_MS = 1500;
// After this many quick tries the retry slows down, but it never stops while
// the user is still on the store route. Giving up permanently was wrong: on a
// fresh Steam start the store tab can take far longer than a few seconds to
// exist, and the first load sometimes comes up as a data:text/html placeholder
// that is replaced moments later.
const QUICK_ATTEMPTS = 5;
const SLOW_RECONNECT_DELAY_MS = 10000;
// Matches the library grid scanner. Three at a time keeps ProtonDB happy while
// still filling a screen of tiles in a couple of ticks.
const FETCH_BATCH = 3;
// A game with no reports should not be re-requested on every scroll tick, but
// it should not be written off for the session either.
const NULL_RETRY_MS = 10 * 60 * 1000;

interface CdpTarget { url?: string; webSocketDebuggerUrl?: string }

let _socket: WebSocket | null = null;
let _msgId = 1;
let _pending = new Map<number, (value: unknown) => void>();
let _inStore = false;
let _scanTimer: ReturnType<typeof setInterval> | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _routePoll: ReturnType<typeof setInterval> | null = null;
let _scanBusy = false;
let _focusTimer: ReturnType<typeof setInterval> | null = null;
let _focusBusy = false;
let _focusedAppId = 0;

const _tiers = new Map<string, string>();      // appId -> tier
const _nullAt = new Map<string, number>();     // appId -> when we last got nothing
const _queue = new Set<string>();
let _fetchBusy = false;

/**
 * App id of the store tile the gamepad is currently on, or 0.
 *
 * Read by the footer hint so pressing View works while BROWSING the store, not
 * only on a game's own page. Lives here because this module already owns the
 * socket to the store target; opening a second one for a dozen DOM hops would
 * be wasteful and would double the reconnect logic.
 */
export function getFocusedStoreAppId(): number {
  return _focusedAppId;
}

export function isStoreTileBadgesEnabled(): boolean {
  return getSetting('storeTileBadges', true);
}

/**
 * Should a badge stay visible on an idle capsule?
 *
 * On by default: the whole point is reading tiers at a glance while scrolling.
 * Turned off, badges behave exactly like Valve's own compatibility pill and
 * appear only on the highlighted capsule.
 */
export function isStoreBadgeAlwaysVisible(): boolean {
  return getSetting('storeBadgesAlwaysVisible', true);
}

// --- CDP plumbing ---

function evaluate(expression: string): Promise<unknown> {
  if (!_socket || _socket.readyState !== WebSocket.OPEN) return Promise.resolve(undefined);
  const id = _msgId++;
  return new Promise((resolve) => {
    // Never leave a caller hanging on a socket that went away mid-flight.
    const timer = setTimeout(() => { _pending.delete(id); resolve(undefined); }, 5000);
    _pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
    try {
      _socket!.send(JSON.stringify({
        id, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }));
    } catch {
      clearTimeout(timer);
      _pending.delete(id);
      resolve(undefined);
    }
  });
}

async function findStoreTarget(): Promise<{ target: CdpTarget; listUrl: string } | null> {
  for (const listUrl of CDP_TARGET_LIST_URLS) {
    try {
      const resp = await fetchNoCors(listUrl);
      if (!resp.ok) continue;
      const targets = await resp.json() as CdpTarget[];
      if (!Array.isArray(targets)) continue;
      const target = targets.find(
        (t) => typeof t?.url === 'string'
          && t.url.includes('store.steampowered.com')
          && !!t.webSocketDebuggerUrl,
      );
      if (target) return { target, listUrl };
    } catch {
      // Port not listening or not serving JSON. Try the next one.
    }
  }
  return null;
}

async function connect(attempt = 1): Promise<void> {
  // No isStoreTileBadgesEnabled() gate: the socket also feeds the footer
  // hint's focused-tile lookup, which the badge setting does not control.
  if (!_inStore || _socket) return;
  if (attempt === QUICK_ATTEMPTS + 1) {
    void logFrontendEvent('DEBUG', 'storeTileBadges: store target still absent, backing off', {
      attempts: QUICK_ATTEMPTS,
      probed: CDP_TARGET_LIST_URLS.join(', '),
      nextDelayMs: SLOW_RECONNECT_DELAY_MS,
    });
  }

  const found = await findStoreTarget();
  if (!found) {
    // Normal on the first tick: Steam creates the store tab lazily.
    retryConnect(attempt + 1);
    return;
  }

  try {
    _socket = new WebSocket(found.target.webSocketDebuggerUrl!);
  } catch (err) {
    void logFrontendEvent('WARNING', 'storeTileBadges: could not open the debugger socket', {
      attempt, error: err instanceof Error ? err.message : String(err),
    });
    retryConnect(attempt + 1);
    return;
  }

  _socket.onopen = () => {
    void logFrontendEvent('INFO', 'storeTileBadges: attached to the store target', {
      source: found.listUrl,
    });
    // Stylesheet first: it drives the focus shuffle, and injecting it before
    // any badge exists avoids a frame where a badge sits in the wrong slot.
    void evaluate(buildBadgeStyleScript(isStoreBadgeAlwaysVisible()));
    void scanTick();
  };

  _socket.onmessage = (event) => {
    let data: any;
    try { data = JSON.parse(String((event as MessageEvent).data)); } catch { return; }
    const resolve = _pending.get(data?.id);
    if (!resolve) return;
    _pending.delete(data.id);
    resolve(data?.result?.result?.value);
  };

  _socket.onerror = () => {
    void logFrontendEvent('DEBUG', 'storeTileBadges: socket error', { attempt });
  };

  _socket.onclose = () => {
    _socket = null;
    for (const [, resolve] of _pending) resolve(undefined);
    _pending.clear();
    // Steam swaps the store target out when the view closes. Still being on
    // the route means it was replaced, not that we are finished.
    if (_inStore) retryConnect(attempt + 1);
  };
}

function retryConnect(attempt: number): void {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  const delay = attempt > QUICK_ATTEMPTS ? SLOW_RECONNECT_DELAY_MS : RECONNECT_DELAY_MS;
  _reconnectTimer = setTimeout(() => { _reconnectTimer = null; void connect(attempt); }, delay);
}

// --- tier resolution ---

function knownTier(appId: string): string | null {
  return _tiers.get(appId) ?? null;
}

function shouldFetch(appId: string): boolean {
  if (_tiers.has(appId) || _queue.has(appId)) return false;
  const nullAt = _nullAt.get(appId);
  if (nullAt != null && Date.now() - nullAt < NULL_RETRY_MS) return false;
  return true;
}

async function drainQueue(): Promise<void> {
  if (_fetchBusy || _queue.size === 0) return;
  _fetchBusy = true;
  try {
    while (_queue.size > 0 && _inStore) {
      const batch = [...(_queue)].slice(0, FETCH_BATCH);
      batch.forEach((id) => _queue.delete(id));
      await Promise.all(batch.map(async (appId) => {
        try {
          // Goes through the plugin's shared summary cache, so tiles the
          // library scanner already looked up cost nothing here.
          const summary = await getProtonDBSummary(appId);
          const tier = summary?.tier ?? null;
          // 'pending' is ProtonDB saying it has too few reports to rate the
          // game. It is truthy, so caching it as a tier shipped an unpaintable
          // value to the page: the badge silently never appeared and the
          // report could only call it unexplained. Treat it as no-data, which
          // also means it gets retried once the null window expires rather
          // than being wrong for the whole session.
          if (tier && TILE_TIER_COLORS[tier]) _tiers.set(appId, tier);
          else _nullAt.set(appId, Date.now());
        } catch (err) {
          _nullAt.set(appId, Date.now());
          void logFrontendEvent('DEBUG', 'storeTileBadges: tier lookup failed', {
            appId, source: 'getProtonDBSummary',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }));
    }
  } finally {
    _fetchBusy = false;
  }
}

// --- scan / paint loop ---

async function scanTick(): Promise<void> {
  if (_scanBusy || !_inStore || !isStoreTileBadgesEnabled()) return;
  if (!_socket || _socket.readyState !== WebSocket.OPEN) return;
  _scanBusy = true;
  try {
    const ids = parseScanResult(await evaluate(buildTileScanScript()));
    if (!ids.length) return;
    // Re-assert the stylesheet: a store navigation swaps the document and
    // takes it with it, which would strand every badge in its idle slot. The
    // script no-ops unless the document lost it or the mode changed.
    void evaluate(buildBadgeStyleScript(isStoreBadgeAlwaysVisible()));

    const resolved: Record<string, string> = {};
    let queued = 0;
    for (const appId of ids) {
      const tier = knownTier(appId);
      if (tier) resolved[appId] = tier;
      else if (shouldFetch(appId)) { _queue.add(appId); queued++; }
    }

    if (Object.keys(resolved).length) {
      const raw = await evaluate(buildApplyBadgesScript(resolved));
      const report = parseApplyReport(raw);
      const withTier = Object.keys(resolved).length;

      if (!report) {
        // The injected script threw, which Runtime.evaluate reports as no
        // completion value. Previously this looked identical to "nothing to
        // do" and a scope bug in the payload went unnoticed until the badges
        // simply never appeared.
        void logFrontendEvent('ERROR', 'storeTileBadges: apply script returned nothing', {
          onScreen: ids.length, withTier, queued,
          hint: 'the injected payload most likely threw; badges will not appear',
          source: 'Runtime.evaluate',
        });
        return;
      }

      // Only tiles we had a tier for, did not paint, and cannot otherwise
      // account for. Everything with a named reason is expected.
      const s = report.skipped;
      const accounted = report.painted + s.already + s.tooSmall
        + s.pillUnmeasured + s.unrated;
      const stranded = Math.max(0, withTier - accounted);
      void logFrontendEvent(stranded > 0 ? 'WARNING' : 'DEBUG', 'storeTileBadges: painted', {
        onScreen: ids.length,
        withTier,
        painted: report.painted,
        // Badges promoted from the artwork corner into Steam's compatibility
        // cluster once it finished rendering.
        relocated: report.moved,
        queued,
        // Every reason a rated game on screen still shows nothing. noTier is
        // benign (game has no reports); the rest point at placement problems.
        skipped: report.skipped,
        unexplained: stranded,
        source: 'Runtime.evaluate',
      });
    }

    // Fetch after painting so what we already know shows up immediately.
    if (queued) void drainQueue();
  } finally {
    _scanBusy = false;
  }
}

// --- lifecycle ---

async function focusTick(): Promise<void> {
  if (_focusBusy || !_inStore) return;
  if (!_socket || _socket.readyState !== WebSocket.OPEN) return;
  _focusBusy = true;
  try {
    const next = Number(parseFocusedApp(await evaluate(buildFocusedAppScript()))) || 0;
    if (next === _focusedAppId) return;
    _focusedAppId = next;
    void logFrontendEvent('DEBUG', 'storeTileBadges: focused tile changed', {
      appId: next || null,
      source: 'document.activeElement',
    });
  } finally {
    _focusBusy = false;
  }
}

function startScanning(): void {
  if (!_scanTimer) _scanTimer = setInterval(() => { void scanTick(); }, SCAN_INTERVAL_MS);
  // Focus tracking runs even with badges switched off: the setting is about
  // painting artwork, not about whether View opens the highlighted game.
  if (!_focusTimer) _focusTimer = setInterval(() => { void focusTick(); }, FOCUS_INTERVAL_MS);
}

function stopScanning(): void {
  if (_scanTimer) { clearInterval(_scanTimer); _scanTimer = null; }
  if (_focusTimer) { clearInterval(_focusTimer); _focusTimer = null; }
  _focusedAppId = 0;
}

function disconnect(): void {
  stopScanning();
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  if (_socket) {
    try { _socket.close(); } catch { /* already gone */ }
    _socket = null;
  }
  _pending.clear();
  _queue.clear();
}

function onRoute(pathname: string): void {
  const inStore = isOnStoreRoute(pathname);
  if (inStore === _inStore) return;
  _inStore = inStore;
  void logFrontendEvent('DEBUG', 'storeTileBadges: store route changed', { pathname, inStore });
  if (inStore) { void connect(); startScanning(); }
  else disconnect();
}

export function setupStoreTileBadges(): void {
  if (_routePoll) return;
  onRoute(globalThis.location?.pathname ?? '');
  _routePoll = setInterval(() => onRoute(globalThis.location?.pathname ?? ''), 1000);
  void logFrontendEvent('INFO', 'storeTileBadges: route watcher started', {
    enabled: isStoreTileBadgesEnabled(),
  });
}

export function teardownStoreTileBadges(): void {
  if (_routePoll) { clearInterval(_routePoll); _routePoll = null; }
  disconnect();
  _inStore = false;
  _tiers.clear();
  _nullAt.clear();
}

/**
 * React to the settings toggle without needing to leave and re-enter the store.
 * Turning it off clears what is already painted.
 */
export function refreshStoreTileBadges(): void {
  if (!_inStore) return;
  if (!isStoreTileBadgesEnabled()) {
    // Clear the artwork badges but keep the socket and the focus poll: the
    // footer hint still needs to know which tile is highlighted.
    void evaluate(buildClearBadgesScript());
    return;
  }
  if (!_socket) { void connect(); startScanning(); return; }
  // Re-inject first so an always-visible toggle takes effect immediately
  // rather than on the next scan.
  void evaluate(buildBadgeStyleScript(isStoreBadgeAlwaysVisible()));
  void scanTick();
}
