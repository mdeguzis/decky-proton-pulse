import { describe, it, expect } from 'vitest';
import { badgeAnchorFromSiblings } from './badgePlacement';

const box = (left: number, width: number, top = 8) => ({ top, left, width });

describe('badgeAnchorFromSiblings (#90)', () => {
  it('defaults to the top-left corner with no siblings', () => {
    expect(badgeAnchorFromSiblings([], 1280)).toEqual({ top: 8, left: 8, considered: 0, ignored: 0 });
  });

  it('sits just right of the rightmost small left-hand widget, at its top', () => {
    const a = badgeAnchorFromSiblings([box(8, 60, 10), box(72, 90, 12)], 1280);
    expect(a).toMatchObject({ top: 12, left: 166, considered: 2, ignored: 0 });
  });

  it('ignores a wide overlay such as PlayCount', () => {
    const a = badgeAnchorFromSiblings([box(8, 60), box(0, 1200, 0)], 1280);
    expect(a).toMatchObject({ left: 72, considered: 1, ignored: 1 });
  });

  it('ignores a widget placed on the right half', () => {
    const a = badgeAnchorFromSiblings([box(8, 60), box(1100, 150)], 1280);
    expect(a).toMatchObject({ left: 72, ignored: 1 });
  });

  it('ignores a right-anchored widget (left: auto with a width)', () => {
    const a = badgeAnchorFromSiblings([{ top: 8, left: NaN, width: 140 }], 1280);
    expect(a).toEqual({ top: 8, left: 8, considered: 0, ignored: 1 });
  });

  it('keeps the old behaviour when the container width is unknown', () => {
    expect(badgeAnchorFromSiblings([box(0, 1200)], 0)).toMatchObject({ left: 1204, considered: 1 });
  });

  it('treats auto top/left/width as 0 for a left-hand widget and keeps the default top', () => {
    expect(badgeAnchorFromSiblings([{ top: NaN, left: 20, width: NaN }], 1280))
      .toMatchObject({ top: 8, left: 24, considered: 1 });
  });
});
