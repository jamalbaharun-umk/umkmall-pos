import { describe, expect, it } from 'vitest';
import { tabIndicatorEdges, tabIndicatorTransform, type IndicatorArith } from '../nav-styles';

/**
 * The tab bar's indicator (UMK-1604): one view `itemWidth` wide at x 0, moved and stretched by
 * `[translateX, scaleX]` from two animated edges. `TabBar` builds the transform with `Animated.add`
 * and `Animated.multiply`; here the SAME function runs on numbers, so what is checked is what is drawn.
 *
 * React Native scales about the view's centre, so the DRAWN edges of a view at x 0, width w, under
 * `[translateX: t, scaleX: s]` are `w/2 + t ∓ s·w/2`. Every case below reads them back that way.
 */
const NUMBERS: IndicatorArith<number> = { add: (a, b) => a + b, scale: (a, k) => a * k };

const drawn = (left: number, right: number, w: number) => {
  const { translateX, scaleX } = tabIndicatorTransform(NUMBERS, left, right, w);
  return { left: w / 2 + translateX - (scaleX * w) / 2, right: w / 2 + translateX + (scaleX * w) / 2, scaleX };
};

describe('the tab indicator', () => {
  const W = 90; // Figma: a 360 bar of four items

  it('rests exactly over each item', () => {
    for (const index of [0, 1, 2, 3]) {
      const edges = tabIndicatorEdges(index, W);
      expect(edges).toEqual({ left: index * W, right: (index + 1) * W });
      const at = drawn(edges.left, edges.right, W);
      expect(at.scaleX).toBeCloseTo(1);
      expect(at.left).toBeCloseTo(edges.left);
      expect(at.right).toBeCloseTo(edges.right);
    }
  });

  it('mid-stretch, the drawn line spans exactly the two edges (the centre-origin compensation)', () => {
    /* Travelling right from item 0 to item 2: the leading (right) edge is ahead, the left one behind. */
    for (const [left, right] of [
      [10, 150],
      [0, 270],
      [95, 180],
    ] as const) {
      const at = drawn(left, right, W);
      expect(at.left).toBeCloseTo(left);
      expect(at.right).toBeCloseTo(right);
      expect(at.scaleX).toBeCloseTo((right - left) / W);
    }
  });

  it('before the row is measured (width 0) it draws nothing, rather than dividing by zero', () => {
    const { scaleX } = tabIndicatorTransform(NUMBERS, 0, 0, 0);
    expect(scaleX).toBe(0);
    expect(Number.isFinite(scaleX)).toBe(true);
  });
});
