/**
 * A tab label is ONE line (UMK-1161), and it never shrinks to fit.
 *
 * The settings sheet's three equal-width triggers (the web's `grid-cols-3`) wrapped "Komunitas"
 * onto two lines at 360dp once the ACTIVE weight widened it. Figma never draws a two-line tab, so
 * the string label renders `numberOfLines={1}`.
 *
 * The first fix also shrank it to fit (`adjustsFontSizeToFit` + `minimumFontScale`). That rendered
 * an idle "Perangkat" at 4pt on iPhone: on the new architecture iOS reads `minimumFontSize` only
 * (default 4pt), never `minimumFontScale`, and its search lands on that floor when no ratio passes
 * the fit check. Android looked right, so only a device saw it. A row too narrow for its labels
 * takes a smaller STEP — `xsmall`, 14px, the web's dense bar — and this file bans the shrink.
 *
 * What the shrink absorbed was the SYSTEM text size, so the label bounds that instead
 * (`TAB_LABEL_MAX_FONT_SCALE`): without a bound an "Extra large" phone reads "Pera…".
 *
 * Read off the syntax tree like `tabs-shrink.test.ts`, and sited in this package for the same
 * reason: a guard only guards its own package.
 *
 * PROVED RED, each alone and reverted (2026-10-12): dropping `numberOfLines={1}`; adding
 * `adjustsFontSizeToFit`; adding `minimumFontScale={0.875}`; adding `minimumFontSize={14}`; adding a
 * `{...shrink}` spread; dropping `maxFontSizeMultiplier`; `TAB_LABEL_MAX_FONT_SCALE = 1.3`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { tokens } from '../../tokens';

const FILE = resolve(__dirname, '../Tabs.tsx');
const sf = ts.createSourceFile(FILE, readFileSync(FILE, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** A top-level numeric `const` in the file, read off its tree (importing `Tabs.tsx` pulls in React Native). */
function numericConst(name: string): number {
  let value: number | undefined;
  sf.forEachChild(function find(node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      value = Number(node.initializer.getText(sf));
    } else node.forEachChild(find);
  });
  expect(value, name).toBeDefined();
  return value!;
}

/** `TAB_SIZE.<step>.role`, off `content-styles.ts`'s text (importing it pulls in React Native). */
function tabRole(step: string): string {
  const cs = resolve(__dirname, '../content-styles.ts');
  const text = readFileSync(cs, 'utf8');
  const block = text.slice(text.indexOf('export const TAB_SIZE'));
  const match = block.match(new RegExp(`\\b${step}:\\s*\\{[^}]*role:\\s*'(\\w+)'`));
  expect(match, `TAB_SIZE.${step}.role`).not.toBeNull();
  return match![1];
}

/** Every `<Text …>` opening element inside the `TabsTrigger` declaration. */
function triggerTexts(): ts.JsxOpeningElement[] {
  const found: ts.JsxOpeningElement[] = [];
  let trigger: ts.Node | undefined;
  sf.forEachChild(function find(node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'TabsTrigger') trigger = node;
    else node.forEachChild(find);
  });
  expect(trigger, 'TabsTrigger declaration').toBeDefined();
  trigger!.forEachChild(function walk(node): void {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(sf) === 'Text') found.push(node);
    node.forEachChild(walk);
  });
  return found;
}

const attr = (el: ts.JsxOpeningElement, name: string): ts.JsxAttribute | undefined =>
  el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name);

const valueOf = (a: ts.JsxAttribute | undefined): string | null => {
  if (!a) return null;
  if (!a.initializer) return 'true';
  return ts.isJsxExpression(a.initializer) ? (a.initializer.expression?.getText(sf) ?? null) : a.initializer.getText(sf);
};

describe('the tab label', () => {
  /* The label Text is the one whose variant is the size's role; the notif count is a different Text. */
  const label = () => triggerTexts().find((el) => valueOf(attr(el, 'variant')) === 'role');

  it('exists where the walk expects it', () => {
    expect(label()).toBeDefined();
  });

  it('never wraps', () => {
    expect(valueOf(attr(label()!, 'numberOfLines'))).toBe('1');
  });

  /* Every spelling that turns the shrink back on: the prop, its floor, and a spread that could
     carry either past this walk. */
  it('never shrinks to fit', () => {
    const el = label()!;
    expect(valueOf(attr(el, 'adjustsFontSizeToFit'))).toBeNull();
    expect(valueOf(attr(el, 'minimumFontScale'))).toBeNull();
    expect(valueOf(attr(el, 'minimumFontSize'))).toBeNull();
    expect(el.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p))).toBe(false);
  });

  /* One Android step ("Large"): the multiplier the call sites' rows are sized to fit at. */
  it('bounds the system text size instead', () => {
    expect(valueOf(attr(label()!, 'maxFontSizeMultiplier'))).toBe('TAB_LABEL_MAX_FONT_SCALE');
    expect(numericConst('TAB_LABEL_MAX_FONT_SCALE')).toBeGreaterThanOrEqual(1);
    expect(numericConst('TAB_LABEL_MAX_FONT_SCALE')).toBeLessThanOrEqual(1.15);
  });

  /* The dense step is the web's size, not a guess: `text-ds-paragraph-mobile`, 14px. */
  it('offers an xsmall step at 14px', () => {
    const role = tabRole('xsmall') as keyof typeof tokens.typography.mobile;
    const step = tokens.typography.mobile[role] as { regular: { fontSize: number } };
    expect(step.regular.fontSize).toBe(14);
  });
});
