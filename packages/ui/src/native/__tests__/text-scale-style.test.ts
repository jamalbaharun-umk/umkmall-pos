/**
 * The reader's text size reaches `resolveTextStyle` as a third argument (UMK-1832). The pure half only:
 * `react-native` does not load under vitest, so the provider, the hook and a rendered `Text` are pinned in
 * `apps/mobile` (`temanai/__tests__/reader-text-size.test.tsx`), and the root mount by
 * `settings/__tests__/text-size-is-mounted.test.ts` there.
 */
import { describe, expect, it } from 'vitest';
import { tokens } from '../../tokens';
import { resolveTextStyle } from '../theme';

const token = tokens.typography.mobile.bodyLg.regular as { fontSize: number; lineHeight: number };

describe('resolveTextStyle with a reader scale', () => {
  it('returns the token pair untouched with no scale and at 1 (UMK-910: never re-derived)', () => {
    expect(resolveTextStyle('bodyLg', 'regular')).toMatchObject({ fontSize: token.fontSize, lineHeight: token.lineHeight });
    expect(resolveTextStyle('bodyLg', 'regular', 1)).toEqual(resolveTextStyle('bodyLg', 'regular'));
  });

  it('multiplies size and line height together and rounds each to a whole pixel', () => {
    const lg = resolveTextStyle('bodyLg', 'regular', 1.125);
    expect(lg.fontSize).toBe(Math.round(token.fontSize * 1.125));
    expect(lg.lineHeight).toBe(Math.round(token.lineHeight * 1.125));
    const sm = resolveTextStyle('bodyLg', 'regular', 0.875);
    expect(sm.fontSize).toBe(Math.round(token.fontSize * 0.875));
    expect(Number.isInteger(sm.lineHeight)).toBe(true);
  });
});

describe('scaleTextStyle', () => {
  it('multiplies and rounds size and line height, keeps the rest, and is the same object at 1', async () => {
    const { scaleTextStyle } = await import('../text-scale');
    const style = { fontSize: 16, lineHeight: 28.8, color: 'black' };
    expect(scaleTextStyle(style, 1)).toBe(style);
    expect(scaleTextStyle(style, 1.25)).toEqual({ fontSize: 20, lineHeight: 36, color: 'black' });
    expect(scaleTextStyle({ color: 'black' }, 1.25)).toEqual({ color: 'black' });
  });
});
