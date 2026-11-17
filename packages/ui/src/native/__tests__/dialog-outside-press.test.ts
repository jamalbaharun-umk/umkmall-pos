import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The native `Dialog`'s `dismissOnOutsidePress`, by WIRING (UMK-1498).
 *
 * `Dialog.tsx` imports `react-native` at runtime, which will not load under vitest, so this reads the
 * source, like `dialog-modal-boundary.test.ts`. What it pins: `false` turns ONLY the backdrop tap off
 * (no `onPress`, role `none`, hidden from accessibility), through one derived value `backdropCloses`;
 * Android Back and the close button keep calling `close` (so `onOpenChange(false)`); the default is
 * `true`, so every existing caller still closes on a backdrop tap.
 *
 * PROVED RED, one injection, reverted: `backdropCloses = dismissible && dismissOnOutsidePress` →
 * `= dismissible` reds three: "defaults to true …", "backdropCloses is dismissible AND the prop" and "the prop
 * reaches nothing but the backdrop" (the wiring checks, which read the prop's own sites).
 */

const DIALOG = readFileSync(resolve(__dirname, '..', 'Dialog.tsx'), 'utf8');
/** Comments removed, so prose cannot satisfy a wiring assertion. */
const code = DIALOG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const backdrop = (() => {
  const at = code.indexOf('<AnimatedPressable');
  return code.slice(at, code.indexOf('/>', at));
})();

describe('the native Dialog dismissOnOutsidePress (wiring)', () => {
  it('defaults to true, so a backdrop press closes for every existing caller', () => {
    expect(code).toMatch(/dismissOnOutsidePress = true,/);
    expect(code).toMatch(/const backdropCloses = dismissible && dismissOnOutsidePress;/);
  });

  it('backdropCloses is dismissible AND the prop (false on the prop ends the backdrop tap, true keeps it)', () => {
    expect(code.match(/const backdropCloses = ([^;]+);/)?.[1]).toBe('dismissible && dismissOnOutsidePress');
  });

  it('the backdrop is wired to backdropCloses: a press closes, otherwise no onPress, role none, hidden', () => {
    expect(backdrop).toMatch(/accessibilityRole=\{backdropCloses \? 'button' : 'none'\}/);
    expect(backdrop).toMatch(/accessibilityLabel=\{backdropCloses \? closeLabel : undefined\}/);
    expect(backdrop).toMatch(/importantForAccessibility=\{backdropCloses \? 'auto' : 'no'\}/);
    expect(backdrop).toMatch(/onPress=\{backdropCloses \? close : undefined\}/);
  });

  it('the prop reaches nothing but the backdrop: Back and the close button still call close', () => {
    const uses = code.match(/dismissOnOutsidePress/g) ?? [];
    // the declaration, the default, the derived value, and nothing else
    expect(uses).toHaveLength(3);
    expect(code).toMatch(/onRequestClose=\{dismissible \? close : \(\) => \{\}\}/);
    const close = code.slice(code.indexOf('{showCloseButton &&'), code.indexOf('))}', code.indexOf('{showCloseButton &&')));
    expect(close).toMatch(/onPress=\{close\}/);
    expect(close).not.toMatch(/backdropCloses|dismissOnOutsidePress|dismissible/);
  });

  it('close reaches onOpenChange(false) while open', () => {
    expect(code).toMatch(/const close = React\.useCallback\(\(\) => \{\s*if \(openRef\.current\) onOpenChange\(false\);/);
  });
});
