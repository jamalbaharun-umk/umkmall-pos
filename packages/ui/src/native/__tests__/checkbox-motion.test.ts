/**
 * `CheckBox` animates (UMK-1486, identity §7): the fill crossfades, the tick springs, the row
 * presses. Every CheckBox in the app wears this, so losing it loses it everywhere — and nothing
 * else fails: a box that snaps between states still renders, toggles and announces correctly.
 *
 * SOURCE-SCANNED, not rendered: `react-native` does not load under vitest (its entry is Flow),
 * the same reason `list-chrome.test.ts` reads `Dialog`'s motion as text. The rendered behaviour —
 * the role, the name, the checked state — is pinned in `apps/mobile` by
 * `src/auth/__tests__/consent-sheet.test.tsx`.
 *
 * | Mutation | What reddens |
 * |---|---|
 * | the fill back to a style swap (`isChecked && CONTROL_BOX_CHECKED` on the box) | "fades the fill" |
 * | `Animated.spring(tick, …MOTION.spring.press` → a timing | "springs the tick", "honours Reduce Motion" |
 * | the tick's `scale: reduce ? 1 : tick` → `scale: tick` | "honours Reduce Motion" |
 * | `<PressableScaleHost` → `<Pressable` | "presses" |
 * | a written-out duration or spring constant | "spells no number" |
 * | the layer mounted unconditionally, or `setLayer(false)` dropped | "unmounts the fill" |
 *
 * The rendered half of the unmount rule is `apps/mobile/src/__tests__/checkbox-fill-layer.test.tsx`;
 * this half runs when the library changes even if that package replays a cached pass.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '..', 'CheckBox.tsx'), 'utf8');

/** The component body, from its declaration to its displayName — prose above it does not count. */
const body = src.slice(src.indexOf('export const CheckBox = ('), src.indexOf('CheckBox.displayName'));

describe('CheckBox motion', () => {
  it('fades the fill: a layer whose opacity is the fill value, timed over duration.fast', () => {
    expect(body).toMatch(/Animated\.timing\(fill, \{ toValue: 1, duration: MOTION\.duration\.fast, easing: EASING\.standard/);
    expect(body).toMatch(/Animated\.timing\(fill, \{ toValue: 0, duration: MOTION\.duration\.fast, easing: EASING\.exit/);
    expect(body).toMatch(/<Animated\.View[\s\S]*?CONTROL_BOX_CHECKED[\s\S]*?opacity: fill/);
    /* The swap the layer replaced: a checked style applied straight to the box snaps. */
    expect(body).not.toMatch(/(isChecked \|\| indeterminate|on)\)? && CONTROL_BOX_CHECKED/);
  });

  it('unmounts the fill when it is not showing, so an empty box carries no brand paint', () => {
    expect(body).toMatch(/\{!disabled && layer && \(\s*<Animated\.View/);
    expect(body).toMatch(/if \(finished && !on\) setLayer\(false\)/);
  });

  it('springs the tick on spring.press, and fades it on the way out', () => {
    expect(body).toMatch(/Animated\.spring\(tick, \{ toValue: 1, \.\.\.MOTION\.spring\.press/);
    expect(body).toMatch(/Animated\.timing\(tick, \{ toValue: 0, duration: MOTION\.duration\.fast, easing: EASING\.exit/);
    expect(body).toMatch(/opacity: tick, transform: \[\{ scale: reduce \? 1 : tick \}\]/);
  });

  it('honours Reduce Motion: no spring and no scale while it is on', () => {
    expect(body).toMatch(/const reduce = useReducedMotion\(\)/);
    /* Under it the tick's way in is a timing, and the spring only runs when it is off. */
    expect(body).toMatch(/reduce\s*\?\s*Animated\.timing\(tick, \{ toValue: 1[^)]*\)\s*:\s*Animated\.spring\(tick/);
    expect(body).toMatch(/scale: reduce \? 1 : tick/);
  });

  it('presses: the row is a PressableScaleHost', () => {
    expect(body).toMatch(/<PressableScaleHost\b/);
    expect(body).not.toMatch(/<Pressable\b/);
  });

  it('spells no number of its own: every duration and spring comes from MOTION', () => {
    expect(body).not.toMatch(/(duration|delay|damping|stiffness|mass):\s*\d/);
  });
});
