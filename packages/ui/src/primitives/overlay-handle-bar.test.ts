import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIALOG_HANDLE_BAR } from './overlay-classes';

const preset = createRequire(import.meta.url)('../../tokens.preset.js').theme.extend as Record<
  string,
  Record<string, string>
>;
const tokensCss = readFileSync(resolve(__dirname, '../../tokens.css'), 'utf8');

/**
 * UMK-1579: the sheet handle was `bg-default-secondary`, the SURFACE token #F6F6F6, which is
 * invisible on the white sheet (UMK-978: a resolving class is not proof of the colour). The
 * mockup draws #C3CBD3 = `--border-default-invert`. No `bg-*` utility maps to a border
 * variable, so the bar is a 2px border filling a 4px box.
 */
describe('DIALOG_HANDLE_BAR', () => {
  it('is the golden class string', () => {
    expect(DIALOG_HANDLE_BAR).toBe('h-1 w-10 rounded-full border-2 border-default-invert');
  });

  it('does not use the surface token', () => {
    expect(DIALOG_HANDLE_BAR).not.toMatch(/(^|\s)bg-/);
  });

  it('border-default-invert maps to --border-default-invert, which is #c3cbd3', () => {
    expect(preset.borderColor['default-invert']).toContain('var(--border-default-invert)');
    expect(tokensCss).toMatch(/--border-default-invert:\s*195 203 211;/); // #c3cbd3
  });
});
