/**
 * The native-ui-v2 navigation chrome — `TabBar`, `IconButton`, `ChatDrawer variant="floating"`
 * — keeps the identity's motion and accessibility rules (docs/guidelines/mobile-design-identity.md
 * §5.1, §5.2, §7, §8).
 *
 * SOURCE-SCANNED, like the other native guards here: `react-native` does not load under vitest.
 * The behaviour (a press selects, the pill springs, the scrim closes) is exercised by Jest in
 * `apps/mobile/src/design/__tests__/nav-chrome.test.tsx`. THIS file is the half sited in the
 * package, because turbo caches `test` per package and a guard only in `apps/mobile` can replay
 * a cached pass over a regression here
 * (docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md).
 *
 * What it pins is what a green behaviour suite would NOT notice, because Jest never sees a
 * native-driver value move: that every animation reads `MOTION` rather than a number, that the
 * tappables go through `PressableScale`, and the accessibility roles.
 *
 * ## The bans in this file, and what was proved (review finding 15)
 *
 * Six assertions here say that something is ABSENT. Each used to be one regex — one spelling — and
 * a ban asserts that nothing matches, so its assertion is its matcher
 * (docs/solutions/conventions/an-injection-proof-only-proves-the-spellings-you-chose.md). Each is
 * now stated as what it forbids, with the spellings injected one at a time into a real scanned
 * file. "Old guard" is the SAME injection run against this file as it stood at HEAD — measured,
 * not read off the regex.
 *
 * ### Bans 1 and 2 — a duration, delay, spring or easing that is not a `MOTION` read; an animation off the native driver
 *
 * Was `duration:\s*\d`, `(damping|stiffness):\s*\d`, `Easing\.bezier\(\s*\.?\d` and
 * `useNativeDriver:\s*false`, over `TabBar` and `ChatDrawer`. Now the shared matcher
 * (`../testing/motion-literals`, whose docblock is the table of spellings), over all four files,
 * with NOTHING recorded. Every red is "TabBar.tsx spells no duration, spring or easing of its own,
 * and animates only on the native driver".
 *
 * | Spelling injected into `TabBar.tsx` | Old guard | Now |
 * | -- | -- | -- |
 * | `duration: 380` | red | red |
 * | `const D = 380; … duration: D` | **green** | red |
 * | `duration: MOTION.duration.base * 2` | **green** | red |
 * | `const duration = …; { toValue: 1, duration, … }` | **green** | red |
 * | `Animated.timing(v, cfg)`, `cfg` built by a call | red | red ×2 † |
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
 * | `...MOTION.spring.press, mass: 3` | **green** | red |
 * | `damping: DAMP`, a named constant | **green** | red |
 * | `import { Easing as E }`, then `E.bezier(.2, .8, .2, 1)` | **green** | red |
 * | `Easing.bezier(.2, .8, .2, 1)` | red | red |
 * | `Easing.bezier(...[0.2, 0.8, 0.2, 1])` | **green** | red |
 * | `easing: Easing.out(Easing.quad)` | **green** | red |
 * | `easing: (x) => x * x` | **green** | red |
 * | `Easing.bezier(...CURVE)`, a named tuple | **green** | red |
 * | `useNativeDriver: false` | red | red ×2 † |
 * | `useNativeDriver: !1` | red | red ×2 † |
 * | `useNativeDriver` omitted | red | red ×2 † |
 * | `useNativeDriver : false` | red | red ×2 † |
 * | `const A = Animated; A.timing(…)` | **green** | red |
 * | a local `{ duration: { base: 380 } }` read as `X.duration.base` | **green** | red |
 * | `setTimeout(fn, 380)` | **green** | red |
 * | `LayoutAnimation.configureNext(Presets.easeInEaseOut)` | red | red ×2 † |
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
 * ZERO offences. Each row is one line appended to the real `TabBar.tsx`, the suite run, the line
 * removed; "Matcher before" is the same injection run before `motion-literals.ts` was changed.
 * Every red is the single assertion "TabBar.tsx spells no duration, spring or easing of its own, and animates only on the native driver".
 *
 * | Spelling injected into `TabBar.tsx` | Matcher before | Now |
 * | -- | -- | -- |
 * | `import * as MOTION from './motion-tokens'`, a namespace import | **green** | red |
 * | `import MOTION from './motion-tokens'`, a default import | **green** | red |
 * | `import Animated from 'react-native'`, `Animated` by a default import | **green** | red |
 * | `import * as M from './motion'`, the tokens whole under another name | **green** | red |
 * | `Animated.event([], { useNativeDriver: false })` | **green** | red |
 * | `Animated.event([])`, no driver named at all | **green** | red |
 *
 * † also reds "runs EVERY TabBar animation on the native driver…", the older count of
 * `useNativeDriver: true` against `Animated.timing|spring(`, which states the same fact a second way.
 *
 * Into `ChatDrawer.tsx`, the second animated file: a named-constant duration (old guard
 * **green**), an omitted `useNativeDriver` (old guard **green** — the count was `TabBar`'s only),
 * and `const EASE_MINE = Easing.bezier(0.4, 0, 1, 1)` (old guard red) — each now red on
 * "ChatDrawer.tsx spells no duration…", one assertion each.
 *
 * Ceiling, injected into `TabBar.tsx` and GREEN:
 *
 * | Spelling injected | Result | Why it is not caught |
 * | -- | -- | -- |
 * | `fadeTo(v, 1, 380)`, a helper from another module | green | the scan reads one file, and a positional number in a call it does not know is not a duration to it |
 * | a `requestAnimationFrame` / `Date.now()` loop | green | there is no config object to read |
 * | `outputRange: [0.4, 1]`, a scale in an interpolation | green | not a duration, a spring or an easing; the pop and press scales are tokens, pinned by value in `motion-tokens.test.ts` |
 * | `duration: MOTION.duration.slow` where another token was meant | green | a token is a token here. WHICH token each leg uses is the positive assertions' job (and Jest's, on the configs) |
 *
 * ### Ban 3 — a colour that is not a token
 *
 * Was `#[0-9a-fA-F]{3,8}\b` and `rgba?\(`. Now `scanColourLiterals`, the matcher
 * `no-raw-colour.test.ts` runs over the whole directory. Into `TabBar.tsx`; every red is
 * "TabBar.tsx carries no colour literal".
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
 * ### Ban 4 — a text weight or face set here instead of through `Text`'s `weight`
 *
 * Was the bare word `fontWeight`. Now `\bfont(Weight|Family)\b`: a `fontFamily` literal is the
 * same thing by its other name. Every red is "<file> sets no fontWeight and no fontFamily".
 *
 * | Spelling injected | Into | Old guard | Now |
 * | -- | -- | -- | -- |
 * | `{ fontWeight: '700' }` | `nav-styles.ts` | red | red |
 * | `{ 'fontWeight': '700' }` | `nav-styles.ts` | red | red |
 * | `<Text fontWeight="700">` | `TabBar.tsx` | red | red |
 * | `{ fontFamily: 'PlusJakartaSans-Bold' }` | `nav-styles.ts` | **green** | red |
 * | CEILING: `{ ['font' + 'Weight']: '700' }` | `nav-styles.ts` | green | green — a key that is COMPUTED is not a word in the source |
 *
 * ### Ban 5 — a hidden TabBar that is not rendered
 *
 * Was `not.toMatch(/return null/)`. "Do not unmount" has too many spellings to list, so the ban is
 * now a ledger: every line of `TabBar.tsx` that reads `hidden` (or `wasHidden`), and every line
 * that writes `null`, is listed EXACTLY, beside the refused empty returns. Every red is "keeps the
 * hidden bar mounted: no empty render, and no use of `hidden` that is not recorded".
 *
 * | Spelling injected into `TabBar.tsx` | Old guard | Now |
 * | -- | -- | -- |
 * | `if (gone) return null;` | red | red |
 * | `hidden ? undefined : <View />` | **green** | red |
 * | `{!hidden && <View />}` | **green** | red |
 * | `({ hidden: gone }) => <>{gone \|\| <View />}</>`, `hidden` under another name | **green** | red |
 * | `if (gone) return <></>;` | **green** | red |
 * | `gone ? <View /> : null`, no `hidden` and no `return null` | **green** | red |
 * | `if (gone) return undefined;` | **green** | red |
 * | `() => null` | **green** | red |
 * | CEILING: `{gone \|\| <View />}` on a name that is not `hidden` and writes no `null` | green | green — a conditional render is ordinary JSX; nothing lexical ties this one to the bar being hidden |
 *
 * The ceiling is why this is the WEAKER half. The behaviour — four tabs still in the tree while
 * hidden — is rendered and asserted by Jest ("stays MOUNTED while hidden"). Also out of reach here:
 * the HOST not rendering `<TabBar>` at all, which is `apps/mobile`'s file, not this package's.
 *
 * ### Ban 6 — this package reaching a navigation library
 *
 * Was `from\s+'(expo-router|@react-navigation\/[^']+)'` over `TabBar.tsx` alone. Now the module
 * NAME as a string in either quote or a template, in every source file under `packages/ui/src`,
 * plus the manifest. Every red is "keeps @umkmall/ui free of a navigation dependency, in every
 * source file" unless the row says otherwise.
 *
 * | Spelling injected | Into | Old guard | Now |
 * | -- | -- | -- | -- |
 * | `import { Tabs } from 'expo-router'` | `TabBar.tsx` | red | red |
 * | `import type { … } from '@react-navigation/bottom-tabs'` | `TabBar.tsx` | red | red |
 * | `import { Tabs } from "expo-router"` | `TabBar.tsx` | **green** | red |
 * | `require('expo-router')` | `TabBar.tsx` | **green** | red |
 * | `import('expo-router')` | `TabBar.tsx` | **green** | red |
 * | `import '@react-navigation/native'` | `TabBar.tsx` | **green** | red |
 * | `type T = import('@react-navigation/bottom-tabs').X` | `TabBar.tsx` | **green** | red |
 * | ``require(`expo-router`)`` | `TabBar.tsx` | **green** | red |
 * | `from 'expo-router/build/link/Link'` | `TabBar.tsx` | **green** | red |
 * | `from 'react-native-screens'` | `TabBar.tsx` | **green** | red |
 * | `/// <reference types="expo-router" />` | `TabBar.tsx` | **green** | red |
 * | `import { Tabs } from 'expo-router'` | `IconButton.tsx` | **green** | red |
 * | `export * from 'expo-router'` | a new `src/zz-injection.ts`, outside `native/` | **green** | red |
 * | `"expo-router": "*"` added to `peerDependencies` | `package.json` | **green** | red — "declares no navigation library in its manifest" |
 * | CEILING: `require('expo-' + 'router')` | `TabBar.tsx` | green | green — a module name that is COMPUTED is not a string in the source |
 *
 * Also out of reach: a navigation library reached THROUGH another package this one imports.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blankComments, scanColourLiterals } from '../testing/colour-literals';
import { scanMotionLiterals } from '../testing/motion-literals';

const NATIVE = resolve(__dirname, '..');
const SRC = resolve(NATIVE, '..');
const read = (file: string) => readFileSync(resolve(NATIVE, file), 'utf8');

/** Comments blanked by the PARSER (strings kept): what the bans read. `code` below is the older,
 *  regex-stripped view the positive assertions were written against. */
const blanked = (file: string) => blankComments(read(file), file);

const FILES = ['TabBar.tsx', 'IconButton.tsx', 'ChatDrawer.tsx', 'nav-styles.ts'] as const;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|test-d|stories)\.tsx?$/.test(entry.name) ? [path] : [];
  });

/** A navigation library, by the name it is imported under. One fragment for every detector. */
const NAV_MODULE = '(?:expo-router|@react-navigation|react-navigation|react-native-screens)(?:/[^\'"`]*)?';

/** Comments out, so a rule quoted in prose cannot satisfy (or trip) an assertion. Line first. */
const code = (file: string) =>
  read(file)
    .replace(/\/\/.*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const tabBar = code('TabBar.tsx');
const iconButton = code('IconButton.tsx');
const drawer = code('ChatDrawer.tsx');
const styles = code('nav-styles.ts');

describe('the nav chrome sources', () => {
  it('reads real files, so nothing below is vacuous', () => {
    for (const source of [tabBar, iconButton, drawer, styles]) expect(source.length).toBeGreaterThan(1000);
  });

  /* BAN 1 and BAN 2. Every animation's duration, delay, spring and easing is a MOTION read, and
     every one runs on the native driver — transform and opacity only (§7.1, §7.3 rule 2). The
     matcher, its table of spellings and its ceiling are `../testing/motion-literals`. NO offence of
     any kind is recorded for these four files: not one default easing, not one JS-driven leg. */
  it.each(FILES)('%s spells no duration, spring or easing of its own, and animates only on the native driver', (file) => {
    expect(scanMotionLiterals(read(file), file).offences).toEqual([]);
  });

  it('read every animation the two animated files write', () => {
    /* Anti-vacuity for the ban above, per file and against a SECOND count taken off the text: a
       walk that truncates still reads some calls, so "more than zero" would watch it happen. */
    for (const [file, floor] of [
      ['TabBar.tsx', 12],
      ['ChatDrawer.tsx', 5],
    ] as const) {
      const written = (blanked(file).match(/\bAnimated\s*\.\s*(timing|spring|decay)\s*\(/g) ?? []).length;
      expect(scanMotionLiterals(read(file), file).calls, file).toBe(written);
      expect(written, file).toBeGreaterThanOrEqual(floor);
    }
  });

  /* BAN 3. No colour that is not a token. The matcher is the directory guard's
     (`no-raw-colour.test.ts` calls the same module), so a spelling closed there is closed here. */
  it.each(FILES)('%s carries no colour literal', (file) => {
    expect(scanColourLiterals(blanked(file))).toEqual([]);
  });

  /* BAN 4. No text weight or face set here: weight goes through `Text`'s `weight` prop, which picks
     the FACE (Android does not synthesise a weight from a static font file). The bare WORD, so the
     style key, the quoted key and the JSX attribute are one match. */
  it.each(FILES)('%s sets no fontWeight and no fontFamily', (file) => {
    expect(blanked(file)).not.toMatch(/\bfont(Weight|Family)\b/);
  });

  it('slides the indicator on the snappy spring, its trailing edge one stagger step behind, and crossfades the faces over duration.fast', () => {
    const slide = tabBar.slice(tabBar.indexOf('const slide'), tabBar.indexOf('type AnimatedNumber'));
    expect(slide).toMatch(/Animated\.spring\(lead,\s*\{[^}]*\.\.\.MOTION\.spring\.snappy,\s*useNativeDriver:\s*true/);
    expect(slide).toMatch(/Animated\.sequence\(\[\s*Animated\.delay\(MOTION\.stagger\.step\),\s*Animated\.spring\(trail,\s*\{[^}]*\.\.\.MOTION\.spring\.snappy,\s*useNativeDriver:\s*true/);
    expect(tabBar).toMatch(/Animated\.timing\(motion\.on,\s*\{\s*toValue:\s*1,\s*duration:\s*MOTION\.duration\.fast/);
    expect(tabBar).toMatch(/Animated\.timing\(motion\.on,\s*\{\s*toValue:\s*0,\s*duration:\s*MOTION\.duration\.fast/);
    expect(tabBar).toMatch(/scale="icon"/);
    expect(tabBar).toMatch(/<PressableScale\b/);
  });

  it('under reduced motion, moves both edges together over duration.press: no stretch', () => {
    const slide = tabBar.slice(tabBar.indexOf('const slide'), tabBar.indexOf('type AnimatedNumber'));
    const reduced = slide.slice(slide.indexOf('if (reduce)'), slide.indexOf('const towardsRight'));
    expect(reduced.match(/Animated\.timing\(edges\.(left|right),\s*\{\s*toValue:\s*target\.(left|right),\s*duration:\s*MOTION\.duration\.press/g)).toHaveLength(2);
    expect(reduced).not.toMatch(/delay|spring/);
  });

  it('ticks the selection haptic on a press of ANOTHER tab only, through the haptic door', () => {
    expect(tabBar).toMatch(/import \{ haptic \} from '\.\/haptics';/);
    expect(tabBar).toMatch(/if \(item\.key !== activeKey\) haptic\('selection'\);\s*onSelect\(item\.key\);/);
    expect(tabBar).not.toMatch(/expo-haptics/);
  });

  it('pops the newly active glyph 1 → pop.squash → pop.overshoot → 1, and not under reduced motion', () => {
    const enter = tabBar.slice(tabBar.indexOf('const enter'), tabBar.indexOf('const leave'));
    expect(enter).toMatch(/if \(!reduce\) \{\s*legs\.push\(\s*Animated\.sequence\(\[/);
    expect(enter).toMatch(/toValue:\s*MOTION\.pop\.squash[\s\S]*toValue:\s*MOTION\.pop\.overshoot[\s\S]*Animated\.spring\(motion\.pop,\s*\{\s*toValue:\s*1,\s*\.\.\.MOTION\.spring\.press/);
    expect(tabBar).toMatch(/transform:\s*\[\{\s*scale:\s*motion\.pop\s*\}\]/);
  });

  it('runs EVERY TabBar animation on the native driver, and never asks LayoutAnimation for the indicator', () => {
    const anims = tabBar.match(/Animated\.(timing|spring)\(/g) ?? [];
    const drivers = tabBar.match(/useNativeDriver:\s*true/g) ?? [];
    expect(anims.length).toBeGreaterThanOrEqual(12);
    expect(drivers.length).toBe(anims.length);
    /* React Native 0.86 ships `enableLayoutAnimationsOnAndroid() = false`: a LayoutAnimation
       indicator would move on iOS and JUMP on Android with nothing failing. The stretch is transforms,
       built by the tested formula (`tab-indicator.test.ts`) on `Animated` nodes.
       (The motion ban above refuses the word too, in all four files, as `other-engine`.) */
    expect(tabBar).not.toMatch(/LayoutAnimation/);
    expect(tabBar).toMatch(/tabIndicatorTransform\(ANIMATED, edges\.left, edges\.right, itemWidth\)/);
    expect(tabBar).toMatch(/transform:\s*\[\{\s*translateX:\s*indicator\.translateX\s*\},\s*\{\s*scaleX:\s*indicator\.scaleX\s*\}\]/);
  });

  it('steps the bar aside on duration.base + easing.exit, back on the sheet spring, and stays mounted', () => {
    expect(tabBar).toMatch(/Animated\.timing\(shown,\s*\{\s*toValue:\s*0,\s*duration:\s*reduce \? MOTION\.duration\.fast : MOTION\.duration\.base,\s*easing:\s*EASING\.exit/);
    expect(tabBar).toMatch(/Animated\.spring\(shown,\s*\{\s*toValue:\s*1,\s*\.\.\.MOTION\.spring\.sheet/);
    expect(tabBar).toMatch(/pointerEvents=\{hidden \? 'none' : 'auto'\}/);
    expect(tabBar).toMatch(/accessibilityElementsHidden=\{hidden\}/);
  });

  /* BAN 5. A hidden bar that is not rendered. It must stay MOUNTED (so it can animate back and
     keep its measurements); Jest proves the behaviour on a render
     (`apps/mobile/src/design/__tests__/nav-chrome.test.tsx`, "stays MOUNTED while hidden"), and
     this is the half that lives in the package. Two parts, because "do not unmount" has too many
     spellings to list: nothing in the file returns an empty render, and EVERY line that reads
     `hidden` is one of the recorded ones — so a new branch on it, in any spelling, or a second name
     for it, changes the list. */
  it('keeps the hidden bar mounted: no empty render, and no use of `hidden` that is not recorded', () => {
    const source = blanked('TabBar.tsx');
    expect(source).not.toMatch(/\breturn\s+(null|undefined|false)\b/);
    expect(source).not.toMatch(/\breturn\s*\(?\s*<>\s*<\/>/);
    expect(source).not.toMatch(/=>\s*\(?\s*(null|undefined|false)\b/);
    const uses = source
      .split('\n')
      .filter((line) => /\bhidden\b|\bwasHidden\b/.test(line))
      .map((line) => line.trim());
    expect(uses).toEqual([
      'hidden?: boolean;',
      'hidden = false,',
      'const shown = React.useRef(new Animated.Value(hidden ? 0 : 1)).current;',
      'const wasHidden = React.useRef(hidden);',
      'if (wasHidden.current === hidden) return;',
      'wasHidden.current = hidden;',
      'stepping.current = hidden',
      '}, [hidden, reduce, shown]);',
      'accessibilityElementsHidden={hidden}',
      "importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}",
      "pointerEvents={hidden ? 'none' : 'auto'}",
      '({ state, navigation, insets, hidden }: TabNavigatorBarProps & { hidden?: boolean }) => {',
      'hidden={hidden}',
    ]);
    /* The same for `null`: a render that goes away without the word `hidden` anywhere near it
       (`gone ? <Bar /> : null`). Today the file writes it only as two ref types and a reducer seed. */
    expect(source.split('\n').filter((line) => /\bnull\b/.test(line)).map((line) => line.trim())).toEqual([
      'const switching = React.useRef<Animated.CompositeAnimation | null>(null);',
      'const stepping = React.useRef<Animated.CompositeAnimation | null>(null);',
    ]);
  });

  it('exposes the TabBar as a tablist of tabs carrying the selected state', () => {
    expect(tabBar).toMatch(/accessibilityRole="tablist"/);
    expect(tabBar).toMatch(/accessibilityRole="tab"/);
    expect(tabBar).toMatch(/accessibilityState=\{\{\s*selected:\s*item\.key === activeKey\s*\}\}/);
  });

  /* BAN 6. This package reaching a navigation library. `navigatorTabBar` adapts the bar to
     expo-router STRUCTURALLY, so nothing here may name one — in any file, not only `TabBar.tsx`. A
     module name is a string wherever it is used (`from`, `import()`, `require()`, a bare
     side-effect import, a type-position `import('…')`), so the ban is on the STRING, in either
     quote or a template, over every source file of the package. */
  it('keeps @umkmall/ui free of a navigation dependency, in every source file', () => {
    const files = sourceFiles(SRC);
    /* 300+ today. The named file is what proves the walk reached `native/`; the floor is sized to
       catch a walk that lost its recursion (the top level of `src` holds a handful of files). */
    expect(files.length).toBeGreaterThanOrEqual(200);
    expect(files.map((path) => relative(SRC, path))).toContain('native/TabBar.tsx');
    const named = new RegExp(`['"\`]${NAV_MODULE}['"\`]`);
    const offenders = files.filter((path) => named.test(blankComments(readFileSync(path, 'utf8'), path)));
    expect(offenders.map((path) => relative(SRC, path))).toEqual([]);
    /* A triple-slash reference is a comment to the parser and a dependency to the compiler. */
    const referenced = files.filter((path) => new RegExp(`///\\s*<reference[^>]*${NAV_MODULE}`).test(readFileSync(path, 'utf8')));
    expect(referenced.map((path) => relative(SRC, path))).toEqual([]);
  });

  it('declares no navigation library in its manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(SRC, '..', 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const declared = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'].flatMap((field) => Object.keys(manifest[field] ?? {}));
    expect(declared.length).toBeGreaterThan(5);
    expect(declared.filter((name) => new RegExp(`^${NAV_MODULE}$`).test(name))).toEqual([]);
  });

  it('gives IconButton the icon press, the 44 pt target and a REQUIRED label', () => {
    expect(iconButton).toMatch(/scale="icon"/);
    expect(iconButton).toMatch(/<PressableScale\b/);
    /* Required: no `?` on the prop. */
    expect(iconButton).toMatch(/\baccessibilityLabel:\s*string;/);
    expect(styles).toMatch(/ICON_BUTTON = \{\s*width:\s*measure\['2-75'\],\s*height:\s*measure\['2-75'\]/);
  });

  it('enters the floating drawer from -distance.sidebar on the sheet spring and exits shorter, on easing.exit', () => {
    expect(drawer).toMatch(/-MOTION\.distance\.sidebar/);
    expect(drawer).toMatch(/Animated\.spring\(panel,\s*\{[^}]*\.\.\.MOTION\.spring\.sheet/);
    expect(drawer).toMatch(/Animated\.timing\(scrim,\s*\{\s*toValue:\s*1,\s*duration:\s*MOTION\.duration\.base/);
    /* Both exit legs: duration.fast on the exit easing — shorter than the entrance (§7.3 rule 1). */
    expect(drawer.match(/toValue:\s*0,\s*duration:\s*MOTION\.duration\.fast,\s*easing:\s*EASE_EXIT/g)).toHaveLength(2);
    expect(drawer).toMatch(/Easing\.bezier\(\.\.\.MOTION\.easing\.exit\)/);
  });

  it('draws the floating panel solid white with the one card edge and the float shadow, over the overlay scrim', () => {
    /* The white fill is the clipped content view's own, which takes the panel's radius; the panel
       itself cannot clip (it would clip its shadow on iOS). No glass layer since UMK-1603. */
    expect(drawer).toMatch(/<View style=\{FLOATING_DRAWER_CONTENT\}>\s*\{children\}/);
    expect(drawer).not.toMatch(/GlassBackdrop/);
    const panel = styles.slice(styles.indexOf('export const FLOATING_DRAWER_PANEL'), styles.indexOf('export const FLOATING_DRAWER_CONTENT'));
    expect(panel).toMatch(/\.\.\.CARD_EDGE,/);
    expect(panel).not.toMatch(/backgroundColor/);
    expect(styles).toMatch(/shadowStyle\(tokens\.shadow\.float\)/);
    expect(styles).toMatch(/backgroundColor:\s*tokens\.surface\.default\.overlay/);
  });

  it('draws the TabBar as a white bar on the bottom edge with the upward nav shadow, its indicator and active ink in brand', () => {
    const bar = styles.slice(styles.indexOf('export const TAB_BAR = '), styles.indexOf('export const TAB_BAR_ROW'));
    expect(bar).toMatch(/shadowStyle\(tokens\.shadow\.nav\)/);
    expect(bar).toMatch(/backgroundColor:\s*tokens\.surface\.default\.primary/);
    expect(bar).toMatch(/left:\s*0,\s*right:\s*0,\s*bottom:\s*0/);
    /* No glass and no float any more (UMK-1516 D1). */
    expect(tabBar).not.toMatch(/GlassBackdrop/);
    expect(styles).not.toMatch(/TAB_BAR_FLOAT/);
    expect(styles).toMatch(/TAB_BAR_INDICATOR = \{[^}]*height:\s*tokens\.borderWidth\.md,\s*backgroundColor:\s*tokens\.surface\.default\.brand/);
    expect(styles).toMatch(/inactive:\s*tokens\.text\.default\.primary,\s*active:\s*tokens\.text\.default\.brand/);
  });
});
