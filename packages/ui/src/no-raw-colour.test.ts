import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * UMK-1380. The `/temanai` route paints through these library files, so they carry no raw colour:
 * no hex, no Tailwind palette class, no literal `rgba()`/`hsl()`. This sits in `packages/ui` rather
 * than in main-website's guard on purpose (UMK-852): turbo hashes a test's own package, so a guard
 * in the app replays a cached pass over a change in this package. The matcher is a copy of
 * `apps/main-website/lib/temanai-design-system.test.ts`'s, for the same reason.
 *
 * It reads STRING LITERALS (strings, no-substitution templates, template heads/spans) from the AST,
 * so a comment is excluded by construction and a class in `cn()`, a constant or `style` is read.
 * A survivor stands under `// ds-raw-ok: <reason>` on its own line or the line above, and only
 * with a non-empty reason; it is then exempt here (the guard in main-website counts survivors).
 *
 * CEILING, stated (what this ban cannot see): a class assembled by concatenation or interpolation (`'bg-' + 'gray-500'`,
 * `` `bg-${c}-500` ``), a hex in JSX TEXT (`<style>.a{fill:#fff}</style>` is a JsxText node, not a literal), and a CSS NAMED colour (`fill="white"`, `{ color: 'red' }`) is not matched — SVG attributes use them throughout the glyph
 * files and a keyword match cannot tell a colour from a prop value. Hex, palette classes and the rgb/hsl/oklch/oklab/lab/lch/color-mix
 * functions are.
 *
 * Scan list is enumerated, and a file that cannot be read fails: a root that goes dark is the
 * failure UMK-958 names, and a `> 0` floor cannot see it.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

/** file (relative to src) -> unannotated hex / palette / colour-function it holds TODAY. A unit lowers its row; the end state is all zeros. */
const BASELINE: Record<string, Metrics> = {
  'primitives/a2ui-classes.ts': { hex: 0, palette: 0, colourFn: 0 },
  'primitives/selection-card-choice-classes.ts': { hex: 0, palette: 0, colourFn: 0 },
  'primitives/Label/Label.tsx': { hex: 0, palette: 0, colourFn: 0 },
  'primitives/overlay-classes.ts': { hex: 0, palette: 0, colourFn: 0 },
  'primitives/lightbox-classes.ts': { hex: 0, palette: 0, colourFn: 0 },
  'primitives/sidebar-classes.ts': { hex: 0, palette: 0, colourFn: 0 },
  'contract/variants.ts': { hex: 0, palette: 0, colourFn: 0 },
  'primitives/Icon/glyphs/index.tsx': { hex: 0, palette: 0, colourFn: 0 },
};
type Metrics = { hex: number; palette: number; colourFn: number };

const PALETTES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITIES =
  'text|bg|border(?:-[trblxyse])?|ring|ring-offset|inset-ring|outline|divide|fill|stroke|from|via|to|placeholder|decoration|accent|caret|shadow|inset-shadow|drop-shadow|text-shadow';
const PALETTE_CLASS = new RegExp(
  `^(?:${UTILITIES})-(?:(?:white|black)|(?:${PALETTES})-\\d{2,3}|\\[(?:#|rgb|hsl)[^\\]]*\\])(?:/(?:\\d+|\\[[^\\]]+\\]))?$`,
);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const COLOUR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\((?!\s*var\()/g;

/** The utility is what follows the last `:` OUTSIDE brackets (`[&_p:hover]:text-x` has two). */
function utilityOf(token: string): string {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === ':' && depth === 0) cut = i;
  }
  return token.slice(cut + 1).replace(/^!/, '');
}

function annotated(raw: string, offset: number): boolean {
  const lines = raw.slice(0, offset).split('\n');
  const has = (l: string) => /ds-raw-ok:\s*\S/.test(l);
  const [twoBack, oneBack, here] = [lines.at(-3) ?? '', lines.at(-2) ?? '', lines.at(-1) ?? ''];
  return has(here) || has(oneBack) || (has(twoBack) && !/<[a-zA-Z]/.test(oneBack));
}

/** What one file holds: raw colour NOT under a reasoned `ds-raw-ok`, and how many literals were read (the floor). */
function scan(name: string, raw: string): Metrics & { literals: number } {
  const sf = ts.createSourceFile(name, raw, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const m = { hex: 0, palette: 0, colourFn: 0, literals: 0 };
  const walk = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      m.literals++;
      if (!annotated(raw, node.getStart(sf))) {
        m.palette += node.text.split(/\s+/).filter((t) => PALETTE_CLASS.test(utilityOf(t))).length;
        m.hex += node.text.match(HEX)?.length ?? 0;
        m.colourFn += node.text.match(COLOUR_FN)?.length ?? 0;
      }
    }
    ts.forEachChild(node, walk); // MUST be last, and this arrow MUST return void (UMK-958).
  };
  walk(sf);
  return m;
}

const read = (f: string) => readFileSync(join(SRC, f), 'utf8');
const files = Object.keys(BASELINE);
const views = files.map((f) => ({ f, raw: read(f), ...scan(f, read(f)) }));

describe('no raw colour in the /temanai library files (UMK-1380)', () => {
  it.each(views)('$f holds no more raw colour than its baseline', ({ f, hex, palette, colourFn }) => {
    const b = BASELINE[f]!;
    expect({ hex, palette, colourFn }, `${f}: lower BASELINE when a unit clears some`).toEqual(b);
  });

  /** A file with almost no literals is a scan that read nothing (UMK-958): the floor is a RATIO of what each file held. */
  const LITERALS_AT_1380: Record<string, number> = {
    'primitives/a2ui-classes.ts': 59,
    'primitives/selection-card-choice-classes.ts': 12,
    'primitives/Label/Label.tsx': 27,
    'primitives/overlay-classes.ts': 35,
    'primitives/lightbox-classes.ts': 9,
    'primitives/sidebar-classes.ts': 20,
    'contract/variants.ts': 1120,
    'primitives/Icon/glyphs/index.tsx': 334,
  };
  it('names every scanned file in the literal floor', () => {
    expect(Object.keys(LITERALS_AT_1380)).toEqual(files);
  });
  it.each(views)('still reads most of the literals in $f', ({ f, literals }) => {
    expect(literals / LITERALS_AT_1380[f]!, `${f}: ${literals} of ${LITERALS_AT_1380[f]}`).toBeGreaterThanOrEqual(0.8);
  });

  /**
   * THE MATCHER, one injection per SPELLING of "a hard-coded colour", written from what a developer
   * types (UMK-900), appended to a REAL file so a scan that skips the file cannot hide it.
   */
  const SPELLINGS: [string, string, keyof Metrics][] = [
    ['hex in a constant', `export const X1380 = '#123456';`, 'hex'],
    ['palette class in cn()', `export const X1380 = cn('bg-gray-100');`, 'palette'],
    ['arbitrary-value class', `export const X1380 = 'text-[#123456]';`, 'palette'],
    ['rgba in a style value', `export const X1380 = { background: 'rgba(0,0,0,0.5)' };`, 'colourFn'],
    ['hsla in a style value', `export const X1380 = { color: 'hsla(10, 20%, 30%, .5)' };`, 'colourFn'],
    ['oklab in a style value', `export const X1380 = { color: 'oklab(0.5 0.1 0.1)' };`, 'colourFn'],
    ['lab in a style value', `export const X1380 = { color: 'lab(50% 40 59.5)' };`, 'colourFn'],
    ['lch in a style value', `export const X1380 = { color: 'lch(50% 80 30)' };`, 'colourFn'],
    ['color-mix in a style value', `export const X1380 = { color: 'color-mix(in srgb, red 50%, blue)' };`, 'colourFn'],
    ['oklch in a style value', `export const X1380 = { color: 'oklch(0.5 0.1 200)' };`, 'colourFn'],
    ['hsl in a template literal', 'export const X1380 = `hsl(${h} 50% 50%)`;', 'colourFn'],
    ['logical-side border colour', `export const X1380 = 'border-s-gray-200';`, 'palette'],
    ['drop-shadow colour', `export const X1380 = 'drop-shadow-red-500';`, 'palette'],
    ['text-shadow colour', `export const X1380 = 'text-shadow-red-500';`, 'palette'],
    ['inset-shadow colour', `export const X1380 = 'inset-shadow-red-500';`, 'palette'],
    ['inset-ring colour', `export const X1380 = 'inset-ring-red-500';`, 'palette'],
    ['palette class behind a variant', `export const X1380 = 'md:hover:!text-blue-600';`, 'palette'],
  ];
  it.each(views.flatMap((v) => SPELLINGS.map((s) => [v.f, ...s] as const)))(
    '%s: injected %s goes red alone',
    (f, _label, code, metric) => {
      const before = views.find((v) => v.f === f)!;
      const after = scan(f, `${before.raw}\n${code}\n`);
      expect(after[metric]).toBe(before[metric] + 1);
      for (const other of ['hex', 'palette', 'colourFn'] as const) {
        if (other !== metric && !(metric === 'palette' && other === 'hex')) expect(after[other]).toBe(before[other]);
      }
    },
  );

  it('counts a literal colour function but not a token-backed rgb(var(--x))', () => {
    expect(scan('x.ts', `export const a = 'rgba(0,0,0,.5)';`).colourFn).toBe(1);
    expect(scan('x.ts', `export const a = 'rgb(var(--surface-default-brand) / 0.3)';`).colourFn).toBe(0);
  });

  it('exempts a survivor only under a reasoned ds-raw-ok', () => {
    expect(scan('x.ts', `// ds-raw-ok: brand mark\nexport const a = '#123456';`).hex).toBe(0);
    expect(scan('x.ts', `// ds-raw-ok:\nexport const a = '#123456';`).hex).toBe(1);
    expect(scan('x.ts', `// ds-raw-ok: why\n\n\nexport const a = '#123456';`).hex).toBe(1);
  });
});
