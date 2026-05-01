// src/patches/storePageBadge.tsx
// Detects when the user is viewing a Steam store game page in the embedded browser,
// then injects a floating Proton Pulse badge into the Steam system header bar.
//
// Architecture note: The Steam external browser (NavigateToExternalWeb) renders in a
// separate CEF frame (SharedJSContext) that is inaccessible from the Decky plugin
// context (Steam Big Picture Mode). We detect the current browser URL by polling
// the CEF DevTools endpoint at localhost:8080/json, then inject into the main frame.
//
// SP_REACTDOM in React 19 does not expose createRoot (moved to react-dom/client).
// The badge is therefore rendered as a plain DOM element with no React dependency.
import { Navigation } from '@decky/ui';
import { callable } from '@decky/api';
import { dispatchNavigate, rememberReturnPath } from '../lib/pageState';
import { getSetting } from '../lib/settings';
import { logFrontendEvent } from '../lib/logger';
import { t } from '../lib/i18n';

const BADGE_CONTAINER_ID = 'pp-store-badge-root';
const POLL_INTERVAL_MS = 1500;

const BRAND_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" aria-label="Proton Pulse" role="img" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:0 0 auto"><path d="M12 2l5.2 2.8 2.8 4.5V14.7l-2.8 4.5L12 22l-5.2-2.8L4 14.7V9.3l2.8-4.5z"/><polyline points="6.5,12 8.5,12 10,9.5 12,14.5 14,9.5 15.5,12 17.5,12"/></svg>`;

const _getActiveStoreAppIdBackend = callable<[], number | null>('get_active_store_app_id');

async function getActiveStoreAppId(): Promise<number | null> {
  try {
    return await _getActiveStoreAppIdBackend();
  } catch {
    return null;
  }
}

let _currentAppId: number | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _container: HTMLElement | null = null;
let _btn: HTMLButtonElement | null = null;
let _injectedDoc: Document | null = null;

// SJC's document.body is a 1x1 hidden frame; inject into BPM's visible document instead.
function getBpmDocument(): Document {
  const fnc = (globalThis as any).FocusNavController;
  const trees: any[] = fnc?.m_ActiveContext?.m_rgGamepadNavigationTrees ?? [];
  for (const tree of trees) {
    const el: HTMLElement | null = tree.m_lastFocusNode?.m_element ?? tree.m_root?.m_element ?? null;
    if (el?.ownerDocument && el.ownerDocument !== document) return el.ownerDocument;
  }
  return document;
}

function handleBadgeClick() {
  if (_currentAppId === null) return;
  const appId = _currentAppId;
  void logFrontendEvent('DEBUG', 'storePageBadge: navigating', { appId });
  rememberReturnPath(globalThis.location?.pathname);
  dispatchNavigate({ tab: 'manage-game', appId, appName: '' });
  try {
    Navigation.Navigate('/proton-pulse');
  } catch { /* fallback */ }
}

function updateBadgeVisibility(appId: number | null) {
  if (!_container) return;
  _currentAppId = appId;
  _container.style.display = appId ? 'flex' : 'none';
  if (_btn && appId) {
    _btn.title = t().common.openInProtonPulse;
  }
}

function createBadgeElement(): HTMLElement {
  const container = document.createElement('div');
  container.id = BADGE_CONTAINER_ID;
  container.style.cssText = [
    'position:fixed',
    'top:56px',
    'left:8px',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'z-index:99999',
    'pointer-events:auto',
  ].join(';');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = t().common.openInProtonPulse;
  btn.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'width:32px',
    'height:32px',
    'border-radius:4px',
    'border:none',
    'background:transparent',
    'cursor:pointer',
    'color:white',
    'padding:0',
    'margin-right:4px',
  ].join(';');

  btn.addEventListener('click', handleBadgeClick);
  btn.addEventListener('mouseover', () => { btn.style.background = 'rgba(255,255,255,0.1)'; });
  btn.addEventListener('mouseout', () => { btn.style.background = 'transparent'; });
  btn.innerHTML = BRAND_SVG;

  container.appendChild(btn);
  _btn = btn;
  return container;
}

function injectBadge() {
  if (!getSetting('showStorePageBadge', false)) return;
  const targetDoc = _injectedDoc ?? getBpmDocument();
  if (_container && targetDoc.contains(_container)) return;

  const container = createBadgeElement();
  targetDoc.body.appendChild(container);
  _injectedDoc = targetDoc;
  _container = container;
  void logFrontendEvent('DEBUG', 'storePageBadge: badge injected (plain DOM overlay)');
}

export function setupStorePageBadge() {
  if (_pollTimer !== null) return;

  void logFrontendEvent('DEBUG', 'storePageBadge: setup starting');

  const poll = async () => {
    try {
      injectBadge();
      const id = await getActiveStoreAppId();
      updateBadgeVisibility(id);
    } catch (e) {
      void logFrontendEvent('ERROR', 'storePageBadge: poll error', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  void poll();
  _pollTimer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
}

export function teardownStorePageBadge() {
  if (_pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_container) {
    try { _container.remove(); } catch { /* ignore */ }
    _container = null;
  }
  _btn = null;
  _currentAppId = null;
  _injectedDoc = null;
}
