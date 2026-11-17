/**
 * The native-ui-v2 motion layer reads EVERY value from `tokens.motion`
 * (docs/guidelines/mobile-design-identity.md §7). The pure half is imported; the
 * `Animated` half (`motion.tsx`) is SOURCE-SCANNED, because `react-native` does not load
 * under vitest — the same trick `exports.test.ts` uses.
 *
 * ## The ban, and why it was rewritten (review finding 15)
 *
 * WHAT IT FORBIDS, in the identity's words: **an animation whose duration, delay, spring or easing
 * is not read from `tokens.motion`, or that does not run on the native driver.**
 *
 * It used to be three regexes over `motion.tsx` (`\b(duration|delay|damping|stiffness)\s*:\s*\d`,
 * `Easing\.bezier\(\s*\d`, and a count of `useNativeDriver: true`). A ban asserts that nothing
 * matches, so its assertion IS its matcher, and those matched a number written directly after the
 * key and nothing else: `const D = 380; … duration: D` was green. The matcher is now
 * `../testing/motion-literals`, shared with `nav-chrome.test.ts` and `identity-cards.test.ts`,
 * and it is written as the ALLOWED form with everything else refused. Its docblock is the table of
 * spellings; the synthetic cases below are one per row.
 *
 * It also only ever read `motion.tsx`. The roots are part of a ban's surface, so it now walks the
 * whole of `packages/ui/src/native`: every file is either clean or RECORDED with its exact count by
 * kind, and only `motion-tokens.ts` (which builds `MOTION`) and `testing/` are outside it, by name.
 *
 * ## PROVED RED
 *
 * Each row is ONE snippet appended to the real `motion.tsx`, the suite run, and the snippet
 * removed. "Old guard" is the same injection against the three regexes, run before they were
 * replaced. Every "red" in the last column is the single assertion "no file carries a motion
 * value, an easing or a JS-driven animation it is not recorded for", and nothing else.
 *
 * | Spelling injected | Old guard | Now |
 * | -- | -- | -- |
 * | `duration: 380` | red | red |
 * | `const D = 380; … duration: D` | **green** | red |
 * | `duration: MOTION.duration.base * 2` | **green** | red |
 * | `const duration = …; { toValue: 1, duration, … }` | **green** | red |
 * | `Animated.timing(v, cfg)`, `cfg` built by a call | red | red |
 * | `{ toValue: 1, ...SLOW, … }` | **green** | red |
 * | `'duration': 380` | **green** | red |
 * | `duration : 380` | red | red |
 * | `duration: reduce ? 120 : 380` | **green** | red |
 * | `delay: 120` | red | red |
 * | `Animated.delay(120)` | **green** | red |
 * | `Animated.stagger(40, [])` | **green** | red |
 * | `tension: 40, friction: 7` | **green** | red |
 * | `speed: 12, bounciness: 8` | **green** | red |
 * | a spring with no physics (RN default) | **green** | red |
 * | a timing with no `duration` (RN default 500 ms) | **green** | red |
 * | `...MOTION.spring.press, mass: 3` | **green** | red |
 * | `damping: DAMP`, a named constant | **green** | red |
 * | `import { Easing as E }`, then `E.bezier(.2, .8, .2, 1)` | **green** | red |
 * | `Easing.bezier(.2, .8, .2, 1)` | **green** | red |
 * | `Easing.bezier(...[0.2, 0.8, 0.2, 1])` | **green** | red |
 * | `easing: Easing.out(Easing.quad)` | **green** | red |
 * | `easing: (x) => x * x` | **green** | red |
 * | `Easing.bezier(...CURVE)`, a named tuple | **green** | red |
 * | `useNativeDriver: false` | red | red |
 * | `useNativeDriver: !1` | red | red |
 * | `useNativeDriver` omitted | red | red |
 * | `useNativeDriver : false` | red | red |
 * | `const A = Animated; A.timing(…)` | **green** | red |
 * | a local `{ duration: { base: 380 } }` read as `X.duration.base` | **green** | red |
 * | `setTimeout(fn, 380)` | **green** | red |
 * | `LayoutAnimation.configureNext(Presets.easeInEaseOut)` | **green** | red |
 * | `import { withTiming } from 'react-native-reanimated'` | **green** | red |
 * | `<Enter delay={120} />` | **green** | red |
 * | `({ delay = 120 }) =>` | **green** | red |
 * | `duration: SLOW_MS`, imported from another module | **green** | red |
 * | `duration: MOTION.distance.enter` | **green** | red |
 * | `const reduce = 380; … duration: reduce` | **green** | red |
 * | a timing with no `easing` (RN default ease-in-out) | **green** | red |
 * | `Animated['timing'](…)` | not run | red |
 *
 * Added after the review of #1367, which found two spellings the shared matcher let through with
 * ZERO offences. Each row is one line appended to the real `motion.tsx`, the suite run, the line
 * removed; "Matcher before" is the same injection run before `motion-literals.ts` was changed.
 * Every red is the single assertion "no file carries a motion value, an easing or a JS-driven animation it is not recorded for".
 *
 * | Spelling injected into `motion.tsx` | Matcher before | Now |
 * | -- | -- | -- |
 * | `import * as MOTION from './motion-tokens'`, a namespace import | **green** | red |
 * | `import MOTION from './motion-tokens'`, a default import | **green** | red |
 * | `import Animated from 'react-native'`, `Animated` by a default import | **green** | red |
 * | `import * as M from './motion'`, the tokens whole under another name | **green** | red |
 * | `Animated.event([], { useNativeDriver: false })` | **green** | red |
 * | `Animated.event([])`, no driver named at all | **green** | red |
 *
 * The ledger, the walk and the matcher's own walk, one break each:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | one more `duration: 200` appended to `Switch.tsx`, a recorded file | "no file carries …" |
 * | `Skeleton.tsx`'s recorded `duration: 1400` changed to a `MOTION` read | "records nothing that is no longer there" |
 * | a new file `zz-injection.tsx` holding a literal timing | "no file carries …" |
 * | a new NESTED file `glyphs/zz-injection.tsx` holding `{ duration: 200 }` | "no file carries …" |
 * | `bezier([0.2, 0.8, 0.2, 1])` appended to `motion.tsx` | "no file carries …" |
 * | a second `Easing.bezier(a, b, c, d)` in `motion.tsx`, outside `bezier` | "no file carries …" |
 * | `motion.tsx`'s `delay: reduce ? 0 : delay` changed to `… : delay * 2` (the one allowed pass-through) | "no file carries …" |
 * | `motion-tokens.ts`'s press spring `mass: 1` → `3` | "resolves each spring to the token damping and stiffness, at mass 1" |
 * | this file's `walk` made non-recursive | "walks the whole directory, and reads every animation written in it" |
 * | the matcher's `forEachChild` callback made to return truthy at call expressions (the truncation trap) | "walks the whole directory …" (the per-file count against the text) AND "records nothing that is no longer there" — two, because a truncated walk both misses calls and finds fewer recorded offences |
 *
 * UMK-1601 re-opened `MOTION.delay` with one member (`toastIcon`) and widened the allowed waits by
 * `delay` and nothing else. One break each:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `motion-literals.ts`'s `TIMED.delay` without `'delay'` | "passes Animated.delay of a delay token" AND "no file carries …" (`Toaster.tsx`) |
 * | `Toaster.tsx`'s `Animated.delay(MOTION.delay.toastIcon)` → `Animated.delay(150)` | "no file carries …" |
 * | the matcher's `Animated.delay` check dropped, so any wait passes | the three `Animated.delay` refusals, the `Animated.stagger` one, and "records nothing that is no longer there" |
 *
 * ## The stated ceiling — injected, and GREEN
 *
 * | Spelling injected | Result | Why it is not caught |
 * | -- | -- | -- |
 * | `fadeTo(v, 1, 380)`, a helper from another module | green | the scan reads one file, and a positional number in a call it does not know is not a duration to it |
 * | a `requestAnimationFrame` / `Date.now()` loop | green | there is no config object to read |
 * | `outputRange: [0.4, 1]`, a scale in an interpolation | green | not a duration, a spring or an easing; the pop and press scales are tokens, pinned by value in `motion-tokens.test.ts` |
 * | `duration: MOTION.duration.slow` where another token was meant | green | a token is a token here. WHICH token each leg uses is the positive assertions' job (and Jest's, on the configs) |
 *
 * Also outside it, by construction: a wrapper around `Animated` imported under its own name
 * (`import { timing } from './anim'`), and a file under `testing/`.
 *
 * ## What the walk found that nobody had listed
 *
 * Three timings in the v2 files name NO easing, so they run React Native's ease-in-out rather than
 * `easing.standard`: `motion.tsx`'s reduced-motion press and two in `FeatureTile.tsx`. They are
 * recorded below as `default-easing`, not fixed here — this is a test-only change.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokens } from '../../tokens';
import { MOTION, parseCubicBezier, staggerDelay } from '../motion-tokens';
import { blankComments } from '../testing/colour-literals';
import { countByKind, scanMotionLiterals, type MotionOffenceKind, type MotionScanOptions } from '../testing/motion-literals';

describe('motion tokens', () => {
  it('parses both easing tokens into four numbers', () => {
    expect(parseCubicBezier(tokens.motion.easing.standard)).toEqual([0.2, 0.8, 0.2, 1]);
    expect(parseCubicBezier(tokens.motion.easing.exit)).toEqual([0.4, 0, 1, 1]);
    expect(MOTION.easing.standard).toEqual([0.2, 0.8, 0.2, 1]);
  });

  it('refuses a token that is not a cubic-bezier, rather than easing linearly', () => {
    expect(() => parseCubicBezier('ease-out')).toThrow(/not a cubic-bezier/);
    expect(() => parseCubicBezier('cubic-bezier(0.2, 0.8, 0.2)')).toThrow();
  });

  it('keeps exits shorter than entrances (identity §7.3 rule 1)', () => {
    expect(MOTION.duration.press).toBeLessThan(MOTION.duration.base);
    expect(MOTION.duration.fast).toBeLessThan(MOTION.duration.base);
    expect(MOTION.duration.exit).toBeLessThan(MOTION.duration.base);
  });

  it("resolves UMK-1601's three: the exit, the toast icon's wait and the ↗ nudge", () => {
    /* By value as well as by source: `MOTION.*` reading the token is half of it, the number Figma
       asked for is the other. */
    expect(MOTION.duration.exit).toBe(tokens.motion.duration.exit);
    expect(MOTION.duration.exit).toBe(200);
    expect(MOTION.delay.toastIcon).toBe(tokens.motion.delay.toastIcon);
    expect(MOTION.delay.toastIcon).toBe(150);
    /* A wait, not a second animation: the check lands while the toast's own entrance is still on. */
    expect(MOTION.delay.toastIcon).toBeLessThan(MOTION.duration.base);
    expect(MOTION.distance.nudge).toBe(tokens.motion.distance.nudge);
    expect(MOTION.distance.nudge).toBe(2);
    /* A nudge, smaller than any travel the identity already has. */
    expect(MOTION.distance.nudge).toBeLessThan(MOTION.distance.label);
  });

  it('staggers one step per item and caps at stagger.max', () => {
    const { step, max } = tokens.motion.stagger;
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBe(step);
    expect(staggerDelay(max - 1)).toBe((max - 1) * step);
    expect(staggerDelay(max + 20)).toBe((max - 1) * step);
    expect(staggerDelay(-3)).toBe(0);
  });

  it('pops the tab glyph down then past 1; the OTP kick and the tab content shift are nudges, not entrances', () => {
    expect(MOTION.pop).toEqual({ squash: 0.82, overshoot: 1.14 });
    expect(MOTION.pop.squash).toBeLessThan(1);
    expect(MOTION.pop.overshoot).toBeGreaterThan(1);
    /* Both smaller than an entrance rise: a tab's content arrives from the side, it does not enter. */
    expect(MOTION.distance.label).toBe(6);
    expect(MOTION.distance.label).toBeLessThan(MOTION.distance.enter);
    expect(MOTION.distance.page).toBe(8);
    expect(MOTION.distance.page).toBeLessThan(MOTION.distance.enter);
  });

  it('resolves each spring to the token damping and stiffness, at mass 1', () => {
    /* `mass` is the one motion number with no token: it is written in `motion-tokens.ts`, the file
       the ban below does not scan, so it is pinned here by value. */
    for (const name of ['press', 'sheet', 'snappy', 'pop'] as const) {
      expect(MOTION.spring[name]).toEqual({ damping: tokens.motion.spring[name].damping, stiffness: tokens.motion.spring[name].stiffness, mass: 1 });
    }
  });

  it("the bell's ring: four swings that alternate side and die down, one ring step each, 500 ms with the rest (UMK-1605)", () => {
    expect(MOTION.ring.angles).toEqual([tokens.motion.rotate.ring['1'], tokens.motion.rotate.ring['2'], tokens.motion.rotate.ring['3'], tokens.motion.rotate.ring['4']]);
    expect(MOTION.ring.angles).toEqual([-14, 12, -8, 5]);
    for (let i = 1; i < MOTION.ring.angles.length; i += 1) {
      expect(Math.sign(MOTION.ring.angles[i])).toBe(-Math.sign(MOTION.ring.angles[i - 1]));
      expect(Math.abs(MOTION.ring.angles[i])).toBeLessThan(Math.abs(MOTION.ring.angles[i - 1]));
    }
    expect(MOTION.duration.ring * (MOTION.ring.angles.length + 1)).toBe(500);
  });

  it('the badge spring overshoots where the press spring does not: lower damping, at least as stiff', () => {
    expect(MOTION.spring.pop.damping).toBeLessThan(MOTION.spring.press.damping);
    expect(MOTION.spring.pop.stiffness).toBeGreaterThanOrEqual(MOTION.spring.press.stiffness);
  });

  it('press depths stay subtle: card shallowest, icon deepest', () => {
    const { default: d, card, icon } = MOTION.scale;
    expect(card).toBeGreaterThan(d);
    expect(d).toBeGreaterThan(icon);
    expect(icon).toBeGreaterThanOrEqual(0.9);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* THE BAN: no duration, delay, spring or easing that is not a `tokens.motion` read (§7.1), and   */
/* no animation off the native driver (§7.3 rule 2). The matcher and the table of spellings are   */
/* `../testing/motion-literals`; the header of this file records what was proved red.             */
/* ------------------------------------------------------------------------------------------ */

const kinds = (source: string, options?: MotionScanOptions) =>
  scanMotionLiterals(`${PREAMBLE}${source}`, 'inline.tsx', options).offences.map(({ kind }) => kind);

const PREAMBLE = "import { Animated, Easing } from 'react-native';\nimport { EASING, MOTION } from './motion';\nconst v = new Animated.Value(0);\n";
const timing = (config: string) => `Animated.timing(v, ${config});`;
const spring = (config: string) => `Animated.spring(v, ${config});`;
const OK = 'easing: EASING.standard, useNativeDriver: true';

describe('the motion matcher, one synthetic case per spelling', () => {
  it.each<[string, string]>([
    ['a token timing', timing(`{ toValue: 1, duration: MOTION.duration.base, ${OK} }`)],
    ['the reduced-motion ternary', timing(`{ toValue: 1, duration: reduce ? MOTION.duration.fast : MOTION.duration.base, delay: reduce ? 0 : MOTION.stagger.step, ${OK} }`)],
    ['a wait that is a duration', timing(`{ toValue: 1, duration: MOTION.duration.base, delay: MOTION.duration.fast, ${OK} }`)],
    /* UMK-1601: the toast's check waits a named `delay` token before it pops. */
    ['Animated.delay of a delay token', 'Animated.sequence([Animated.delay(MOTION.delay.toastIcon)]);'],
    ['a token spring', spring('{ toValue: 1, ...MOTION.spring.sheet, useNativeDriver: true }')],
    ['a quoted, multi-line token config', timing(`{\n  'toValue': 1,\n  'duration': MOTION.duration.base,\n  ${OK},\n}`)],
    ['an EASE constant built from the token tuple', `const EASE_EXIT = Easing.bezier(...MOTION.easing.exit);\n${timing('{ toValue: 0, duration: MOTION.duration.fast, easing: EASE_EXIT, useNativeDriver: true }')}`],
    ['a shorthand toValue', `const toValue = 1;\n${timing(`{ toValue, duration: MOTION.duration.base, ${OK} }`)}`],
    ['a motion value named only in a comment or a string', "/* duration: 380, Easing.linear */\nconst note = 'duration: 380';"],
    ['Animated as a type and a value', 'const ref: Animated.CompositeAnimation | null = null;\nconst sum = Animated.add(v, v);'],
    ['an Animated.event on the native driver', 'const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: v } } }], { useNativeDriver: true, listener: () => {} });'],
    ['a default and a namespace import of something that is not watched', "import React from 'react';\nimport Svg, * as shapes from 'react-native-svg';\nimport * as RN from 'react-native';\nRN.Animated.timing(v, { toValue: 1, duration: MOTION.duration.base, easing: EASING.standard, useNativeDriver: true });"],
    /* The ceiling, pinned so that closing one is noticed: these are GREEN and are meant to be. */
    ['CEILING — a helper from another module taking a number', 'fadeTo(v, 1, 380);'],
    ['CEILING — a hand-rolled frame loop', 'const t0 = Date.now();\nconst tick = () => { if (Date.now() - t0 < 380) requestAnimationFrame(tick); };'],
    ['CEILING — a scale in an interpolation', 'const s = v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });'],
    ['CEILING — the wrong token of the right family', timing(`{ toValue: 1, duration: MOTION.duration.slow, ${OK} }`)],
  ])('passes %s', (_name, source) => {
    expect(kinds(source)).toEqual([]);
  });

  it.each<[string, string, MotionOffenceKind[]]>([
    ['a literal duration', timing(`{ toValue: 1, duration: 380, ${OK} }`), ['value']],
    ['a named constant', `const D = 380;\n${timing(`{ toValue: 1, duration: D, ${OK} }`)}`, ['value']],
    ['a constant imported from another module', `import { SLOW_MS } from './somewhere';\n${timing(`{ toValue: 1, duration: SLOW_MS, ${OK} }`)}`, ['value']],
    ['arithmetic on a token', timing(`{ toValue: 1, duration: MOTION.duration.base * 2, ${OK} }`), ['value']],
    ['a literal in a ternary arm', timing(`{ toValue: 1, duration: reduce ? 120 : 380, ${OK} }`), ['value']],
    ['a ternary on something that is not reduced motion', timing(`{ toValue: 1, duration: big ? MOTION.duration.slow : MOTION.duration.base, ${OK} }`), ['value']],
    ['a token of the wrong family', timing(`{ toValue: 1, duration: MOTION.distance.enter, ${OK} }`), ['value']],
    ['a number called reduce', timing(`{ toValue: 1, duration: reduce, ${OK} }`), ['value']],
    ['a quoted key', timing(`{ toValue: 1, 'duration': 380, ${OK} }`), ['value']],
    ['a space before the colon', timing(`{ toValue: 1, duration : 380, ${OK} }`), ['value']],
    ['a literal delay', timing(`{ toValue: 1, duration: MOTION.duration.base, delay: 120, ${OK} }`), ['value']],
    ['a timing with no duration', timing(`{ toValue: 1, ${OK} }`), ['value']],
    ['a timing with no easing', timing('{ toValue: 1, duration: MOTION.duration.base, useNativeDriver: true }'), ['default-easing']],
    ['a shorthand duration', `const duration = MOTION.duration.base;\n${timing(`{ toValue: 1, duration, ${OK} }`)}`, ['config', 'value']],
    ['a config built elsewhere', 'Animated.timing(v, makeConfig());', ['config']],
    ['a spread that is not the token spring', timing(`{ toValue: 1, ...SLOW, duration: MOTION.duration.base, ${OK} }`), ['config']],
    ['a token spring spread into a timing', timing(`{ toValue: 1, ...MOTION.spring.sheet, duration: MOTION.duration.base, ${OK} }`), ['config']],
    ['a config key the guard does not know', timing(`{ toValue: 1, duration: MOTION.duration.base, isInteraction: false, ${OK} }`), ['config']],
    ['Animated.delay with a literal', 'Animated.sequence([Animated.delay(120)]);', ['value']],
    /* UMK-1601: the toast icon's wait written out — still refused once `delay` tokens are allowed. */
    ['Animated.delay with the toast-icon wait written out', 'Animated.sequence([Animated.delay(150)]);', ['value']],
    ['Animated.delay of a delay token under arithmetic', 'Animated.delay(MOTION.delay.toastIcon * 2);', ['value']],
    ['Animated.stagger with a literal', 'Animated.stagger(40, []);', ['value']],
    ['setTimeout with a literal', 'setTimeout(() => {}, 380);', ['value']],
    ['a JSX delay literal', 'const j = <Enter delay={120} />;', ['value']],
    ['a JSX delay string', 'const j = <Enter delay="120" />;', ['value']],
    ['a default parameter literal', 'const f = ({ delay = 120 }: { delay?: number }) => delay;', ['value']],
    ['a motion key in a config object outside the call', 'const table = { duration: 380 };', ['value']],
    ['a spring by damping/stiffness literals', spring('{ toValue: 1, damping: 18, stiffness: 260, useNativeDriver: true }'), ['physics', 'physics', 'physics']],
    ['a spring by tension/friction', spring('{ toValue: 1, tension: 40, friction: 7, useNativeDriver: true }'), ['physics', 'physics', 'physics']],
    ['a spring by speed/bounciness', spring('{ toValue: 1, speed: 12, bounciness: 8, useNativeDriver: true }'), ['physics', 'physics', 'physics']],
    ['a spring with no physics at all', spring('{ toValue: 1, useNativeDriver: true }'), ['physics']],
    ['a literal mass over the token spring', spring('{ toValue: 1, ...MOTION.spring.press, mass: 3, useNativeDriver: true }'), ['physics']],
    ['a named spring constant', spring('{ toValue: 1, ...MOTION.spring.press, damping: DAMP, useNativeDriver: true }'), ['physics']],
    ['a decay', 'Animated.decay(v, { velocity: 1, useNativeDriver: true });', ['physics', 'physics']],
    ['a bezier of literals', 'const c = Easing.bezier(0.2, 0.8, 0.2, 1);', ['easing']],
    ['a bezier of leading-dot literals', 'const c = Easing.bezier(.2, .8, .2, 1);', ['easing']],
    ['a bezier of a spread literal', 'const c = Easing.bezier(...[0.2, 0.8, 0.2, 1]);', ['easing']],
    ['a bezier of a named curve', 'const C = [0.2, 0.8, 0.2, 1] as const;\nconst c = Easing.bezier(...C);', ['easing']],
    ['a preset easing', timing('{ toValue: 1, duration: MOTION.duration.base, easing: Easing.linear, useNativeDriver: true }'), ['easing']],
    ['a composed easing, counted once', timing('{ toValue: 1, duration: MOTION.duration.base, easing: Easing.out(Easing.quad), useNativeDriver: true }'), ['easing']],
    ['a hand-written easing function', timing('{ toValue: 1, duration: MOTION.duration.base, easing: (t: number) => t * t, useNativeDriver: true }'), ['easing']],
    ['an EASE constant that is not the token bezier', 'const EASE_OUT = (t: number) => t;', ['easing']],
    ['an EASE constant this file does not build', timing('{ toValue: 1, duration: MOTION.duration.base, easing: EASE_ELSEWHERE, useNativeDriver: true }'), ['easing']],
    ['useNativeDriver: false', timing('{ toValue: 1, duration: MOTION.duration.base, easing: EASING.standard, useNativeDriver: false }'), ['js-driver']],
    ['useNativeDriver : false, spaced', timing('{ toValue: 1, duration: MOTION.duration.base, easing: EASING.standard, useNativeDriver : false }'), ['js-driver']],
    ['useNativeDriver: !1', timing('{ toValue: 1, duration: MOTION.duration.base, easing: EASING.standard, useNativeDriver: !1 }'), ['driver']],
    ['useNativeDriver behind a name', timing('{ toValue: 1, duration: MOTION.duration.base, easing: EASING.standard, useNativeDriver: NATIVE }'), ['driver']],
    ['useNativeDriver omitted', timing('{ toValue: 1, duration: MOTION.duration.base, easing: EASING.standard }'), ['driver']],
    ['Animated under another name', 'const A = Animated;\nA.timing(v, makeConfig());', ['alias']],
    ['Animated destructured', 'const { timing: run } = Animated;\nrun(v, makeConfig());', ['alias']],
    ['Animated by element access', "Animated['timing'](v, makeConfig());", ['alias']],
    ['Easing imported under another name', "import { Easing as E } from 'react-native';\nconst c = E.bezier(0.2, 0.8, 0.2, 1);", ['alias']],
    ['Animated from somewhere that is not react-native', "import { Animated as Reanimated } from 'somewhere';", ['alias', 'alias']],
    ['MOTION under another name', 'const M = MOTION;', ['alias']],
    /* Review of #1367: only a NAMED import can be checked for where its name comes from. */
    ['MOTION by a default import', `import MOTION from './numbers';\n${timing(`{ toValue: 1, duration: MOTION.duration.base, ${OK} }`)}`, ['alias']],
    ['MOTION by a namespace import', `import * as MOTION from './numbers';\n${timing(`{ toValue: 1, duration: MOTION.duration.base, ${OK} }`)}`, ['alias']],
    ['MOTION by a default import of the token module itself', "import MOTION from './motion-tokens';", ['alias']],
    ['EASING by a default import', "import EASING from './curves';", ['alias']],
    ['Animated by a default import', `import Animated from './anim';\n${timing(`{ toValue: 1, duration: MOTION.duration.base, ${OK} }`)}`, ['alias']],
    ['Animated by a namespace import', "import * as Animated from './anim';", ['alias']],
    ['Easing by a default import beside named ones', "import Easing, { View } from './anim';", ['alias']],
    ['the motion module imported whole under another name', "import * as M from './motion';", ['alias']],
    ['the token module default-imported under another name', "import T from './motion-tokens';", ['alias']],
    /* Review of #1367: the driver ban read timing, spring and decay only. */
    ['Animated.event off the native driver', 'const onScroll = Animated.event([], { useNativeDriver: false });', ['js-driver']],
    ['Animated.event with no config', 'const onScroll = Animated.event([]);', ['driver']],
    ['Animated.event with no useNativeDriver', 'const onScroll = Animated.event([], { listener: () => {} });', ['driver']],
    ['Animated.event with a config built elsewhere', 'const onScroll = Animated.event([], CONFIG);', ['driver']],
    ['Animated.event with the driver behind a name', 'const onScroll = Animated.event([], { useNativeDriver: NATIVE });', ['driver']],
    ['Animated.event with a spread after the driver', 'const onScroll = Animated.event([], { useNativeDriver: true, ...rest });', ['driver']],
    ['Animated.event through a namespace', "import * as RN from 'react-native';\nconst onScroll = RN.Animated.event([], { useNativeDriver: false });", ['js-driver']],
    ['a local stand-in for MOTION', `const LOCAL = { duration: { base: 380 } };\n${timing(`{ toValue: 1, duration: LOCAL.duration.base, ${OK} }`)}`, ['value', 'value']],
    ['a local EASING', 'const EASING = { standard: (t: number) => t };', ['alias']],
    ['LayoutAnimation', "import { LayoutAnimation } from 'react-native';\nLayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);", ['other-engine', 'other-engine', 'other-engine']],
    ['LayoutAnimation switched on through UIManager', 'UIManager.setLayoutAnimationEnabledExperimental?.(true);', ['other-engine']],
    ['another engine, imported', "import { withTiming } from 'react-native-reanimated';", ['other-engine']],
    ['another engine, required', "const { MotiView } = require('moti');", ['other-engine']],
  ])('refuses %s', (_name, source, expected) => {
    expect(kinds(source)).toEqual(expected);
  });

  it('reads the builder forms only in the file that builds EASING', () => {
    const builder = 'const bezier = ([a, b, c, d]: readonly [number, number, number, number]) => Easing.bezier(a, b, c, d);\nexport const EASING = { standard: bezier(MOTION.easing.standard) } as const;';
    expect(kinds(builder, { buildsEasing: true })).toEqual([]);
    expect(kinds(builder)).toEqual(['easing', 'alias']);
    /* …and even there, only fed a token tuple, and only inside `bezier` itself. */
    expect(kinds(`${builder}\nconst mine = bezier([0.2, 0.8, 0.2, 1]);`, { buildsEasing: true })).toEqual(['easing']);
    expect(kinds(`${builder}\nconst [a, b, c, d] = [0.2, 0.8, 0.2, 1];\nconst mine = Easing.bezier(a, b, c, d);`, { buildsEasing: true })).toEqual(['easing']);
  });

  it('allows a value only when it is written out exactly', () => {
    const passthrough = timing(`{ toValue: 1, duration: MOTION.duration.base, delay: reduce ? 0 : delay, ${OK} }`);
    expect(kinds(passthrough)).toEqual(['value']);
    expect(kinds(passthrough, { allowValues: ['reduce ? 0 : delay'] })).toEqual([]);
    expect(kinds(passthrough.replace(': delay,', ': delay * 2,'), { allowValues: ['reduce ? 0 : delay'] })).toEqual(['value']);
  });

  it('counts every animation it read, on one line or many', () => {
    const source = `${PREAMBLE}${timing(`{ toValue: 1, duration: MOTION.duration.base, ${OK} }`)}\n${spring('{\n  toValue: 1,\n  ...MOTION.spring.sheet,\n  useNativeDriver: true,\n}')}`;
    expect(scanMotionLiterals(source).calls).toBe(2);
  });
});

describe('the motion ban, over the whole native directory', () => {
  const NATIVE_DIR = resolve(__dirname, '..');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });

  /** The two places that are not animation code, each with its reason. */
  const NOT_SCANNED: Record<string, string> = {
    'motion-tokens.ts': 'BUILDS `MOTION` out of `tokens.motion`; its values are pinned by value above, `mass: 1` included',
    'testing/': 'the matchers themselves: they name every forbidden spelling in order to refuse it',
  };

  /** What `motion.tsx` may write that is not a `MOTION` read: a caller's own `delay`, passed through. */
  const OPTIONS: Record<string, MotionScanOptions> = {
    'motion.tsx': { buildsEasing: true, allowValues: ['reduce ? 0 : delay', 'delay + staggerDelay(index)'] },
  };

  /**
   * What each file still carries, by kind, EXACTLY — more is a regression and FEWER reds too, so a
   * fix forces the record shrunk. Two groups. The v2 identity files carry only what is deliberate.
   * The rest predate the motion tokens: they are recorded so that the ban's claim is true of the
   * directory rather than of the files someone thought to list, not because they are fine.
   */
  const RECORDED: Record<string, { counts: Partial<Record<MotionOffenceKind, number>>; why: string }> = {
    'motion.tsx': { counts: { 'default-easing': 1 }, why: "the reduced-motion press timing names no easing, so it runs React Native's ease-in-out over duration.press" },
    'FeatureTile.tsx': { counts: { 'default-easing': 2 }, why: 'the selected crossfade and its reduced-motion check name no easing' },
    'CoinChip.tsx': { counts: { 'js-driver': 1 }, why: 'the count-up drives TEXT, which the native driver cannot reach — one balance chip in a header, never a list' },
    'ChatMessageMetadata.tsx': { counts: { value: 1, easing: 1 }, why: 'pre-v2: the streaming pulse keeps its own half-period and ease' },
    'ChatSoundWave.tsx': { counts: { value: 4, easing: 2 }, why: 'pre-v2: the sound-wave bars keep their own period, stagger and ease' },
    'CodeBlock.tsx': { counts: { value: 1 }, why: 'pre-v2: the "copied" state settles on its own timer' },
    'Dialog.tsx': { counts: { value: 3, easing: 1, 'default-easing': 2 }, why: 'pre-v2: the sheet keeps its own enter/exit and snap-back timings' },
    'Skeleton.tsx': { counts: { value: 1, easing: 1 }, why: 'pre-v2: the shimmer loop keeps its own period, linear by nature' },
    'Spinner.tsx': { counts: { value: 1, easing: 1 }, why: 'pre-v2: the spin keeps its own period, linear by nature' },
    'Switch.tsx': { counts: { value: 1, 'default-easing': 1 }, why: 'pre-v2: the thumb keeps its own 150 ms' },
    /* UMK-1487 moved the toast's entrance and exit onto `spring.sheet` / `easing.exit`; what is left is
       the DWELL — the 4000 ms default, its per-toast override and the timer that reads it. */
    'Toaster.tsx': { counts: { value: 3 }, why: 'the dwell time only (a product default, not a motion token); the slide in and out are MOTION reads' },
  };

  const scanned = walk(NATIVE_DIR)
    .map((path) => relative(NATIVE_DIR, path))
    .filter((rel) => !Object.keys(NOT_SCANNED).some((skip) => rel === skip || rel.startsWith(skip)))
    .map((rel) => {
      const source = readFileSync(join(NATIVE_DIR, rel), 'utf8');
      /* Counted a SECOND way, off the text: the anti-vacuity check for the parser's walk. */
      const written = (blankComments(source, rel).match(/\bAnimated\s*\.\s*(timing|spring|decay)\s*\(/g) ?? []).length;
      return { rel, written, ...scanMotionLiterals(source, rel, OPTIONS[rel]) };
    });

  it('walks the whole directory, and reads every animation written in it', () => {
    /* 80+ source files today; a walk that lost its recursion leaves the ~70 at the top level, so the
       named nested file is what catches that, and the floor what catches a walk that stops early. */
    expect(scanned.length).toBeGreaterThanOrEqual(70);
    expect(scanned.map(({ rel }) => rel)).toContain('glyphs/generated.tsx');
    /* Per file, not in total: a truncated walk reads SOME calls, and a total hides which file lost them. */
    expect(scanned.filter(({ calls, written }) => calls !== written).map(({ rel, calls, written }) => ({ rel, calls, written }))).toEqual([]);
    expect(scanned.find(({ rel }) => rel === 'motion.tsx')?.calls).toBeGreaterThanOrEqual(3);
    expect(scanned.reduce((sum, { calls }) => sum + calls, 0)).toBeGreaterThanOrEqual(35);
  });

  it('no file carries a motion value, an easing or a JS-driven animation it is not recorded for', () => {
    const over = scanned.flatMap(({ rel, offences }) => {
      const counts = countByKind(offences);
      const allowed = RECORDED[rel]?.counts ?? {};
      return (Object.keys(counts) as MotionOffenceKind[])
        .filter((kind) => (counts[kind] ?? 0) > (allowed[kind] ?? 0))
        .map((kind) => `${rel}: ${counts[kind]} × ${kind} (recorded ${allowed[kind] ?? 0}) — ${offences.filter((o) => o.kind === kind).map((o) => `${o.line} ${o.text}`).join(' | ')}`);
    });
    expect(over).toEqual([]);
  });

  it('records nothing that is no longer there', () => {
    const stale = Object.entries(RECORDED).flatMap(([rel, { counts }]) => {
      const found = countByKind(scanned.find((file) => file.rel === rel)?.offences ?? []);
      return (Object.keys(counts) as MotionOffenceKind[]).filter((kind) => (found[kind] ?? 0) < (counts[kind] ?? 0)).map((kind) => `${rel}: recorded ${counts[kind]} × ${kind}, found ${found[kind] ?? 0}`);
    });
    expect(stale).toEqual([]);
  });

  it('gives its reason for every exception', () => {
    for (const { why } of Object.values(RECORDED)) expect(why.length).toBeGreaterThan(20);
    for (const rel of Object.keys(OPTIONS)) expect(scanned.map((file) => file.rel)).toContain(rel);
  });
});
