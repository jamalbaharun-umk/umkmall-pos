/**
 * The native Image's `avatar` FILLS its circle (UMK-1186): `fit` defaults to `cover` for that
 * type, as on the web, where a letterboxed photo drew as a pill inside the circle. A source
 * scan, like the other guards here: this package renders no native tree.
 *
 * Proven red: the default back to a flat `'contain'`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '..', 'Image.tsx'), 'utf8');

describe('the native avatar', () => {
  it('defaults fit to cover for type avatar, and contain otherwise', () => {
    expect(source).toMatch(/fit = type === 'avatar' \? 'cover' : 'contain'/);
  });
});
