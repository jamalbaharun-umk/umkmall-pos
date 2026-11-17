/**
 * THE MOTION-LITERAL MATCHER, shared by the three guards that ban one (review finding 15):
 * `__tests__/motion-tokens.test.ts` (`motion.tsx`), `__tests__/nav-chrome.test.ts` (the nav chrome)
 * and `__tests__/identity-cards.test.ts` (the identity cards).
 *
 * ONE MODULE, CALLED BY ALL THREE, for the reason `colour-literals.ts` beside it gives: a ban is its
 * matcher, and three copies drift. Each of those suites had its own regex (`duration:\s*\d`, with or
 * without `delay`, with or without `mass`, with or without a leading-dot bezier), and each could be
 * walked past by a spelling one of the others happened to know. It is exported from no entry, and
 * `typescript` is the only thing it imports.
 *
 * WHAT THE BAN FORBIDS, in the identity's words (docs/guidelines/mobile-design-identity.md §7.1):
 * **an animation whose duration, delay, spring or easing is not read from `tokens.motion`**, and
 * (§7.3 rule 2) **an animation that does not run on the native driver**.
 *
 * It is written as the ALLOWED form, with everything else refused, because a list of forbidden
 * spellings is the list its author thought of
 * (docs/solutions/conventions/an-injection-proof-only-proves-the-spellings-you-chose.md). The allowed
 * forms are:
 *
 * - `Animated.timing(value, { … })` and `Animated.spring(value, { … })` with the config written
 *   INLINE, as an object of known keys: `toValue`, `useNativeDriver: true`, `duration`, `delay`,
 *   `easing`, and — on a spring only — one `...MOTION.spring.<name>` spread;
 * - a `duration` that is `MOTION.duration.<name>`, a `delay` that is a `MOTION.duration.<name>` (a
 *   wait until something else has finished), a `MOTION.stagger.<name>` (one beat behind a sibling,
 *   as the tab indicator's trailing edge) or a `MOTION.delay.<name>` (a named wait, as the toast
 *   check's `toastIcon`, UMK-1601), a bare `0`, or a `reduce ? … : …` between those;
 * - an `easing` that is `EASING.<name>` or an `EASE…` constant the same file builds as
 *   `Easing.bezier(...MOTION.easing.<name>)`.
 *
 * The spellings the language gives the forbidden thing, one row each. Every `yes` row has a
 * synthetic case in `motion-tokens.test.ts`; the PROVED RED tables in the three suites list the
 * ones that were also injected into a real scanned file, and which assertion went red.
 *
 * | Spelling | Kind | Caught |
 * | -- | -- | -- |
 * | a literal, `duration: 380`, `delay: 120` (quoted key and `duration : 380` included) | `value` | yes |
 * | a named constant, `const D = 380; … duration: D` | `value` | yes — a name that is not a `MOTION` read is refused, wherever it is defined |
 * | a constant imported from another module, `duration: SLOW_MS` | `value` | yes — same rule |
 * | arithmetic on a token, `MOTION.duration.base * 2` | `value` | yes |
 * | a literal in one arm of the reduced-motion ternary, `reduce ? 120 : 380` | `value` | yes |
 * | a token of the wrong family, `duration: MOTION.distance.enter` | `value` | yes |
 * | a number that happens to be called `reduce`, `duration: reduce` | `value` | yes — `reduce` is allowed as a CONDITION only |
 * | a shorthand property, `{ toValue: 1, duration, … }` | `config` | yes |
 * | a config built elsewhere, `Animated.timing(v, cfg)` | `config` | yes |
 * | a spread that is not the token spring, `{ toValue: 1, ...SLOW }` | `config` | yes |
 * | a delay spelled as a call, `Animated.delay(120)`, `Animated.stagger(40, …)`, `setTimeout(fn, 380)` | `value` | yes |
 * | a delay or duration as a JSX prop, `<Enter delay={120} />`, or a default, `({ delay = 120 })` | `value` | yes |
 * | spring physics in any of RN's three vocabularies — `damping`/`stiffness`/`mass`, `tension`/`friction`, `speed`/`bounciness` — literal or named | `physics` | yes |
 * | a spring with NO physics (RN's own default spring) | `physics` | yes |
 * | a timing with NO duration (RN's own 500 ms) | `value` | yes |
 * | a timing with NO easing (RN's own ease-in-out, not `easing.standard`) | `default-easing` | yes — and it has LIVE cases, so each suite records its files' exact count |
 * | a bezier from literals in any form, `Easing.bezier(0.2, …)`, `(.2, …)`, `(...[0.2, …])`, `(...CURVE)` | `easing` | yes |
 * | a preset or composed easing, `Easing.linear`, `Easing.out(Easing.quad)` | `easing` | yes |
 * | a hand-written easing function, `easing: (t) => t * t` | `easing` | yes |
 * | `useNativeDriver: false` | `js-driver` | yes — a kind of its own, because `CoinChip`'s count-up is a recorded, deliberate one |
 * | `useNativeDriver` anything else (`!1`, a name) or omitted | `driver` | yes |
 * | `Animated`, `Easing` or `MOTION` reached under another name — `const A = Animated`, `Animated['timing']`, `import { Easing as E }`, a local `MOTION` | `alias` | yes |
 * | a watched name bound by a DEFAULT or NAMESPACE import — `import MOTION from './numbers'`, `import * as MOTION from './motion-tokens'`, `import Animated from './anim'` — or the motion modules imported that way under any name, `import * as M from './motion'` | `alias` | yes — only the NAMED import can be checked for where the name comes from; the other two forms bind the watched name to whatever the module happens to export (review of #1367) |
 * | `Animated.event(mapping, { useNativeDriver: false })` | `js-driver` | yes (review of #1367: the driver ban read timing, spring and decay only) |
 * | `Animated.event(mapping)` with no config, a config built elsewhere, a spread in it, or a `useNativeDriver` that is not the literal `true` | `driver` | yes |
 * | another animation engine — `LayoutAnimation`, `react-native-reanimated`, `moti`, `lottie-react-native`, `react-native-animatable` | `other-engine` | yes |
 *
 * THE CEILING — what stays green, each proved green by injection and listed as such in the suites:
 *
 * | Spelling | Why not |
 * | -- | -- |
 * | a helper in ANOTHER module that takes a number, `fadeTo(v, 1, 380)` | the scan reads one file; a positional number in a call it does not know is not a duration to it |
 * | a hand-rolled loop — `requestAnimationFrame`, `Date.now()` arithmetic | no config object to read |
 * | a distance or a scale in an interpolation, `outputRange: [0.4, 1]` | not a duration, spring or easing. The pop and press scales are tokens and are pinned by value in `motion-tokens.test.ts` |
 * | the wrong token of the right family, `duration.slow` where `duration.fast` was meant | a token is a token here; WHICH token each leg uses is pinned by the positive assertions beside the ban, and by Jest on the configs |
 * | a wrapper around `Animated` imported under its own name, `import { timing } from './anim'` | not `Animated` in this file |
 * | a file no suite scans | each suite names its files; `motion-tokens.test.ts` asserts every `Animated`-driven file in the directory is either scanned or recorded |
 *
 * `scanMotionLiterals` parses the source itself, so comments and strings need no stripping: a
 * duration named in a docblock is not a node.
 */
import ts from 'typescript';

export type MotionOffenceKind = 'value' | 'config' | 'physics' | 'easing' | 'default-easing' | 'driver' | 'js-driver' | 'alias' | 'other-engine';

export interface MotionOffence {
  line: number;
  kind: MotionOffenceKind;
  text: string;
}

export interface MotionScan {
  offences: MotionOffence[];
  /**
   * How many `Animated.timing`/`spring`/`decay` calls were read — the anti-vacuity count.
   * `Animated.event` is checked for its driver but NOT counted: the suites compare this number with
   * a count of those three taken off the text.
   */
  calls: number;
}

export interface MotionScanOptions {
  /**
   * Values that are allowed although they are not a `MOTION` read, each written out exactly
   * (whitespace-normalised). A decision per entry: `motion.tsx` passes a caller's `delay` through.
   */
  allowValues?: readonly string[];
  /** `motion.tsx` only: the file that BUILDS `EASING` out of the token tuples, through `bezier`. */
  buildsEasing?: boolean;
}

const PHYSICS = new Set(['damping', 'stiffness', 'mass', 'tension', 'friction', 'speed', 'bounciness', 'velocity', 'deceleration']);
/** What each timed key may read. A wait may be a duration ("until the sheet has landed"), a
 *  stagger step ("one beat behind its sibling") or a named delay token ("the toast's check, after
 *  `delay.toastIcon`", UMK-1601). */
const TIMED: Record<string, readonly string[]> = { duration: ['duration'], delay: ['duration', 'stagger', 'delay'] };
const WATCHED = new Set(['Animated', 'Easing', 'MOTION']);
const ENGINES = new Set(['react-native-reanimated', 'moti', 'lottie-react-native', 'react-native-animatable']);
const MOTION_MODULES = new Set(['./motion', './motion-tokens']);
const EASE_NAME = /^EASE(_[A-Z0-9]+)*$/;
const TOKEN_BEZIER = /^Easing\.bezier\(\.\.\.MOTION\.easing\.\w+\)$/;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

export function scanMotionLiterals(source: string, fileName = 'inline.tsx', options: MotionScanOptions = {}): MotionScan {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const offences: MotionOffence[] = [];
  const allow = new Set((options.allowValues ?? []).map(squash));
  const handled = new Set<ts.Node>();
  let calls = 0;

  const textOf = (node: ts.Node) => squash(node.getText(file));
  /* One offence per easing expression: `Easing.out(Easing.quad)` is one easing, not three. */
  const easingRanges: [number, number][] = [];
  const flag = (node: ts.Node, kind: MotionOffenceKind, why: string) => {
    const start = node.getStart(file);
    if (kind === 'easing') {
      if (easingRanges.some(([from, to]) => start >= from && node.getEnd() <= to)) return;
      easingRanges.push([start, node.getEnd()]);
    }
    offences.push({ line: file.getLineAndCharacterOfPosition(start).line + 1, kind, text: `${why}: ${textOf(node).slice(0, 90)}` });
  };

  /** `MOTION.<family>.<name>`, a bare `0`, or a `reduce ? … : …` between those. Nothing else. */
  const isTimedValue = (node: ts.Expression, families: readonly string[]): boolean => {
    if (ts.isParenthesizedExpression(node)) return isTimedValue(node.expression, families);
    if (ts.isNumericLiteral(node)) return node.text === '0';
    if (ts.isConditionalExpression(node)) {
      const condition = textOf(node.condition);
      return /^!?(reduce|reduceMotion)$/.test(condition) && isTimedValue(node.whenTrue, families) && isTimedValue(node.whenFalse, families);
    }
    return families.some((family) => new RegExp(`^MOTION\\.${family}\\.\\w+$`).test(textOf(node)));
  };
  const timedOk = (node: ts.Expression, families: readonly string[]) => allow.has(textOf(node)) || isTimedValue(node, families);

  /** `Animated.timing` → `timing`; also through a namespace, `RN.Animated.timing`. */
  const animatedMember = (callee: ts.Expression): string | undefined => {
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    const owner = callee.expression;
    const ownerName = ts.isIdentifier(owner) ? owner.text : ts.isPropertyAccessExpression(owner) ? owner.name.text : undefined;
    return ownerName === 'Animated' ? callee.name.text : undefined;
  };

  const keyOf = (name: ts.PropertyName): string | undefined =>
    ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;

  const easingOk = (node: ts.Expression) => /^EASING\.\w+$/.test(textOf(node)) || (ts.isIdentifier(node) && EASE_NAME.test(node.text));

  const checkConfig = (call: ts.CallExpression, member: 'timing' | 'spring' | 'decay') => {
    calls += 1;
    const config = call.arguments[1];
    if (!config || !ts.isObjectLiteralExpression(config)) {
      flag(call, 'config', 'the animation config is not written inline, so nothing here can read it');
      return;
    }
    const seen = new Set<string>();
    let tokenSpring = false;
    for (const property of config.properties) {
      handled.add(property);
      if (ts.isSpreadAssignment(property)) {
        if (member === 'spring' && /^MOTION\.spring\.\w+$/.test(textOf(property.expression))) tokenSpring = true;
        else flag(property, 'config', 'a spread that is not a token spring on a spring');
        continue;
      }
      /* `{ toValue, … }` hides nothing: where an animation ends is not a motion value. */
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'toValue') continue;
      const key = ts.isPropertyAssignment(property) ? keyOf(property.name) : undefined;
      if (!ts.isPropertyAssignment(property) || key === undefined) {
        flag(property, 'config', 'a shorthand, computed or method property hides its value');
        continue;
      }
      seen.add(key);
      const value = property.initializer;
      if (key === 'toValue') continue;
      if (key === 'useNativeDriver') {
        if (value.kind === ts.SyntaxKind.FalseKeyword) flag(property, 'js-driver', 'runs on the JS thread');
        else if (value.kind !== ts.SyntaxKind.TrueKeyword) flag(property, 'driver', 'the driver is not the literal `true`');
      } else if (key in TIMED) {
        if (member !== 'timing') flag(property, 'config', `\`${key}\` on a ${member}`);
        else if (!timedOk(value, TIMED[key]!)) flag(property, 'value', `\`${key}\` is not a MOTION.${TIMED[key]![0]} read`);
      } else if (key === 'easing') {
        if (!easingOk(value)) flag(property, 'easing', 'the easing is not a token easing');
      } else if (PHYSICS.has(key)) {
        flag(property, 'physics', 'spring physics written here rather than spread from MOTION.spring');
      } else {
        flag(property, 'config', `an animation config key this guard does not know (\`${key}\`)`);
      }
    }
    if (!seen.has('useNativeDriver')) flag(call, 'driver', 'no useNativeDriver, so it runs on the JS thread');
    if (member === 'spring' && !tokenSpring) flag(call, 'physics', "a spring with no MOTION.spring spread runs React Native's default spring");
    if (member === 'timing' && !seen.has('duration')) flag(call, 'value', "a timing with no duration runs React Native's default 500 ms");
    if (member === 'timing' && !seen.has('easing')) flag(call, 'default-easing', "a timing with no easing runs React Native's default ease-in-out");
    if (member === 'decay') flag(call, 'physics', 'a decay has no token');
  };

  /** Is this identifier a NAME being read as `X.member`, or as the tail of `NS.X.member`? */
  const isPlainRead = (id: ts.Identifier): boolean => {
    const parent = id.parent;
    if (ts.isPropertyAccessExpression(parent)) {
      if (parent.expression === id) return true;
      /* `RN.Animated.timing`: `Animated` is the NAME of one access and the owner of the next. */
      return parent.name === id && ts.isPropertyAccessExpression(parent.parent) && parent.parent.expression === parent;
    }
    /* A type position: `Animated.Value`, `typeof MOTION.scale`. */
    return ts.isQualifiedName(parent) && parent.left === id;
  };

  /**
   * `Animated.event(mapping, config)` drives a value from a scroll or a gesture, and it has a
   * driver like any other animation: the config must be written inline and carry the literal
   * `useNativeDriver: true`. A spread could put a `false` after it, so there is none; `listener`
   * is the only other key the call takes.
   */
  const checkEvent = (call: ts.CallExpression) => {
    const config = call.arguments[1];
    if (!config || !ts.isObjectLiteralExpression(config)) {
      flag(call, 'driver', 'Animated.event with no inline config, so nothing here says it runs on the native driver');
      return;
    }
    let driver = false;
    for (const property of config.properties) {
      const key = ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property) ? keyOf(property.name) : undefined;
      if (key === 'listener') continue;
      if (!ts.isPropertyAssignment(property) || key !== 'useNativeDriver') {
        flag(property, 'driver', 'an Animated.event config entry that can hide the driver');
        continue;
      }
      driver = true;
      const value = property.initializer;
      if (value.kind === ts.SyntaxKind.FalseKeyword) flag(property, 'js-driver', 'Animated.event runs on the JS thread');
      else if (value.kind !== ts.SyntaxKind.TrueKeyword) flag(property, 'driver', 'the driver is not the literal `true`');
    }
    if (!driver) flag(call, 'driver', 'Animated.event with no useNativeDriver, so it runs on the JS thread');
  };

  const isBezierDeclaration = (node: ts.Node): boolean =>
    Boolean(options.buildsEasing) && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'bezier';

  const declaredEasings = new Set<string>();
  const usedEasings: ts.Identifier[] = [];

  const visit = (node: ts.Node, insideBezierDeclaration: boolean): void => {
    const inBezier = insideBezierDeclaration || isBezierDeclaration(node);

    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const module = node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
      if (ENGINES.has(module)) flag(node, 'other-engine', 'another animation engine');
      /* A DEFAULT or NAMESPACE import. Only a named import says WHICH export a watched name is, so
         only it can be checked against where the tokens live; these two bind the name to whatever
         the module exports — `import MOTION from './numbers'` reads as `MOTION.duration.base` ever
         after. And the motion modules imported whole (`import * as M from './motion'`) are the
         tokens under another name. A namespace of `react-native` under its own name is left alone:
         `RN.Animated.timing(…)` is read like any other call (`animatedMember`). */
      if (ts.isImportDeclaration(node) && node.importClause) {
        const { name: defaultName, namedBindings } = node.importClause;
        const whole = [defaultName, namedBindings && ts.isNamespaceImport(namedBindings) ? namedBindings.name : undefined];
        for (const local of whole) {
          if (!local) continue;
          if (WATCHED.has(local.text) || local.text === 'EASING') flag(node, 'alias', `\`${local.text}\` bound by a default or namespace import, so nothing says what it is`);
          else if (MOTION_MODULES.has(module)) flag(node, 'alias', 'the motion tokens imported whole, under another name');
        }
      }
      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
      if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        for (const element of bindings.elements) {
          const original = (element.propertyName ?? element.name).text;
          const local = element.name.text;
          const watched = WATCHED.has(original) || WATCHED.has(local) || original === 'EASING' || local === 'EASING';
          if (!watched) {
            if (original === 'LayoutAnimation') flag(element, 'other-engine', 'LayoutAnimation');
            continue;
          }
          if (element.propertyName) flag(element, 'alias', 'a watched name imported under another one');
          const home = original === 'Animated' || original === 'Easing' ? module === 'react-native' : MOTION_MODULES.has(module);
          if (!home) flag(element, 'alias', `\`${original}\` does not come from where the tokens do`);
        }
      }
      return;
    }

    if (ts.isStringLiteralLike(node) && ENGINES.has(node.text)) flag(node, 'other-engine', 'another animation engine');

    if (ts.isIdentifier(node)) {
      /* The word anywhere in a name: `UIManager.setLayoutAnimationEnabledExperimental` turns it on. */
      if (node.text.includes('LayoutAnimation')) flag(node, 'other-engine', 'LayoutAnimation');
      if ((node.text === 'Animated' || node.text === 'MOTION') && !isPlainRead(node)) {
        /* A property KEY called `MOTION` is not a read; a type member neither. */
        const parent = node.parent;
        const isKey = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
        if (!isKey) flag(parent, 'alias', `\`${node.text}\` reached other than as \`${node.text}.<member>\``);
      }
      if (node.text === 'Easing') {
        const access = node.parent;
        const call = access.parent;
        const tokenBezier = ts.isPropertyAccessExpression(access) && access.expression === node && ts.isCallExpression(call) && TOKEN_BEZIER.test(textOf(call));
        const builder = inBezier && ts.isCallExpression(call) && textOf(call) === 'Easing.bezier(a, b, c, d)';
        /* The whole call when `Easing.x` is what is being called; otherwise just the read. */
        const whole = ts.isPropertyAccessExpression(access) && ts.isCallExpression(call) && call.expression === access ? call : access;
        if (!tokenBezier && !builder) flag(whole, 'easing', 'an easing not built from MOTION.easing');
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const init = node.initializer;
      if (EASE_NAME.test(name)) {
        declaredEasings.add(name);
        if (!init || !TOKEN_BEZIER.test(textOf(init))) flag(node, 'easing', 'an EASE constant that is not Easing.bezier(...MOTION.easing.<name>)');
      }
      if (name === 'EASING') {
        const object = init && ts.isAsExpression(init) ? init.expression : init;
        const built =
          options.buildsEasing &&
          object &&
          ts.isObjectLiteralExpression(object) &&
          object.properties.every((p) => ts.isPropertyAssignment(p) && /^bezier\(MOTION\.easing\.\w+\)$/.test(textOf(p.initializer)));
        if (!built) flag(node, 'alias', 'a local EASING');
      }
      if ((name === 'duration' || name === 'delay') && init && !timedOk(init, TIMED[name]!)) {
        flag(node, 'value', `a local \`${name}\` that is not a MOTION read`);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && (EASE_NAME.test(node.name.text) || node.name.text === 'EASING')) {
      flag(node.name, 'easing', 'a hand-written easing function');
    }

    if (ts.isCallExpression(node)) {
      const member = animatedMember(node.expression);
      if (member === 'timing' || member === 'spring' || member === 'decay') checkConfig(node, member);
      if (member === 'event') checkEvent(node);
      if (member === 'delay' || member === 'stagger') {
        const wait = node.arguments[0];
        if (!wait || !timedOk(wait, member === 'delay' ? TIMED.delay! : ['stagger'])) flag(node, 'value', `Animated.${member} with a wait that is not a MOTION read`);
      }
      if (ts.isIdentifier(node.expression)) {
        const callee = node.expression.text;
        if (callee === 'setTimeout' || callee === 'setInterval') {
          const wait = node.arguments[1];
          if (wait && !timedOk(wait, TIMED.delay!)) flag(node, 'value', `${callee} with a wait that is not a MOTION read`);
        }
        if (options.buildsEasing && callee === 'bezier') {
          const curve = node.arguments[0];
          if (!curve || !/^MOTION\.easing\.\w+$/.test(textOf(curve))) flag(node, 'easing', 'bezier() of something that is not a token tuple');
        }
      }
    }

    /* A motion key ANYWHERE ELSE: a config object built outside the call, a `LayoutAnimation` or
       another engine's options, a table of durations. */
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && !handled.has(node)) {
      const key = keyOf(node.name);
      if (key !== undefined && (key in TIMED || key === 'easing' || PHYSICS.has(key))) {
        if (ts.isShorthandPropertyAssignment(node)) flag(node, 'config', 'a shorthand motion key hides its value');
        else if (key in TIMED) {
          if (!timedOk(node.initializer, TIMED[key]!)) flag(node, 'value', `\`${key}\` is not a MOTION.${TIMED[key]![0]} read`);
        } else if (key === 'easing') {
          if (!easingOk(node.initializer)) flag(node, 'easing', 'the easing is not a token easing');
        } else if (key !== 'velocity' && key !== 'deceleration') {
          flag(node, 'physics', 'spring physics written here rather than spread from MOTION.spring');
        }
      }
    }
    if (ts.isPropertyAssignment(node) && keyOf(node.name) === 'easing' && ts.isIdentifier(node.initializer) && EASE_NAME.test(node.initializer.text)) {
      usedEasings.push(node.initializer);
    }

    /* `<Enter delay={120} />`. */
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text in TIMED) {
      const init = node.initializer;
      const expression = init && ts.isJsxExpression(init) ? init.expression : undefined;
      if (!expression || !timedOk(expression, TIMED[node.name.text]!)) flag(node, 'value', `a \`${node.name.text}\` prop that is not a MOTION read`);
    }

    /* `({ delay = 120 })`, `(duration = 380) =>`. */
    if ((ts.isBindingElement(node) || ts.isParameter(node)) && ts.isIdentifier(node.name) && node.name.text in TIMED && node.initializer) {
      if (!timedOk(node.initializer, TIMED[node.name.text]!)) flag(node, 'value', `a default \`${node.name.text}\` that is not a MOTION read`);
    }

    /* Never return the child visit's value: a truthy return truncates `forEachChild`
       (docs/solutions/conventions/the-typescript-compiler-api-traps-that-fail-silently.md). */
    ts.forEachChild(node, (child) => {
      visit(child, inBezier);
    });
  };
  visit(file, false);

  for (const use of usedEasings) {
    if (!declaredEasings.has(use.text)) flag(use, 'easing', 'an EASE constant this file does not build, so nothing here can read it');
  }

  return { offences: offences.sort((a, b) => a.line - b.line), calls };
}

/** Offence counts by kind — what the suites compare against their recorded, exact ledgers. */
export const countByKind = (offences: readonly MotionOffence[]): Partial<Record<MotionOffenceKind, number>> =>
  offences.reduce<Partial<Record<MotionOffenceKind, number>>>((acc, { kind }) => ({ ...acc, [kind]: (acc[kind] ?? 0) + 1 }), {});
