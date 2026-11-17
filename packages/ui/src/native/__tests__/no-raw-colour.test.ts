/**
 * NO COLOUR LITERAL ANYWHERE IN `packages/ui/src/native`, but the artwork the web keeps raw too
 * (UMK-1317).
 *
 * The native half of the library reads `tokens`. Nothing enforced that: the web has
 * `no-raw-colour.test.ts` over its primitives and `apps/mobile` has `design-literals.test.ts` over
 * the app, and this directory sat between the two guards, in neither. It held no stray colour only
 * because nobody had written one.
 *
 * THE MATCHERS ARE THE APP GUARD'S, CALLED, NOT COPIED: `../testing/colour-literals` is one
 * module both suites import, and its docblock is the table of spellings — what is caught, and what
 * deliberately is not. A ban is its matcher; two copies drift.
 *
 * THE ALLOWLIST IS EXACT, PER FILE AND PER KIND, in both directions: more than recorded is a
 * regression, and FEWER reds too, so a fix forces the record shrunk. One file is on it:
 * `glyphs/generated.tsx`, which is GENERATED from the web glyph file (`scripts/generate-native-glyphs.mjs`).
 * Its four tile colours are the web's own annotated survivors
 * (`primitives/Icon/glyphs/index.tsx`, each marked `ds-raw-ok`), and its white fills are the same
 * artwork's. Native cannot drop them without the web dropping them first — and
 * `glyphs-generated.test.ts` already reds if the two files disagree.
 *
 * SITED HERE, not in `apps/mobile`: turbo hashes `test` per package, so a guard over this directory
 * written in the app would replay a cached pass over an edit here.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * PROVED RED, one injection each into a real file (`Divider.tsx`), plus the two directions of the
 * allowlist:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `borderColor: '#F0F0F0'` | no unrecorded literal — kind `hex` |
 * | `` borderColor: `${tokens.border.default.primary}cc` `` | no unrecorded literal — kind `alpha-concat` |
 * | `borderColor: 'rgba(0,0,0,0.1)'` | no unrecorded literal — kind `colour-fn` |
 * | `borderColor: 'white'` | no unrecorded literal — kind `named` |
 * | `borderColor: 0xfff0f0f0` | no unrecorded literal — kind `hex-number` |
 * | one tile hex deleted from `glyphs/generated.tsx` | records nothing that is gone |
 * | the walk made non-recursive | walks the whole directory |
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blankComments, scanColourLiterals, type ColourOffenceKind } from '../testing/colour-literals';

const NATIVE_DIR = resolve(__dirname, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

/** What a file may still carry, by kind, exactly — with the web line that carries the same. */
const ALLOWED: Record<string, { counts: Partial<Record<ColourOffenceKind, number>>; why: string }> = {
  'glyphs/generated.tsx': {
    counts: { hex: 4, named: 12 },
    why:
      'GENERATED from the web glyphs (scripts/generate-native-glyphs.mjs): the four file-tile colours are the ' +
      "web's own `ds-raw-ok` survivors in primitives/Icon/glyphs/index.tsx, and the white fills and stroke are the same artwork",
  },
  /* The matcher module spells the colour names it looks for; it is the scanner, not a colour. */
  'testing/colour-literals.ts': {
    counts: {},
    why: 'the shared matcher itself — excluded from its own scan below, listed so the exclusion is a recorded decision',
  },
};
const NOT_SCANNED = new Set(['testing/colour-literals.ts']);

const files = sourceFiles(NATIVE_DIR);
const found = new Map<string, Partial<Record<ColourOffenceKind, number>>>();
const lines: string[] = [];
for (const file of files) {
  const rel = relative(NATIVE_DIR, file);
  if (NOT_SCANNED.has(rel)) continue;
  const counts: Partial<Record<ColourOffenceKind, number>> = {};
  for (const offence of scanColourLiterals(blankComments(readFileSync(file, 'utf8'), file))) {
    counts[offence.kind] = (counts[offence.kind] ?? 0) + 1;
    lines.push(`${rel}:${offence.line} ${offence.kind} ${offence.text}`);
  }
  if (Object.keys(counts).length) found.set(rel, counts);
}

describe('no colour literal in the native library', () => {
  /**
   * A count floor cannot catch lost recursion here — all but a handful of the files sit at the top
   * level — so the two files that live one level DOWN are named: a walk that stops descending loses
   * both, and one of them is the only file with anything recorded.
   */
  it('walks the whole directory, glyphs included', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files.some((f) => f.endsWith('glyphs/generated.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('composer-styles.ts'))).toBe(true);
    expect([...NOT_SCANNED].every((rel) => files.some((f) => f.endsWith(rel)))).toBe(true);
  });

  it('finds what it is built to find, so a clean result is not a dead matcher', () => {
    const kinds = (source: string) => scanColourLiterals(blankComments(source)).map((o) => o.kind);
    expect(kinds("const a = { color: '#FFFFFF' };")).toEqual(['hex']);
    expect(kinds('const a = `${tokens.surface.default.overlay}66`;')).toEqual(['alpha-concat']);
    expect(kinds("const a = { shadowColor: 'rgba(0,0,0,0.1)' };")).toEqual(['colour-fn']);
    expect(kinds('<Path fill="white" />')).toEqual(['named']);
    expect(kinds("// '#FFFFFF'\n/* rgba(0,0,0,1) */ const a = tokens.surface.default.primary;")).toEqual([]);
    expect(kinds("const u = 'https://x.y/z'; const c = '#123456';")).toEqual(['hex']);
    /* A `//` or a slash-star inside a string is not a comment: the regex stripper this suite first
       had blanked the literal after each. */
    expect(kinds("const a = { uri: 'cdn//x', color: '#ABCDE3' };")).toEqual(['hex']);
    expect(kinds("const a = { accept: 'video/*', color: '#ABCDE4' };\nconst b = { color: '#ABCDE5' }; /* x */")).toEqual(['hex', 'hex']);
    expect(kinds("const a = { color: dark ? 'white' : 'black', backgroundColor: 'skyblue' };")).toEqual(['named', 'named', 'named']);
    expect(kinds("const a = 0XFF0074E7; const b = 'RGBA(0,0,0,0.5)';")).toEqual(['hex-number', 'colour-fn']);
  });

  it('has no source the scan cannot read: no .js, .jsx, .mjs, .cjs or .json in the library', () => {
    const unread = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return unread(path);
        return /\.(?:[cm]?jsx?|json)$/.test(entry.name) ? [relative(NATIVE_DIR, path)] : [];
      });
    expect(unread(NATIVE_DIR)).toEqual([]);
  });

  it('holds no literal a file is not recorded for', () => {
    const over = [...found].flatMap(([file, counts]) =>
      Object.entries(counts)
        .filter(([kind, count]) => (count ?? 0) > (ALLOWED[file]?.counts[kind as ColourOffenceKind] ?? 0))
        .map(([kind]) => `${file}: ${kind}`),
    );
    expect(over, `read a token, or withAlpha(token, percent):\n${lines.filter((l) => over.some((o) => l.startsWith(o.split(':')[0]))).join('\n')}`).toEqual([]);
  });

  it('records nothing that is gone', () => {
    const stale = Object.entries(ALLOWED).flatMap(([file, { counts }]) =>
      Object.entries(counts)
        .filter(([kind, count]) => (found.get(file)?.[kind as ColourOffenceKind] ?? 0) !== count)
        .map(([kind, count]) => `${file}: recorded ${count} ${kind}, found ${found.get(file)?.[kind as ColourOffenceKind] ?? 0}`),
    );
    expect(stale).toEqual([]);
    for (const { why } of Object.values(ALLOWED)) expect(why.length).toBeGreaterThan(40);
  });
});
