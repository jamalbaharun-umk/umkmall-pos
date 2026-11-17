/**
 * `native/glyphs/generated.tsx` still matches the web glyphs it was generated from.
 *
 * `icon-parity.test.ts` compares the two registries by NAME, which is the wrong half of the
 * problem: a name can be present on both platforms and point at a drawing that changed on one
 * of them a month ago. Editing a path in `primitives/Icon/glyphs/index.tsx` left native
 * rendering the old shape with every test in this package green — the generator has to be
 * re-run by hand, and nothing asked whether it had been.
 *
 * The generator's own `--check` mode is the comparison: it builds both outputs in memory and
 * exits non-zero if either differs from what is committed. A generated file is only as
 * trustworthy as the check that it was regenerated.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GENERATOR = resolve(__dirname, '../../../scripts/generate-native-glyphs.mjs');

describe('generated native glyphs', () => {
  it('are what the generator produces from the current web source', () => {
    let output = '';
    try {
      output = execFileSync('node', [GENERATOR, '--check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      throw new Error(
        `native glyphs are stale — a web glyph changed and the generator was not re-run.\n${e.stderr ?? ''}${e.stdout ?? ''}`,
      );
    }
    /* The generator's own floor throws below 30 glyphs, so a drifted regex cannot reach here
       and report agreement between two empty files. */
    expect(output).toMatch(/✓ \d+ glyphs and \d+ registry rows match/);
  });
});
