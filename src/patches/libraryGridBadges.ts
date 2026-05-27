// src/patches/libraryGridBadges.ts
// Injects ProtonDB tier badges onto game tiles in Steam's library grid view.
// Uses DOM scanning + MutationObserver on BPM's document (same cross-frame pattern
// as searchResultsHint.tsx). Fetches tiers via getProtonDBSummary with rate limiting.
// On by default -- toggle via showLibraryBadges setting.
//
// Design: Steam re-renders library tiles frequently (virtual DOM), so we cannot
// rely on stable DOM node refs. Instead we maintain a session-level _tierCache
// (appId -> tier) and re-apply badges to all visible [data-id] tiles on every
// scan tick. Tiles already badged (PP_BADGE_EL_ATTR present) are skipped cheaply.
import { getProtonDBSummary } from '../lib/protondb';
import { RATING_COLORS } from '../lib/reportFormatters';
import { getSetting } from '../lib/settings';
import { logFrontendEvent } from '../lib/logger';
import { getCached } from '../lib/cache';

const PP_BADGE_EL_ATTR = 'data-pp-lib-badge';

// Full tier labels for wide/landscape capsules
const TIER_FULL: Record<string, string> = {
  platinum: 'PLATINUM',
  gold: 'GOLD',
  silver: 'SILVER',
  bronze: 'BRONZE',
  borked: 'BORKED',
  pending: '?',
};

// Abbreviated tier labels for portrait capsules
const TIER_ABBREV: Record<string, string> = {
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

function getTierLabel(tier: string, cover: HTMLElement): string {
  const isWide = cover.offsetWidth > cover.offsetHeight;
  const map = isWide ? TIER_FULL : TIER_ABBREV;
  return map[tier] ?? tier.toUpperCase();
}

// Session-level tier cache: appId -> tier string | null (null = no ProtonDB data)
// Undefined = not yet fetched. Survives tile re-renders within a session.
const _tierCache = new Map<string, string | null>();

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

// Extract appId + cover container from an image element.
// Covers two Steam library layouts:
//   - Home page "Recent Games": [data-id] card wrapping an <img>
//   - Library grid (Installed/All Games): bare <img> with no [data-id] ancestor.
// Try both the HTML attribute (relative paths like /assets/<id>/) and the resolved
// .src property (absolute CDN URLs like steamstatic.com/.../apps/<id>/).
function extractFromImg(img: HTMLImageElement): { appId: string; cover: HTMLElement } | null {
  const attr = img.getAttribute('src') ?? '';
  const appId = extractAppIdFromUrl(attr) ?? extractAppIdFromUrl(img.src ?? '');
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
  const appId = extractAppIdFromUrl(urlMatch[1]);
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
    if (!seen.has(hit.cover)) { seen.add(hit.cover); results.push(hit); }
  }

  // Library grid (some Steam versions): cover art as CSS background-image
  for (const el of Array.from(doc.querySelectorAll('[style*="background"]')) as HTMLElement[]) {
    const hit = extractFromBgEl(el);
    if (!hit) continue;
    if (!seen.has(hit.cover)) { seen.add(hit.cover); results.push(hit); }
  }

  return results;
}

function applyBadgeToCover(cover: HTMLElement, tier: string | null): void {
  if (!tier) return;
  const doc = cover.ownerDocument ?? getBpmDocument();

  const existing = cover.querySelector(`[${PP_BADGE_EL_ATTR}]`) as HTMLElement | null;
  if (existing) {
    existing.textContent = getTierLabel(tier, cover);
    existing.style.background = RATING_COLORS[tier] ?? '#888';
    existing.style.color = TIER_TEXT_COLOR[tier] ?? '#fff';
    return;
  }

  const badge = doc.createElement('div');
  badge.setAttribute(PP_BADGE_EL_ATTR, '1');
  badge.textContent = getTierLabel(tier, cover);
  badge.style.cssText = [
    'position:absolute',
    'bottom:4px',
    'left:4px',
    'z-index:10',
    'padding:2px 5px',
    'border-radius:3px',
    'font-size:9px',
    'font-weight:700',
    'letter-spacing:0.04em',
    'pointer-events:none',
    'white-space:nowrap',
    'line-height:1.4',
    `background:${RATING_COLORS[tier] ?? '#888'}`,
    `color:${TIER_TEXT_COLOR[tier] ?? '#fff'}`,
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
        try {
          const wasCached = !!getCached(appId)?.summary;
          const summary = await getProtonDBSummary(appId);
          const tier = summary?.tier ?? null;
          // Store in session cache so future scan ticks can apply without re-fetching
          _tierCache.set(appId, tier);
          // Apply immediately to any currently visible covers with this appId
          const doc = getBpmDocument();
          const visible = findVisibleTiles(doc).filter((t) => t.appId === appId);
          for (const { cover } of visible) applyBadgeToCover(cover, tier);
          void logFrontendEvent('DEBUG', 'libraryGridBadges: tier fetched', {
            appId,
            tier,
            source: wasCached ? 'cache' : (summary ? 'network' : 'none'),
            coversUpdatedNow: visible.length,
          });
        } catch (err) {
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

function scanAndQueue(): void {
  if (!getSetting('showLibraryBadges', true)) return;

  const doc = getBpmDocument();
  runDiagnostic(doc);
  const tiles = findVisibleTiles(doc);

  let badgedNow = 0;
  let queued = 0;

  for (const { appId, cover } of tiles) {
    if (_tierCache.has(appId)) {
      const tier = _tierCache.get(appId) ?? null;
      if (tier) { applyBadgeToCover(cover, tier); badgedNow++; }
    } else if (!_fetchQueue.has(appId)) {
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

export function refreshLibraryGridBadges(enabled: boolean): void {
  void logFrontendEvent('INFO', 'libraryGridBadges: refreshLibraryGridBadges', { enabled });
  if (!enabled) {
    removeAllBadges();
  } else {
    scanAndQueue();
  }
}

export function setupLibraryGridBadges(): void {
  void logFrontendEvent('INFO', 'libraryGridBadges: setup', {});

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
  _bpmDocCache = null;
  _fetchQueue.clear();
  _fetchBusy = false;
  _diagDone = false;
}
