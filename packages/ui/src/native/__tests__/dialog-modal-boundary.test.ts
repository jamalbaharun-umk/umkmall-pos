import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The native `Dialog`'s screen-reader boundary and identity close, by WIRING (UMK-1487).
 *
 * `Dialog.tsx` imports `react-native` at runtime, which will not load under vitest, so this reads the
 * source — the trick `toast-design.test.ts` and `press-states.test.ts` use. What it pins: without an
 * overlay the panel is the `accessibilityViewIsModal` element (unchanged for every existing caller);
 * with one, a wrapper holding the panel and the overlay carries it instead, so a toast beside the
 * panel is reachable; the identity sheet's close presses with `PressableScaleHost`, the classic one
 * keeps its plain `Pressable`. The rendered behaviour — scrim hidden, overlay reachable, close scales
 * and closes — is `apps/mobile/src/design/__tests__/dialog-modal-boundary.test.tsx`.
 *
 * PROVED RED, one injection each, reverted:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | panel `accessibilityViewIsModal={overlay === undefined}` → `{false}` | "the panel is modal exactly when there is no overlay" |
 * | the overlay wrapper's `accessibilityViewIsModal` removed | "with an overlay, a wrapper …" |
 * | the identity close back to a plain `Pressable` | "the identity close presses …" |
 */

const DIALOG = readFileSync(resolve(__dirname, '..', 'Dialog.tsx'), 'utf8');
/** Comments removed, so prose cannot satisfy a wiring assertion. */
const code = DIALOG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the Dialog modal boundary (wiring)', () => {
  it('the panel is modal exactly when there is no overlay', () => {
    const panel = code.slice(code.indexOf('const panel = ('), code.indexOf('return (\n    <Modal'));
    expect(panel).toMatch(/accessibilityViewIsModal=\{overlay === undefined\}/);
  });

  it('with an overlay, a wrapper holding the panel and the overlay is the modal element', () => {
    const tail = code.slice(code.indexOf('{overlay === undefined ? ('));
    expect(tail).toMatch(/<View accessibilityViewIsModal pointerEvents="box-none"[^>]*>\s*\{panel\}[\s\S]*?\{overlay\}/);
  });

  it('the identity close presses with PressableScaleHost; the classic close stays a Pressable', () => {
    const close = code.slice(code.indexOf('{showCloseButton &&'), code.indexOf('))}', code.indexOf('{showCloseButton &&')));
    expect(close).toMatch(/identity \? \(\s*<PressableScaleHost scale="icon"[^>]*accessibilityLabel=\{closeLabel\}[^>]*onPress=\{close\}/);
    expect(close).toMatch(/\) : \(\s*<Pressable accessibilityRole="button" accessibilityLabel=\{closeLabel\} onPress=\{close\}/);
  });
});
