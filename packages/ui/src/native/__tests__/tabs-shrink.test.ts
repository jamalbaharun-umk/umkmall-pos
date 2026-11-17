/**
 * The native `Tabs` set and its panel SHRINK (UMK-1075).
 *
 * `Tabs` and `TabsContent` each render a root `View`, and React Native defaults a flex child to
 * `flexShrink: 0`. Put the set in a bounded parent — a bottom sheet capped at 88% of the screen —
 * and an unshrinking root lays out at its content's full height: the cap clips it, and a
 * `ScrollView` in the panel believes it has room for everything and never scrolls. The settings
 * sheet shipped that way, with Simpan, Hapus Akun and "Keluar dari semua perangkat" cut off.
 *
 * SITED HERE because a guard only guards its own package. `apps/mobile/src/__tests__/
 * overlay-scroll.test.tsx` reads this primitive too, but its turbo hash does not cover this file,
 * so a cached pass there can replay over a regression here.
 *
 * Read off the syntax tree, not a regex, so a comment explaining `flexShrink` cannot satisfy it
 * and an override later in the style array cannot hide behind an earlier entry: the LAST entry
 * that sets shrinking decides, as React Native resolves it. The trailing `style` prop is the call
 * site's and is judged there.
 *
 * PROVED RED (UMK-1075), each alone and reverted:
 *
 * | Injection into `Tabs.tsx` | Reds |
 * | -- | -- |
 * | `Tabs` root back to `<View style={style}>` (as shipped) | `Tabs` |
 * | `TabsContent` without `SHRINK` | `TabsContent` |
 * | `SHRINK` becomes `{ flexShrink: 0 }` | both |
 * | `TabsContent` style `[SHRINK, …, { flexShrink: 0 }, style]` | `TabsContent` |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const FILE = resolve(__dirname, '../Tabs.tsx');
const sf = ts.createSourceFile(FILE, readFileSync(FILE, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) ? unwrap(e.expression) : e;

const declarations = (): Map<string, ts.Expression> => {
  const out = new Map<string, ts.Expression>();
  const walk = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) out.set(n.name.text, n.initializer);
    /* Returns void: a truthy return would end `forEachChild` early and silently find less. */
    ts.forEachChild(n, (c) => {
      walk(c);
    });
  };
  walk(sf);
  return out;
};
const DECLS = declarations();

/** `true`/`false` when this entry SETS shrinking, `undefined` when it says nothing about it. */
const setsShrink = (expr: ts.Expression): boolean | undefined => {
  let e = unwrap(expr);
  if (ts.isIdentifier(e) && DECLS.has(e.text)) e = unwrap(DECLS.get(e.text) as ts.Expression);
  if (ts.isConditionalExpression(e)) {
    const [a, b] = [setsShrink(e.whenTrue), setsShrink(e.whenFalse)];
    /* A branch can take shrinking away; it cannot be relied on to grant it. */
    return a === false || b === false ? false : undefined;
  }
  if (!ts.isObjectLiteralExpression(e)) return undefined;
  for (const p of e.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === 'flexShrink') {
      const v = unwrap(p.initializer);
      return ts.isNumericLiteral(v) && Number(v.text) > 0;
    }
  }
  return undefined;
};

/** Whether the outermost `View` the named component renders leaves `flexShrink` > 0 in force. */
const rootShrinks = (component: string): boolean => {
  const init = DECLS.get(component);
  if (!init) throw new Error(`${component} not found in Tabs.tsx`);
  let root: ts.JsxOpeningLikeElement | undefined;
  const find = (n: ts.Node): void => {
    if (root) return;
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === 'View') root = n;
    ts.forEachChild(n, (c) => {
      find(c);
    });
  };
  find(init);
  if (!root) throw new Error(`${component} renders no View`);
  const style = root.attributes.properties.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === 'style',
  );
  const value = style?.initializer && ts.isJsxExpression(style.initializer) ? style.initializer.expression : undefined;
  if (!value) return false;
  const entries = ts.isArrayLiteralExpression(unwrap(value)) ? (unwrap(value) as ts.ArrayLiteralExpression).elements : [value];
  let inForce = false;
  for (const entry of entries) {
    const set = setsShrink(entry);
    if (set !== undefined) inForce = set;
  }
  return inForce;
};

describe('native Tabs can shrink inside a bounded parent', () => {
  it('Tabs — the set’s root View', () => {
    expect(rootShrinks('Tabs')).toBe(true);
  });

  it('TabsContent — the panel a caller puts its ScrollView in', () => {
    expect(rootShrinks('TabsContent')).toBe(true);
  });

  it('TabsList does NOT — the trigger row is the one part that must stay whole', () => {
    /* The reader's positive control: it must be able to answer `false`, or the two above prove
       nothing. `TabsList`'s root sets no shrink. */
    expect(rootShrinks('TabsList')).toBe(false);
  });
});
