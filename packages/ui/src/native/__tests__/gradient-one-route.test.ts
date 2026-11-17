/**
 * ONE ROUTE TO A GRADIENT, on this side of the package boundary (PR #1116 review).
 *
 * `GradientFill` (`native/gradient.tsx`) is the one place `expo-linear-gradient` is drawn: its
 * direction table is where the web's direction class becomes a pair of points, and a second, ad hoc
 * `start`/`end` is how one surface ends up sweeping the other way. `apps/mobile`'s
 * `design/__tests__/gradients.test.tsx` bans the import across the APP, but a second
 * `import { LinearGradient }` inside THIS package, the other half of `GradientFill`'s claim, was
 * invisible to it. And that guard could not simply widen its root: a guard only guards its own
 * package, because turbo hashes `test` per package and would replay a cached app-side pass over a
 * change here (CLAUDE.md, UMK-852). So the package gets its own.
 *
 * Scanned as text in every module-load form, keyed on the specifier, over the WHOLE package source.
 * Web files have no business importing a React Native module either. Two assertions keep it from
 * being vacuous: the walk must reach `gradient.tsx` and a known web primitive, and `gradient.tsx`
 * must itself import the module (so moving the helper or dropping the dependency reds, rather than
 * leaving a ban that bans nothing).
 *
 * PROVED RED, one injection each, reverted:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `import { LinearGradient } from 'expo-linear-gradient';` added to `native/Badge.tsx` | one route |
 * | `require("expo-linear-gradient")` added to `native/Card.tsx` | one route |
 * | `gradient.tsx`'s import renamed to a local stub path | the helper holds the import |
 * | the walk stops recursing (a flat `readdirSync`) | the walk reaches both halves |
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');
const HELPER = join('native', 'gradient.tsx');

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });

/* Every module-load form: `import … from`, bare `import`, `export … from`, `require(…)` and
   dynamic `import(…)`, with either quote or a no-substitution template literal. */
const LOAD = /(?:from|import|require)\s*\(?\s*['"`]expo-linear-gradient['"`]/;

/* This file names the specifier in prose and in LOAD itself, and is not a consumer. */
const SELF = join('native', '__tests__', 'gradient-one-route.test.ts');

describe('the package reaches expo-linear-gradient only through GradientFill', () => {
  const all = files(SRC);
  const rel = (f: string) => relative(SRC, f);

  it('the walk reaches both halves of the package, so the ban is not vacuous', () => {
    const names = all.map(rel);
    expect(names).toContain(HELPER);
    expect(names).toContain(join('primitives', 'Button', 'Button.tsx'));
    expect(names.filter((n) => n.startsWith(`native${'/'}`)).length).toBeGreaterThan(40);
  });

  it('the helper holds the import', () => {
    expect(LOAD.test(readFileSync(join(SRC, HELPER), 'utf8'))).toBe(true);
  });

  it('one route: no other file in the package imports it', () => {
    const offenders = all
      .filter((f) => rel(f) !== HELPER && rel(f) !== SELF)
      .filter((f) => LOAD.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
