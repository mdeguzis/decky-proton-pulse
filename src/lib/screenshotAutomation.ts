import { Navigation, Router } from '@decky/ui';
import { dispatchNavigate, pageState, toNavigationPath } from './pageState';
import type { PageId } from './pageState';
import { logFrontendEvent } from './logger';
import { getActiveLanguage, normalizeLanguagePreference, setLanguage } from './i18n';

export interface ScreenshotAutomationAction {
  appId?: number | null;
  appName?: string;
  currentLaunchOptions?: string;
  incomingLaunchOptions?: string;
  language?: string;
  profileName?: string;
  protonVersion?: string;
  tab?: PageId;
  target?: string;
  useFocusedApp?: boolean;
  waitMs?: number;
}

type ScreenshotAutomationHandler = (
  action: ScreenshotAutomationAction
) => void | Promise<void>;
type ScreenshotPageNavigator = (
  payload: { tab: PageId; appId: number | null; appName: string }
) => void | Promise<void>;
type ScreenshotPageGetter = () => PageId | null;

interface ScreenshotAutomationBridge {
  run: (action: ScreenshotAutomationAction) => Promise<{
    ok: true;
    pathname: string | null;
    target: string | null;
  }>;
}

declare global {
  interface Window {
    __PROTON_PULSE_SCREENSHOT__?: ScreenshotAutomationBridge;
  }
}

const PLUGIN_ROUTE = '/proton-pulse';
const HANDLER_WAIT_TIMEOUT_MS = 4000;
const ROUTE_WAIT_TIMEOUT_MS = 4000;
const handlers = new Map<string, ScreenshotAutomationHandler>();
let pageNavigator: ScreenshotPageNavigator | null = null;
let currentPageGetter: ScreenshotPageGetter | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs: number,
  label: string,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await delay(intervalMs);
  }
}

function resolveAppContext(action: ScreenshotAutomationAction): {
  appId: number | null;
  appName: string;
} {
  if (action.useFocusedApp) {
    return {
      appId: pageState.focusedAppId,
      appName: pageState.focusedAppName,
    };
  }
  return {
    appId: action.appId ?? null,
    appName: action.appName ?? '',
  };
}

async function resetTransientUiState(): Promise<void> {
  const currentPath = globalThis.location?.pathname ?? null;
  Router.CloseSideMenus();
  if (!currentPath?.includes(PLUGIN_ROUTE)) {
    return;
  }
  try {
    const navigationPath = toNavigationPath('/routes/library/home');
    if (navigationPath) {
      Navigation.Navigate(navigationPath);
    }
    await delay(350);
  } catch {
    // If route navigation fails, continue and let plugin-route opening recover.
  }
}

async function ensurePluginRouteOpen(): Promise<void> {
  const currentPath = globalThis.location?.pathname ?? null;
  void logFrontendEvent('DEBUG', 'Screenshot automation ensuring plugin route', {
    currentPath,
    alreadyOpen: Boolean(currentPath?.includes(PLUGIN_ROUTE)),
  });
  if (currentPath?.includes(PLUGIN_ROUTE)) return;

  Router.CloseSideMenus();
  try {
    Navigation.Navigate(PLUGIN_ROUTE);
  } catch {
    Router.Navigate(PLUGIN_ROUTE);
  }

  await waitFor(
    () => Boolean(globalThis.location?.pathname?.includes(PLUGIN_ROUTE)),
    ROUTE_WAIT_TIMEOUT_MS,
    100,
    'Proton Pulse route',
  );
  void logFrontendEvent('DEBUG', 'Screenshot automation plugin route is open', {
    pathname: globalThis.location?.pathname ?? null,
  });
}

async function waitForHandler(target: string): Promise<ScreenshotAutomationHandler> {
  await waitFor(
    () => handlers.has(target),
    HANDLER_WAIT_TIMEOUT_MS,
    100,
    `screenshot handler "${target}"`,
  );
  return handlers.get(target)!;
}

export async function runRegisteredScreenshotAutomationHandler(
  target: string,
  action: ScreenshotAutomationAction = {},
): Promise<void> {
  const handler = await waitForHandler(target);
  await handler(action);
}

async function runAutomationAction(action: ScreenshotAutomationAction): Promise<{
  ok: true;
  activePage: PageId | null;
  pathname: string | null;
  target: string | null;
}> {
  void logFrontendEvent('DEBUG', 'Screenshot automation action started', {
    action,
    pathname: globalThis.location?.pathname ?? null,
    pageNavigatorReady: Boolean(pageNavigator),
    currentPageGetterReady: Boolean(currentPageGetter),
  });
  await resetTransientUiState();
  const requestedLanguage = normalizeLanguagePreference(action.language ?? null);
  if (requestedLanguage && requestedLanguage !== getActiveLanguage()) {
    setLanguage(requestedLanguage);
    await delay(150);
    void logFrontendEvent('DEBUG', 'Screenshot automation language applied', {
      requestedLanguage,
      activeLanguage: getActiveLanguage(),
    });
  }
  if (action.tab) {
    const { appId, appName } = resolveAppContext(action);
    await ensurePluginRouteOpen();
    const payload = {
      tab: action.tab,
      appId,
      appName,
    };
    if (!pageNavigator || !currentPageGetter) {
      void logFrontendEvent('DEBUG', 'Screenshot automation waiting for mounted page automation', {
        payload,
        pathname: globalThis.location?.pathname ?? null,
      });
      dispatchNavigate(payload);
      await waitFor(
        () => Boolean(pageNavigator && currentPageGetter),
        HANDLER_WAIT_TIMEOUT_MS,
        50,
        'mounted screenshot page automation',
      );
    }
    void logFrontendEvent('DEBUG', 'Screenshot automation applying page navigation', {
      payload,
      pathname: globalThis.location?.pathname ?? null,
    });
    await pageNavigator!(payload);
    await waitFor(
      () => currentPageGetter!() === action.tab,
      HANDLER_WAIT_TIMEOUT_MS,
      50,
      `page "${action.tab}"`,
    );
    void logFrontendEvent('DEBUG', 'Screenshot automation page navigation applied', {
      payload,
      activePage: currentPageGetter!(),
      pathname: globalThis.location?.pathname ?? null,
    });
    await delay(250);
  }

  if (action.target) {
    void logFrontendEvent('DEBUG', 'Screenshot automation waiting for target handler', {
      target: action.target,
      pathname: globalThis.location?.pathname ?? null,
    });
    void logFrontendEvent('DEBUG', 'Screenshot automation invoking target handler', {
      target: action.target,
      pathname: globalThis.location?.pathname ?? null,
    });
    await runRegisteredScreenshotAutomationHandler(action.target, action);
  }

  if (action.waitMs && action.waitMs > 0) {
    await delay(action.waitMs);
  }

  const result: {
    ok: true;
    activePage: PageId | null;
    pathname: string | null;
    target: string | null;
  } = {
    ok: true,
    activePage: currentPageGetter ? currentPageGetter() : pageState.initialPage,
    pathname: globalThis.location?.pathname ?? null,
    target: action.target ?? null,
  };
  void logFrontendEvent('DEBUG', 'Screenshot automation action finished', result);
  return result;
}

export function installScreenshotAutomationBridge(): () => void {
  window.__PROTON_PULSE_SCREENSHOT__ = {
    run: runAutomationAction,
  };

  return () => {
    if (window.__PROTON_PULSE_SCREENSHOT__?.run === runAutomationAction) {
      delete window.__PROTON_PULSE_SCREENSHOT__;
    }
    handlers.clear();
  };
}

export function registerScreenshotAutomationHandler(
  target: string,
  handler: ScreenshotAutomationHandler,
): () => void {
  handlers.set(target, handler);
  return () => {
    const current = handlers.get(target);
    if (current === handler) {
      handlers.delete(target);
    }
  };
}

export function registerScreenshotPageAutomation(
  navigator: ScreenshotPageNavigator,
  getCurrentPage: ScreenshotPageGetter,
): () => void {
  pageNavigator = navigator;
  currentPageGetter = getCurrentPage;
  return () => {
    if (pageNavigator === navigator) {
      pageNavigator = null;
    }
    if (currentPageGetter === getCurrentPage) {
      currentPageGetter = null;
    }
  };
}
