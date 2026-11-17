/**
 * The native TextField's `prefix` (UMK-1186) sits in the box's row BEFORE the adornment and
 * the input, and is not hidden from accessibility — a country picker inside it must stay
 * reachable. A source scan, like the other guards here: this package renders no native tree.
 *
 * Proven red: moving the prefix line below `<TextInput`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* Comments stripped (line comments first, as `dialog-no-centred.test.ts` does), so a docblock
   quoting `{prefix}` cannot stand in for the JSX. */
const source = readFileSync(resolve(__dirname, '..', 'TextField.tsx'), 'utf8')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('the native TextField prefix', () => {
  it('renders before the adornment and the input', () => {
    expect(source.match(/\{prefix\}/g) ?? []).toHaveLength(1);
    const prefix = source.indexOf('{prefix}');
    const adornment = source.indexOf('{leadingAdornment}');
    const input = source.search(/<TextInput\s/);
    expect(prefix).toBeGreaterThan(0);
    expect(prefix).toBeLessThan(adornment);
    expect(adornment).toBeLessThan(input);
  });

  it('is not wrapped in the hidden-from-accessibility view', () => {
    /* The WHOLE expression, from its guard to the node: a hiding wrapper written on the line
       above `{prefix}` — the shape the adornment beside it has — must red too. */
    const end = source.indexOf('{prefix}');
    const start = source.lastIndexOf('{prefix !==', end);
    expect(start).toBeGreaterThan(0);
    expect(source.slice(start, end)).not.toMatch(/accessibilityElementsHidden|no-hide-descendants/);
  });
});
