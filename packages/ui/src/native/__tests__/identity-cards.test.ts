/**
 * The native-ui-v2 identity cards — `FeatureTile`, `PhotoCard`, `CoinChip` — pinned where vitest
 * can reach them (docs/guidelines/mobile-design-identity.md §2.3, §4.2, §4.3, §4.7, §7).
 *
 * The pure half (`identity-card-styles.ts`) is IMPORTED; the components are read as TEXT, because
 * `react-native`'s entry is Flow and does not load here. Behaviour (press, count-up, the check
 * spring) is tested in `apps/mobile/src/design/__tests__/identity-cards.test.tsx`.
 *
 * ## The bans in this file, and what was proved (review finding 15)
 *
 * Five assertions here say that something is ABSENT. Each was one regex — one spelling — and a ban
 * asserts that nothing matches, so its assertion is its matcher
 * (docs/solutions/conventions/an-injection-proof-only-proves-the-spellings-you-chose.md). Each is
 * now stated as what it forbids, with the spellings injected one at a time into a real scanned
 * file. "Old guard" is the SAME injection run against this file as it stood at HEAD — measured,
 * not read off the regex.
 *
 * ### Ban 1 — a colour that is not a token
 *
 * Was `#[0-9a-fA-F]{3,8}\b` and `rgba?\(`. Now `scanColourLiterals`, the matcher
 * `no-raw-colour.test.ts` runs over the whole directory. Into `FeatureTile.tsx`; every red is
 * "FeatureTile.tsx carries no colour literal".
 *
 * | Spelling injected | Old guard | Now |
 * | -- | -- | -- |
 * | `borderColor: '#F0F0F0'` | red | red |
 * | `'rgba(0,0,0,0.1)'` | red | red |
 * | `'hsl(0 0% 0%)'` | **green** | red |
 * | `'oklch(70% 0.1 200)'` | **green** | red |
 * | `color: 'white'` | **green** | red |
 * | `borderColor: 0xfff0f0f0` | **green** | red |
 * | `` `${tokens.border.glass.default}cc` `` | **green** | red |
 * | CEILING: `borderColor: BRAND`, a colour behind a name imported from another module | green | green — the scan is lexical; the constant's own declaration is what gets caught, in its own file |
 *
 * ### Ban 2 — a text weight or face set here instead of through `Text`'s `weight`
 *
 * Was the bare word `fontWeight`. Now `\bfont(Weight|Family)\b`. Every red is
 * "<file> sets no fontWeight and no fontFamily".
 *
 * | Spelling injected | Into | Old guard | Now |
 * | -- | -- | -- | -- |
 * | `{ fontWeight: '700' }` | `identity-card-styles.ts` | red | red |
 * | `{ 'fontWeight': '700' }` | `identity-card-styles.ts` | red | red |
 * | `<Text fontWeight="700">` | `PhotoCard.tsx` | red | red |
 * | `{ fontFamily: 'PlusJakartaSans-Bold' }` | `identity-card-styles.ts` | **green** | red |
 * | CEILING: `{ ['font' + 'Weight']: '700' }` | `identity-card-styles.ts` | green | green — a key that is COMPUTED is not a word in the source |
 *
 * ### Ban 3 — a tappable that does not go through `PressableScale`
 *
 * Was `not.toMatch(/<Pressable\b/)`. Now the allowed form: every touch handler in the file is an
 * attribute of a `PressableScale` (or `PressableScaleHost`) imported from `./motion`, and React
 * Native's other tappables are refused by name. Into `PhotoCard.tsx`; every red is "PhotoCard.tsx
 * presses through PressableScale, and through nothing else".
 *
 * | Spelling injected | Old guard | Now |
 * | -- | -- | -- |
 * | `<Pressable />` | red | red |
 * | `<TouchableOpacity />` | **green** | red |
 * | `<Text onPress={…}>` | **green** | red |
 * | `<View onLongPress={…} />` | **green** | red |
 * | `<View onTouchEnd={…} />` | **green** | red |
 * | `<View onStartShouldSetResponder={…} />` | **green** | red |
 * | `const P = Pressable` | **green** | red |
 * | `React.createElement(View, {})` | **green** | red |
 * | `<View {...{ onPress: … }} />`, the handler as an object key | **green** | red |
 * | `const PressableScale = View`, the name redeclared | **green** | red |
 * | `<RectButton />` (gesture-handler) | **green** | red |
 * | `<Card onPress={…} />`, another component given the press | **green** | red |
 * | CEILING: `<Card onTap={…} />`, a tappable from another module with its own handler name | green | green — nothing in this file says `onTap` is a touch |
 * | CEILING: `<View {...press} />`, a props object built in another module | green | green — the keys are not in this file |
 *
 * ### Ban 4 — a duration, delay, spring or easing that is not a `MOTION` read; an animation off the native driver
 *
 * Was `duration:\s*\d`, `(damping|stiffness|mass):\s*\d` and `Easing\.bezier\(\s*\d` over the
 * three components, with no driver check at all. Now the shared matcher
 * (`../testing/motion-literals`, whose docblock is the table of spellings) over all five files,
 * with what they deliberately carry recorded EXACTLY. Every red is "FeatureTile.tsx spells no
 * motion value of its own", and nothing else.
 *
 * | Spelling injected into `FeatureTile.tsx` | Old guard | Now |
 * | -- | -- | -- |
 * | `duration: 380` | red | red |
 * | `const D = 380; … duration: D` | **green** | red |
 * | `duration: MOTION.duration.base * 2` | **green** | red |
 * | `const duration = …; { toValue: 1, duration, … }` | **green** | red |
 * | `Animated.timing(v, cfg)`, `cfg` built by a call | **green** | red |
 * | `{ toValue: 1, ...SLOW, … }` | **green** | red |
 * | `'duration': 380` | **green** | red |
 * | `duration : 380` | **green** | red |
 * | `duration: reduce ? 120 : 380` | **green** | red |
 * | `delay: 120` | **green** | red |
 * | `Animated.delay(120)` | **green** | red |
 * | `Animated.stagger(40, [])` | **green** | red |
 * | `tension: 40, friction: 7` | **green** | red |
 * | `speed: 12, bounciness: 8` | **green** | red |
 * | a spring with no physics (RN default) | **green** | red |
 * | a timing with no `duration` (RN default 500 ms) | **green** | red |
 * | `...MOTION.spring.press, mass: 3` | red | red |
 * | `damping: DAMP`, a named constant | **green** | red |
 * | `import { Easing as E }`, then `E.bezier(.2, .8, .2, 1)` | **green** | red |
 * | `Easing.bezier(.2, .8, .2, 1)` | **green** | red |
 * | `Easing.bezier(...[0.2, 0.8, 0.2, 1])` | **green** | red |
 * | `easing: Easing.out(Easing.quad)` | **green** | red |
 * | `easing: (x) => x * x` | **green** | red |
 * | `Easing.bezier(...CURVE)`, a named tuple | **green** | red |
 * | `useNativeDriver: false` | **green** | red |
 * | `useNativeDriver: !1` | **green** | red |
 * | `useNativeDriver` omitted | **green** | red |
 * | `useNativeDriver : false` | **green** | red |
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
 * ZERO offences. Each row is one line appended to the real `FeatureTile.tsx`, the suite run, the line
 * removed; "Matcher before" is the same injection run before `motion-literals.ts` was changed.
 * Every red is the single assertion "FeatureTile.tsx spells no motion value of its own".
 *
 * | Spelling injected into `FeatureTile.tsx` | Matcher before | Now |
 * | -- | -- | -- |
 * | `import * as MOTION from './motion-tokens'`, a namespace import | **green** | red |
 * | `import MOTION from './motion-tokens'`, a default import | **green** | red |
 * | `import Animated from 'react-native'`, `Animated` by a default import | **green** | red |
 * | `import * as M from './motion'`, the tokens whole under another name | **green** | red |
 * | `Animated.event([], { useNativeDriver: false })` | **green** | red |
 * | `Animated.event([])`, no driver named at all | **green** | red |
 *
 * The record, in both directions: `CoinChip.tsx`'s recorded `useNativeDriver: false` changed to
 * `true` → red ("CoinChip.tsx spells no motion value of its own": fewer than recorded), and one of
 * `FeatureTile.tsx`'s two recorded default easings given `easing: EASING.standard` → red, the same
 * way. Both were green on the old guard, which recorded nothing.
 *
 * Ceiling, injected into `FeatureTile.tsx` and GREEN:
 *
 * | Spelling injected | Result | Why it is not caught |
 * | -- | -- | -- |
 * | `fadeTo(v, 1, 380)`, a helper from another module | green | the scan reads one file, and a positional number in a call it does not know is not a duration to it |
 * | a `requestAnimationFrame` / `Date.now()` loop | green | there is no config object to read |
 * | `outputRange: [0.4, 1]`, a scale in an interpolation | green | not a duration, a spring or an easing; the pop and press scales are tokens, pinned by value in `motion-tokens.test.ts` |
 * | `duration: MOTION.duration.slow` where another token was meant | green | a token is a token here. WHICH token each leg uses is Jest's to pin, on the configs each animation is asked for |
 *
 * ### Ban 5 — a coin amount the component decides for itself
 *
 * Was `(amount|price)\s*=\s*\d`. Now the allowed form: the only things ever formatted as coins
 * are the `price`/`amount` props and the count-up's frame of one, and neither prop is given a value
 * here. Into `PhotoCard.tsx` unless the row says otherwise; every red is "hard-codes no price: the
 * amount is always the prop".
 *
 * | Spelling injected | Old guard | Now |
 * | -- | -- | -- |
 * | `({ price = 5 }) =>`, a default | red | red |
 * | `x.price = 5`, an assignment | red | red |
 * | `<CoinChip amount={5} />` | **green** | red |
 * | `price ?? 5` | **green** | red |
 * | `price \|\| 5` | **green** | red |
 * | `formatCoins(5)` | **green** | red |
 * | `const PRICE = 5; formatCoins(PRICE)` | **green** | red |
 * | `<CoinChip amount={PRICE} />` | **green** | red |
 * | `<Text>5 koin</Text>` | **green** | red |
 * | `<Text>{'5'}</Text>` | **green** | red |
 * | `{ amount: 5 }`, an object key | **green** | red |
 * | `formatCoins(Math.max(price, 5))` | **green** | red |
 * | `useCountUp(5, isBalance)` in `CoinChip.tsx` | **green** | red |
 * | CEILING: `<Text>{String(5)}</Text>`, a number COMPUTED into text | green | green — the scan reads what is written, not what it evaluates to |
 *
 * Also out of reach, by construction: a price a CALLER hard-codes and passes in as the prop. That
 * is the caller's file, and this ban is about these three.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';
import { tokens } from '../../tokens';
import { blankComments, scanColourLiterals } from '../testing/colour-literals';
import { countByKind, scanMotionLiterals, type MotionOffenceKind } from '../testing/motion-literals';
import {
  COIN_CHIP_VARIANT,
  FEATURE_TILE_TONE,
  coverAnchoredSize,
  countUpFrame,
  formatCoins,
  hitSlopFor,
} from '../identity-card-styles';

const NATIVE_DIR = resolve(__dirname, '..');
const read = (name: string) => readFileSync(resolve(NATIVE_DIR, name), 'utf8');
const COMPONENTS = ['FeatureTile.tsx', 'PhotoCard.tsx', 'CoinChip.tsx'] as const;
const FILES = [...COMPONENTS, 'identity-card-styles.ts', 'coin-glyph.tsx'] as const;

describe('formatCoins mirrors the app formatter', () => {
  /* The SAME outputs `apps/mobile/src/temanai/__tests__/credit.test.ts` pins on `formatCredits`.
     The two are hand-mirrored (this package cannot import app code), so the cases are too. */
  it.each([
    [null, '∞'],
    [0, '0'],
    [1, '1'],
    [24, '24'],
    [0.5, '0,5'],
    [2.25, '2,25'],
    [3.0, '3'],
    [1500, '1.500'],
    [2813, '2.813'],
    [1_250_000, '1.250.000'],
    [1500.5, '1.500,5'],
  ] as const)('%s → %s', (input, out) => {
    expect(formatCoins(input)).toBe(out);
  });
});

describe('countUpFrame', () => {
  it('starts at the old value and lands on the new one', () => {
    expect(countUpFrame(100, 2813, 0)).toBe(100);
    expect(countUpFrame(100, 2813, 1)).toBe(2813);
  });

  it('draws only whole numbers between two whole numbers', () => {
    for (const p of [0.1, 0.33, 0.5, 0.77]) expect(Number.isInteger(countUpFrame(0, 7, p))).toBe(true);
  });

  it('keeps two decimals when either end is fractional', () => {
    expect(countUpFrame(0, 0.5, 0.5)).toBe(0.25);
  });

  it('counts down as well as up', () => {
    expect(countUpFrame(10, 0, 0.5)).toBe(5);
  });
});

describe('coverAnchoredSize', () => {
  it('covers the box at the art aspect ratio, overflowing on one axis only', () => {
    /* A 1:1 art on a 350 × 200 card: width governs, the extra height overflows upward. */
    expect(coverAnchoredSize({ width: 350, height: 200 }, { width: 100, height: 100 })).toEqual({ width: 350, height: 350 });
    /* A wide art: height governs, the extra width overflows leftward. */
    expect(coverAnchoredSize({ width: 350, height: 200 }, { width: 400, height: 100 })).toEqual({ width: 800, height: 200 });
  });

  it('refuses to guess when either size is unknown', () => {
    expect(coverAnchoredSize({ width: 0, height: 200 }, { width: 10, height: 10 })).toBeUndefined();
    expect(coverAnchoredSize({ width: 350, height: 200 }, { width: 0, height: 0 })).toBeUndefined();
  });
});

describe('the tone vocabulary is one list', () => {
  const axis = [...contract.FeatureTile.axes.tone].sort();

  it('names exactly the seven identity tones (§2.3)', () => {
    expect(axis).toEqual(['blue', 'green', 'neutral', 'orange', 'purple', 'red', 'yellow']);
  });

  it('matches both token groups and the style table', () => {
    expect(Object.keys(tokens.surface.tile).sort()).toEqual(axis);
    expect(Object.keys(tokens.icon.tile).sort()).toEqual(axis);
    expect(Object.keys(FEATURE_TILE_TONE).sort()).toEqual(axis);
  });

  it('paints each tone from its own pair', () => {
    for (const tone of axis as (keyof typeof FEATURE_TILE_TONE)[]) {
      expect(FEATURE_TILE_TONE[tone]).toEqual({ surface: tokens.surface.tile[tone], glyph: tokens.icon.tile[tone] });
    }
  });
});

describe('CoinChip paint', () => {
  it('reads the published chip pairs, and brand ink on the white balance chip with the one card edge (UMK-1603)', () => {
    expect(COIN_CHIP_VARIANT.price).toMatchObject({ bg: tokens.surface.chip.price, ink: tokens.text.chip.price });
    expect(Object.keys(COIN_CHIP_VARIANT).sort()).toEqual(['balance', 'price']);
    expect(COIN_CHIP_VARIANT.balance).toEqual({ bg: tokens.surface.default.primary, ink: tokens.brand.b500, border: tokens.border.default.primary });
  });

  it('pads a pressable chip up to the 44 pt target and never below zero', () => {
    expect(hitSlopFor(40)).toBe(2);
    expect(hitSlopFor(24)).toBe(10);
    expect(hitSlopFor(56)).toBe(0);
  });

  it('draws its coin from the identity disc token and the shared mark', () => {
    const glyph = read('coin-glyph.tsx');
    expect(glyph).toMatch(/tokens\.icon\.coin\.default/);
    expect(glyph).toMatch(/CREDIT_COIN_MARK_PATH/);
  });
});

/** Comments blanked by the PARSER, strings kept: what the bans read. */
const blanked = (file: string) => blankComments(read(file), file);

/**
 * Every JSX attribute in a file, with the tag it sits on — and every key of an OBJECT LITERAL,
 * under the tag `{}`, because a handler can be handed over as `{...{ onPress }}` or
 * `{ onPress: go }` instead of as an attribute. (A destructured `{ onPress }` is a binding, not an
 * object literal, and is not listed.)
 */
const jsxAttributes = (file: string): { tag: string; name: string }[] => {
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: { tag: string; name: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) found.push({ tag: node.parent.parent.tagName.getText(tree), name: node.name.getText(tree) });
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isObjectLiteralExpression(node.parent)) {
      found.push({ tag: '{}', name: node.name.getText(tree).replace(/^['"]|['"]$/g, '') });
    }
    /* Braces, not an expression body: a truthy return truncates `forEachChild`. */
    ts.forEachChild(node, (child) => {
      visit(child);
    });
  };
  visit(tree);
  return found;
};

/** A handler that makes a view answer a touch, by any of React Native's names for one. */
const TOUCH_HANDLER = /^on(Press|PressIn|PressOut|LongPress|Touch[A-Z]\w*|Responder[A-Z]\w*|StartShouldSetResponder\w*|MoveShouldSetResponder\w*|Click)$/;

describe('identity card sources', () => {
  /* BAN 1. No colour that is not a token — the directory guard's own matcher
     (`no-raw-colour.test.ts`), so a spelling closed there is closed here. */
  it.each(FILES)('%s carries no colour literal', (file) => {
    expect(scanColourLiterals(blanked(file))).toEqual([]);
  });

  /* BAN 2. No text weight or face set here: weight goes through `Text`'s `weight` prop. The bare
     WORD, so the style key, the quoted key and the JSX attribute are one match. */
  it.each(FILES)('%s sets no fontWeight and no fontFamily', (file) => {
    expect(blanked(file)).not.toMatch(/\bfont(Weight|Family)\b/);
  });

  /* BAN 3. A tappable that does not go through `PressableScale` (§7.2 "Press"): it would press
     with no scale and no reduced-motion handling. Written from the allowed form — every touch
     handler in the file sits on a `PressableScale`, which comes from `./motion` — and then the
     other ways React Native makes a view tappable are refused by name. */
  it.each(COMPONENTS)('%s presses through PressableScale, and through nothing else', (file) => {
    const source = blanked(file);
    const handlers = jsxAttributes(file).filter(({ name }) => TOUCH_HANDLER.test(name));
    /* Anti-vacuity, against a second count off the text: each component has exactly one press. */
    expect(handlers).toHaveLength((source.match(/\bonPress=/g) ?? []).length);
    expect(handlers).toHaveLength(1);
    expect(handlers.filter(({ tag }) => tag !== 'PressableScale' && tag !== 'PressableScaleHost')).toEqual([]);
    expect(source).toMatch(/<PressableScale\b/);
    expect(source).toMatch(/import \{[^}]*\bPressableScale\b[^}]*\} from '\.\/motion';/);
    /* `PressableScale` is the imported one: never redeclared, never an alias for something else. */
    expect(source).not.toMatch(/\b(const|let|var|function|class)\s+PressableScale\b|\bas\s+PressableScale\b|\bPressableScale\s+as\b/);
    /* The word, not the tag: an import, an alias (`const P = Pressable`), `createElement(Pressable)`
       and `createAnimatedComponent(Pressable)` all name it. `PressableScale` is a different word. */
    expect(source).not.toMatch(/\bPressable\b/);
    expect(source).not.toMatch(/\bTouchable\w*/);
    expect(source).not.toMatch(/\b(RectButton|BaseButton|BorderlessButton|GestureDetector|\w*GestureHandler)\b|react-native-gesture-handler/);
    expect(source).not.toMatch(/\bcreateElement\b/);
  });

  /* BAN 4. No duration, delay, spring or easing that is not a MOTION read, and nothing off the
     native driver (§7.1, §7.3 rule 2) — the shared matcher, with what these files deliberately
     carry recorded EXACTLY, so both a new one and a fixed one red. */
  const MOTION_RECORDED: Record<string, Partial<Record<MotionOffenceKind, number>>> = {
    /* The selected crossfade and its reduced-motion check name no easing (RN's ease-in-out). */
    'FeatureTile.tsx': { 'default-easing': 2 },
    /* The count-up drives TEXT, which the native driver cannot reach. */
    'CoinChip.tsx': { 'js-driver': 1 },
  };
  it.each(FILES)('%s spells no motion value of its own', (file) => {
    const { offences } = scanMotionLiterals(read(file), file);
    expect(countByKind(offences), offences.map((o) => `${o.line} ${o.kind} ${o.text}`).join('\n')).toEqual(MOTION_RECORDED[file] ?? {});
  });

  it('read every animation the two animated cards write', () => {
    /* Per file, against a SECOND count taken off the text: a truncated walk still reads some. */
    for (const [file, floor] of [
      ['FeatureTile.tsx', 3],
      ['CoinChip.tsx', 1],
    ] as const) {
      const written = (blanked(file).match(/\bAnimated\s*\.\s*(timing|spring|decay)\s*\(/g) ?? []).length;
      expect(scanMotionLiterals(read(file), file).calls, file).toBe(written);
      expect(written, file).toBeGreaterThanOrEqual(floor);
    }
  });

  /* BAN 5. A coin amount the component decides for itself. The amount is ALWAYS the caller's,
     read from the live price book (identity §4.7: "never a guess"). Written from the allowed form:
     the only things ever formatted as coins are the `price`/`amount` props and the count-up's
     frame of one, and `price`/`amount` are never given a value here — no default, no fallback, no
     assignment, no literal handed on as a prop. */
  it('hard-codes no price: the amount is always the prop', () => {
    const formatted = (file: string) => [...blanked(file).matchAll(/\bformatCoins\(([^()]*)\)/g)].map(([, arg]) => arg!.trim());
    expect(formatted('FeatureTile.tsx')).toEqual([]);
    expect(formatted('PhotoCard.tsx')).toEqual(['price', 'price']);
    expect(formatted('CoinChip.tsx')).toEqual(['shown', 'amount']);
    /* …and no call the pattern above could not read (a nested call as the argument). */
    for (const file of COMPONENTS) expect((blanked(file).match(/\bformatCoins\(/g) ?? []).length, file).toBe(formatted(file).length);
    /* `shown` is the count-up of the prop, and nothing else. */
    expect(blanked('CoinChip.tsx')).toMatch(/const shown = useCountUp\(amount, isBalance\);/);
    expect(blanked('CoinChip.tsx').match(/\bshown\b\s*=[^=>]/g)).toHaveLength(1);

    for (const file of COMPONENTS) {
      const source = blanked(file);
      /* A default (`price = 5`), a fallback (`price ?? 5`, `price || 5`) or an assignment. */
      expect(source, file).not.toMatch(/\b(amount|price)\s*(\?\?|\|\||=(?![=>]))/);
      /* Handed on as a prop with anything but the prop itself: `amount={5}`, `amount={PRICE}`. */
      expect(source, file).not.toMatch(/\b(amount|price)=(?!\{(amount|price)\})/);
      /* A number drawn as text: `<Text>5</Text>`, `{5}`, `{'5'}`. */
      expect(source, file).not.toMatch(/>\s*\d[\d.,]*\s*(koin)?\s*</);
      expect(source, file).not.toMatch(/[>}]\s*\{\s*['"`]?\d[\d.,]*(\s*koin)?['"`]?\s*\}/);
    }
    /* `price:`/`amount:` appear only as the props' TYPES. */
    const typed = (file: string) => [...blanked(file).matchAll(/\b(?:amount|price)\??\s*:\s*[^;,}\n]+/g)].map(([text]) => text);
    expect(typed('FeatureTile.tsx')).toEqual(['price?: React.ReactNode']);
    expect(typed('PhotoCard.tsx')).toEqual(['price?: number | null']);
    expect(typed('CoinChip.tsx')).toEqual(['amount: number | null ']);
  });

  it('presses the grid tile at card depth and the row at default depth', () => {
    expect(read('FeatureTile.tsx')).toMatch(/scale=\{isRow \? 'default' : 'card'\}/);
    expect(read('PhotoCard.tsx')).toMatch(/scale="card"/);
  });
});
