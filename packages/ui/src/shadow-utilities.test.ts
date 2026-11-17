import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const preset = createRequire(root + '/')('./tailwind.preset.js');
const css = readFileSync(resolve(root, 'tokens.css'), 'utf8');

// UMK-1333: `shadow-5-pct` / `shadow-card` / `shadow-10-pct` resolve to the published
// composites. A name Tailwind does not know emits nothing, so a typo here is a missing shadow
// with no error — hence the check that each var is one tokens.css actually defines.
describe('shadow utilities', () => {
  for (const name of ['5-pct', 'card', '10-pct']) {
    it(`shadow-${name} points at a defined --shadow-${name}`, () => {
      expect(preset.theme.extend.boxShadow[name]).toBe(`var(--shadow-${name})`);
      expect(css).toContain(`--shadow-${name}:`);
    });
  }
});
