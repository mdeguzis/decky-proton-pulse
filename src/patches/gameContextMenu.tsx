// src/patches/gameContextMenu.tsx
// Injects a "Proton Pulse…" menu item into the game library context menu,
// following the same pattern used by decky-steamgriddb.
import {
  afterPatch,
  fakeRenderComponent,
  findInReactTree,
  findInTree,
  findModuleByExport,
  MenuItem,
  Navigation,
  Patch,
} from '@decky/ui';
import type { FC } from 'react';
import type { Export } from '@decky/ui';
import { pageState, dispatchNavigate } from '../lib/pageState';
import { logFrontendEvent } from '../lib/logger';

// ─── Find Steam's LibraryContextMenu component ────────────────────────────────

export const LibraryContextMenu: any = fakeRenderComponent(
  (Object.values(
    findModuleByExport(
      (e: Export) => e?.toString && e.toString().includes('().LibraryContextMenu')
    )
  ) as any[]).find((sibling: any) =>
    sibling?.toString().includes('navigator:')
  ) as FC
).type;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Only patch the game library context menu, not screenshot or other menus.
const isGameContextMenu = (items: any[]): boolean => {
  if (!items?.length) return false;
  return !!findInReactTree(
    items,
    (x: any) => x?.props?.onSelected &&
      x.props.onSelected.toString().includes('launchSource')
  );
};

// Remove stale injected item to prevent duplicates on re-renders.
const removeDupe = (items: any[]): void => {
  const idx = items.findIndex((x: any) => x?.key === 'proton-pulse-configure');
  if (idx !== -1) items.splice(idx, 1);
};

const summarizeAppLike = (value: any): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null;
  const summary: Record<string, unknown> = {};
  const keys = [
    'appid',
    'display_name',
    'sort_as',
    'selected_clientid',
    'clientid',
    'gameid',
    'parent_appid',
    'base_appid',
    'icon_hash',
    'library_capsule',
    'is_installing',
    'third_party_mod',
  ];
  for (const key of keys) {
    if (key in value) summary[key] = value[key];
  }
  if (typeof value.BIsShortcut === 'function') {
    try {
      summary.is_shortcut = value.BIsShortcut();
    } catch {
      // ignore helper failures
    }
  }
  return Object.keys(summary).length ? summary : null;
};

const flattenInterestingFields = (
  value: any,
  prefix = '',
  depth = 0,
  out: Record<string, unknown> = {}
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || depth > 2) return out;
  for (const [rawKey, rawVal] of Object.entries(value)) {
    const key = String(rawKey);
    const path = prefix ? `${prefix}.${key}` : key;
    const lowered = key.toLowerCase();
    const interesting =
      lowered.includes('appid') ||
      lowered.includes('app_id') ||
      lowered.includes('gameid') ||
      lowered.includes('parent') ||
      lowered.includes('base') ||
      lowered.includes('canon') ||
      lowered.includes('launch') ||
      lowered.includes('shortcut');

    if (
      interesting &&
      (typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean')
    ) {
      out[path] = rawVal;
      continue;
    }

    if (rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
      flattenInterestingFields(rawVal, path, depth + 1, out);
    }
  }
  return out;
};

const probeSteamAppDetails = async (appid: number): Promise<void> => {
  const steamApps = (globalThis as any).SteamClient?.Apps;
  if (!steamApps?.RegisterForAppDetails) {
    await logFrontendEvent('DEBUG', 'Steam app details probe unavailable', { appId: appid });
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let unregister = () => {};

    const finish = async (context: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      try {
        unregister();
      } catch {
        // ignore unregister failures
      }
      await logFrontendEvent('DEBUG', 'Steam app details probe result', {
        appId: appid,
        ...context,
      });
      resolve();
    };

    try {
      const registration = steamApps.RegisterForAppDetails(appid, (details: any) => {
        void finish({
          topLevelKeys: details && typeof details === 'object' ? Object.keys(details).slice(0, 40) : [],
          interestingFields: flattenInterestingFields(details),
        });
      });
      unregister = registration?.unregister ?? (() => {});
      timeoutId = setTimeout(() => {
        void finish({ timedOut: true });
      }, 500);
    } catch (error) {
      void finish({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

const summarizeContext = (component: any, items: any[]): Record<string, unknown> => {
  const outerOverview = component?._owner?.pendingProps?.overview ?? null;
  const itemOverview = findInTree(
    items,
    (x: any) => x?.overview && typeof x.overview === 'object',
    { walkable: ['_owner', 'pendingProps', 'props', 'children'] }
  )?.overview;
  const itemApp = findInTree(
    items,
    (x: any) => x?.app && typeof x.app === 'object',
    { walkable: ['props', 'children'] }
  )?.app;

  return {
    outerOverview: summarizeAppLike(outerOverview),
    itemOverview: summarizeAppLike(itemOverview),
    itemApp: summarizeAppLike(itemApp),
  };
};

const resolveAppIdFromRoute = (): number => {
  const pathname = globalThis.location?.pathname ?? '';
  const match = pathname.match(/\/(?:routes\/)?library\/app\/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

const resolveAppIdFromItems = (items: any[], appid: number): number => {
  let updatedAppId = appid;

  const parentOverview = items.find(
    (item: any) =>
      item?._owner?.pendingProps?.overview?.appid &&
      item._owner.pendingProps.overview.appid !== appid
  );
  if (parentOverview?._owner?.pendingProps?.overview?.appid) {
    updatedAppId = parentOverview._owner.pendingProps.overview.appid;
  }

  if (updatedAppId === appid) {
    const app = findInTree(
      items,
      (x: any) => typeof x?.app?.appid === 'number' && x.app.appid > 0,
      { walkable: ['props', 'children'] }
    );
    if (typeof app?.app?.appid === 'number') {
      updatedAppId = app.app.appid;
    }
  }

  return updatedAppId;
};

const resolveInitialAppId = (component: any): number => {
  const ownerAppId = component?._owner?.pendingProps?.overview?.appid;
  if (typeof ownerAppId === 'number' && ownerAppId > 0) return ownerAppId;

  const foundApp = findInTree(
    component?.props?.children,
    (x: any) => typeof x?.app?.appid === 'number' && x.app.appid > 0,
    { walkable: ['props', 'children'] }
  );
  if (typeof foundApp?.app?.appid === 'number') return foundApp.app.appid;

  return 0;
};

const injectMenuItem = (
  items: any[],
  initialAppId: number,
  contextSummary: Record<string, unknown>
): void => {
  // Insert before "Properties…" to match SteamGridDB position.
  const propertiesIdx = items.findIndex((item: any) =>
    findInReactTree(
      item,
      (x: any) => x?.onSelected && x.onSelected.toString().includes('AppProperties')
    )
  );
  const insertAt = propertiesIdx !== -1 ? propertiesIdx : items.length;

  items.splice(insertAt, 0,
    <MenuItem
      key="proton-pulse-configure"
      onSelected={() => {
        const focusedAppId = pageState.focusedAppId ?? 0;
        const focusedAppName = pageState.focusedAppName ?? '';
        const routeAppId = resolveAppIdFromRoute();
        const treeAppId = resolveAppIdFromItems(items, initialAppId);
        const appid = treeAppId || focusedAppId || routeAppId || initialAppId;
        const steamOverview =
          (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(appid) ?? null;
        const lookedUpAppName =
          steamOverview?.display_name ?? '';
        const appName =
          focusedAppName || lookedUpAppName;
        if (!appid) {
          void logFrontendEvent('WARNING', 'Game context menu selection missing app id');
          return;
        }
        void logFrontendEvent('INFO', 'Game context menu selected', {
          appId: appid,
          appName,
          initialAppId: initialAppId || null,
          focusedAppId: focusedAppId || null,
          routeAppId: routeAppId || null,
          treeAppId: treeAppId || null,
          pathname: globalThis.location?.pathname ?? '',
          steamOverview: summarizeAppLike(steamOverview),
          ...contextSummary,
        });
        void probeSteamAppDetails(appid);
        pageState.initialPage = 'manage-game';
        pageState.appId = appid;
        pageState.appName = appName;
        dispatchNavigate({ tab: 'manage-game', appId: appid, appName });
        Navigation.Navigate('/proton-pulse');
      }}
    >
      ProtonDB Config
    </MenuItem>
  );
};

const patchMenuItems = (
  component: any,
  items: any[],
  initialAppId: number
): void => {
  injectMenuItem(items, initialAppId, summarizeContext(component, items));
};

// ─── Patch factory ────────────────────────────────────────────────────────────

export function patchGameContextMenu(LibraryContextMenuComponent: any): {
  unpatch(): void;
} {
  const patches: { outer?: Patch; inner?: Patch; unpatch(): void } = {
    unpatch: () => { /* filled below */ },
  };

  patches.outer = afterPatch(
    LibraryContextMenuComponent.prototype,
    'render',
    (_: Record<string, unknown>[], component: any) => {
      const initialAppId = resolveInitialAppId(component);
      if (!patches.inner) {
        patches.inner = afterPatch(component, 'type', (_: any, ret: any) => {
          afterPatch(ret.type.prototype, 'render', (_: any, ret2: any) => {
            const menuItems = ret2.props.children[0];
            if (!isGameContextMenu(menuItems)) return ret2;
            try { removeDupe(menuItems); } catch { return ret2; }
            patchMenuItems(component, menuItems, initialAppId);
            return ret2;
          });

          afterPatch(ret.type.prototype, 'shouldComponentUpdate', ([nextProps]: any, shouldUpdate: any) => {
            try { removeDupe(nextProps.children); } catch { return shouldUpdate; }
            if (shouldUpdate === true) patchMenuItems(component, nextProps.children, initialAppId);
            return shouldUpdate;
          });

          return ret;
        });
      } else {
        // Subsequent renders — splice directly
        if (component.props?.children) {
          try { removeDupe(component.props.children); } catch { /* ignore */ }
          injectMenuItem(
            component.props.children,
            initialAppId,
            summarizeContext(component, component.props.children)
          );
        }
      }

      return component;
    }
  );

  patches.unpatch = () => {
    patches.outer?.unpatch();
    patches.inner?.unpatch();
  };

  return patches;
}
