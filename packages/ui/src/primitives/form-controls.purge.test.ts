import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BARE_BOX,
  BARE_CONTROL,
  BOX_BASE,
  BOX_CONTROL,
  BOX_SIZE,
  BOX_HEIGHT_COMPACT,
  BOX_SIZE_COMPACT,
  BOX_STATE_COMPACT,
  BOX_SIZE_XSMALL,
  BOX_STATE,
  BOX_STATE_VALID,
  CONTROL_FIRST_LINE,
  FIELD_COUNTER_LARGE,
  FIELD_COUNTER_LIMIT_LARGE,
  FIELD_VALID_MARK,
  CONTROL_BOX,
  RADIO_BOX,
  CONTROL_BOX_ERROR,
  CONTROL_GLYPH,
  CONTROL_LABEL,
  CONTROL_ROW,
  FIELD_ADORNMENT,
  FIELD_COUNTER,
  FIELD_COUNTER_LIMIT,
  FIELD_LABEL,
  SELECT_DISABLED_HINT,
  OTP_ROW,
  OTP_BOX,
  OTP_BOX_SIZE,
  OTP_BOX_ACTIVE,
  OTP_INPUT,
  SELECT_EMPTY,
  SELECT_LIST,
  SELECT_LIST_SIZE,
  SELECT_OPTION,
  SELECT_OPTION_HINT,
  SELECT_ROW_SIZE,
  SELECT_SEARCH,
  SELECT_SEARCH_INPUT,
  SELECT_TRIGGER,
  SELECTION_CARD,
  SELECTION_CARD_BODY,
  SELECTION_CARD_EYEBROW,
  SELECTION_CARD_HEADING,
  SELECTION_CARD_INDICATOR,
  SELECTION_CARD_INDICATOR_MARK,
  SELECTION_CARD_INDICATOR_SHAPE,
  SELECTION_CARD_INDICATOR_STATE,
  SELECTION_CARD_INPUT,
  SELECTION_CARD_LAYOUT,
  SELECTION_CARD_ROW,
  SELECTION_CARD_GRID,
  SELECTION_CARD_TILE_BADGE,
  SELECTION_CARD_TILE_SIZE,
  SELECTION_CARD_TILE_TEXT,
  SELECTION_CARD_SIZE,
  SELECTION_CARD_STATE,
  UPLOAD_BASE,
  UPLOAD_BORDER,
  UPLOAD_DRAG_OVER,
  UPLOAD_INPUT,
  UPLOAD_SIZE,
  UPLOAD_STATUS,
  SEGMENTED_SEGMENT,
  SEGMENTED_SEGMENT_CHECKED,
  SEGMENTED_SEGMENT_SIZE,
  SEGMENTED_TRACK,
} from './field-classes';
/* The whole module, so the coverage check can compare the hand-assembled list against what
   `field-classes.ts` actually exports rather than against itself. */
import * as tables from './field-classes';
/* The `choice` appearance's tables live in their OWN file (they carry two hex values the table guard
   below forbids), so they are guarded here, separately, rather than by being left out of every list. */
import * as choiceTables from './selection-card-choice-classes';
/* UMK-1307: the `a2ui` appearances of every primitive the agent surface renders, in one file for the same reason. */
import * as a2uiTables from './a2ui-classes';

/**
 * A PURGED CLASS RENDERS UNSTYLED AGAINST A GREEN SUITE. The component tests assert a class
 * name is on the element; nothing there can tell whether Tailwind ever emitted a rule for it.
 * The Storybook build is the usual gate for that, and it is the only one — so this runs the
 * same compiler over this package's own preset and its own source, and asserts the rules
 * exist.
 *
 * Sited HERE, not in `apps/design`. `turbo.json`'s `test` task hashes a package's own files
 * and not its workspace dependencies', so a purge guard living in the consuming app replays
 * a cached PASS over a component edit (UMK-852). It also has to load the preset by relative
 * path: `@umkmall/ui/tailwind-preset` resolves through the node_modules symlink, which is a
 * different copy of this package the moment anyone works in a git worktree.
 *
 * AND IT SCANS SOURCE ONLY, never the tests. A glob of `src/**` sweeps this file in, and the
 * list of selectors below is then its own content — every class here would report as emitted
 * whether or not any component still uses it. That is the exact shape of a guard that passes
 * because it is measuring itself.
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

/**
 * EVERY CLASS THE TABLES HOLD, spread from `field-classes.ts` rather than hand-listed.
 *
 * This list used to be a chosen subset of twenty-odd selectors while its docblock claimed to
 * cover "the generated token colours, the ds-* scales, the focus pair and the peer-driven
 * glyph". A subset is the failure this whole file exists to prevent one level up: breaking a
 * size step, or adding a table nobody remembered to list, left the suite green. The three
 * sibling purge guards already derive theirs; this one now does too, and the coverage check
 * below keeps it honest as the family grows.
 *
 * The extras below the spread are classes that live in a COMPONENT rather than in a table —
 * the calendar's own slots and the peer-driven glyph — so nothing derives them.
 */
const words = (table: Record<string, string>): string[] =>
  Object.values(table).flatMap((v) => v.split(' '));

const ALL_TABLE_WORDS = [
  ...BARE_BOX.split(' '),
  ...BARE_CONTROL.split(' '),
  ...BOX_SIZE_XSMALL.split(' '),
  ...BOX_SIZE_COMPACT.split(' '),
  ...words(BOX_STATE_COMPACT),
  ...words(BOX_HEIGHT_COMPACT),
  ...BOX_STATE_VALID.split(' '),
  ...words(CONTROL_FIRST_LINE),
  ...FIELD_COUNTER_LARGE.split(' '),
  ...FIELD_COUNTER_LIMIT_LARGE.split(' '),
  ...FIELD_VALID_MARK.split(' '),
  ...BOX_BASE.split(' '),
  ...words(BOX_SIZE),
  ...words(BOX_STATE),
  ...BOX_CONTROL.split(' '),
  ...CONTROL_BOX.split(' '),
  ...RADIO_BOX.split(' '),
  ...CONTROL_BOX_ERROR.split(' '),
  ...CONTROL_GLYPH.split(' '),
  ...CONTROL_ROW.split(' '),
  ...CONTROL_LABEL.split(' '),
  ...FIELD_LABEL.split(' '),
  ...FIELD_ADORNMENT.split(' '),
  ...FIELD_COUNTER.split(' '),
  ...FIELD_COUNTER_LIMIT.split(' '),
  ...SELECTION_CARD_ROW.split(' '),
  ...SELECTION_CARD_GRID.split(' '),
  ...SELECTION_CARD.split(' '),
  ...words(SELECTION_CARD_SIZE),
  ...words(SELECTION_CARD_STATE),
  ...SELECTION_CARD_EYEBROW.split(' '),
  ...SELECTION_CARD_HEADING.split(' '),
  ...SELECTION_CARD_BODY.split(' '),
  ...SELECTION_CARD_INPUT.split(' '),
  /* UMK-1218: the tile layout and its corner control. */
  ...words(SELECTION_CARD_LAYOUT),
  ...SELECTION_CARD_INDICATOR.split(' '),
  ...words(SELECTION_CARD_INDICATOR_SHAPE),
  ...words(SELECTION_CARD_INDICATOR_STATE),
  ...SELECTION_CARD_INDICATOR_MARK.split(' '),
  ...SELECTION_CARD_TILE_TEXT.split(' '),
  ...SELECTION_CARD_TILE_BADGE.split(' '),
  ...words(SELECTION_CARD_TILE_SIZE),
  ...UPLOAD_BASE.split(' '),
  ...SEGMENTED_TRACK.split(' '),
  ...SEGMENTED_SEGMENT.split(' '),
  ...SEGMENTED_SEGMENT_CHECKED.split(' '),
  ...words(SEGMENTED_SEGMENT_SIZE),
  ...words(UPLOAD_SIZE),
  ...words(UPLOAD_STATUS),
  ...words(UPLOAD_BORDER),
  ...UPLOAD_DRAG_OVER.split(' '),
  ...UPLOAD_INPUT.split(' '),
  ...SELECT_TRIGGER.split(' '),
  ...SELECT_LIST.split(' '),
  ...words(SELECT_OPTION),
  ...words(SELECT_LIST_SIZE),
  ...words(SELECT_ROW_SIZE),
  ...SELECT_SEARCH.split(' '),
  ...SELECT_SEARCH_INPUT.split(' '),
  ...SELECT_EMPTY.split(' '),
  ...SELECT_OPTION_HINT.split(' '),
  ...SELECT_DISABLED_HINT.split(' '),
  ...OTP_ROW.split(' '),
  ...OTP_BOX.split(' '),
  ...words(OTP_BOX_SIZE),
  ...OTP_BOX_ACTIVE.split(' '),
  ...OTP_INPUT.split(' '),
  /* Component-sited, not table-sited. The calendar styles itself from these rather than from
     a library stylesheet, so they purge exactly like any other class here — and nothing that
     renders it would notice. */
  'rounded-ds-full',
  'rounded-ds-xs',
  'text-default-secondary',
  'peer-checked:opacity-100',
  'hover:bg-weak-brand',
  'text-ds-body-md-mobile',
  'border-collapse',
  'invisible',
  'focus-visible:border-focus-brand',
  'focus-visible:ring-halo',
].filter((c) => c.length > 0);

const classWordsOf = (value: unknown): string[] =>
  typeof value === 'string' ? value.split(' ') : Object.values(value as Record<string, string>).flatMap((v) => v.split(' '));
const CHOICE_WORDS = Object.values(choiceTables).flatMap(classWordsOf).filter((c) => c.length > 0);
const A2UI_WORDS = Object.values(a2uiTables).flatMap(classWordsOf).filter((c) => c.length > 0);
/* The choice file carries NO raw colour since UMK-1380: its idle border and body ink moved to the nearest tokens. Any hex reds. */
const CHOICE_ALLOWED_HEX: string[] = [];

const REQUIRED = [...ALL_TABLE_WORDS, ...CHOICE_WORDS, ...A2UI_WORDS]
  /**
   * ARBITRARY VALUES ARE DROPPED, because this guard cannot falsify them: Tailwind's JIT
   * generates them from the very line the expectation is derived from, so the rule always
   * exists and the check always passes. Kept out of `ALL_TABLE_WORDS` itself because the
   * hex check below must still see them — `bg-[#ff0000]` IS an arbitrary value.
   */
  .filter((c) => !c.includes('['))
  /**
   * Tailwind BACKSLASH-ESCAPES anything CSS would read as syntax, so a variant class is
   * emitted as `.hover\\:bg-…`. Escaping a chosen subset builds a selector the stylesheet
   * never contains and reports a healthy class as purged; mirror Tailwind's own rule.
   */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the form-control classes survive the purge', () => {
  /* Compiled ONCE, as the three sibling purge guards already do. The pipeline reads the same
     preset over the same content either way, so running it per assertion paid the cost twice
     for a byte-identical answer. */
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  /**
   * THE DAY CELL'S `:not()` VARIANT, which no other check in this package can see (UMK-1091).
   *
   * `[&:not(.day-selected)>button]:text-default-brand` is what stops today's ink tying with the
   * selection's ink and painting brand-on-brand. It contains `[`, so `REQUIRED` above filters it
   * out along with every other arbitrary value — and the behaviour test asserts the class is in
   * the class STRING, not that it resolves. Both are green if the selector is malformed.
   *
   * And malformed fails in the direction that looks fixed: Tailwind emits nothing, today's brand
   * ink never applies to any day, and the collision is "gone" because the losing rule stopped
   * existing. The only tell is an unselected today rendering in default ink.
   *
   * So this asserts the RULE, out of the same compile the guard above uses: that the selector
   * survived, and that it is scoped rather than universal. Same shape as `Slider.test.tsx`'s
   * preset-rung assertions, for the same reason — a bracketed class gets no purge coverage, which
   * is the whole subject of
   * docs/solutions/conventions/preflight-reaches-three-selectors-and-a-vendor-pseudo-element-is-not-one.md
   */
  /**
   * THE QUIET-FOCUS RING (UMK-955). `FOCUS_RING.field` is an arbitrary variant now, so `REQUIRED` above
   * drops it with the other bracketed classes: assert the RULE. It must be scoped to a box WITHOUT
   * `data-quiet-focus`, or an autofocused field paints its ring again.
   */
  it('emits the focus ring only for a box that is not quiet', () => {
    for (const utility of ['border-focus-brand', 'ring-2', 'ring-halo']) {
      expect(css, utility).toContain(
        `.\\[\\&\\:not\\(\\[data-quiet-focus\\]\\)\\]\\:focus-within\\:${utility}:focus-within:not([data-quiet-focus])`,
      );
    }
  });

  it('emits the scoped today-ink rule the day cell depends on', () => {
    const rule = new RegExp(String.raw`\.\\\[\\&\\:not\\\(\\\.day-selected\\\)\\>button\\\]\\:text-default-brand:not\(\.day-selected\)\s*>\s*button\s*\{([^}]*)\}`).exec(css);
    expect(
      rule,
      "Tailwind emitted no rule for the scoped today ink; a malformed selector silently drops it and every other assertion still passes",
    ).not.toBeNull();
    expect(rule?.[1], 'the rule emitted but sets no colour').toMatch(/color:/);
    /* Scoped, not universal: a rule that lost its `:not()` would apply to a selected day too,
       which is the collision this exists to remove. */
    /**
     * SCOPED IS ASSERTED OVER THE RULES THAT EXIST, not as a ban on a spelling.
     *
     * A ban is only as good as its escaping: get the backslashes wrong and it matches nothing
     * and passes, which is the vacuity this branch has now hit three times. So instead of
     * refusing one spelling, collect every emitted rule that inks `text-default-brand` through
     * a `> button` descendant and require all of them to carry the `:not()`. The set is the
     * evidence — an empty set fails the floor, so the check cannot pass by finding nothing.
     */
    const brandInkOnButton = [...css.matchAll(/([^{}]*text-default-brand[^{}]*>\s*button[^{}]*)\{/g)].map(
      (m) => m[1].trim(),
    );
    expect(
      brandInkOnButton.length,
      'no emitted rule inks the day button brand at all, so this check is measuring nothing',
    ).toBeGreaterThan(0);
    expect(
      brandInkOnButton.filter((selector) => !selector.includes(':not(')),
      'an unscoped today-ink rule is emitted, so it ties with the selection ink again',
    ).toEqual([]);
  });

  it(
    'emits a rule for every class the controls rely on',
    () => {
      /* A substring match is not enough: `.rounded-ds-lg` is a substring of the real
         `.rounded-ds-sm`, so `includes` reports a purged class as present. The boundary is
         what makes this guard bite. */
      const emitted = (selector: string) =>
        new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
      const missing = REQUIRED.filter((selector) => !emitted(selector));
      expect(missing).toEqual([]);
    },
  );

  /* Anti-vacuity: an empty list would make the assertion above pass by looking for nothing at
     all, which is the failure mode this file's docblock warns about. */
  it('has a non-trivial list to check', () => {
    expect(new Set(REQUIRED).size).toBeGreaterThan(40);
  });

  /**
   * EVERY EXPORTED TABLE IS ACCOUNTED FOR. The list above is hand-assembled, so a control
   * adding a table to `field-classes.ts` and forgetting to spread it here loses its purge
   * check silently: nothing fails, the totals still look healthy, and only that control
   * renders unstyled when its token goes. Comparing against the module's own exports is what
   * makes the omission loud, and a future helper is excluded by TYPE rather than by name.
   */
  it('spreads every class table the module exports', () => {
    const classWords = (v: unknown): string[] =>
      typeof v === 'string'
        ? v.split(' ')
        : v && typeof v === 'object'
          ? Object.values(v as Record<string, string>).flatMap((x) => String(x).split(' '))
          : [];

    const covered = new Set(ALL_TABLE_WORDS);
    const missing: string[] = [];
    for (const [name, value] of Object.entries(tables)) {
      if (typeof value === 'function') continue;
      const own = classWords(value).filter((c) => c.length > 0);
      if (own.length === 0) continue;
      if (!own.every((c) => covered.has(c))) missing.push(name);
    }
    expect(missing, 'these exports are not spread into ALL_TABLE_WORDS').toEqual([]);
    expect(Object.keys(tables).length).toBeGreaterThan(8);
  });

  /**
   * NO RAW PALETTE AND NO HEX. A token-shaped table with one palette class left in it renders
   * perfectly while being outside the design system entirely. Reads the UNFILTERED list,
   * because Tailwind's hex escape hatch is itself an arbitrary value and the bracket filter
   * would make this blind to the exact thing it catches.
   */
  it('uses no raw Tailwind palette class and no hex', () => {
    const all = ALL_TABLE_WORDS.join(' ');
    expect(all).not.toMatch(
      /(?:^|[\s:])(?:bg|text|border|from|via|to|ring|fill|stroke|shadow|outline|decoration|accent|caret|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
    );
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('guards the choice appearance: every export, no hex, file scanned', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    // The hand-assembled content list is only a guard if it actually reaches the file.
    expect(scanned.some((f) => f.endsWith('selection-card-choice-classes.ts'))).toBe(true);
    expect(Object.keys(choiceTables).length).toBeGreaterThan(5);
    const hexes = [...new Set(CHOICE_WORDS.join(' ').match(/#[0-9a-fA-F]{3,8}/g) ?? [])].map((h) => h.toUpperCase());
    expect(hexes.sort()).toEqual([...CHOICE_ALLOWED_HEX].sort());
    expect(CHOICE_WORDS.join(' ')).not.toMatch(
      /(?:^|[\s:])(?:bg|text|border|ring|fill|stroke|shadow|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
    );
  });

  it('guards the a2ui appearances: every export, no raw palette step, file scanned and required to survive the purge', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('a2ui-classes.ts'))).toBe(true);
    expect(Object.keys(a2uiTables).length).toBeGreaterThan(20);
    /* Its hex is allowlisted by `a2ui-classes.test.ts`; here the file is held to the compile. */
    expect(A2UI_WORDS.join(' ')).not.toMatch(
      /(?:^|[\s:])(?:bg|text|border|ring|fill|stroke|shadow|outline|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
    );
    const required = new Set(REQUIRED);
    for (const c of A2UI_WORDS.filter((w) => !w.includes('['))) {
      expect(required.has(`.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`), `${c} is not required to survive the purge`).toBe(true);
    }
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('form-controls.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('TextField.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('field-support.test-d.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('field-classes.ts'))).toBe(true);
  });

  it(
    "emits the Slider's computed track gradient and both thumb pseudo-elements",
    () => {
      expect(css).toContain('var(--slider-fill)');
      expect(css).toContain('::-webkit-slider-thumb');
      expect(css).toContain('::-moz-range-thumb');
    },
  );
});
