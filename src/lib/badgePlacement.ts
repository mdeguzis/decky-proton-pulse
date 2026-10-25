// src/lib/badgePlacement.ts
//
// Where the game page badge sits relative to the other absolutely
// positioned widgets in the header container (#90). The badge goes just to
// the right of the left-hand cluster (Steam's own pills, other small plugin
// badges) so the navmesh groups it with them.
//
// Only small widgets anchored on the left count. PlayCount and Unifideck add
// wide or right-anchored overlays to the same container; letting those set
// the right edge pushed the badge to the far right, where it was barely
// visible.

export interface SiblingBox {
  top: number;   // computed CSS top, NaN when auto
  left: number;  // computed CSS left, NaN when auto
  width: number; // computed CSS width, NaN when auto
}

export interface BadgeAnchor {
  top: number;
  left: number;
  considered: number;
  ignored: number;
}

const DEFAULT_TOP = 8;
const DEFAULT_LEFT = 8;
const GAP = 4;

export function badgeAnchorFromSiblings(siblings: SiblingBox[], containerWidth: number): BadgeAnchor {
  const half = containerWidth > 0 ? containerWidth / 2 : Infinity;
  let maxRight = 0;
  let top = DEFAULT_TOP;
  let considered = 0;
  for (const s of siblings) {
    const left = isNaN(s.left) ? 0 : s.left;
    const width = isNaN(s.width) ? 0 : s.width;
    // A right-anchored widget has left: auto (NaN) but a real width, or a
    // left past the middle. A wide overlay spans half the header or more.
    const rightAnchored = isNaN(s.left) && width > 0;
    if (rightAnchored || left >= half || width >= half) continue;
    considered += 1;
    if (left + width > maxRight) {
      maxRight = left + width;
      if (!isNaN(s.top)) top = s.top;
    }
  }
  const ignored = siblings.length - considered;
  if (considered === 0) return { top: DEFAULT_TOP, left: DEFAULT_LEFT, considered, ignored };
  return { top, left: maxRight + GAP, considered, ignored };
}
