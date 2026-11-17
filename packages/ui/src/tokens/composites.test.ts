import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokens } from './generated';

// Typography and Shadow are the only COMPOSITE tokens in the tree — one token whose value
// is an object rather than a scalar. They are published through the overlay (UMK-910) and
// each one has to satisfy two consumers with opposite needs, which is what these cover.
describe('composite tokens', () => {
  // The design pairs an absolute lineHeight with each size. Re-deriving one from the other
  // with a multiplier rounds differently and is subtly wrong everywhere at once.
  it('keeps size and lineHeight as an absolute pair, both numbers', () => {
    const p = tokens.typography.mobile.paragraph.regular;
    expect(p.fontSize).toBe(14);
    expect(p.lineHeight).toBe(20);
    expect(tokens.typography.mobile.h4.bold).toMatchObject({
      fontSize: 20,
      lineHeight: 26,
    });
  });

  // React Native styles take numeric values; a '12px' string is silently ignored or throws.
  it('gives React Native unitless numbers, never px strings', () => {
    const leaves = [
      tokens.typography.mobile.bodyLg.regular.fontSize,
      tokens.typography.mobile.bodyLg.regular.lineHeight,
      tokens.shadow.card.offsetY,
      tokens.shadow.card.blur,
    ];
    for (const v of leaves) expect(typeof v).toBe('number');
  });

  // Style Dictionary flattens a composite to a CSS shorthand BEFORE a format sees it, and
  // it joins the raw numbers — `0 4 12 0 #0000000d`, `400 12/18 'Be Vietnam Pro'`. A browser
  // drops an unitless length declaration entirely, with nothing red in the build, so the
  // build re-emits these from the untransformed value. Without that, the vars are inert.
  it('emits CSS lengths with units, so the declaration is not dropped', () => {
    const css = readFileSync(join(__dirname, '../../tokens.css'), 'utf8');
    const varOf = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();

    expect(varOf('typography-mobile-paragraph-regular')).toBe("400 calc(0.875rem * var(--ds-text-scale, 1))/calc(1.25rem * var(--ds-text-scale, 1)) 'Be Vietnam Pro'");
    expect(varOf('shadow-card')).toBe('0 2px 8px 0 #0000001a');
  });

  // One tree serves both platforms, so a change that flattened a composite to a string
  // would break every consumer at once rather than just one.
  it('keeps the composite whole in the token tree', () => {
    expect(tokens.typography.mobile.h4.bold.fontWeight).toBe(700);
  });
});
