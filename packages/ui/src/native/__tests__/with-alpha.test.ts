/**
 * `withAlpha` — a token colour at an opacity, the native spelling of a web class's `/NN`
 * modifier (UMK-1317).
 *
 * `theme.ts` imports only a TYPE from `react-native`, so it loads under vitest and the function
 * is called for real here rather than read as text.
 *
 * The expectations are HAND-TYPED hexes on purpose. The a2ui parity guard in `apps/mobile`
 * computes its own alpha expectations with this same function, so a bug here would agree with
 * itself there; these literals are the independent source.
 */
import { describe, expect, it } from 'vitest';
import { tokens, withAlpha } from '../theme';

describe('withAlpha', () => {
  it('appends the alpha to a six-digit hex', () => {
    expect(withAlpha('#0074e7', 30)).toBe('#0074e74d');
    expect(withAlpha('#0074E7', 20)).toBe('#0074E733');
    expect(withAlpha('#000000', 55)).toBe('#0000008c');
  });

  it('covers both ends', () => {
    expect(withAlpha('#0074e7', 0)).toBe('#0074e700');
    expect(withAlpha('#0074e7', 100)).toBe('#0074e7ff');
  });

  /**
   * Tailwind v3 REPLACES a colour's own alpha with the modifier. The overlay surface is the one
   * published token that carries an alpha, which is what makes it the test.
   */
  it('replaces an alpha the colour already carries, as the web modifier does', () => {
    expect(tokens.surface.default.overlay).toBe('#04264899');
    expect(withAlpha(tokens.surface.default.overlay, 40)).toBe('#04264866');
  });

  it('throws on a value that is not a hex, so an unresolved token cannot become a colour', () => {
    expect(() => withAlpha(undefined as unknown as string, 30)).toThrow(/not a 6- or 8-digit hex/);
    expect(() => withAlpha('#fff', 30)).toThrow(/not a 6- or 8-digit hex/);
    expect(() => withAlpha('rgb(0,0,0)', 30)).toThrow(/not a 6- or 8-digit hex/);
    expect(() => withAlpha('transparent', 30)).toThrow(/not a 6- or 8-digit hex/);
  });

  it('throws on a percentage out of range, where a fraction was probably meant', () => {
    expect(() => withAlpha('#0074e7', -1)).toThrow(/percentage/);
    expect(() => withAlpha('#0074e7', 101)).toThrow(/percentage/);
    expect(() => withAlpha('#0074e7', Number.NaN)).toThrow(/percentage/);
  });
});
