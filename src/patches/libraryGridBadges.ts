// src/patches/libraryGridBadges.ts
// Injects ProtonDB tier badges onto game tiles in Steam's library grid view.
// Uses DOM scanning + MutationObserver on BPM's document (same cross-frame pattern
// as searchResultsHint.tsx). Fetches tiers via getProtonDBSummary with rate limiting.
// Badge style controlled by libraryBadgeStyle setting: full | compact | minimal | off.
//
// Design: Steam re-renders library tiles frequently (virtual DOM), so we cannot
// rely on stable DOM node refs. Instead we maintain a session-level _tierCache
// (appId -> tier) and re-apply badges to all visible tiles on every scan tick.
import { appDetailsClasses } from '@decky/ui';
import { getProtonDBSummary } from '../lib/protondb';
import { RATING_COLORS } from '../lib/reportFormatters';
import { getSetting } from '../lib/settings';
import { logFrontendEvent } from '../lib/logger';
import { getCached, getCacheTtlMs } from '../lib/cache';
import {
  countBadgeTileSeen, countBadgeApplied, countBadgeNoData,
  countBadgeFetchError, countBadgeFetchMs,
} from '../lib/metrics';

const PP_BADGE_EL_ATTR = 'data-pp-lib-badge';
const NO_DATA_COLOR = '#6b21a8'; // purple

export type LibraryBadgeStyle = 'full' | 'compact' | 'minimal' | 'off';

const TIER_FULL: Record<string, string> = {
  platinum: 'PLATINUM',
  gold: 'GOLD',
  silver: 'SILVER',
  bronze: 'BRONZE',
  borked: 'BORKED',
  pending: '?',
};

const TIER_COMPACT: Record<string, string> = {
  platinum: 'PLAT',
  gold: 'GOLD',
  silver: 'SILV',
  bronze: 'BRNZ',
  borked: 'BORK',
  pending: '?',
};

const TIER_TEXT_COLOR: Record<string, string> = {
  platinum: '#1a1a2e',
  gold: '#1a1a00',
  silver: '#1a1a1a',
  bronze: '#fff',
  borked: '#fff',
  pending: '#ccc',
};

// Minimal badge atom icon. Adjust width/height to match the Steam Deck Verified badge
// circle size (~28px outer). SVG 15px + padding 4px each side = ~23px outer.
const BADGE_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 36 36" fill="none" aria-hidden="true"><ellipse cx="18" cy="18" rx="15" ry="5.5" stroke="currentColor" stroke-width="1.8"/><ellipse cx="18" cy="18" rx="15" ry="5.5" stroke="currentColor" stroke-width="1.8" transform="rotate(60 18 18)"/><ellipse cx="18" cy="18" rx="15" ry="5.5" stroke="currentColor" stroke-width="1.8" transform="rotate(-60 18 18)"/><circle cx="18" cy="18" r="2.6" fill="currentColor"/></svg>';

function getLibraryBadgeStyle(): LibraryBadgeStyle {
  return getSetting('libraryBadgeStyle', 'full') as LibraryBadgeStyle;
}

function getShowNoData(): boolean {
  return getSetting('libraryBadgeShowNoData', false) as boolean;
}

function getBadgeContent(style: LibraryBadgeStyle, tier: string): { html: string; text: string } {
  if (style === 'minimal') {
    return { html: BADGE_ICON_SVG, text: '' };
  }
  const map = style === 'compact' ? TIER_COMPACT : TIER_FULL;
  const label = map[tier] ?? tier.toUpperCase();
  return { html: '', text: label };
}

const TIER_STORAGE_KEY = 'pp_lib_tier_cache_v1';

interface TierEntry { tier: string; cachedAt: number; }

// Persistent tier cache: appId -> { tier, cachedAt }.
// Loaded from localStorage on setup, saved after each fetch.
// TTL matches the user's cache-ttl-hours setting (same as main report cache).
const _tierCache = new Map<string, TierEntry>();

// Tracks appIds fetched but with no ProtonDB data, with the attempt timestamp.
// Entries expire after NULL_EXPIRY_MS so transient failures get retried.
const _nullCache = new Map<string, number>(); // appId -> Date.now() of last attempt
const NULL_EXPIRY_MS = 10 * 60 * 1000;

function loadTierCache(): void {
  try {
    const raw = localStorage.getItem(TIER_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, TierEntry>;
    const ttl = getCacheTtlMs();
    const now = Date.now();
    let loaded = 0;
    for (const [appId, entry] of Object.entries(saved)) {
      if (now - entry.cachedAt < ttl) { _tierCache.set(appId, entry); loaded++; }
    }
    void logFrontendEvent('DEBUG', 'libraryGridBadges: loaded tier cache from storage', {
      loaded, totalSaved: Object.keys(saved).length,
    });
  } catch { /* corrupt storage */ }
}

function saveTierCache(): void {
  try {
    const obj: Record<string, TierEntry> = {};
    for (const [appId, entry] of _tierCache) obj[appId] = entry;
    localStorage.setItem(TIER_STORAGE_KEY, JSON.stringify(obj));
  } catch { /* storage full */ }
}

let _scanInterval: ReturnType<typeof setInterval> | null = null;
let _mutObs: MutationObserver | null = null;
let _bpmDocCache: Document | null = null;
const _fetchQueue: Set<string> = new Set();
let _fetchBusy = false;
let _mutObsDebounce: ReturnType<typeof setTimeout> | null = null;
let _diagDone = false;

// BPM document access -- same approach as searchResultsHint.tsx
function getBpmDocument(): Document {
  if (_bpmDocCache) return _bpmDocCache;
  try {
    const parentDoc = (globalThis as any).parent?.document;
    if (parentDoc && parentDoc !== document && (parentDoc.body?.clientWidth ?? 0) > 1) {
      _bpmDocCache = parentDoc;
      return _bpmDocCache as Document;
    }
  } catch { /* cross-origin guard */ }
  const fnc = (globalThis as any).FocusNavController;
  const trees: any[] = fnc?.m_ActiveContext?.m_rgGamepadNavigationTrees ?? [];
  for (const tree of trees) {
    const el: HTMLElement | null = tree.m_lastFocusNode?.m_element ?? tree.m_root?.m_element ?? null;
    const w = el?.ownerDocument?.body?.clientWidth ?? 0;
    if (el?.ownerDocument && el.ownerDocument !== document && w > 100) {
      _bpmDocCache = el.ownerDocument;
      return _bpmDocCache as Document;
    }
  }
  return document;
}

// Extract appId from a Steam CDN or loopback URL.
// Handles patterns:
//   /apps/<id>/           -- classic CDN (cdn.cloudflare.steamstatic.com/steam/apps/<id>/)
//   /steam/apps/<id>/     -- new shared.steamstatic.com/store_item_assets/steam/apps/<id>/
//   /assets/<id>/         -- loopback proxy
//   /customimages/<id>/   -- custom art
const STEAM_APPID_RE = /\/steam\/apps\/(\d+)\/|\/apps\/(\d+)\/|(?:assets|customimages)\/(\d+)/;

function extractAppIdFromUrl(url: string): string | null {
  const m = url.match(STEAM_APPID_RE);
  const appId = m ? (m[1] ?? m[2] ?? m[3]) : null;
  if (!appId || parseInt(appId, 10) <= 0) return null;
  return appId;
}

// Walk up from an element to find the best positioned container for overlay badges.
// Stops at the first non-static ancestor (max 5 levels).
function findCoverContainer(el: HTMLElement): HTMLElement {
  let cover: HTMLElement = el.parentElement as HTMLElement ?? el;
  for (let i = 0; i < 5; i++) {
    const p = cover.parentElement;
    if (!p || p === document.body) break;
    const cs = window.getComputedStyle(p);
    if (cs.position !== 'static') break;
    cover = p;
  }
  return cover;
}

// Returns true if the element or any nearby ancestor contains navigation text
// like "View more" or "View all" -- these are Steam UI nav tiles, not game covers.
function isNavTile(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el;
  for (let i = 0; i < 6; i++) {
    if (!cur) break;
    const text = (cur.textContent ?? '').trim().toLowerCase();
    if (text.includes('view more') || text.includes('view all')) return true;
    cur = cur.parentElement;
  }
  return false;
}

// Extract appId + cover container from an image element.
// Covers two Steam library layouts:
//   - Home page "Recent Games": [data-id] card wrapping an <img>
//   - Library grid (Installed/All Games): bare <img> with no [data-id] ancestor.
// Try both the HTML attribute (relative paths like /assets/<id>/) and the resolved
// .src property (absolute CDN URLs like steamstatic.com/.../apps/<id>/).
// Library tiles are at least ~80px tall; our plugin's Manage This Game header
// shows a tiny 40px boxart that also matches img[src*="/apps/"], and we don't
// want to stamp a redundant atom badge there (rating is already shown to the
// right of the header). Skip anything below MIN_TILE_HEIGHT so small in-plugin
// boxarts are left alone
const MIN_TILE_HEIGHT = 60;

function extractFromImg(img: HTMLImageElement): { appId: string; cover: HTMLElement } | null {
  const attr = img.getAttribute('src') ?? '';
  const src = img.src ?? '';
  // Skip game page hero/header images -- full-screen artwork shown on the game details page,
  // not grid tiles. Confirmed in logs: library_hero.jpg and library_header*.jpg appear in
  // findVisibleTiles scans when the user is on the game page, causing lib badges to be
  // injected into the game page InnerContainer and removed alongside real lib badges on
  // toggle-off, making the game page badge appear to respond to the library grid setting.
  const urlToCheck = attr || src;
  if (urlToCheck.includes('library_hero') || urlToCheck.includes('library_header')) return null;
  // Skip small images (eg. our own plugin's 40px header boxart)
  const h = img.clientHeight || img.naturalHeight || 0;
  if (h > 0 && h < MIN_TILE_HEIGHT) return null;
  const appId = extractAppIdFromUrl(attr) ?? extractAppIdFromUrl(src);
  if (!appId) return null;
  return { appId, cover: findCoverContainer(img) };
}

// Extract appId + cover from an element using CSS background-image.
// Library grid tiles in some Steam versions render cover art as background-image
// rather than <img> elements.
function extractFromBgEl(el: HTMLElement): { appId: string; cover: HTMLElement } | null {
  const bg = el.style?.backgroundImage ?? '';
  if (!bg || !bg.includes('url(')) return null;
  const urlMatch = bg.match(/url\(['"]?([^'")\s]+)['"]?\)/);
  if (!urlMatch) return null;
  const url = urlMatch[1];
  if (url.includes('library_hero') || url.includes('library_header')) return null;
  const appId = extractAppIdFromUrl(url);
  if (!appId) return null;
  return { appId, cover: el };
}

// Return all visible game cover tiles from both layout types.
function findVisibleTiles(doc: Document): Array<{ appId: string; cover: HTMLElement }> {
  const results: Array<{ appId: string; cover: HTMLElement }> = [];
  const seen = new Set<HTMLElement>();

  // Home page "Recent Games" tiles carry [data-id]
  for (const el of Array.from(doc.querySelectorAll('[data-id]')) as HTMLElement[]) {
    const raw = el.getAttribute('data-id');
    if (!raw) continue;
    const id = parseInt(raw, 10);
    if (id <= 0) continue;
    if (isNavTile(el)) continue;
    const img = el.querySelector('img');
    const cover = (img?.parentElement && img.parentElement !== el)
      ? img.parentElement as HTMLElement
      : el;
    if (!seen.has(cover)) { seen.add(cover); results.push({ appId: String(id), cover }); }
  }

  // Library grid: <img> tiles -- covers both absolute CDN URLs and Steam's relative loopback paths
  // Relative paths: /assets/<id>/... and /customimages/<id>/... (steamloopback.host serves these)
  // Absolute CDN: steamstatic.com/.../apps/<id>/...
  const imgSelector = [
    'img[src*="steamstatic.com"]',
    'img[src*="/assets/"]',
    'img[src*="/customimages/"]',
    'img[src*="/apps/"]',
  ].join(', ');
  for (const img of Array.from(doc.querySelectorAll(imgSelector)) as HTMLImageElement[]) {
    const hit = extractFromImg(img);
    if (!hit) continue;
    if (isNavTile(hit.cover)) continue;
    if (!seen.has(hit.cover)) { seen.add(hit.cover); results.push(hit); }
  }

  // Library grid (some Steam versions): cover art as CSS background-image
  for (const el of Array.from(doc.querySelectorAll('[style*="background"]')) as HTMLElement[]) {
    const hit = extractFromBgEl(el);
    if (!hit) continue;
    if (isNavTile(hit.cover)) continue;
    if (!seen.has(hit.cover)) { seen.add(hit.cover); results.push(hit); }
  }

  return results;
}

function applyNoDataBadgeToCover(cover: HTMLElement, style: LibraryBadgeStyle): void {
  if (style === 'off') return;
  const doc = cover.ownerDocument ?? getBpmDocument();
  const existing = cover.querySelector(`[${PP_BADGE_EL_ATTR}]`) as HTMLElement | null;
  const label = style === 'minimal' ? BADGE_ICON_SVG : (style === 'compact' ? 'N/D' : 'NO DATA');
  const isMinimal = style === 'minimal';
  if (existing) {
    if (isMinimal) { existing.innerHTML = label; existing.style.padding = '4px'; }
    else { existing.textContent = label; existing.style.padding = '2px 5px'; }
    existing.style.background = NO_DATA_COLOR;
    existing.style.color = '#fff';
    return;
  }
  const badge = doc.createElement('div');
  badge.setAttribute(PP_BADGE_EL_ATTR, '1');
  if (isMinimal) { badge.innerHTML = label; } else { badge.textContent = label; }
  badge.style.cssText = [
    'position:absolute', 'bottom:4px', 'left:4px', 'z-index:10',
    isMinimal ? 'padding:4px' : 'padding:2px 5px',
    'border-radius:3px', 'font-size:9px', 'font-weight:700',
    'letter-spacing:0.04em', 'pointer-events:none', 'white-space:nowrap',
    'line-height:1', 'display:flex', 'align-items:center',
    `background:${NO_DATA_COLOR}`, 'color:#fff',
  ].join(';');
  const cs = doc.defaultView?.getComputedStyle(cover);
  if (cs?.position === 'static') cover.style.position = 'relative';
  cover.appendChild(badge);
}

function applyBadgeToCover(cover: HTMLElement, tier: string | null, style: LibraryBadgeStyle): void {
  if (!tier || style === 'off') return;
  const doc = cover.ownerDocument ?? getBpmDocument();
  const bg = RATING_COLORS[tier] ?? '#888';
  const color = TIER_TEXT_COLOR[tier] ?? '#fff';
  const { html, text } = getBadgeContent(style, tier);
  const isMinimal = style === 'minimal';

  const existing = cover.querySelector(`[${PP_BADGE_EL_ATTR}]`) as HTMLElement | null;
  if (existing) {
    if (isMinimal) {
      existing.innerHTML = html;
      existing.style.padding = '4px';
    } else {
      existing.textContent = text;
      existing.style.padding = '2px 5px';
    }
    existing.style.background = bg;
    existing.style.color = color;
    return;
  }

  const badge = doc.createElement('div');
  badge.setAttribute(PP_BADGE_EL_ATTR, '1');
  if (isMinimal) {
    badge.innerHTML = html;
  } else {
    badge.textContent = text;
  }
  // Badge position: bottom-left corner of the cover tile.
  // minimal padding (4px) sizes the outer box to match the Deck Verified circles.
  // full/compact font-size (9px) keeps text readable at grid tile scale.
  badge.style.cssText = [
    'position:absolute',
    'bottom:4px',
    'left:4px',
    'z-index:10',
    isMinimal ? 'padding:4px' : 'padding:2px 5px',
    'border-radius:3px',
    'font-size:9px',
    'font-weight:700',
    'letter-spacing:0.04em',
    'pointer-events:none',
    'white-space:nowrap',
    'line-height:1',
    'display:flex',
    'align-items:center',
    `background:${bg}`,
    `color:${color}`,
  ].join(';');

  const cs = doc.defaultView?.getComputedStyle(cover);
  if (cs?.position === 'static') cover.style.position = 'relative';
  cover.appendChild(badge);
}

async function processFetchQueue(): Promise<void> {
  if (_fetchBusy || _fetchQueue.size === 0) return;
  _fetchBusy = true;

  const BATCH_SIZE = 3;
  const batch = Array.from(_fetchQueue).slice(0, BATCH_SIZE);
  batch.forEach((id) => _fetchQueue.delete(id));

  void logFrontendEvent('DEBUG', 'libraryGridBadges: fetching batch', {
    count: batch.length,
    remaining: _fetchQueue.size,
  });

  try {
    await Promise.all(
      batch.map(async (appId) => {
        const t0 = Date.now();
        try {
          const wasCached = !!getCached(appId)?.summary;
          const summary = await getProtonDBSummary(appId);
          const fetchMs = Date.now() - t0;
          countBadgeFetchMs(fetchMs);
          const tier = summary?.tier ?? null;
          if (tier) {
            _tierCache.set(appId, { tier, cachedAt: Date.now() });
            saveTierCache();
          } else {
            _nullCache.set(appId, Date.now());
            countBadgeNoData();
            void logFrontendEvent('DEBUG', 'libraryGridBadges: null tier cached', {
              appId, source: wasCached ? 'cache' : 'network',
            });
          }
          // Apply immediately to any currently visible covers with this appId,
          // but skip if the user navigated to a game details page while fetch was in flight.
          const doc = getBpmDocument();
          const style = getLibraryBadgeStyle();
          const showNoData = getShowNoData();
          let coversUpdatedNow = 0;
          if (!isOnGameDetailsPage()) {
            const visible = findVisibleTiles(doc).filter((t) => t.appId === appId);
            for (const { cover } of visible) {
              if (tier) {
                applyBadgeToCover(cover, tier, style);
                countBadgeApplied();
              } else if (showNoData) {
                applyNoDataBadgeToCover(cover, style);
              }
            }
            coversUpdatedNow = visible.length;
          }
          void logFrontendEvent('DEBUG', 'libraryGridBadges: tier fetched', {
            appId,
            tier,
            source: wasCached ? 'cache' : (summary ? 'network' : 'none'),
            fetchMs,
            coversUpdatedNow,
          });
        } catch (err) {
          countBadgeFetchError();
          void logFrontendEvent('WARNING', 'libraryGridBadges: fetch failed', {
            appId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  } finally {
    _fetchBusy = false;
    if (_fetchQueue.size > 0) void processFetchQueue();
  }
}

function runDiagnostic(doc: Document): void {
  if (_diagDone) return;
  _diagDone = true;
  const allImgs = Array.from(doc.querySelectorAll('img')) as HTMLImageElement[];
  const srcs = allImgs.slice(0, 10).map((i) => i.src ?? i.getAttribute('src') ?? i.getAttribute('data-src') ?? '(no src)');
  const bgEls = Array.from(doc.querySelectorAll('[style*="background"]')) as HTMLElement[];
  const bgSamples = bgEls.slice(0, 5).map((el) => (el.style?.backgroundImage ?? el.getAttribute('style') ?? '').slice(0, 120));
  const dataIds = doc.querySelectorAll('[data-id]').length;
  const steamStaticImgs = doc.querySelectorAll('img[src*="steamstatic.com"]').length;
  const loopbackImgs = doc.querySelectorAll('img[src*="steamloopback.host"]').length;
  const appsImgs = doc.querySelectorAll('img[src*="/apps/"]').length;
  void logFrontendEvent('DEBUG', 'libraryGridBadges: DOM diagnostic', {
    totalImgs: allImgs.length,
    imgSrcSamples: srcs,
    steamStaticImgMatches: steamStaticImgs,
    loopbackImgMatches: loopbackImgs,
    appsImgMatches: appsImgs,
    dataIdElements: dataIds,
    bgElementCount: bgEls.length,
    bgSamples,
    docTitle: doc.title,
    docUrl: doc.location?.href ?? '?',
  });
}

// Detect game details page by checking for InnerContainer in the BPM DOM.
// URL-based detection is unreliable because Steam uses client-side routing and
// the BPM window's location.pathname does not change on in-app navigation.
function isOnGameDetailsPage(): boolean {
  try {
    const bpmDoc = getBpmDocument();
    const cls = (appDetailsClasses as any)?.InnerContainer;
    if (!cls) return false;
    return !!bpmDoc.querySelector(`.${cls}`);
  } catch {
    return false;
  }
}

function scanAndQueue(): void {
  const style = getLibraryBadgeStyle();
  if (style === 'off') return;

  const doc = getBpmDocument();

  // Do not scan the game details page -- its capsule/thumbnail images match our tile
  // selectors, causing lib badges to bleed into the game page hero area. Clear any
  // stale lib badges that may have been applied before navigation and bail out.
  if (isOnGameDetailsPage()) {
    doc.querySelectorAll(`[${PP_BADGE_EL_ATTR}]`).forEach((el) => el.remove());
    void logFrontendEvent('DEBUG', 'libraryGridBadges: skipping scan on game details page');
    return;
  }

  runDiagnostic(doc);
  const tiles = findVisibleTiles(doc);

  let badgedNow = 0;
  let queued = 0;

  const now = Date.now();
  const ttl = getCacheTtlMs();
  const showNoData = getShowNoData();
  for (const { appId, cover } of tiles) {
    countBadgeTileSeen(appId);
    const entry = _tierCache.get(appId);
    if (entry && now - entry.cachedAt < ttl) {
      applyBadgeToCover(cover, entry.tier, style);
      countBadgeApplied();
      badgedNow++;
    } else if (_nullCache.has(appId) && now - _nullCache.get(appId)! < NULL_EXPIRY_MS) {
      // fetched recently, came back null
      if (showNoData) applyNoDataBadgeToCover(cover, style);
    } else if (!_fetchQueue.has(appId)) {
      // expired or never fetched -- queue for refresh
      if (entry) _tierCache.delete(appId); // evict expired entry
      _fetchQueue.add(appId);
      queued++;
    }
  }

  void logFrontendEvent('DEBUG', 'libraryGridBadges: scan tick', {
    visibleTiles: tiles.length,
    badgedFromCache: badgedNow,
    newlyQueued: queued,
    fetchQueueSize: _fetchQueue.size,
    sessionCacheSize: _tierCache.size,
  });

  if (_fetchQueue.size > 0 && !_fetchBusy) void processFetchQueue();
}

function removeAllBadges(): void {
  const doc = getBpmDocument();
  doc.querySelectorAll(`[${PP_BADGE_EL_ATTR}]`).forEach((el) => el.remove());
}

// Call after changing the libraryBadgeStyle setting -- removes stale badges and re-applies.
export function refreshLibraryGridBadges(): void {
  const style = getLibraryBadgeStyle();
  void logFrontendEvent('INFO', 'libraryGridBadges: refreshLibraryGridBadges', { style });
  removeAllBadges();
  if (style !== 'off') scanAndQueue();
}

export function setupLibraryGridBadges(): void {
  loadTierCache();
  void logFrontendEvent('INFO', 'libraryGridBadges: setup', { persistedTiers: _tierCache.size });

  window.setTimeout(() => {
    scanAndQueue();
    const doc = getBpmDocument();
    _mutObs = new MutationObserver(() => {
      if (_mutObsDebounce) clearTimeout(_mutObsDebounce);
      _mutObsDebounce = setTimeout(() => {
        _mutObsDebounce = null;
        scanAndQueue();
      }, 300);
    });
    _mutObs.observe(doc.body, { childList: true, subtree: true });
    void logFrontendEvent('DEBUG', 'libraryGridBadges: MutationObserver attached', {});
  }, 2000);

  _scanInterval = setInterval(scanAndQueue, 5000);
}

export function teardownLibraryGridBadges(): void {
  void logFrontendEvent('INFO', 'libraryGridBadges: teardown', {});
  if (_scanInterval) { clearInterval(_scanInterval); _scanInterval = null; }
  if (_mutObsDebounce) { clearTimeout(_mutObsDebounce); _mutObsDebounce = null; }
  if (_mutObs) { _mutObs.disconnect(); _mutObs = null; }
  removeAllBadges();
  _tierCache.clear();
  _nullCache.clear();
  try { localStorage.removeItem(TIER_STORAGE_KEY); } catch { /* ignore */ }
  _bpmDocCache = null;
  _fetchQueue.clear();
  _fetchBusy = false;
  _diagDone = false;
}
