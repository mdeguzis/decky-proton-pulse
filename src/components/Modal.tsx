// src/components/Modal.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { SidebarNavigation, Focusable, Navigation, Router } from '@decky/ui';
import type { SidebarNavigationPage } from '@decky/ui';
import { callable } from '@decky/api';
import { LoggingErrorBoundary } from './LoggingErrorBoundary';
import { pageState, NAVIGATE_EVENT, normalizeDeckRoutePath, toNavigationPath } from '../lib/pageState';
import type { NavigatePayload, PageId } from '../lib/pageState';
import { toaster } from '../lib/notify';
import type { SystemInfo } from '../types';
import { ConfigureTab } from './tabs/ConfigureTab';
import { ManageTab } from './tabs/ManageTab';
import { LogsTab } from './tabs/LogsTab';
import { CompatibilityToolsTab } from './tabs/CompatibilityToolsTab';
import { GeneralSettingsTab } from './tabs/GeneralSettingsTab';
import { AboutTab } from './tabs/AboutTab';
import { SystemRequirementsTab } from './tabs/SystemRequirementsTab';
import { logFrontendEvent, callWithTimeout } from '../lib/logger';
import { useLanguage, t } from '../lib/i18n';
import { getSetting } from '../lib/settings';
import { registerScreenshotPageAutomation } from '../lib/screenshotAutomation';

const getSystemInfo = callable<[], SystemInfo>('get_system_info');
const getSystemInfoSafe = () => callWithTimeout(() => getSystemInfo(), 'get_system_info');
const DEFAULT_EXIT_PATH = '/routes/library/home';

export function ProtonPulsePage() {
  useLanguage(); // triggers re-render on language change
  const extras = t().extras!;
  const [activePage, setActivePage] = useState<string>(pageState.initialPage);
  const [appId, setAppId]           = useState<number | null>(pageState.appId);
  const [appName, setAppName]       = useState<string>(pageState.appName);
  const [sysInfo, setSysInfo]       = useState<SystemInfo | null>(null);

  const [backendError, setBackendError] = useState<string | null>(null);
  const appliedPendingVersionRef = useRef(pageState.pendingNavigateVersion);

  const applyNavigation = useCallback((payload: NavigatePayload) => {
    setAppId(payload.appId);
    setAppName(payload.appName);
    setActivePage(payload.tab);
  }, []);

  useEffect(() => {
    getSystemInfoSafe()
      .then((info) => {
        void logFrontendEvent('INFO', 'System info loaded', {
          gpuVendor: info.gpu_vendor,
          kernel: info.kernel,
        });
        setSysInfo(info);
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        void logFrontendEvent('ERROR', 'Failed to load system info', { error: msg });
        setBackendError(msg);
      });
  }, []);

  // React to re-navigation while the component is already mounted.
  useEffect(() => {
    const handler = (e: Event) => {
      const { tab, appId: id, appName: name } = (e as CustomEvent<NavigatePayload>).detail;
      void logFrontendEvent('DEBUG', 'Navigation event received', { tab, appId: id, appName: name });
      appliedPendingVersionRef.current = pageState.pendingNavigateVersion;
      applyNavigation({ tab, appId: id, appName: name });
    };
    window.addEventListener(NAVIGATE_EVENT, handler);
    return () => window.removeEventListener(NAVIGATE_EVENT, handler);
  }, [applyNavigation]);

  useEffect(() => {
    const syncPendingNavigation = () => {
      if (!globalThis.location?.pathname?.includes('/proton-pulse')) return;
      if (!pageState.pendingNavigate) return;
      if (appliedPendingVersionRef.current === pageState.pendingNavigateVersion) return;

      appliedPendingVersionRef.current = pageState.pendingNavigateVersion;
      void logFrontendEvent('DEBUG', 'Pending navigation applied from page state', {
        ...pageState.pendingNavigate,
        pendingNavigateVersion: pageState.pendingNavigateVersion,
      });
      applyNavigation(pageState.pendingNavigate);
    };

    syncPendingNavigation();
    const interval = window.setInterval(syncPendingNavigation, 150);
    return () => window.clearInterval(interval);
  }, [applyNavigation]);

  // If the game-specific page is active but appId is cleared, fall back to Manage.
  useEffect(() => {
    if (!appId && activePage === 'manage-game') {
      void logFrontendEvent('WARNING', 'Manage This Game page lost app context; falling back to Manage');
      setActivePage('manage');
    }
  }, [appId, activePage]);

  // double-B to exit: first B shows toast, second B within 3s actually exits
  const exitPendingRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doExit = useCallback(() => {
    exitPendingRef.current = false;
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    const returnPath = pageState.returnPath;
    const currentPath = normalizeDeckRoutePath(globalThis.location?.pathname ?? null);
    const targetPath = returnPath && returnPath !== currentPath
      ? returnPath
      : DEFAULT_EXIT_PATH;
    const navigationTargetPath = toNavigationPath(targetPath);

    pageState.returnPath = null;
    pageState.pendingNavigate = null;

    void logFrontendEvent('INFO', 'Exiting Proton Pulse page', {
      currentPath,
      targetPath,
      hadReturnPath: Boolean(returnPath),
    });

    Router.CloseSideMenus();
    void logFrontendEvent('DEBUG', 'Exit step: Router.CloseSideMenus()', {
      currentPath: normalizeDeckRoutePath(globalThis.location?.pathname ?? null),
    });
    // NavigateBack pops the proton-pulse entry from history rather than pushing
    // a new one, which prevents B on the return page looping back here.
    window.setTimeout(() => {
      if (!globalThis.location?.pathname?.includes('/proton-pulse')) return;
      void logFrontendEvent('DEBUG', 'Exit step: NavigateBack', {
        currentPath: normalizeDeckRoutePath(globalThis.location?.pathname ?? null),
        targetPath,
      });
      try {
        Navigation.NavigateBack();
      } catch {
        Router.Navigate(targetPath);
      }
    }, 50);
    window.setTimeout(() => {
      if (!globalThis.location?.pathname?.includes('/proton-pulse')) return;
      void logFrontendEvent('DEBUG', 'Exit fallback: explicit Navigate', {
        currentPath: normalizeDeckRoutePath(globalThis.location?.pathname ?? null),
        navigationTargetPath,
        targetPath,
      });
      try {
        if (navigationTargetPath) {
          Navigation.Navigate(navigationTargetPath);
        } else {
          Router.Navigate(targetPath);
        }
      } catch {
        Router.Navigate(targetPath);
      }
    }, 200);
  }, []);

  const handleCancel = useCallback(() => {
    if (!getSetting('doubleBToExit', false)) {
      doExit();
      return;
    }
    if (exitPendingRef.current) {
      void logFrontendEvent('DEBUG', 'Exit confirmation accepted', {
        currentPath: globalThis.location?.pathname ?? null,
      });
      doExit();
      return;
    }
    exitPendingRef.current = true;
    void logFrontendEvent('DEBUG', 'Exit confirmation requested', {
      currentPath: globalThis.location?.pathname ?? null,
      activePage,
    });
    toaster.toast({ title: 'Proton Pulse', body: extras.pressBackAgainToExit(), duration: 3000 });
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => { exitPendingRef.current = false; }, 3000);
  }, [activePage, doExit, extras]);

  useEffect(() => {
    pageState.initialPage = activePage as typeof pageState.initialPage;
  }, [activePage]);

  useEffect(() => registerScreenshotPageAutomation(
    async (payload) => {
      void logFrontendEvent('DEBUG', 'Screenshot automation page navigation requested', payload);
      appliedPendingVersionRef.current = pageState.pendingNavigateVersion;
      applyNavigation(payload);
      void logFrontendEvent('DEBUG', 'Screenshot automation page navigation state set', {
        requestedTab: payload.tab,
        appId: payload.appId,
        appName: payload.appName,
        pathname: globalThis.location?.pathname ?? null,
      });
    },
    () => activePage as PageId,
  ), [activePage, applyNavigation]);

  // cleanup timer on unmount
  useEffect(() => () => { if (exitTimerRef.current) clearTimeout(exitTimerRef.current); }, []);

  const hasGame = !!appId;

  const pages: (SidebarNavigationPage | 'separator')[] = [
    ...(hasGame ? [{
      title: t().nav.manageThisGame,
      identifier: 'manage-game',
      route: 'manage-game',
      content: (
        <ConfigureTab
          appId={appId}
          appName={appName}
          sysInfo={sysInfo}
        />
      ),
    }, {
      title: t().nav.systemRequirements,
      identifier: 'system-requirements',
      route: 'system-requirements',
      content: (
        <SystemRequirementsTab
          appId={appId}
          appName={appName ?? ''}
          sysInfo={sysInfo}
        />
      ),
    }] : []),
    {
      title: t().nav.manageConfigurations,
      identifier: 'manage',
      route: 'manage',
      content: <LoggingErrorBoundary name="ManageTab"><ManageTab appId={appId} appName={appName} gpuVendor={sysInfo?.gpu_vendor ?? null} sysInfo={sysInfo} /></LoggingErrorBoundary>,
    },
    {
      title: t().nav.compatibilityTools,
      identifier: 'compatibility-tools',
      route: 'compatibility-tools',
      content: <LoggingErrorBoundary name="CompatibilityTools"><CompatibilityToolsTab /></LoggingErrorBoundary>,
    },
    {
      title: t().nav.logs,
      identifier: 'logs',
      route: 'logs',
      content: <LoggingErrorBoundary name="Logs"><LogsTab /></LoggingErrorBoundary>,
    },
    {
      title: t().nav.settings,
      identifier: 'settings',
      route: 'settings',
      content: <LoggingErrorBoundary name="Settings"><GeneralSettingsTab /></LoggingErrorBoundary>,
    },
    {
      title: t().nav.about,
      identifier: 'about',
      route: 'about',
      content: <LoggingErrorBoundary name="About"><AboutTab /></LoggingErrorBoundary>,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {backendError && (
        <div style={{
          background: '#4a1c1c',
          border: '1px solid #8b3030',
          borderRadius: 6,
          padding: '8px 14px',
          margin: '0 0 8px',
          fontSize: 11,
          color: '#f4c6c6',
          lineHeight: 1.5,
        }}>
          <strong>{extras.backendUnavailableTitle()}</strong> {backendError}
          <div style={{ fontSize: 10, color: '#c09090', marginTop: 4 }}>
            {extras.backendUnavailableHint()}
          </div>
        </div>
      )}
      <Focusable
        onCancelButton={handleCancel}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <SidebarNavigation
          title="Proton Pulse"
          showTitle={false}
          pages={pages}
          page={activePage}
          onPageRequested={(page) => {
            void logFrontendEvent('DEBUG', 'Sidebar page requested', {
              requestedPage: typeof page === 'string' ? page : null,
              appId,
              appName,
            });
            if (typeof page !== 'string') return;
            if (!pages.some((entry) => entry !== 'separator' && entry.route === page)) return;
            setActivePage(page);
          }}
          disableRouteReporting={true}
        />
      </Focusable>
    </div>
  );
}
