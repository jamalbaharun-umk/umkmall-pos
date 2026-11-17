import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALERT_BASE,
  ALERT_GLYPH_INK,
  ALERT_INK,
  ALERT_SIZE,
  ALERT_SURFACE,
  ALERT_TREATMENT,
  ALERT_TREATMENT_GLYPH_INK,
  PROGRESS_FILL,
  PROGRESS_LABEL,
  PROGRESS_LABEL_TEXT,
  PROGRESS_LABEL_VALUE,
  PROGRESS_RADIAL_GRADIENT_STOPS,
  PROGRESS_RADIAL_SIZE,
  PROGRESS_RADIAL_STROKE,
  PROGRESS_RADIAL_TRACK,
  PROGRESS_SIZE,
  PROGRESS_TRACK,
  PROGRESS_VARIANT,
  SPINNER_BASE,
  SPINNER_GRADIENT_FILL,
  SPINNER_GRADIENT_MASK,
  SPINNER_SIZE,
  SPINNER_VARIANT,
  DISMISS_BUTTON,
  SKELETON_BASE,
  SKELETON_SHAPE,
  SKELETON_SHEEN,
  TOOLTIP_SIZE,
  TOOLTIP_SURFACE,
  TOOLTIP_ARROW_FILL,
  TOASTER_WIDTH,
} from './feedback-classes';
/* The whole module, so the coverage check below can compare the hand-assembled list against
   what `feedback-classes.ts` actually exports rather than against itself. */
import * as tables from './feedback-classes';

/**
 * A PURGED CLASS RENDERS UNSTYLED AGAINST A GREEN SUITE. The component tests assert a class
 * name is on the element; nothing there can tell whether Tailwind ever emitted a rule for
 * it. Same reasoning and same siting as `form-controls.purge.test.ts` — in this package,
 * because `turbo.json`'s `test` task hashes a package's own files and not its workspace
 * dependencies' (UMK-852), and loading the preset by relative path because
 * `@umkmall/ui/tailwind-preset` resolves through a node_modules symlink that is a different
 * copy the moment anyone works in a git worktree.
 *
 * AND IT SCANS SOURCE ONLY, never the tests. A glob of `src/**` sweeps this file in, and
 * the class names below become their own content — every one would report as emitted
 * whether or not a component still uses it. That is the exact shape of a guard that passes
 * because it is measuring itself.
 *
 * The expectations are DERIVED from the same tables the components render rather than
 * hand-listed, so a table that gains a value gains its purge check with it.
 */
const require_ = createRequire(import.meta.url);
const PACKAGE = resolve(__dirname, '../..');

const componentFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? componentFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.(?:test|test-d|stories)\./.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

const compile = async (): Promise<string> => {
  const preset = require_(resolve(PACKAGE, 'tailwind.preset.js'));
  const processed = await postcss([
    tailwind({ presets: [preset], content: componentFiles(resolve(PACKAGE, 'src')) }),
  ]).process('@tailwind utilities;', { from: undefined });
  return processed.css;
};

const words = (table: Record<string, string>): string[] =>
  Object.values(table).flatMap((v) => v.split(' '));

/** The size tables hold `{ box, glyph }` rather than a bare string. */
const sizeWords = (table: Record<string, { box: string; glyph: string }>): string[] =>
  Object.values(table).flatMap((v) => `${v.box} ${v.glyph}`.split(' '));

/**
 * Every colour AND GEOMETRY class the four surfaces depend on — spread from the tables
 * themselves, so a table that gains a value gains its check with it.
 *
 * The size tables and the two base strings were missing from the first version of this
 * list while its docblock already claimed to cover them, which is its own small version of
 * the failure this file exists to prevent: a guard whose stated scope is wider than its
 * actual one. Breaking a type step in `ALERT_SIZE` or the sweep colour in `SKELETON_SHEEN`
 * left the whole suite green. Spread every table; never hand-list a subset.
 */
const ALL_TABLE_WORDS = [
  ...ALERT_BASE.split(' '),
  ...sizeWords(ALERT_SIZE),
  ...sizeWords(TOOLTIP_SIZE),
  ...SKELETON_SHEEN.split(' '),
  ...words(ALERT_SURFACE.alert),
  ...words(ALERT_SURFACE.toast),
  ...words(ALERT_INK.alert),
  ...words(ALERT_INK.toast),
  ...words(ALERT_GLYPH_INK.alert),
  ...words(ALERT_GLYPH_INK.toast),
  /* Every treatment's classes, spread from the tables rather than hand-listed — including
     BOTH gradient stops, which is the pair a truncation would otherwise shrink away
     unnoticed. */
  ...Object.values(ALERT_TREATMENT).flatMap((byFunction) => words(byFunction)),
  ...Object.values(ALERT_TREATMENT_GLYPH_INK).flatMap((byFunction) => words(byFunction)),
  ...words(TOOLTIP_SURFACE),
  ...words(TOOLTIP_ARROW_FILL),
  ...words(SKELETON_SHAPE),
  ...SKELETON_BASE.split(' '),
  ...DISMISS_BUTTON.split(' '),
  ...TOASTER_WIDTH.split(' '),
  ...PROGRESS_TRACK.split(' '),
  ...PROGRESS_FILL.split(' '),
  ...words(PROGRESS_VARIANT),
  ...words(PROGRESS_SIZE),
  ...words(PROGRESS_RADIAL_SIZE),
  ...words(PROGRESS_RADIAL_STROKE),
  ...PROGRESS_RADIAL_TRACK.split(' '),
  ...words(PROGRESS_RADIAL_GRADIENT_STOPS),
  ...SPINNER_GRADIENT_FILL.split(' '),
  ...SPINNER_GRADIENT_MASK.split(' '),
  ...PROGRESS_LABEL.split(' '),
  ...PROGRESS_LABEL_TEXT.split(' '),
  ...PROGRESS_LABEL_VALUE.split(' '),
  ...SPINNER_BASE.split(' '),
  ...words(SPINNER_VARIANT),
  ...words(SPINNER_SIZE),
  /* The elevation. There is no z-index token group otherwise — the preset's `z` group is a
     colour group — so this is the one class proving `build.mjs` still emits `zIndex`. */
  'z-ds-overlay',
].filter((c) => c.length > 0);

const REQUIRED = ALL_TABLE_WORDS
  /**
   * ARBITRARY VALUES ARE DROPPED, because this guard cannot falsify them. Tailwind's JIT
   * generates `h-[18px]` from the very line the expectation is derived from, so the rule
   * always exists and the check always passes — a tautology, and exactly the
   * measuring-itself shape the docblock above warns about. Asserting them would inflate
   * the count while proving nothing. Scale and token classes are the real subject: those
   * come from the preset, which can genuinely stop emitting them.
   */
  .filter((c) => !c.includes('['))
  /**
   * Tailwind BACKSLASH-ESCAPES every character in a class name that CSS would otherwise
   * read as syntax — `:` in a variant, and `[`/`]` in an arbitrary value — so the emitted
   * selector for `h-[18px]` is literally `.h-\\[18px\\]`. Escaping only the colon (the
   * first version of this) built a selector the stylesheet never contains and reported a
   * healthy class as purged. Mirror Tailwind's own rule instead of enumerating characters:
   * anything outside [A-Za-z0-9_-] gets a backslash.
   */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the feedback classes survive the purge', () => {
  /* Compiled ONCE. The pipeline reads the same preset over the same content either way, so
     running it per test paid ~600ms twice for a byte-identical answer. */
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it(
    'emits a rule for every class the four surfaces rely on',
    () => {
      /* A substring match is not enough: `.rounded-ds-lg` is a substring of the real
         `.rounded-ds-sm`, so `includes` reports a purged class as present. The boundary is
         what makes this guard bite.

         `\\` MUST be in the escape set. Tailwind writes a variant class with a literal
         backslash — `.hover\\:opacity-100:hover` — so a regex that turns `\\:` back into a
         plain `:` looks for a selector the stylesheet does not contain and reports a
         perfectly healthy class as purged. Every non-variant class passes either way,
         which is why this only surfaced once a `focus-visible:` class was added. */
      const emitted = (selector: string) =>
        new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
      const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
      expect(missing).toEqual([]);
    },
  );

  /**
   * THE ONE ARBITRARY VALUE WHOSE MEASURED NUMBERS ARE PINNED. The filter above drops bracketed
   * classes as tautologies, and for the SELECTOR that is right — Tailwind generates the rule
   * from the same line the expectation reads. The declaration is a different question: this
   * spells the two Figma measurements out (1140 on the 1440 desktop frame, and the 16px-a-side
   * gutter that lands the 360 phone at 328), so an edit to either one has to be an edit here
   * too, rather than a toast that is quietly the wrong box at every width.
   *
   * WHAT IT CANNOT CATCH, checked rather than assumed: the un-spaced `calc(100vw-32px)` — the
   * spelling that looks like the silent failure, since `calc()` needs spaces around its
   * operator — is normalised BY TAILWIND back to `calc(100vw - 32px)`. It emits correct CSS
   * and this stays green, which is the honest scope of the guard. The underscores in the class
   * are still the right spelling; they are just not load-bearing.
   */
  it('emits the measured width, not just a rule named like one', () => {
    expect(css).toMatch(/width:\s*min\(1140px,\s*calc\(100vw - 32px\)\)/);
  });

  it('emits the shimmer keyframe itself, not only the utility that names it', () => {
    /* A utility referencing a keyframe that was never emitted animates nothing, and the
       class is present either way — which is why the class check above cannot see it. */
    expect(css).toContain('@keyframes ds-shimmer');
  });

  /**
   * NO LEGACY `z-*` TOKEN, NO RAW PALETTE AND NO HEX in any feedback table.
   *
   * Added with `ProgressBar` and `Spinner`, which are the reason it was needed: they shipped
   * `bg-green-500`, `bg-orange-500`, `bg-red-500`, `bg-gray-200`, `border-t-z-primary` and
   * `border-t-gray-500` — every one rendering correctly today and rendering nothing on the day
   * its group retires. Reads the UNFILTERED list, because Tailwind's hex escape hatch is
   * itself an arbitrary value and the bracket filter would blind this to the thing it catches.
   */
  it('uses no legacy z-* token, no raw Tailwind palette class and no hex', () => {
    const all = ALL_TABLE_WORDS.join(' ');
    expect(all).not.toMatch(/(?:^|[\s:])(?:bg|text|border|ring|fill|stroke|from|via|to)-z-/);
    expect(all).not.toMatch(
      /(?:^|[\s:])(?:bg|text|border|from|via|to|ring|fill|stroke|shadow|outline|decoration|accent|caret|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
    );
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    /* Anti-vacuity: the unfiltered list must be strictly larger than the filtered one, or the
       bracket-bearing classes this check exists to see are not reaching it. */
    expect(ALL_TABLE_WORDS.length).toBeGreaterThan(REQUIRED.length);
  });

  /**
   * EVERY EXPORTED TABLE IS ACCOUNTED FOR — the check that keeps this guard's coverage honest
   * as the family grows, and the one its two siblings already had while this file did not.
   *
   * `REQUIRED` is hand-assembled, so a component adding a table to `feedback-classes.ts` and
   * forgetting to spread it here loses its purge check silently: nothing fails, the totals
   * still look healthy, and only that component renders unstyled when its token goes.
   *
   * The two VOCABULARY tables are excluded by name rather than by type, because they are
   * strings that are not classes — a severity word and an icon name. Naming them is what keeps
   * the exclusion from quietly widening to a real table someone adds later.
   */
  it('spreads every class table the module exports', () => {
    const NOT_CLASS_TABLES = new Set(['ALERT_VARIANT_LABEL', 'ALERT_VARIANT_ICON']);
    const classWords = (v: unknown): string[] =>
      typeof v === 'string'
        ? v.split(' ')
        : v && typeof v === 'object'
          ? Object.values(v as Record<string, unknown>).flatMap((x) =>
              x && typeof x === 'object'
                ? Object.values(x as Record<string, string>).flatMap((y) => String(y).split(' '))
                : String(x).split(' '),
            )
          : [];

    const covered = new Set(ALL_TABLE_WORDS);
    const missing: string[] = [];
    for (const [name, value] of Object.entries(tables)) {
      if (typeof value === 'function' || NOT_CLASS_TABLES.has(name)) continue;
      const own = classWords(value).filter((c) => c.length > 0);
      if (own.length === 0) continue;
      if (!own.every((c) => covered.has(c))) missing.push(name);
    }
    expect(missing, 'these exports are not spread into ALL_TABLE_WORDS').toEqual([]);
    /* And there is something to compare against, so an empty module read cannot pass. */
    expect(Object.keys(tables).length).toBeGreaterThan(15);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('feedback.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('Alert.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('feedback-classes.ts'))).toBe(true);
    /* `.test-d.` is not `.test.`, so a filter keyed on the latter sweeps every type-level test
       in as content. Named per file rather than as a total, so ONE reappearing is visible. */
    expect(scanned.some((f) => f.endsWith('field-support.test-d.ts'))).toBe(false);
  });
});
