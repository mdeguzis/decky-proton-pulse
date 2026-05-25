// src/patches/gamePageBadge.tsx
// Injects a Proton Pulse icon badge into the game library page header.
// Pattern adapted from protondb-decky by OMGDuke (MIT):
// https://github.com/OMGDuke/protondb-decky
// Uses createReactTreePatcher to drill through component boundaries so that
// the afterPatch callback receives ret from the inner component that renders
// InnerContainer directly (not the shallow outer renderFunc output).
import {
  afterPatch,
  findInReactTree,
  appDetailsClasses,
  createReactTreePatcher,
  Navigation,
  Focusable,
} from '@decky/ui';
import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { BrandGlyph } from '../components/BrandGlyph';
import { dispatchNavigate, rememberReturnPath } from '../lib/pageState';
import { getSetting } from '../lib/settings';
import { logFrontendEvent } from '../lib/logger';
import { getProtonDBSummary } from '../lib/protondb';
import { RATING_COLORS } from '../lib/reportFormatters';
import { t } from '../lib/i18n';
import { type GameSourceInfo, getGameSource } from '../lib/gameSource';

const SOURCE_COLORS: Record<string, { bg: string; color: string }> = {
  Heroic:      { bg: '#7b3fb5', color: '#f0e0ff' },
  Epic:        { bg: '#2d6da3', color: '#ddf0ff' },
  GOG:         { bg: '#6b4f2a', color: '#ffe8c0' },
  Lutris:      { bg: '#1a5c3a', color: '#c8ffe0' },
  Bottles:     { bg: '#8c3a1a', color: '#ffe8d8' },
  'itch.io':   { bg: '#7a1f3c', color: '#ffd0df' },
  'Non-Steam': { bg: '#3a3a3a', color: '#cccccc' },
};

const TIER_TEXT_COLOR: Record<string, string> = {
  platinum: '#1a1a2e',
  gold: '#1a1a00',
  silver: '#1a1a1a',
  bronze: '#fff',
  borked: '#fff',
  pending: '#fff',
};

const BADGE_ID = 'proton-pulse-game-badge';
const PATCHED_FLAG = '__pp_badge_patched__';


// Map ProtonDB summary (tier + sample count + own confidence string) to a 0-100
// percentage for the badge chip. This is a lightweight cousin of
// aggregatePerGame() that runs without an extra reports fetch - good enough
// for an at-a-glance badge; the full per-report confidence still lives in
// ConfigureTab. Keep the formula here predictable, not a black box
function estimatePerGameConfidence(summary: { total: number; confidence: string } | null): number {
  if (!summary || !summary.total) return 0;
  const stringConf = (summary.confidence || '').toLowerCase();
  let base = 50;
  if (stringConf.includes('strong'))        base = 80;
  else if (stringConf.includes('good'))     base = 70;
  else if (stringConf.includes('moderate')) base = 55;
  else if (stringConf.includes('low'))      base = 35;
  // Sample-size bonus on a log scale (1 report = 0, 10 = ~10, 100 = ~20)
  const sampleBonus = Math.min(20, Math.round(Math.log2(Math.max(1, summary.total)) * 3));
  return Math.max(0, Math.min(100, base + sampleBonus));
}

function confidenceColorRgb(confidence: number): string {
  if (confidence >= 80) return '#4ade80';
  if (confidence >= 60) return '#facc15';
  if (confidence >= 40) return '#fb923c';
  return '#f87171';
}

function BadgeIcon({ appId }: { appId: number }) {
  // pos drives both visibility (null = hidden) and position via React state,
  // so the Focusable's rendered DOM coords are correct when the navmesh scans.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  // Per-game confidence percentage shown alongside the tier badge. Comes from
  // the same summary that gives us the tier, so no extra network call
  const [confidence, setConfidence] = useState<number | null>(null);
  const [reportCount, setReportCount] = useState<number>(0);
  const [sourceInfo, setSourceInfo] = useState<GameSourceInfo | null>(null);
  const [isNativeLinux, setIsNativeLinux] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const overview = (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(appId);
    const appName = overview?.display_name ?? '';
    // EAppPlatform.Linux = 16 in Steam's client-side enum
    const platformList: number[] = Array.isArray(overview?.platform_list) ? overview.platform_list : [];
    const native = platformList.includes(16);
    setIsNativeLinux(native);
    void logFrontendEvent('DEBUG', 'gamePageBadge: platform_list', { appId, platformList, native });
    getProtonDBSummary(String(appId)).then((summary) => {
      if (summary?.tier) setTier(summary.tier);
      if (summary) {
        setConfidence(estimatePerGameConfidence(summary));
        setReportCount(summary.total ?? 0);
      }
    }).catch(() => {/* show icon fallback */});
    void getGameSource(appId, appName).then((info) => { if (info) setSourceInfo(info); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  // For non-Steam shortcuts with a resolved Steam store match, re-fetch tier
  // using the matched app ID (the shortcut ID has no ProtonDB data).
  // Prefer full_game_app_id when the matched title is a demo.
  useEffect(() => {
    const protonId = sourceInfo?.full_game_app_id ?? sourceInfo?.steam_app_id_match;
    if (!protonId) return;
    getProtonDBSummary(protonId).then((summary) => {
      if (summary?.tier) setTier(summary.tier);
      if (summary) {
        setConfidence(estimatePerGameConfidence(summary));
        setReportCount(summary.total ?? 0);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceInfo?.full_game_app_id, sourceInfo?.steam_app_id_match]);

  function measurePos(): { top: number; left: number } | null {
    const inner = innerRef.current;
    if (!inner) return null;
    const el = inner.parentElement as HTMLDivElement | null; // Focusable div
    if (!el) return null;
    const parent = el.parentElement; // InnerContainer
    if (!parent) return null;

    const siblings = (Array.from(parent.children) as HTMLElement[]).filter(
      (c) => c !== el && window.getComputedStyle(c).position === 'absolute',
    );
    if (siblings.length === 0) return { top: 8, left: 8 };

    // Use computed CSS values (same coordinate space as el.style.top/left) rather
    // than getBoundingClientRect, which is viewport-absolute. If InnerContainer has
    // padding the rect approach offsets our badge relative to siblings, breaking
    // the navmesh's spatial grouping (we appear "above" instead of "to the right").
    let maxRight = 0;
    let sibTop = 8;
    for (const sib of siblings) {
      const st = window.getComputedStyle(sib);
      const cssTop = parseFloat(st.top);
      const cssLeft = parseFloat(st.left);
      const cssWidth = parseFloat(st.width);
      const rightEdge = (isNaN(cssLeft) ? 0 : cssLeft) + (isNaN(cssWidth) ? 0 : cssWidth);
      if (rightEdge > maxRight) {
        maxRight = rightEdge;
        if (!isNaN(cssTop)) sibTop = cssTop;
      }
    }
    const result = { top: sibTop, left: maxRight + 4 };
    void logFrontendEvent('DEBUG', 'gamePageBadge: measurePos', {
      sibCount: siblings.length,
      sibs: siblings.map((sib) => {
        const st = window.getComputedStyle(sib);
        const r = sib.getBoundingClientRect();
        return { cssTop: st.top, cssLeft: st.left, cssWidth: st.width, rectTop: Math.round(r.top), rectLeft: Math.round(r.left), rectRight: Math.round(r.right), rectBottom: Math.round(r.bottom) };
      }),
      result,
    });
    return result;
  }

  // Fires synchronously before paint - positions the badge so the navmesh
  // reads the correct coordinates when it scans the DOM after mount.
  useLayoutEffect(() => {
    const p = measurePos();
    if (p) setPos(p);
    const el = innerRef.current?.parentElement;
    if (el) {
      const r = el.getBoundingClientRect();
      void logFrontendEvent('DEBUG', 'gamePageBadge: ownRect', {
        top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Observers re-measure on ProtonDB toggle or focus-expand.
  useEffect(() => {
    const remeasure = () => {
      const p = measurePos();
      if (p) setPos(p);
    };

    const inner = innerRef.current;
    const el = inner?.parentElement;
    const parent = el?.parentElement ?? null;
    if (!parent) return;

    // childList: badge added/removed from DOM
    const childObs = new MutationObserver(remeasure);
    childObs.observe(parent, { childList: true });

    // Watch each sibling for: resize (focus expand) AND style/class changes (toggle hide/show)
    const siblingObservers: MutationObserver[] = [];
    const resizeObs = new ResizeObserver(remeasure);
    (Array.from(parent.children) as HTMLElement[])
      .filter((c) => c !== el)
      .forEach((sib) => {
        resizeObs.observe(sib);
        const attrObs = new MutationObserver(remeasure);
        attrObs.observe(sib, { attributes: true, attributeFilter: ['style', 'class'] });
        siblingObservers.push(attrObs);
      });

    return () => {
      childObs.disconnect();
      resizeObs.disconnect();
      siblingObservers.forEach((o) => o.disconnect());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isNonSteam = sourceInfo !== null && !sourceInfo.is_steam;
  const sourceLabel = sourceInfo?.source ?? null;
  const sourceColors = sourceLabel ? (SOURCE_COLORS[sourceLabel] ?? SOURCE_COLORS['Non-Steam']) : null;
  const hasResolvedSteamId = isNonSteam && !!sourceInfo?.steam_app_id_match;
  // Show tier badge when: Steam game, non-Steam with resolved ID, or non-Steam with no source label
  // (always show something -- source badge alone only when launcher is identified)
  const showTierBadge = !isNonSteam || hasResolvedSteamId || !sourceColors;
  const showSourceBadge = isNonSteam && !!sourceColors;

  const navigate = () => {
    const appName =
      (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(appId)?.display_name ?? '';
    // Always pass the original appId so ConfigureTab can detect isShortcut correctly.
    // ConfigureTab resolves non-Steam shortcuts to their Steam store ID internally.
    rememberReturnPath(globalThis.location?.pathname);
    dispatchNavigate({ tab: 'manage-game', appId: appId, appName });
    try {
      Navigation.Navigate('/proton-pulse');
    } catch {
      // fallback
    }
  };

  return (
    <Focusable
      noFocusRing={false}
      onActivate={navigate}
      onClick={navigate}
      onFocus={() => {
        void logFrontendEvent('DEBUG', 'gamePageBadge: focused via gamepad');
        setTimeout(() => { const p = measurePos(); if (p) setPos(p); }, 120);
      }}
      style={{
        position: 'absolute',
        top: pos?.top ?? 8,
        left: pos?.left ?? 8,
        zIndex: 20,
        display: 'flex',
        gap: 4,
        opacity: pos ? 1 : 0,
      }}
    >
      {isNativeLinux && (
        <div
          title="Native Linux build available"
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '5px 8px',
            borderRadius: 4,
            background: '#1a3a2a',
            color: '#4ade80',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
            border: '1px solid #4ade80',
          }}
        >
          NATIVE
        </div>
      )}
      {showTierBadge && (
        <div
          ref={innerRef}
          title={confidence != null
            ? `${tier?.toUpperCase() ?? ''} - ${confidence}% confidence (based on ${reportCount} report${reportCount === 1 ? '' : 's'})`
            : t().common.openInProtonPulse}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            cursor: 'pointer',
            padding: '5px 8px',
            borderRadius: 4,
            background: tier ? (RATING_COLORS[tier] ?? 'rgba(0,0,0,0.82)') : 'rgba(0,0,0,0.82)',
            color: tier ? (TIER_TEXT_COLOR[tier] ?? '#fff') : 'white',
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          <BrandGlyph size={16} />
          {tier && <span>{tier.toUpperCase()}</span>}
          {confidence != null && (
            <span
              style={{
                marginLeft: 4,
                padding: '1px 5px',
                borderRadius: 3,
                background: 'rgba(0,0,0,0.55)',
                color: confidenceColorRgb(confidence),
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.02em',
              }}
            >
              {confidence}%
            </span>
          )}
        </div>
      )}
      {showSourceBadge && (
        <div
          ref={!showTierBadge ? innerRef : undefined}
          title={t().common.openInProtonPulse}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '5px 8px',
            borderRadius: 4,
            background: sourceColors.bg,
            color: sourceColors.color,
            fontWeight: 700,
            fontSize: 11,
            whiteSpace: 'nowrap',
            letterSpacing: '0.04em',
            cursor: 'pointer',
          }}
        >
          {sourceLabel}
        </div>
      )}
    </Focusable>
  );
}

/**
 * Called from inside the working gamePagePatch route callback in index.tsx.
 * Guard prevents stacking multiple patches on the same routeProps object.
 */
export function setupGamePageBadge(routeProps: any) {
  if (routeProps[PATCHED_FLAG]) return;
  routeProps[PATCHED_FLAG] = true;

  const patchHandler = createReactTreePatcher(
    [
      (tree: any) =>
        findInReactTree(tree, (x: any) => x?.props?.children?.props?.overview)?.props?.children,
    ],
    (_args: any[], ret?: ReactElement) => {
      try {
        const appId = parseInt(
          globalThis.location?.pathname?.match(/\/library\/app\/(\d+)/)?.[1] ?? '0',
          10,
        );
        if (!appId) return ret;

        const container = findInReactTree(
          ret,
          (x: ReactElement) =>
            Array.isArray((x as any)?.props?.children) &&
            typeof (x as any)?.props?.className === 'string' &&
            (x as any).props.className.includes(appDetailsClasses?.InnerContainer ?? ''),
        );

        if (!container) {
          void logFrontendEvent('WARNING', 'gamePageBadge: InnerContainer not found', {
            innerClass: appDetailsClasses?.InnerContainer ?? null,
          });
          return ret;
        }

        const children = (container as any).props.children as any[];

        // Inject tier badge (PLATINUM/GOLD) in the top-left of the hero image
        if (getSetting('showGamePageBadge', true) && !children.some((c: any) => c?.key === BADGE_ID)) {
          (container as any).props.style = {
            ...((container as any).props.style ?? {}),
            position: (container as any).props.style?.position ?? 'relative',
          };
          children.splice(1, 0, <BadgeIcon key={BADGE_ID} appId={appId} />);
          void logFrontendEvent('DEBUG', 'gamePageBadge: injected', { appId });
        }

      } catch (e) {
        void logFrontendEvent('ERROR', 'gamePageBadge: injection error', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return ret;
    },
  );

  afterPatch(routeProps, 'renderFunc', patchHandler);
}
