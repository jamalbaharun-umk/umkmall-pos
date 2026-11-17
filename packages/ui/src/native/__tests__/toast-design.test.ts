/**
 * The native toast draws what Figma draws, and the inline Alert does not follow it (UMK-1057).
 *
 * UMK-1039 read the download success toast off Figma and changed three things about it on the
 * web: the `success` glyph became `check-circle-filled` (the inline Alert keeps the outline), the
 * size follows the viewport (Medium from 768, Small below), and the close glyph is 20 / 18 px
 * beside them. Native mirrored none of it, so the same event drew a different picture on each
 * platform — and NOTHING FAILED, because both pictures are a valid glyph at a valid size. Every
 * gate in this repo proves a value resolves; none proves it resolves to the right drawing. So the
 * values are pinned here, one assertion each.
 *
 * SITED IN `packages/ui`, where the values live: `turbo.json`'s `test` task is cached per package
 * with no `dependsOn`, so a pin written in `apps/mobile` would replay a cached PASS over a change
 * here. See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * HALF IMPORTED, HALF SCANNED. `feedback-styles.ts` and `theme.ts` carry only type imports from
 * `react-native`, so their tables are imported and asserted by VALUE. `Alert.tsx`, `Toaster.tsx`
 * and `Icon.tsx` import `react-native` at runtime, whose entry is Flow and will not load under
 * vitest, so the WIRING — that a component reads the table rather than a literal — is read as text,
 * the same trick `menu-inset.test.ts` and `press-states.test.ts` use.
 *
 * PROVED RED, one injection per assertion, each reverted before the next:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `Alert.tsx`: the fork removed, `name` = `ALERT_VARIANT_ICON[fn]` | 1 — "forks the toast glyph" |
 * | `ALERT_VARIANT_ICON.success` repointed to `check-circle-filled` | 1 — "keeps the inline alert on the outline" |
 * | `toastSizeForWidth` returns `'medium'` for every width | 1 — "crosses from Small to Medium" |
 * | `Toaster.tsx`: `entry.size ?? 'medium'` (the shipped default) | 1 — "the host defaults to the rule" |
 * | `ALERT_SIZE.small.paddingHorizontal` set to `tokens.spacing.sm` (one padding for both) | 1 — "Small: 8px side padding" |
 * | `ALERT_SIZE.small.glyph` set to `'lg'` | 1 — "Small: a 20px glyph" |
 * | `TOAST_CLOSE_GLYPH.small` set to `20` | 1 — "20 beside Medium and 18 beside Small" |
 * | `Toaster.tsx`: `<CloseGlyph px={20} …>` | 1 — "the host draws the close glyph at that size" |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALERT_SIZE,
  ALERT_VARIANT_ICON,
  TOAST_CLOSE_GLYPH,
  TOAST_MEDIUM_MIN_WIDTH,
  toastSizeForWidth,
} from '../feedback-styles';
import { measure, resolveTextStyle } from '../theme';

const NATIVE_DIR = resolve(__dirname, '..');
const read = (file: string): string => readFileSync(resolve(NATIVE_DIR, file), 'utf8');

const ALERT = read('Alert.tsx');
const TOASTER = read('Toaster.tsx');
const ICON = read('Icon.tsx');

/**
 * An `Icon` step in pixels, read off `Icon.tsx`'s own `SIZES` table and then off the ladder — the
 * component cannot be imported, and hand-typing `lg → 24` here would be a second copy of the table
 * that agrees until it does not. Asserting the match is what keeps a renamed table from turning
 * every size assertion below into `undefined === 24`, which reads as a failure of the wrong thing.
 */
const glyphPx = (step: string): number => {
  const match = new RegExp(`\\b${step}: measure\\['([\\d-]+)'\\]`).exec(ICON);
  expect(match, `Icon.tsx no longer spells its '${step}' step off the measurement ladder`).not.toBeNull();
  return measure[match![1] as keyof typeof measure];
};

describe('the three modules are read, not assumed', () => {
  it('finds real sources for Alert, Toaster and Icon', () => {
    for (const [name, text] of [['Alert', ALERT], ['Toaster', TOASTER], ['Icon', ICON]] as const) {
      expect(text.length, `${name}.tsx read as empty`).toBeGreaterThan(500);
    }
  });
});

describe('the success toast draws the filled check, and the inline Alert does not follow', () => {
  /* The fork is in the COMPONENT, exactly where the web `Alert` puts it — not in the table. */
  it('forks the toast glyph to check-circle-filled, off the inline table for everything else', () => {
    expect(ALERT).toMatch(
      /type === 'toast' && fn === 'success'\s*\?\s*'check-circle-filled'\s*:\s*ALERT_VARIANT_ICON\[fn\]/,
    );
    /* Declared AND drawn: a fork computed into a variable nothing renders is the same bug green. */
    expect(ALERT).toMatch(/<Icon\s+name=\{name\}/);
  });

  /**
   * THE HALF A "CONSOLIDATION" BREAKS. Repointing `success` in the shared table is the obvious
   * one-line way to mirror the web, and it moves the inline Alert somewhere the web's did not go —
   * every other guard stays green, because `check-circle-filled` is a perfectly valid name.
   */
  it('keeps the inline alert on the outline check', () => {
    expect(ALERT_VARIANT_ICON.success).toBe('check-circle');
  });
});

describe("the toast takes Figma's two sizes from the width", () => {
  it('crosses from Small to Medium at the width the web host reads', () => {
    expect(TOAST_MEDIUM_MIN_WIDTH).toBe(768);
    expect(toastSizeForWidth(TOAST_MEDIUM_MIN_WIDTH - 1)).toBe('small');
    expect(toastSizeForWidth(TOAST_MEDIUM_MIN_WIDTH)).toBe('medium');
  });

  it('the host defaults to the rule rather than to one size, and lets an explicit size win', () => {
    expect(TOASTER).toMatch(/useWindowDimensions\(\)/);
    expect(TOASTER).toMatch(/entry\.size \?\? toastSizeForWidth\(width\)/);
  });

  /* Each Figma value on its own line, so a break names the value and not the size. */
  it('Medium: 14/20 text', () => {
    expect(resolveTextStyle(ALERT_SIZE.medium.role, 'regular')).toMatchObject({ fontSize: 14, lineHeight: 20 });
  });
  it('Medium: a 24px glyph', () => {
    expect(glyphPx(ALERT_SIZE.medium.glyph)).toBe(24);
  });
  it('Medium: 12px side padding', () => {
    expect(ALERT_SIZE.medium.paddingHorizontal).toBe(12);
  });
  it('Small: 12/18 text', () => {
    expect(resolveTextStyle(ALERT_SIZE.small.role, 'regular')).toMatchObject({ fontSize: 12, lineHeight: 18 });
  });
  it('Small: a 20px glyph', () => {
    expect(glyphPx(ALERT_SIZE.small.glyph)).toBe(20);
  });
  it('Small: 8px side padding', () => {
    expect(ALERT_SIZE.small.paddingHorizontal).toBe(8);
  });
});

describe('the close glyph follows the toast size and not the icon ladder', () => {
  it('is 20 beside Medium and 18 beside Small', () => {
    expect(TOAST_CLOSE_GLYPH).toEqual({ large: 20, medium: 20, small: 18 });
  });

  it('the host draws the close glyph at that size', () => {
    expect(TOASTER).toMatch(/<CloseGlyph\s+px=\{TOAST_CLOSE_GLYPH\[size\]\}/);
  });
});

/**
 * The toast moves with the identity and is heard on iOS (UMK-1487).
 *
 * Read as text for the reason above. What is pinned: the entrance is `spring.sheet` with a travel
 * from above the screen, the exit is `duration.exit` on `easing.exit` (UMK-1601; it was `duration.fast`), Reduce Motion is honoured,
 * the close presses like every other tappable, and `toast()` — not a host — tells VoiceOver, so two
 * hosts drawing one queue (the root one under a sheet, one over it) never speak a toast twice.
 */
describe('the toast host (UMK-1487)', () => {
  it('slides in on spring.sheet and out on easing.exit, from tokens', () => {
    expect(TOASTER).toMatch(/Animated\.spring\(progress, \{ toValue: 1, \.\.\.MOTION\.spring\.sheet/);
    expect(TOASTER).toMatch(/duration: MOTION\.duration\.exit, easing: EASING\.exit/);
    expect(TOASTER).toMatch(/useReducedMotion\(\)/);
    expect(TOASTER).not.toMatch(/duration: \d/);
  });

  it('a sticky toast arms no dwell timer', () => {
    expect(TOASTER).toMatch(/if \(entry\.sticky\) return;\s*const timer = setTimeout\(\(\) => dismiss\(entry\.id\), duration\)/);
  });

  it('presses its close with PressableScaleHost', () => {
    expect(TOASTER).toMatch(/<PressableScaleHost\s+scale="icon"/);
  });

  it('announces on iOS once, from toast() rather than from a host', () => {
    const enqueue = TOASTER.slice(TOASTER.indexOf('export const toast'), TOASTER.indexOf('export interface ToasterProps'));
    expect(enqueue).toMatch(/Platform\.OS === 'ios'\) AccessibilityInfo\.announceForAccessibility/);
    expect(TOASTER.split('announceForAccessibility').length - 1).toBe(1);
  });
});
