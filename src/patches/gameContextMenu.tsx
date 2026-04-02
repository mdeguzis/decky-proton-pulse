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

const resolveAppIdFromRoute = (): number => {
  const pathname = globalThis.location?.pathname ?? '';
  const match = pathname.match(/\/library\/app\/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

const resolveAppIdFromItems = (items: any[]): number => {
  for (const item of items) {
    const ownerAppId = item?._owner?.pendingProps?.overview?.appid;
    if (typeof ownerAppId === 'number' && ownerAppId > 0) return ownerAppId;
  }

  const overview = findInTree(
    items,
    (x: any) => typeof x?.overview?.appid === 'number' && x.overview.appid > 0,
    { walkable: ['_owner', 'pendingProps', 'props', 'children'] }
  );
  if (typeof overview?.overview?.appid === 'number') return overview.overview.appid;

  const app = findInTree(
    items,
    (x: any) => typeof x?.app?.appid === 'number' && x.app.appid > 0,
    { walkable: ['props', 'children'] }
  );
  if (typeof app?.app?.appid === 'number') return app.app.appid;

  return 0;
};

const injectMenuItem = (items: any[]): void => {
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
        const routeAppId = resolveAppIdFromRoute();
        const treeAppId = resolveAppIdFromItems(items);
        const appid = routeAppId || treeAppId;
        const appName =
          (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(appid)?.display_name ?? '';
        if (!appid) {
          void logFrontendEvent('WARNING', 'Game context menu selection missing app id');
          return;
        }
        void logFrontendEvent('INFO', 'Game context menu selected', {
          appId: appid,
          appName,
          routeAppId: routeAppId || null,
          treeAppId: treeAppId || null,
          pathname: globalThis.location?.pathname ?? '',
        });
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

const patchMenuItems = (items: any[]): void => {
  injectMenuItem(items);
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
      if (!patches.inner) {
        patches.inner = afterPatch(component, 'type', (_: any, ret: any) => {
          afterPatch(ret.type.prototype, 'render', (_: any, ret2: any) => {
            const menuItems = ret2.props.children[0];
            if (!isGameContextMenu(menuItems)) return ret2;
            try { removeDupe(menuItems); } catch { return ret2; }
            patchMenuItems(menuItems);
            return ret2;
          });

          afterPatch(ret.type.prototype, 'shouldComponentUpdate', ([nextProps]: any, shouldUpdate: any) => {
            try { removeDupe(nextProps.children); } catch { return shouldUpdate; }
            if (shouldUpdate === true) patchMenuItems(nextProps.children);
            return shouldUpdate;
          });

          return ret;
        });
      } else {
        // Subsequent renders — splice directly
        if (component.props?.children) {
          try { removeDupe(component.props.children); } catch { /* ignore */ }
          injectMenuItem(component.props.children);
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
