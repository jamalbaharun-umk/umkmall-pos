/**
 * The native-ui-v2 surfaces: the solid card on the white page and `Avatar`
 * (docs/guidelines/mobile-design-identity.md §4.1, §8). `MeshBackground` was here until the v2 pages
 * went white (UMK-1603) and it lost its last screen; the glass card, its `GlassBackdrop` and the
 * glass fill constants were deleted in the same ticket.
 *
 * Values are asserted by IMPORT where the module is pure (`avatar-support.ts`, `content-styles.ts`),
 * and wiring by SOURCE SCAN where the module loads `react-native`, which vitest cannot. The
 * rendered behaviour is `apps/mobile`'s `design/__tests__/ui-v2-surfaces.test.tsx`.
 *
 * PROVED RED, one injection each, reverted:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `Card`'s press scale written as `scale="default"` | the card depth |
 * | `Avatar` restating `/^https:\/\//i` | one copy of the https rule |
 * | `CARD_EDGE.borderColor` back to `border.glass.default` | the one card edge, and every wearer |
 * | `CARD_VARIANT.outlined` / `ICON_BUTTON_VARIANT.outlined` / `COIN_CHIP_VARIANT.balance` / `FEATURE_TILE_LAYOUT.grid` / `FLOATING_DRAWER_CONTENT` each without its white fill | every solid surface is a white fill (that surface's assertion) |
 * | `ListGroup`'s `CONTAINER` without `backgroundColor` | the ListGroup source scan |
 * | `glass: {}` back in `CARD_VARIANT` | no glass is left in the library |
 * | the edge's contrast taken of `'#fefefe'` instead of `EDGE.borderColor` | the one visible card edge (1.01:1 < 1.1:1) |
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokens } from '../../tokens';
import { contract } from '../../contract';
import { initialsOf } from '../avatar-support';
import { CARD_EDGE, CARD_VARIANT } from '../content-styles';
import { COIN_CHIP_VARIANT, FEATURE_TILE_LAYOUT } from '../identity-card-styles';
import { FLOATING_DRAWER_CONTENT, FLOATING_DRAWER_PANEL, ICON_BUTTON_VARIANT } from '../nav-styles';

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

/**
 * UMK-1603 (UMK-1516 D1, "white solid surfaces as in Figma, no glass"): the v2 pages are white, and
 * the old glass (white 78% over a blur, a white 95% hairline) had no visible edge on white. So every
 * v2 card is Figma's white card: a solid `surface.default.primary` fill, NO blur, and ONE edge —
 * 1 px of `border.default.primary`, the stroke the Sosial Media and Pengaturan Perangkat cards and
 * the tab header's scrolled hairline draw. The glass variants and their backdrop were then DELETED.
 *
 * Asserted against `tokens`, never against the exported constant alone: a constant moves with the
 * regression it would be compared to.
 */
const EDGE = { borderWidth: tokens.borderWidth.sm, borderColor: tokens.border.default.primary } as const;
const WHITE = tokens.surface.default.primary;

/** WCAG 2 relative luminance of an opaque `#rrggbb`. */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG 2 contrast ratio of two opaque hexes, 1 (identical) to 21 (black on white). */
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The least contrast the edge may have on the page white. `border.default.primary` (#f0f0f0) is 1.14:1;
 *  a near-white such as `#fefefe` is 1.01:1, an edge nobody sees (UMK-978: a class can resolve and still
 *  be the wrong colour, so "not exactly white" is not "visible"). */
const MIN_EDGE_CONTRAST = 1.1;

describe('the solid card on the white page (UMK-1603)', () => {
  it('has one visible card edge: 1 px of an opaque border token at least 1.1:1 on the white it sits on', () => {
    expect(CARD_EDGE).toEqual(EDGE);
    expect(EDGE.borderWidth).toBe(1);
    /* Visible: a 6-digit (opaque) hex, and measurably darker than the page's own white. The old
       hairline was `#ffffff` at 95%. */
    expect(EDGE.borderColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(WHITE).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(EDGE.borderColor, WHITE)).toBeGreaterThanOrEqual(MIN_EDGE_CONTRAST);
    /* The measure itself: a near-white fails it, and the known endpoints hold. */
    expect(contrast('#fefefe', WHITE)).toBeLessThan(MIN_EDGE_CONTRAST);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('is worn by every v2 card, each a white fill on its own box', () => {
    expect(CARD_VARIANT.outlined).toEqual({ backgroundColor: WHITE, ...EDGE });
    expect(FEATURE_TILE_LAYOUT.grid).toMatchObject({ backgroundColor: WHITE, ...EDGE });
    expect(ICON_BUTTON_VARIANT.outlined).toEqual({ backgroundColor: WHITE, ...EDGE });
    expect(FLOATING_DRAWER_PANEL).toMatchObject(EDGE);
    /* The panel cannot clip (it would clip its shadow on iOS), so the clipped content view is white. */
    expect(FLOATING_DRAWER_CONTENT).toMatchObject({ backgroundColor: WHITE, overflow: 'hidden' });
    expect(COIN_CHIP_VARIANT.balance).toMatchObject({ bg: WHITE, border: EDGE.borderColor });
    /* ListGroup loads react-native, so its container is read: a white fill and the one edge. */
    expect(read('ListGroup.tsx')).toMatch(/const CONTAINER = \{\s*backgroundColor: tokens\.surface\.default\.primary,\s*\.\.\.CARD_EDGE,/);
  });

  it('leaves no glass in the library: no variant, no backdrop, no glass token, no blur', () => {
    expect(Object.keys(CARD_VARIANT)).toEqual(['elevated', 'outlined', 'plain']);
    expect(contract.Card.axes.variant).not.toContain('glass');
    expect(contract.ListGroup.axes.variant).not.toContain('glass');
    expect(contract.IconButton.axes.variant).not.toContain('glass');
    expect(Object.keys(ICON_BUTTON_VARIANT)).not.toContain('glass');
    expect(existsSync(resolve(__dirname, '..', 'glass.tsx'))).toBe(false);
    const sources = readdirSync(resolve(__dirname, '..')).filter((f) => /\.tsx?$/.test(f));
    expect(sources.length).toBeGreaterThan(40);
    for (const file of sources) {
      const source = read(file);
      expect(source, file).not.toMatch(/GlassBackdrop|GLASS_|GlassStrength|(surface|border)\.glass\.|from 'expo-blur'/);
    }
  });
});

describe('Card', () => {
  it('presses at the card depth', () => {
    expect(read('Card.tsx')).toMatch(/<PressableScale[\s\S]*?scale="card"/);
  });
});

describe('Avatar', () => {
  it('takes at most two initials, first and last word, uppercased', () => {
    expect(initialsOf('Siti Nurhaliza binti Tarudin')).toBe('ST');
    expect(initialsOf('  budi  ')).toBe('B');
    expect(initialsOf('')).toBe('');
    expect(initialsOf(undefined)).toBe('');
    expect(initialsOf('ika ratna')).toBe('IR');
  });

  it('takes one initial, the first word\'s, when asked for one (the Profil header, UMK-1601)', () => {
    expect(initialsOf('Bambang Pamungkas', 1)).toBe('B');
    expect(initialsOf('  siti  ', 1)).toBe('S');
    expect(initialsOf('', 1)).toBe('');
    /* Two stays the default. */
    expect(initialsOf('Bambang Pamungkas')).toBe('BP');
  });

  it('reads the initials count off the contract axis, two by default, and sets the profile size bold', () => {
    const source = read('Avatar.tsx');
    expect(contract.Avatar.axes.initials).toEqual(['two', 'one']);
    expect(source).toMatch(/Of<'initials'>/);
    expect(source).toMatch(/initials = 'two'/);
    expect(source).toMatch(/initialsOf\(name, INITIALS\[initials\]\)/);
    expect(source).toMatch(/profile: \{ diameter: PROFILE_DIAMETER, role: 'h4', icon: 'lg', weight: 'bold' \}/);
    expect(source).toMatch(/weight=\{step\.weight\}/);
  });

  it('asks Image whether a photo may load, rather than restating the https rule', () => {
    const avatar = read('Avatar.tsx');
    expect(avatar).toMatch(/isRenderableImageSrc\(src\)/);
    expect(avatar).not.toMatch(/\^https|startsWith\(['"]https/i);
    /* And `Image` holds the one copy, and uses it. */
    const image = read('Image.tsx');
    expect(image.match(/\/\^https:\\\/\\\/\/i/g)).toHaveLength(1);
    expect(image).toMatch(/if \(!isRenderableImageSrc\(src\)\)/);
  });

  it('paints the initials fallback white on the brand fill, sized off the measurement ladder', () => {
    const source = read('Avatar.tsx');
    expect(source).toMatch(/backgroundColor: tokens\.surface\.default\.brand/);
    expect(source).toMatch(/color="invert"/);
    expect(source).toMatch(/name="user"/);
    expect(source).toMatch(/measure\['2-25'\][\s\S]*measure\['2-75'\][\s\S]*measure\['3-5'\]/);
  });
});
