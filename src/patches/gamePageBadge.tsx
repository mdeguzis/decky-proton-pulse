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

const BADGE_ID = 'proton-pulse-game-badge';

function BadgeIcon({ appId }: { appId: number }) {
  return (
    <div
      id={BADGE_ID}
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

/**
 * Find the InnerContainer node in the React tree.
 *
 * Strategy 1: use appDetailsClasses.InnerContainer (original protondb-decky approach).
 * Strategy 2: fall back to matching any node whose className contains "InnerContainer".
 *
 * Steam client updates can break the class-module lookup that backs
 * appDetailsClasses, so the fallback keeps the badge working even when
 * the module fingerprint changes.
 */
function findContainer(ret: ReactElement | undefined) {
  const innerClass = appDetailsClasses?.InnerContainer;

  // Strategy 1 — exact class from module map
  if (innerClass) {
    const node = findInReactTree(
      ret,
      (x: any) =>
        Array.isArray(x?.props?.children) &&
        typeof x?.props?.className === 'string' &&
        x.props.className.includes(innerClass),
    );
    if (node) return node;
  }

  // Strategy 2 — fuzzy match on "InnerContainer" substring
  const node = findInReactTree(
    ret,
    (x: any) =>
      Array.isArray(x?.props?.children) &&
      typeof x?.props?.className === 'string' &&
      x.props.className.includes('InnerContainer'),
  );
  if (node) {
    console.log(
      '[ProtonPulse] gamePageBadge: appDetailsClasses lookup missed, fell back to fuzzy match',
    );
  }
  return node;
}

export function patchGamePageBadge(): ReturnType<typeof routerHook.addPatch> {
  return routerHook.addPatch(
    '/library/app/:appid',
    (tree: any) => {
      const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
      if (!routeProps) {
        console.warn('[ProtonPulse] gamePageBadge: renderFunc not found in tree');
        return tree;
      }

      const patchHandler = createReactTreePatcher(
        [
          (tree: any) => {
            // Strategy 1: original protondb-decky selector
            const overviewNode = findInReactTree(
              tree,
              (x: any) => x?.props?.children?.props?.overview,
            );
            if (overviewNode) return overviewNode.props.children;

            // Strategy 2: find any node with an `appid` prop (common in newer Steam builds)
            const appidNode = findInReactTree(
              tree,
              (x: any) => x?.props?.appid !== undefined && x?.props?.children,
            );
            if (appidNode) {
              console.log(
                '[ProtonPulse] gamePageBadge: overview selector missed, fell back to appid node',
              );
              return appidNode.props.children;
            }

            console.warn('[ProtonPulse] gamePageBadge: no suitable tree entry point found');
            return undefined;
          },
        ],
        (_: Array<unknown>, ret?: ReactElement) => {
          if (!getSetting('showGamePageBadge', false)) return ret;

          const container = findContainer(ret);
          if (typeof container !== 'object') {
            console.warn('[ProtonPulse] gamePageBadge: InnerContainer not found');
            return ret;
          }

          const appId = parseInt(
            globalThis.location?.pathname?.match(/\/library\/app\/(\d+)/)?.[1] ?? '0',
            10,
          );
          if (!appId) return ret;

          // Prevent duplicate injection
          const children = container.props.children as any[];
          if (children.some((c: any) => c?.props?.id === BADGE_ID)) return ret;

          children.splice(1, 0, <BadgeIcon appId={appId} />);
          return ret;
        },
      );

      afterPatch(routeProps, 'renderFunc', patchHandler);
      return tree;
    },
  );
}
