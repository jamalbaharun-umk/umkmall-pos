import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { tokens } from './generated';

/**
 * UMK-1041 L24: `Surface/Default Subtle` (#F9FAFB), the chat shell and thread fill. It enters through
 * the overlay and the generator — never a hand edit — so this checks the whole chain from the
 * source value to an emitted `bg-default-subtle` rule.
 */
const PACKAGE = resolve(__dirname, '../..');
const require_ = createRequire(import.meta.url);

describe('surface-default-subtle', () => {
  it('is #F9FAFB in the generated tree, as an rgb custom property, and a preset colour', () => {
    expect((tokens as unknown as { surface: Record<string, string> }).surface.defaultSubtle).toBe('#f9fafb');
    expect(readFileSync(resolve(PACKAGE, 'tokens.css'), 'utf8')).toContain('--surface-default-subtle: 249 250 251;');
    expect(readFileSync(resolve(PACKAGE, 'tokens.preset.js'), 'utf8')).toContain(
      '"default-subtle": "rgb(var(--surface-default-subtle) / <alpha-value>)"',
    );
  });

  it('emits a bg-default-subtle rule that reads the custom property', async () => {
    const preset = require_(resolve(PACKAGE, 'tailwind.preset.js'));
    const out = await postcss([
      tailwind({ presets: [preset], content: [{ raw: '<div class="bg-default-subtle"></div>' }] }),
    ]).process('@tailwind utilities;', { from: undefined });
    expect(out.css).toMatch(/\.bg-default-subtle\s*{[^}]*--surface-default-subtle/);
  });
});
