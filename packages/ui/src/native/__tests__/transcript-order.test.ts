/**
 * THE TRANSCRIPT IS NEVER DRAWN NEWEST-FIRST (UMK-1129) — the static half of the ban.
 *
 * WHAT IS BANNED, IN THE DOMAIN'S WORDS: a native transcript whose messages reach the eye, or the
 * screen reader, newest-first. An inverted list flips a normal one with a transform, so its view
 * order is newest-first while it draws oldest-at-top and a screen reader walks the conversation
 * BACKWARDS — `ChatThread`'s docblock says why the family refuses that. There are four ways to get
 * there and this file bans each by what it DOES, not by how it is spelled:
 *
 * 1. THE PLATFORM FLAG. No key, attribute, property or runtime string anywhere in
 *    `packages/ui/src/native/**` resolves to `inverted` — an identifier, a string literal, a
 *    computed key, a concatenation, a template, a const bound to any of those, a `Reflect.set` /
 *    `Object.fromEntries` argument. Type positions are exempt: the `Owned` union has to NAME it to
 *    keep it off the public props, and a string in a type erases.
 * 2. A VERTICAL FLIP BY HAND. No style object anywhere under `native/**` holds a transform whose
 *    VALUE flips vertically: `scaleY`/`scale` negative, `rotate`/`rotateX`/`rotateZ` a half turn in
 *    any unit (deg, rad, grad, turn — `'3.14159rad'` is a half turn), a `matrix` whose y-scale is
 *    negative (the 2-D `d`; element 4 of a 3×3, 5 of a 4×4), or the same inside a transform STRING
 *    (`'scaleY(-1)'`). Values are FOLDED — constants, negation, arithmetic, `Math.PI`, a const
 *    object's property, both arms of a conditional — so `scaleY: FLIP` with `const FLIP = -1` is the
 *    same hit as `scaleY: -1`. A flip-capable key whose value cannot be folded is refused in the
 *    transcript's own files and allowlisted by NAME elsewhere (the two animations that exist), so a
 *    new one anywhere has to be looked at.
 * 3. A REVERSED VERTICAL AXIS. No style object anywhere under `native/**` holds a `flexDirection`
 *    whose folded value is `column-reverse` — React Native's documented alternative to `inverted`,
 *    which paints the rows (and hands them to a screen reader) newest-first without touching the
 *    tree a render test walks. `row-reverse` is a HORIZONTAL mirror and stays legal: the user's
 *    metadata line uses it on purpose, as the web does. An unfoldable `flexDirection` in the
 *    transcript's files is refused unless allowlisted by name, and the one allowlisted lookup's
 *    table is read and checked instead. (PR #1117 re-review's fourth spelling.)
 * 4. REORDERING THE DATA. No `.reverse()` / `.toReversed()` anywhere under `native/**`; no sort
 *    with a constant or argument-swapped comparator anywhere; and in the transcript's own files no
 *    sort, `reduceRight` or index-from-the-end lookup (`data[data.length - 1 - index]`) at all —
 *    the list draws what the host hands it, in the order handed over.
 *
 * THE STATIC HALF IS NOT THE WHOLE BAN. A scan reasons about spellings however hard it folds, and
 * an adversary gets the last word — `apps/mobile/src/__tests__/transcript-order.test.tsx` renders
 * the real `ChatMessageList` and `ChatThread` with ordered data and asserts what the platform list
 * RECEIVES and what is drawn: the same order, `inverted` falsy, no flip in any flattened style in the
 * tree. That half does not depend on spelling at all. It lives in `apps/mobile` because
 * `react-native` cannot load here, and `apps/mobile/turbo.json`'s test inputs already include
 * `packages/ui/src/native/**` (tests excluded), so a change here re-runs it.
 *
 * READ OFF THE SYNTAX TREE (`ScriptKind.TSX`, parents set, walk callbacks that return nothing —
 * `docs/solutions/conventions/the-typescript-compiler-api-traps-that-fail-silently.md`), so a
 * comment explaining inversion cannot fail it and a comment cannot satisfy it.
 *
 * PROVED RED (2026-09-22). The first three rows are the reviewer's evasions of the previous
 * version (which checked two files for three spellings); the rest are written from the intent
 * above, not from these matchers. Applied one at a time, run, reverted. "static" is this file;
 * "render" is the apps/mobile behaviour test.
 *
 * | Injection (into `ChatMessageList.tsx` unless named) | static | render |
 * | -- | -- | -- |
 * | `style={{ transform: [{ rotate: '180deg' }] }}` on the FlatList | red (flip) | red (flip in tree) |
 * | `data={data ? [...data].reverse() : data}` | red (reorder) | red (order) |
 * | `{...{ ['inverted']: true }}` on the FlatList | red (inverted) | red (inverted prop + flip) |
 * | `const FLIP = -1` + `transform: [{ scaleY: FLIP }]` | red (flip) | red (flip in tree) |
 * | `transform: [{ rotate: '3.14159rad' }]` | red (flip) | red (flip in tree) |
 * | `data={data ? [...data].sort(() => -1) : data}` | red (reorder) | red (order) |
 * | `renderItem` remapped to `data[data.length - 1 - info.index]` | red (reorder) | red (order) |
 * | `{...{ ['inv' + 'erted']: true }}` on the FlatList | red (inverted) | red (inverted prop + flip) |
 * | `{...Object.fromEntries([['inverted', true]])}` on the FlatList | red (inverted) | red (inverted prop + flip) |
 * | `data={data?.reduceRight<ItemT[]>((a, x) => [...a, x], [])}` | red (reorder) | red (order) |
 * | `MESSAGE_THREAD_ROOT` in `message-styles.ts` gains `transform: 'scaleY(-1)'` | red (flip) | red (flip in tree) |
 * | `ChatMessageBubble`'s root gains `transform: [{ matrix: [1,0,0,0, 0,-1,0,0, 0,0,1,0, 0,0,0,1] }]` | red (flip) | red (flip in tree) |
 * | `'inverted'` removed from the `Owned` union | red (public props) | — (a type) |
 * | `contentContainerStyle` gains `flexDirection: 'column-reverse'` | red (axis) | red (flip in tree) |
 * | `const AXIS = 'column' + '-reverse'` + `flexDirection: AXIS` on `ChatThread`'s root | red (axis) | red (flip in tree) |
 * | `MESSAGE_META_DIRECTION.user` → `'column-reverse'` | red (metadata table) | — |
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

/** Every `.ts`/`.tsx` under `native/`, recursively, tests excluded. */
const collect = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : collect(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });

const FILES = collect(ROOT).map((path) => {
  const rel = relative(ROOT, path);
  return {
    rel,
    file: ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  };
});

/**
 * The transcript's OWN files — the message family and its support modules — where the rules are
 * fail-closed: a value the scan cannot fold is refused rather than let through.
 */
const TRANSCRIPT = /^(Chat(Message\w*|Thread|ScrollButton)\.tsx|message-[\w-]+\.tsx?)$/;
const isTranscript = (rel: string) => TRANSCRIPT.test(rel);

/** Every node, skipping TYPE positions. The callback returns nothing, so the walk never stops early. */
const valueNodes = (root: ts.Node): ts.Node[] => {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return;
    out.push(n);
    ts.forEachChild(n, (c) => {
      walk(c);
    });
  };
  walk(root);
  return out;
};

const WALKED = new Map(FILES.map(({ rel, file }) => [rel, valueNodes(file)]));

/* ------------------------------------------------------------------ constant folding */

type Val = number | string | ts.ObjectLiteralExpression | ts.ArrayLiteralExpression;

const unwrap = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (
    ts.isParenthesizedExpression(x) ||
    ts.isAsExpression(x) ||
    ts.isSatisfiesExpression(x) ||
    ts.isNonNullExpression(x) ||
    ts.isTypeAssertionExpression(x)
  ) {
    x = x.expression;
  }
  return x;
};

/** The `const` initializer a name is bound to in this file, if any. Scope is ignored — conservative. */
const constInit = (file: ts.SourceFile, name: string): ts.Expression | undefined => {
  let found: ts.Expression | undefined;
  const walk = (n: ts.Node): void => {
    if (
      !found &&
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer !== undefined &&
      ts.isVariableDeclarationList(n.parent) &&
      (n.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      found = n.initializer;
    }
    ts.forEachChild(n, (c) => {
      walk(c);
    });
  };
  walk(file);
  return found;
};

const product = <T>(sets: T[][]): T[][] =>
  sets.reduce<T[][]>((acc, set) => acc.flatMap((a) => set.map((v) => [...a, v])), [[]]);

/**
 * Every value `e` can evaluate to, or `undefined` when any path cannot be folded. Both arms of a
 * conditional and of `??`/`||` count — a flip behind a flag is still a flip.
 */
const fold = (e: ts.Expression, file: ts.SourceFile, depth = 0): Val[] | undefined => {
  if (depth > 12) return undefined;
  const x = unwrap(e);
  const again = (y: ts.Expression) => fold(y, file, depth + 1);
  if (ts.isNumericLiteral(x)) return [Number(x.text)];
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return [x.text];
  if (ts.isObjectLiteralExpression(x) || ts.isArrayLiteralExpression(x)) return [x];
  if (ts.isTemplateExpression(x)) {
    const spans = x.templateSpans.map((s) => again(s.expression));
    if (spans.some((s) => s === undefined)) return undefined;
    return product(spans as Val[][]).map(
      (parts) => x.head.text + parts.map((p, i) => String(p) + x.templateSpans[i].literal.text).join(''),
    );
  }
  if (ts.isPrefixUnaryExpression(x)) {
    const inner = again(x.operand);
    if (inner === undefined || inner.some((v) => typeof v !== 'number')) return undefined;
    if (x.operator === ts.SyntaxKind.MinusToken) return (inner as number[]).map((v) => -v);
    if (x.operator === ts.SyntaxKind.PlusToken) return inner;
    return undefined;
  }
  if (ts.isConditionalExpression(x)) {
    const a = again(x.whenTrue);
    const b = again(x.whenFalse);
    return a && b ? [...a, ...b] : undefined;
  }
  if (ts.isBinaryExpression(x)) {
    const op = x.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      const a = again(x.left);
      const b = again(x.right);
      return a && b ? [...a, ...b] : undefined;
    }
    const a = again(x.left);
    const b = again(x.right);
    if (!a || !b) return undefined;
    const out: Val[] = [];
    for (const l of a) {
      for (const r of b) {
        if (typeof l === 'object' || typeof r === 'object') return undefined;
        if (op === ts.SyntaxKind.PlusToken) out.push(typeof l === 'string' || typeof r === 'string' ? `${l}${r}` : l + r);
        else if (typeof l !== 'number' || typeof r !== 'number') return undefined;
        else if (op === ts.SyntaxKind.MinusToken) out.push(l - r);
        else if (op === ts.SyntaxKind.AsteriskToken) out.push(l * r);
        else if (op === ts.SyntaxKind.SlashToken) out.push(l / r);
        else return undefined;
      }
    }
    return out;
  }
  if (ts.isIdentifier(x)) {
    const init = constInit(file, x.text);
    return init ? again(init) : undefined;
  }
  if (ts.isPropertyAccessExpression(x)) {
    if (ts.isIdentifier(x.expression) && x.expression.text === 'Math' && x.name.text === 'PI') return [Math.PI];
    const owners = again(x.expression);
    if (!owners) return undefined;
    const out: Val[] = [];
    for (const o of owners) {
      if (typeof o !== 'object' || !ts.isObjectLiteralExpression(o)) return undefined;
      const prop = o.properties.find((p) => keysOf(p, file)?.includes(x.name.text));
      if (!prop) return undefined;
      const v = valueOf(prop);
      const folded = v ? again(v) : undefined;
      if (!folded) return undefined;
      out.push(...folded);
    }
    return out;
  }
  return undefined;
};

/** Every key a property can have, or `undefined` when a computed key cannot be folded. */
function keysOf(p: ts.ObjectLiteralElementLike, file: ts.SourceFile): string[] | undefined {
  if (ts.isSpreadAssignment(p)) return [];
  const name = p.name;
  if (name === undefined) return [];
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return [name.text];
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return [name.text];
  if (ts.isComputedPropertyName(name)) {
    const vals = fold(name.expression, file);
    return vals?.filter((v) => typeof v !== 'object').map(String);
  }
  return undefined;
}

function valueOf(p: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isPropertyAssignment(p)) return p.initializer;
  if (ts.isShorthandPropertyAssignment(p)) return p.name;
  return undefined;
}

/* ------------------------------------------------------------------ what a flip is */

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
/** A half turn, in degrees, modulo a full one. */
const halfTurn = (deg: number) => near(((deg % 360) + 360) % 360, 180);

const ANGLE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(deg|rad|grad|turn)?\s*$/i;
const TO_DEG: Record<string, number> = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

/** Does this rotate value turn the content upside down? A bare number is read as BOTH units. */
const isHalfTurn = (v: number | string): boolean => {
  if (typeof v === 'number') return halfTurn(v) || halfTurn(v * TO_DEG.rad);
  const m = ANGLE.exec(v);
  return m !== null && halfTurn(Number(m[1]) * TO_DEG[(m[2] ?? 'deg').toLowerCase()]);
};

/** A matrix's vertical scale, by the matrix's size: 2-D `d`, then a 3×3, then a 4×4. */
const Y_SCALE_INDEX: Record<number, number> = { 6: 3, 9: 4, 16: 5 };

/** A transform written as a STRING — `'scaleY(-1)'`, `'rotate(180deg)'`, `'matrix(…)'`. */
const stringFlips = (text: string): boolean =>
  [...text.matchAll(/(\w+)\s*\(([^)]*)\)/g)].some(([, fn, raw]) => {
    const args = raw.split(/[\s,]+/).filter(Boolean);
    const nums = args.map(Number);
    if (fn === 'scaleY') return nums[0] < 0;
    if (fn === 'scale') return (args.length === 1 ? nums[0] : nums[1]) < 0;
    if (fn === 'rotate' || fn === 'rotateX' || fn === 'rotateZ') return args.length > 0 && isHalfTurn(args[0]);
    if (fn === 'matrix' || fn === 'matrix3d') {
      const i = Y_SCALE_INDEX[nums.length];
      return i !== undefined && nums[i] < 0;
    }
    return false;
  });

const FLIP_KEYS = ['scaleY', 'scale', 'rotate', 'rotateX', 'rotateZ', 'matrix', 'transform'] as const;
type FlipKey = (typeof FLIP_KEYS)[number];

/** `true` a flip, `false` not one, `undefined` cannot tell. */
const valueFlips = (key: FlipKey, vals: Val[] | undefined, file: ts.SourceFile): boolean | undefined => {
  if (vals === undefined) return undefined;
  let unknown = false;
  for (const v of vals) {
    if (key === 'scaleY' || key === 'scale') {
      if (typeof v === 'number' && v < 0) return true;
      if (typeof v === 'object') unknown = true;
    } else if (key === 'rotate' || key === 'rotateX' || key === 'rotateZ') {
      if (typeof v !== 'object' && isHalfTurn(v)) return true;
      if (typeof v === 'object') unknown = true;
    } else if (key === 'matrix') {
      if (typeof v !== 'object' || !ts.isArrayLiteralExpression(v)) {
        unknown = true;
        continue;
      }
      const i = Y_SCALE_INDEX[v.elements.length];
      const el = i === undefined ? undefined : v.elements[i];
      const y = el === undefined ? undefined : fold(el, file);
      if (y === undefined) unknown = true;
      else if (y.some((n) => typeof n === 'number' && n < 0)) return true;
    } else if (key === 'transform') {
      /* The array form's entries are object literals of their own, and the walk visits them. */
      if (typeof v === 'string' && stringFlips(v)) return true;
    }
  }
  return unknown ? undefined : false;
};

/* ------------------------------------------------------------------ the scans */

interface Hit {
  where: string;
  what: string;
}

const at = (rel: string, file: ts.SourceFile, n: ts.Node) =>
  `${rel}:${file.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;

const invertedHits = (): Hit[] =>
  FILES.flatMap(({ rel, file }) =>
    WALKED.get(rel)!.flatMap((n): Hit[] => {
      const hit = (what: string) => [{ where: at(rel, file, n), what }];
      /* Any NAME: a JSX attribute, an object key, a property access, a binding. */
      if (ts.isIdentifier(n) && n.text === 'inverted') return hit(`name: ${n.parent.getText()}`);
      /* Any RUNTIME STRING that folds to it, at the outermost expression that does. */
      if (
        (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isBinaryExpression(n)) &&
        fold(n, file)?.includes('inverted') &&
        !(ts.isExpression(n.parent) && !ts.isCallExpression(n.parent) && fold(n.parent as ts.Expression, file)?.includes('inverted'))
      ) {
        return hit(`value: ${n.getText()} (in ${n.parent.getText().slice(0, 80)})`);
      }
      /* A computed key whose expression folds to it (an identifier bound to the string included). */
      if (ts.isComputedPropertyName(n) && fold(n.expression, file)?.includes('inverted')) return hit(`key: ${n.getText()}`);
      return [];
    }),
  );

/**
 * The flip-capable keys whose value is an ANIMATION outside the transcript — motion, not
 * orientation, and not foldable. By file and key, so a third one anywhere reds until looked at.
 */
/* native-ui-v2: `motion.tsx scale` is PressableScale's press shrink, an Animated.Value between
   `motion.scale.press.icon` (0.92) and 1, never negative, so it cannot flip. `motion-tokens.ts
   scale` is not a transform at all: it is the `MOTION.scale` token map's key, which the scan
   reads as one because the name matches. `FeatureTile.tsx scale` is the selected check's 0.6 → 1
   pop, never negative. `TabBar.tsx scale` is the active tab glyph's pop, 1 → `motion.scale.pop.squash`
   (0.82) → `.overshoot` (1.14) → 1 on the press spring, never negative. */
const UNRESOLVED_ALLOWED = [
  'ChatSoundWave.tsx scaleY',
  /* The tick's 0 -> 1 spring (UMK-1486): a scale off an Animated value, never negative. */
  'CheckBox.tsx scale',
  'FeatureTile.tsx scale',
  'Spinner.tsx rotate',
  'TabBar.tsx scale',
  /* The toast check's pop (UMK-1601): 0 -> 1 on spring.pop, overshooting above 1 and never below 0. */
  'Toaster.tsx scale',
  'motion-tokens.ts scale',
  'motion.tsx scale',
];

const scanTransforms = () => {
  const flips: Hit[] = [];
  const unresolved: string[] = [];
  const unreadKeys: Hit[] = [];
  for (const { rel, file } of FILES) {
    for (const n of WALKED.get(rel)!) {
      if (!ts.isObjectLiteralExpression(n)) continue;
      for (const p of n.properties) {
        const keys = keysOf(p, file);
        if (keys === undefined) {
          if (isTranscript(rel)) unreadKeys.push({ where: at(rel, file, p), what: p.getText() });
          continue;
        }
        const value = valueOf(p);
        if (!value) continue;
        for (const key of keys) {
          if (!(FLIP_KEYS as readonly string[]).includes(key)) continue;
          const verdict = valueFlips(key as FlipKey, fold(value, file), file);
          if (verdict === true) flips.push({ where: at(rel, file, p), what: p.getText() });
          else if (verdict === undefined && key !== 'transform') {
            if (isTranscript(rel)) flips.push({ where: at(rel, file, p), what: `cannot fold: ${p.getText()}` });
            else unresolved.push(`${rel} ${key}`);
          }
        }
      }
    }
  }
  return { flips, unresolved, unreadKeys };
};

/**
 * The `flexDirection` values the scan cannot fold, by file and expression — each a lookup into a
 * table whose values are checked on their own below.
 */
const AXIS_LOOKUPS_ALLOWED = ['ChatMessageMetadata.tsx MESSAGE_META_DIRECTION[sender]'];

/** Every `flexDirection` under `native/**` that reverses the vertical axis (rule 3). */
const reversedAxisHits = (): Hit[] =>
  FILES.flatMap(({ rel, file }) =>
    WALKED.get(rel)!.flatMap((n): Hit[] => {
      if (!ts.isObjectLiteralExpression(n)) return [];
      return n.properties.flatMap((p): Hit[] => {
        if (!keysOf(p, file)?.includes('flexDirection')) return [];
        const value = valueOf(p);
        if (!value) return [];
        const vals = fold(value, file);
        if (vals === undefined) {
          if (AXIS_LOOKUPS_ALLOWED.includes(`${rel} ${value.getText()}`)) return [];
          return isTranscript(rel) ? [{ where: at(rel, file, p), what: `cannot fold: ${p.getText()}` }] : [];
        }
        return vals.some((v) => v === 'column-reverse') ? [{ where: at(rel, file, p), what: p.getText() }] : [];
      });
    }),
  );

const calledMethod = (n: ts.Node): string | undefined =>
  ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : undefined;

/** A comparator that is not an ordering: it returns a constant, or it compares `b` before `a`. */
const reversedComparator = (cmp: ts.Expression | undefined, file: ts.SourceFile): boolean => {
  if (cmp === undefined || !(ts.isArrowFunction(cmp) || ts.isFunctionExpression(cmp))) return false;
  const body = ts.isBlock(cmp.body)
    ? cmp.body.statements.find(ts.isReturnStatement)?.expression
    : (cmp.body as ts.Expression);
  if (body === undefined) return false;
  if (fold(body, file) !== undefined) return true;
  const [a, b] = cmp.parameters.map((p) => p.name.getText());
  if (!a || !b) return false;
  const mentions = (e: ts.Node, name: string) =>
    e.getText().split(/[^\w$]+/).includes(name);
  const x = unwrap(body);
  if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.MinusToken) {
    return mentions(x.left, b) && !mentions(x.left, a) && mentions(x.right, a);
  }
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'localeCompare') {
    return mentions(x.expression.expression, b) && x.arguments.some((arg) => mentions(arg, a));
  }
  return false;
};

/** `x[<from the end> - <a variable>]` — an index counted backwards from the length. */
const indexFromEnd = (n: ts.Node, file: ts.SourceFile): boolean => {
  if (!ts.isElementAccessExpression(n)) return false;
  const terms: ts.Expression[] = [];
  let x = unwrap(n.argumentExpression);
  while (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.MinusToken) {
    terms.unshift(unwrap(x.right));
    x = unwrap(x.left);
  }
  if (terms.length === 0 || fold(x, file) !== undefined) return false;
  return terms.some((t) => fold(t, file) === undefined);
};

const reorderHits = (): Hit[] =>
  FILES.flatMap(({ rel, file }) =>
    WALKED.get(rel)!.flatMap((n): Hit[] => {
      const hit = (what: string) => [{ where: at(rel, file, n), what }];
      const method = calledMethod(n);
      if (method === 'reverse' || method === 'toReversed') return hit(n.getText());
      if (method === 'sort' || method === 'toSorted') {
        if (isTranscript(rel)) return hit(`sorts in the transcript: ${n.getText()}`);
        if (reversedComparator((n as ts.CallExpression).arguments[0], file)) return hit(n.getText());
      }
      if (isTranscript(rel) && method === 'reduceRight') return hit(n.getText());
      if (isTranscript(rel) && indexFromEnd(n, file)) return hit(`index from the end: ${n.getText()}`);
      return [];
    }),
  );

/* ------------------------------------------------------------------ the assertions */

describe('the scan reaches every native file, all the way through', () => {
  /**
   * PER FILE, not a total (UMK-956/958): a walk that stopped early in one file leaves the others
   * standing. Each file's last statement and its end-of-file token must be among the visited nodes
   * — a truncated traversal cannot reach either.
   */
  it.each(FILES.map((f) => [f.rel, f] as const))('walks %s to its end', (_rel, { rel, file }) => {
    const seen = new Set(WALKED.get(rel));
    expect(seen.has(file.endOfFileToken), 'the walk never reached the end of the file').toBe(true);
    const lastValue = [...file.statements]
      .reverse()
      .find((s) => !ts.isTypeAliasDeclaration(s) && !ts.isInterfaceDeclaration(s));
    if (lastValue) expect(seen.has(lastValue), 'the walk never reached the last statement').toBe(true);
  });

  it('covers the whole directory, the transcript files included', () => {
    const transcript = FILES.map((f) => f.rel).filter(isTranscript).sort();
    expect(transcript).toEqual([
      'ChatMessage.tsx',
      'ChatMessageBubble.tsx',
      'ChatMessageList.tsx',
      'ChatMessageMetadata.tsx',
      'ChatMessageTTSButton.tsx',
      'ChatScrollButton.tsx',
      'ChatThread.tsx',
      'message-follow.ts',
      'message-styles.ts',
      'message-support.tsx',
    ]);
    /* Not only the family: every sibling and support module, and the glyphs folder below them. */
    expect(FILES.some((f) => f.rel.startsWith('glyphs/'))).toBe(true);
    expect(FILES.length).toBeGreaterThan(transcript.length * 4);
  });
});

describe('the transcript is never drawn newest-first', () => {
  it('names nothing `inverted`, in any key, attribute or runtime string', () => {
    expect(invertedHits()).toEqual([]);
  });

  it('draws no vertical flip, in any unit or spelling', () => {
    expect(scanTransforms().flips).toEqual([]);
  });

  /**
   * The positive control: the scan DOES see into real style objects, because the two animations
   * that exist are found — and a third unfoldable flip-capable key anywhere reds until it is
   * looked at.
   */
  it('leaves only the known animations unfolded', () => {
    expect([...new Set(scanTransforms().unresolved)].sort()).toEqual(UNRESOLVED_ALLOWED);
  });

  it('reads every key in the transcript files — no computed key it cannot fold', () => {
    expect(scanTransforms().unreadKeys).toEqual([]);
  });

  it('never reverses the vertical axis', () => {
    expect(reversedAxisHits()).toEqual([]);
  });

  /* The allowlisted lookup's TABLE, read off the tree: a row may mirror, a column may not. */
  it('keeps the metadata direction table horizontal', () => {
    const styles = FILES.find((f) => f.rel === 'message-styles.ts')!.file;
    let table: ts.ObjectLiteralExpression | undefined;
    const walk = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'MESSAGE_META_DIRECTION' && n.initializer) {
        const init = unwrap(n.initializer);
        if (ts.isObjectLiteralExpression(init)) table = init;
      }
      ts.forEachChild(n, walk);
    };
    walk(styles);
    expect(table, 'MESSAGE_META_DIRECTION is no longer an object literal in message-styles.ts').toBeDefined();
    const values = table!.properties.map((p) => (ts.isPropertyAssignment(p) ? fold(p.initializer, styles) : undefined));
    expect(values.every((v) => v !== undefined && v.every((x) => x === 'row' || x === 'row-reverse'))).toBe(true);
  });

  it('never reorders data', () => {
    expect(reorderHits()).toEqual([]);
  });

  /**
   * And a caller cannot flip it either: the public props OMIT `inverted`, so `...rest` never
   * carries it onto the list. Read off the `Owned` union the props type omits — the one place the
   * word is allowed, in a type.
   */
  it('keeps inverted off the public props', () => {
    const list = FILES.find((f) => f.rel === 'ChatMessageList.tsx')!.file;
    const owned = list.statements.find(
      (n): n is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(n) && n.name.text === 'Owned',
    );
    expect(owned, 'ChatMessageList declares no Owned union').toBeDefined();
    const members = ts.isUnionTypeNode(owned!.type) ? owned!.type.types.map((t) => t.getText()) : [owned!.type.getText()];
    expect(members).toContain("'inverted'");
    const props = list.statements.find(
      (n): n is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(n) && n.name.text === 'ChatMessageListProps',
    );
    expect(props?.heritageClauses?.[0]?.getText(), 'ChatMessageListProps no longer omits Owned').toMatch(
      /Omit<FlatListProps<ItemT>, Owned>/,
    );
  });
});
