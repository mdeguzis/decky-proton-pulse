// src/patches/gamePageBadge.tsx
// Injects a Proton Pulse icon badge into the game library page header.
// Pattern adapted from protondb-decky by OMGDuke (MIT):
// https://github.com/OMGDuke/protondb-decky
import {
  afterPatch,
  findInReactTree,
  appDetailsClasses,
  createReactTreePatcher,
  Navigation,
} from '@decky/ui';
import { routerHook } from '@decky/api';
import type { ReactElement } from 'react';
import { BrandGlyph } from '../components/BrandGlyph';
import { dispatchNavigate, rememberReturnPath } from '../lib/pageState';
import { getSetting } from '../lib/settings';

function BadgeIcon({ appId }: { appId: number }) {
  return (
    <div
      title="Proton Pulse"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: '4px',
        opacity: 0.85,
      }}
      onClick={() => {
        const appName =
          (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(appId)?.display_name ?? '';
        rememberReturnPath(globalThis.location?.pathname);
        dispatchNavigate({ tab: 'manage-game', appId, appName });
        try {
          Navigation.Navigate('/proton-pulse');
        } catch {
          // fallback
        }
      }}
    >
      <BrandGlyph size={24} />
    </div>
  );
}

export function patchGamePageBadge(): ReturnType<typeof routerHook.addPatch> {
  return routerHook.addPatch(
    '/library/app/:appid',
    (tree: any) => {
      const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
      if (!routeProps) return tree;

      const patchHandler = createReactTreePatcher(
        [
          (tree: any) =>
            findInReactTree(tree, (x: any) => x?.props?.children?.props?.overview)
              ?.props?.children,
        ],
        (_: Array<unknown>, ret?: ReactElement) => {
          // Hot-toggle: read setting on every render so toggling takes effect immediately
          if (!getSetting('showGamePageBadge', false)) return ret;

          const container = findInReactTree(
            ret,
            (x: ReactElement & { props?: { children?: unknown; className?: string } }) =>
              Array.isArray(x?.props?.children) &&
              x?.props?.className?.includes(appDetailsClasses.InnerContainer) === true,
          );
          if (typeof container !== 'object') return ret;

          const appId = parseInt(
            globalThis.location?.pathname?.match(/\/library\/app\/(\d+)/)?.[1] ?? '0',
            10,
          );
          if (!appId) return ret;

          container.props.children.splice(1, 0, <BadgeIcon appId={appId} />);
          return ret;
        },
      );

      afterPatch(routeProps, 'renderFunc', patchHandler);
      return tree;
    },
  );
}
