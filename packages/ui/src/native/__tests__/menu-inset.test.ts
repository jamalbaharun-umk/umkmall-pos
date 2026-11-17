/**
 * `Menu` must hand its `bottomInset` to the `Dialog` it renders (UMK-913).
 *
 * `Menu` IS a bottom sheet — the UMK-913 decision — so it inherits the sheet's safe-area
 * problem exactly: anchored to `flex-end`, its last row lands under the home indicator on
 * gesture navigation. The prop defaults to `0`, so a `Menu` that accepts an inset and drops
 * it on the floor compiles, renders, reviews clean and is still the shipped bug.
 *
 * THIS half exists because of the turbo caching rule: `test` is cached per package with no
 * `dependsOn`, so the call-site scan in `apps/mobile/src/__tests__/overlay-safe-area.test.tsx`
 * replays a cached PASS when the change is here. Break the forwarding below and that scan may
 * never run — every call site still passes an inset, and none of it reaches the sheet.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * SOURCE-SCANNED, not imported: `react-native` does not load under vitest (its entry is
 * Flow), so the component is read as text — the same trick `exports.test.ts` and
 * `press-states.test.ts` use.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MENU = readFileSync(resolve(__dirname, '..', 'Menu.tsx'), 'utf8');

/**
 * The `<Dialog …>` opening tag, ended at the first `>` at brace depth 0.
 *
 * Deliberately not `/<Dialog[\s\S]*?>/`: that stops at the first `>` in the tag, which here
 * is the arrow in `onOpenChange={(next) => …}` on the line above — the exact failure that let
 * `dialogs.test.ts` watch one dialog of four. Duplicated from `apps/mobile`'s `jsx-tags.ts`
 * rather than shared because a package cannot import its consumer's test helper; the comment
 * is the link, and both are pinned by their own fixtures.
 */
const dialogTag = (source: string): string => {
  const start = source.indexOf('<Dialog ');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let quote: string | null = null;
  let i = start + '<Dialog'.length;
  for (; i < source.length; i++) {
    const c = source[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
    } else if (c === '>' && depth === 0) {
      break;
    }
  }
  return source.slice(start, i + 1);
};

describe('Menu forwards its safe-area inset', () => {
  it('declares the prop', () => {
    expect(MENU).toMatch(/bottomInset\?: number;/);
  });

  it('destructures it rather than leaving it in the rest', () => {
    /* A prop declared and never read is the same bug with a passing type check. */
    expect(MENU).toMatch(/export const Menu = \([^)]*\bbottomInset\b[^)]*\}: MenuProps\)/s);
  });

  it('hands it to the Dialog it renders', () => {
    expect(dialogTag(MENU)).toMatch(/bottomInset=\{bottomInset\}/);
  });

  it('forwards `compact` to the Dialog as well (UMK-1702)', () => {
    expect(MENU).toMatch(/compact\?: boolean;/);
    expect(MENU).toMatch(/export const Menu = \([^)]*\bcompact\b[^)]*\}: MenuProps\)/s);
    expect(dialogTag(MENU)).toMatch(/compact=\{compact\}/);
  });

  /* The reader has to survive this file's own subject: `Menu`'s Dialog tag carries an arrow
     in `onOpenChange`, so a reader that stopped at the first `>` would return a tag ending
     before `bottomInset` and red the assertion above for the wrong reason. */
  it('reads past an arrow inside the tag', () => {
    expect(dialogTag(MENU)).toContain('onOpenChange');
    expect(dialogTag(MENU).endsWith('>')).toBe(true);
  });
});
