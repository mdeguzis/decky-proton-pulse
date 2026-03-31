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

const injectMenuItem = (items: any[], appid: number): void => {
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
        const appName =
          (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(appid)?.display_name ?? '';
        pageState.initialPage = 'configure';
        pageState.appId = appid;
        pageState.appName = appName;
        dispatchNavigate({ tab: 'configure', appId: appid, appName });
        Navigation.Navigate('/proton-pulse');
      }}
    >
      Proton Pulse…
    </MenuItem>
  );
};

const resolveAppId = (component: any, fallback: number): number => {
  // Primary: component owner props (most Steam versions)
  if (component?._owner?.pendingProps?.overview?.appid) {
    return component._owner.pendingProps.overview.appid;
  }
  // Fallback: tree walk for Oct 2025+ client
  const found = findInTree(
    component?.props?.children,
    (x: any) => x?.app?.appid,
    { walkable: ['props', 'children'] }
  );
  return found?.app?.appid ?? fallback;
};

const patchMenuItems = (items: any[], appid: number): void => {
  // Correct for stale cached appid
  let resolvedId = appid;
  const parentOverview = items.find(
    (x: any) => x?._owner?.pendingProps?.overview?.appid &&
      x._owner.pendingProps.overview.appid !== appid
  );
  if (parentOverview) {
    resolvedId = parentOverview._owner.pendingProps.overview.appid;
  } else {
    const found = findInTree(items, (x: any) => x?.app?.appid, {
      walkable: ['props', 'children'],
    });
    if (found) resolvedId = found.app.appid;
  }
  injectMenuItem(items, resolvedId);
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
      const appid: number = resolveAppId(component, 0);

      if (!patches.inner) {
        patches.inner = afterPatch(component, 'type', (_: any, ret: any) => {
          afterPatch(ret.type.prototype, 'render', (_: any, ret2: any) => {
            const menuItems = ret2.props.children[0];
            if (!isGameContextMenu(menuItems)) return ret2;
            try { removeDupe(menuItems); } catch { return ret2; }
            patchMenuItems(menuItems, appid);
            return ret2;
          });

          afterPatch(ret.type.prototype, 'shouldComponentUpdate', ([nextProps]: any, shouldUpdate: any) => {
            try { removeDupe(nextProps.children); } catch { return shouldUpdate; }
            if (shouldUpdate === true) patchMenuItems(nextProps.children, appid);
            return shouldUpdate;
          });

          return ret;
        });
      } else {
        // Subsequent renders — splice directly
        if (component.props?.children && appid) {
          try { removeDupe(component.props.children); } catch { /* ignore */ }
          injectMenuItem(component.props.children, appid);
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
