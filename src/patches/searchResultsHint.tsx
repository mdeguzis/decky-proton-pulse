// src/patches/searchResultsHint.tsx
// Shows a "Y  Show Proton Info" hint at the bottom when a search result card is
// focused via the gamepad. Hooks into Steam's FocusNavController (shared between
// SharedJSContext and BPM) rather than DOM focus events, because search results
// render in the BPM frame which has a separate document from the SJC plugin context.
//
// AppId extraction: Steam's search tiles have no data-appid attribute; the appId
// is embedded in the store CDN image src (steam/apps/<id>/header.jpg).
//
// Button detection: hooks m_ButtonDownCallbacks on all gamepad input sources.
// Y button = EButton 4 in Steam's internal EButton enum (empirically confirmed --
// NOT the standard Web Gamepad API index 3).
//
// No settings toggle -- always active.
import { Navigation } from '@decky/ui';
import { dispatchNavigate, rememberReturnPath } from '../lib/pageState';
import { logFrontendEvent } from '../lib/logger';
import { t } from '../lib/i18n';

const HINT_ID = 'pp-search-hint-root';

let _hintEl: HTMLElement | null = null;
let _bpmDocCache: Document | null = null;
let _focusedAppId: number | null = null;
let _pollInterval: ReturnType<typeof setInterval> | null = null;
let _buttonCbs: Array<{ source: any; cb: (btn: number) => void }> = [];
let _yWasDown = false;

// SJC's document.body is a 1x1 hidden frame. We need to append the hint to
// BPM's document body (the visible Steam UI). Get BPM's document via any
// focused nav tree element's ownerDocument, which is cross-frame accessible
// because SJC and BPM share the same steamloopback.host origin.
// Cache the reference -- BPM's document never changes at runtime.
function getBpmDocument(): Document {
  if (_bpmDocCache) return _bpmDocCache;

  // Attempt 1: window.parent (SJC is a child frame of BPM on steamloopback.host)
  try {
    const parentDoc = (globalThis as any).parent?.document;
    if (parentDoc && parentDoc !== document && (parentDoc.body?.clientWidth ?? 0) > 1) {
      _bpmDocCache = parentDoc;
      void logFrontendEvent('DEBUG', 'searchResultsHint: BPM doc via window.parent', { w: parentDoc.body.clientWidth });
      return _bpmDocCache as Document;
    }
  } catch { /* cross-origin guard */ }

  // Attempt 2: FocusNavController nav tree element ownerDocument -- must have
  // real width (>100) to exclude small popup/panel frames (clientWidth=1)
  const fnc = (globalThis as any).FocusNavController;
  const trees: any[] = fnc?.m_ActiveContext?.m_rgGamepadNavigationTrees ?? [];
  for (const tree of trees) {
    const el: HTMLElement | null = tree.m_lastFocusNode?.m_element ?? tree.m_root?.m_element ?? null;
    const w = el?.ownerDocument?.body?.clientWidth ?? 0;
    if (el?.ownerDocument && el.ownerDocument !== document && w > 100) {
      _bpmDocCache = el.ownerDocument;
      void logFrontendEvent('DEBUG', 'searchResultsHint: BPM doc via nav tree', { w });
      return _bpmDocCache as Document;
    }
  }

  void logFrontendEvent('DEBUG', 'searchResultsHint: BPM doc not found, SJC fallback');
  return document;
}

// ── appId from focused nav tree element ──────────────────────────────────────

function isOnSearchRoute(): boolean {
  return (globalThis.location?.pathname ?? '').includes('search');
}

function getAppIdFromNavTrees(): number | null {
  const fnc = (globalThis as any).FocusNavController;
  if (!fnc) return null;

  const trees: any[] = fnc.m_ActiveContext?.m_rgGamepadNavigationTrees ?? [];
  for (const tree of trees) {
    const el: HTMLElement | null = tree.m_lastFocusNode?.m_element ?? null;
    if (!el) continue;
    const appId = extractAppIdFromElement(el);
    if (appId) return appId;
  }
  return null;
}

function extractAppIdFromElement(el: HTMLElement): number | null {
  // Walk self + ancestors up to 10 levels.
  // querySelectorAll("img") is blocked across browsing contexts so we use
  // outerHTML regex matching instead -- outerHTML IS readable cross-frame.
  let cur: HTMLElement | null = el;
  for (let i = 0; i < 10 && cur; i++) {
    // data-appid attribute (direct, no cross-frame issue)
    const raw = cur.getAttribute?.('data-appid') ?? cur.getAttribute?.('data-app-id');
    if (raw) {
      const id = parseInt(raw, 10);
      if (id > 0) return id;
    }

    // Store CDN URL embedded in the element's HTML: /steam/apps/<id>/
    try {
      const html: string = cur.outerHTML ?? '';
      const m = html.match(/steam\/apps\/(\d+)\//);
      if (m) return parseInt(m[1], 10);
    } catch { /* ignore cross-frame errors */ }

    cur = cur.parentElement;
  }
  return null;
}

// ── hint element ─────────────────────────────────────────────────────────────

function ensureHint(): HTMLElement {
  const targetDoc = getBpmDocument();
  if (_hintEl && targetDoc.contains(_hintEl)) return _hintEl;

  const el = targetDoc.createElement('button');
  el.id = HINT_ID;
  el.type = 'button';
  // Centered in the bottom bar, matching Steam's hint bar height and style.
  // True native injection into Steam's FooterLegend requires afterPatch on Steam's
  // search tile component (which needs internal component name knowledge), so the
  // overlay approach is used instead.
  el.style.cssText = [
    'position:fixed',
    'bottom:0',
    'left:50%',
    'transform:translateX(-50%)',
    'display:none',
    'align-items:center',
    'gap:8px',
    'padding:0 14px',
    'height:36px',
    'border:none',
    'background:transparent',
    'color:rgba(255,255,255,0.92)',
    'font-size:13px',
    'font-family:inherit',
    'cursor:pointer',
    'z-index:99998',
    'pointer-events:auto',
  ].join(';');

  // Pill-shaped Y glyph matching Steam's native A/B button style
  el.innerHTML = [
    '<span aria-hidden="true" style="',
      'display:inline-flex;align-items:center;justify-content:center;',
      'width:22px;height:22px;border-radius:50%;',
      'border:2px solid rgba(255,255,255,0.75);',
      'font-size:12px;font-weight:700;flex:0 0 auto;',
    '">Y</span>',
    `<span>${t().common.showProtonInfo}</span>`,
  ].join('');

  el.addEventListener('click', triggerHintAction);
  _hintEl = el;
  targetDoc.body.appendChild(el);
  return el;
}

function showHint(appId: number) {
  _focusedAppId = appId;
  ensureHint().style.display = 'flex';
}

function hideHint() {
  _focusedAppId = null;
  if (_hintEl) _hintEl.style.display = 'none';
}

// ── action ───────────────────────────────────────────────────────────────────

function triggerHintAction() {
  const appId = _focusedAppId;
  if (!appId) return;
  void logFrontendEvent('DEBUG', 'searchResultsHint: opening manage for app', { appId });
  hideHint();
  rememberReturnPath(globalThis.location?.pathname);
  dispatchNavigate({ tab: 'manage-game', appId, appName: '' });
  try { Navigation.Navigate('/proton-pulse'); } catch { /* fallback */ }
}

// ── poll + button hooks ───────────────────────────────────────────────────────

function pollFocus() {
  if (!isOnSearchRoute()) { hideHint(); return; }
  // Hide while the on-screen keyboard is active (text input focused in BPM doc)
  const bpmDoc = getBpmDocument();
  const active = bpmDoc.activeElement;
  const tag = (active as HTMLElement)?.tagName ?? '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (active as HTMLElement)?.isContentEditable) {
    hideHint();
    return;
  }
  const appId = getAppIdFromNavTrees();
  if (appId) showHint(appId);
  else hideHint();
}

function onButtonDown(eButton: number) {
  void logFrontendEvent('DEBUG', 'searchResultsHint: btnDown', { b: eButton, appId: _focusedAppId });
  // Y button = EButton 4 in Steam's internal enum (B=1, X=3, Y=4 confirmed empirically)
  if (eButton === 4 && _focusedAppId) {
    if (!_yWasDown) { _yWasDown = true; triggerHintAction(); }
  } else { _yWasDown = false; }
}

function onButtonUp(eButton: number) {
  if (eButton === 4) _yWasDown = false;
}

export function setupSearchResultsHint() {
  const fnc = (globalThis as any).FocusNavController;
  if (!fnc) {
    void logFrontendEvent('DEBUG', 'searchResultsHint: FocusNavController not found, skipping');
    return;
  }

  // Poll every 200ms -- more robust than hooking m_ActiveContext which changes on navigation
  _pollInterval = setInterval(pollFocus, 200);

  // Hook button down/up on all gamepad input sources (these live on FNC directly, not m_ActiveContext)
  const sources: any[] = fnc.m_rgGamepadInputSources ?? [];
  for (const source of sources) {
    if (source?.m_ButtonDownCallbacks?.m_vecCallbacks) {
      const cb = (btn: number) => onButtonDown(btn);
      source.m_ButtonDownCallbacks.m_vecCallbacks.push(cb);
      _buttonCbs.push({ source, cb });
    }
    if (source?.m_ButtonUpCallbacks?.m_vecCallbacks) {
      const cb = (btn: number) => onButtonUp(btn);
      source.m_ButtonUpCallbacks.m_vecCallbacks.push(cb);
      _buttonCbs.push({ source, cb });
    }
  }

  void logFrontendEvent('DEBUG', 'searchResultsHint: setup complete', {
    sourcesHooked: sources.length,
    polling: true,
  });
}

export function teardownSearchResultsHint() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }

  // Remove button callbacks
  for (const { source, cb } of _buttonCbs) {
    for (const key of ['m_ButtonDownCallbacks', 'm_ButtonUpCallbacks']) {
      const vec = source?.[key]?.m_vecCallbacks;
      if (!vec) continue;
      const idx = vec.indexOf(cb);
      if (idx !== -1) vec.splice(idx, 1);
    }
  }
  _buttonCbs = [];

  if (_hintEl) { try { _hintEl.remove(); } catch { /* ignore */ } _hintEl = null; }
  _bpmDocCache = null;
  _focusedAppId = null;
  _yWasDown = false;
}
