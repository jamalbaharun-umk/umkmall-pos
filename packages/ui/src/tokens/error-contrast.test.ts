import { describe, expect, it } from 'vitest';
import { tokens } from './generated';

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// UMK-1333: Text/Icon Default/Error moved off the shared red primitive (#E70000, 4.40 on the
// weak-error fill) onto its own AA step. Only the two roles moved: the primitive, the gradient
// stop and the Button danger fill still read r400.
describe('error text and icon are AA', () => {
  for (const [role, hex] of [
    ['text', tokens.text.default.error],
    ['icon', tokens.icon.default.error],
  ] as const) {
    it(`${role} error clears 4.5 on the weak-error fill and on white`, () => {
      expect(ratio(hex, tokens.surface.weak.error)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
  }

  // The roles' other backgrounds (a neutral field, a hovered row), pinned so a repoint cannot slip under 4.5.
  it('error ink also clears 4.5 on the neutral surfaces', () => {
    for (const bg of [tokens.surface.default.secondary, tokens.surface.hover.secondary]) expect(ratio(tokens.text.default.error, bg)).toBeGreaterThanOrEqual(4.5);
  });

  // Plain `text-default-warning` (#F59E0B) is ~2.1:1, so instructions in warning ink use the active step
  // under a `ds-raw-ok: state-darkened role (active-*)` marker (AIAccessStatus, TemplateFormDialog).
  it('warning instruction ink (active step) clears 4.5 on white, the weak-warning fill and amber-50', () => {
    // '#fffbeb' is Tailwind amber-50, the banner's own literal background (not a token), so it stays a literal
    for (const bg of [tokens.surface.default.primary, tokens.surface.weak.warning, '#fffbeb'])
      expect(ratio(tokens.text.active.warning, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves the shared red primitive where it was', () => {
    expect(tokens.red.r400).toBe('#e70000');
  });
});
