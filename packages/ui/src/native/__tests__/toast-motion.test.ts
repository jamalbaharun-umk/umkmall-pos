/**
 * The toast's own motion, from Figma's toast (UMK-1601, UMK-1614 "Toast"): the success check pops
 * after a wait, success and danger are FELT once per toast, a swipe up dismisses early, the exit
 * leaves upward over `duration.exit`, and Reduce Motion fades only.
 *
 * Every one of these fails silently. A toast with no pop, no haptic, a dead swipe or the old exit
 * still appears, reads and closes — so nothing else in the suite would notice it gone.
 *
 * HALF IMPORTED, HALF SCANNED, the split `toast-design.test.ts` explains. The decisions — which
 * variant ticks, once per toast, how far up a swipe must go — are plain functions in
 * `toast-exit.ts` and are asserted here by VALUE. `Toaster.tsx` imports `react-native` at runtime,
 * whose entry is Flow and does not load under vitest, so its WIRING — that the host calls those
 * functions, on which values, in which arm — is read as text. The rendered half (a toast mounted,
 * swiped and timed) is not exercisable here; the numbers it would assert are pinned instead.
 *
 * PROVED RED, each injection reverted before the next — see the commit that added this file for the
 * record by assertion.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claimsToastSwipe,
  dismissesOnRelease,
  takeToastHaptic,
  TOAST_SWIPE_DISMISS,
  TOAST_SWIPE_SLOP,
  toastDrag,
  toastHaptic,
  toastSwipeTravel,
} from '../toast-exit';

const TOASTER = readFileSync(resolve(__dirname, '..', 'Toaster.tsx'), 'utf8');

/** One toast's component, from its declaration to the close glyph below it — prose above it does not count. */
const ITEM = TOASTER.slice(TOASTER.indexOf('const ToastItem = ('), TOASTER.indexOf('const CloseX'));

describe('the source is read, not assumed', () => {
  it('finds the toast item', () => {
    expect(ITEM.length, 'ToastItem not found in Toaster.tsx').toBeGreaterThan(1000);
  });
});

describe('the check pops after a wait', () => {
  it("waits delay.toastIcon, then springs the pop on spring.pop — a token wait, not a number", () => {
    expect(ITEM).toMatch(
      /Animated\.sequence\(\[\s*Animated\.delay\(MOTION\.delay\.toastIcon\),\s*Animated\.spring\(pop, \{ toValue: 1, \.\.\.MOTION\.spring\.pop, useNativeDriver: true \}\),?\s*\]\)/,
    );
  });

  it('runs alongside the entrance, so the check lands while the toast is still sliding in', () => {
    expect(ITEM).toMatch(
      /Animated\.parallel\(\[\s*Animated\.spring\(progress, \{ toValue: 1, \.\.\.MOTION\.spring\.sheet, useNativeDriver: true \}\),\s*Animated\.sequence\(\[\s*Animated\.delay\(MOTION\.delay\.toastIcon\)/,
    );
  });

  it("pops the Alert's own glyph, through alertGlyph, rather than a second copy of the fork", () => {
    expect(ITEM).toMatch(
      /icon=\{\s*<Animated\.View style=\{\{ transform: \[\{ scale: pops \? pop : 1 \}\] \}\}>\s*\{alertGlyph\('toast', entry\.variant \?\? 'info', size\)\}/,
    );
    /* The fork stays in Alert.tsx alone (toast-design.test.ts pins it there). */
    expect(TOASTER).not.toMatch(/check-circle-filled/);
  });

  it('pops the success check only', () => {
    expect(ITEM).toMatch(/const pops = entry\.variant === 'success' && !reduce;/);
  });
});

describe('the haptic: success and danger are felt, once per toast', () => {
  it('maps success → success and danger → error; info and warning are not felt', () => {
    expect(toastHaptic('success')).toBe('success');
    expect(toastHaptic('danger')).toBe('error');
    expect(toastHaptic('info')).toBeNull();
    expect(toastHaptic('warning')).toBeNull();
    /* `toast()` with no variant is an info toast. */
    expect(toastHaptic(undefined)).toBeNull();
  });

  it('plays a toast once, however many hosts draw it, and each toast its own', () => {
    const felt = new Set<number>();
    expect(takeToastHaptic(felt, { id: 1, variant: 'success' })).toBe('success');
    /* The same toast drawn again — a sheet's host over the root, then the root again. */
    expect(takeToastHaptic(felt, { id: 1, variant: 'success' })).toBeNull();
    expect(takeToastHaptic(felt, { id: 1, variant: 'success' })).toBeNull();
    /* A second toast is felt on its own first drawing. */
    expect(takeToastHaptic(felt, { id: 2, variant: 'danger' })).toBe('error');
    expect(takeToastHaptic(felt, { id: 2, variant: 'danger' })).toBeNull();
  });

  it('records nothing for a toast that is not felt', () => {
    const felt = new Set<number>();
    expect(takeToastHaptic(felt, { id: 3, variant: 'info' })).toBeNull();
    expect(felt.size).toBe(0);
  });

  it('the host asks takeToastHaptic on each drawing, from one module-level ledger, and plays what it answers', () => {
    expect(TOASTER).toMatch(/^const felt = new Set<number>\(\);$/m);
    expect(ITEM).toMatch(
      /React\.useEffect\(\(\) => \{\s*const kind = takeToastHaptic\(felt, entry\);\s*if \(kind\) haptic\(kind\);[\s\S]*?\}, \[entry\.id\]\);/,
    );
    /* One door: no other haptic in the host, so nothing else ticks on a toast. */
    expect(TOASTER.match(/\bhaptic\(/g)).toHaveLength(1);
  });

  it('forgets a toast as it leaves the queue, so the ledger does not grow for the life of the app', () => {
    expect(TOASTER).toMatch(/const dismiss = \(id: number\) => \{[^}]*felt\.delete\(id\);/);
  });
});

describe('a swipe up dismisses early', () => {
  it(`dismisses at ${TOAST_SWIPE_DISMISS} pt up and not one point short of it`, () => {
    expect(TOAST_SWIPE_DISMISS).toBe(24);
    expect(dismissesOnRelease(-24)).toBe(true);
    expect(dismissesOnRelease(-60)).toBe(true);
    expect(dismissesOnRelease(-23)).toBe(false);
    expect(dismissesOnRelease(0)).toBe(false);
    /* Down is never a dismissal. */
    expect(dismissesOnRelease(40)).toBe(false);
  });

  it('claims only a mostly-vertical drag UP past the slop, so a tap on the close stays a tap', () => {
    expect(TOAST_SWIPE_SLOP).toBeLessThan(TOAST_SWIPE_DISMISS);
    expect(claimsToastSwipe(0, -(TOAST_SWIPE_SLOP + 1))).toBe(true);
    expect(claimsToastSwipe(0, -TOAST_SWIPE_SLOP)).toBe(false);
    expect(claimsToastSwipe(0, 20)).toBe(false);
    /* Sideways is the screen's. */
    expect(claimsToastSwipe(30, -10)).toBe(false);
  });

  /**
   * PanResponder zeroes `dy` at the grant, so the release's `dy` is only the travel AFTER the claim.
   * The threshold is the finger's whole travel from touch-down: the claim's own `dy` is added back.
   */
  it('counts the slop: the travel that decides a dismiss runs from touch-down, not from the claim', () => {
    expect(toastSwipeTravel(-(TOAST_SWIPE_SLOP + 1), -19)).toBe(-24);
    expect(dismissesOnRelease(toastSwipeTravel(-(TOAST_SWIPE_SLOP + 1), -19))).toBe(true);
    expect(dismissesOnRelease(toastSwipeTravel(-(TOAST_SWIPE_SLOP + 1), -18))).toBe(false);
    /* A drag that came back down after the claim is measured where it ends. */
    expect(toastSwipeTravel(-10, 6)).toBe(-4);
  });

  it('follows the finger up and never down past its rest', () => {
    expect(toastDrag(-12)).toBe(-12);
    expect(toastDrag(0)).toBe(0);
    expect(toastDrag(30)).toBe(0);
  });

  it('the host wires the gesture to those three, dismisses on release, and springs a short drag back', () => {
    expect(ITEM).toMatch(/const claims = claimsToastSwipe\(g\.dx, g\.dy\);\s*if \(claims\) claimDy\.current = g\.dy;\s*return claims;/);
    expect(ITEM).toMatch(/onPanResponderMove: \(_e, g\) => drag\.setValue\(toastDrag\(g\.dy\)\)/);
    expect(ITEM).toMatch(
      /if \(dismissesOnRelease\(toastSwipeTravel\(claimDy\.current, g\.dy\)\)\) dismiss\(entry\.id\);\s*else Animated\.spring\(drag, \{ toValue: 0, \.\.\.MOTION\.spring\.press, useNativeDriver: true \}\)\.start\(\);/,
    );
    expect(ITEM).toMatch(/onPanResponderTerminate: \(\) => Animated\.spring\(drag, \{ toValue: 0, \.\.\.MOTION\.spring\.press/);
    /* Mounted on the toast, and the drag is drawn: a responder whose value moves nothing is dead. */
    expect(ITEM).toMatch(/<Animated\.View\s+\{\.\.\.swipe\.panHandlers\}/);
    expect(ITEM).toMatch(/translateY: Animated\.add\(progress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[rise, 0\] \}\), drag\)/);
  });
});

describe('the exit leaves upward over duration.exit', () => {
  it('times the exit on duration.exit and easing.exit, and nothing exits on duration.fast', () => {
    expect(ITEM).toMatch(/leaving\s*\?\s*Animated\.timing\(progress, \{ toValue: 0, duration: MOTION\.duration\.exit, easing: EASING\.exit, useNativeDriver: true \}\)/);
    expect(ITEM).not.toMatch(/duration: MOTION\.duration\.fast, easing: EASING\.exit/);
  });

  it('travels UP: progress 0 sits a full toast height plus the inset above the screen', () => {
    expect(ITEM).toMatch(/const rise = reduce \? 0 : -\(height \+ travel\);/);
  });
});

describe('Reduce Motion fades only', () => {
  it('enters with a plain fade, so neither the slide nor the pop runs', () => {
    /* The pop lives only in the third arm; under Reduce Motion the second arm is all that runs. */
    expect(ITEM).toMatch(
      /:\s*reduce\s*\?\s*Animated\.timing\(progress, \{ toValue: 1, duration: MOTION\.duration\.fast, easing: EASING\.standard, useNativeDriver: true \}\)\s*:\s*Animated\.parallel\(/,
    );
  });

  it('draws no travel and no scale: rise is 0, and the glyph is not scaled', () => {
    expect(ITEM).toMatch(/const rise = reduce \? 0 :/);
    expect(ITEM).toMatch(/const pops = entry\.variant === 'success' && !reduce;/);
    expect(ITEM).toMatch(/scale: pops \? pop : 1/);
  });

  it('still plays the haptic — feedback, not motion: the haptic effect reads no reduce flag', () => {
    const effect = ITEM.slice(ITEM.indexOf('const kind = takeToastHaptic'), ITEM.indexOf('}, [entry.id]);'));
    expect(effect.length).toBeGreaterThan(0);
    expect(effect).not.toMatch(/reduce/);
  });
});
