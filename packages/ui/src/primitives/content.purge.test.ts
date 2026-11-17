import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BADGE_BASE,
  BADGE_COLOR,
  BADGE_SIZE,
  CARD_BASE,
  CARD_PADDING,
  CARD_VARIANT,
  CHIP_BASE,
  CHIP_COMPACT_IDLE_BORDER,
  CHIP_COMPACT_WEIGHT,
  CHIP_SIZE,
  CHIP_STATE,
  CODE_BLOCK_ACTION,
  CODE_BLOCK_ACTIONS,
  CODE_BLOCK_BAR,
  CODE_BLOCK_BASE,
  CODE_BLOCK_BODY,
  CODE_BLOCK_FAILED,
  CODE_BLOCK_SIZE,
  DISCLOSURE_BASE,
  DISCLOSURE_PANEL,
  DISCLOSURE_SUMMARY,
  DIVIDER_BASE,
  DIVIDER_LABEL,
  DIVIDER_ORIENTATION,
  DIVIDER_RULE,
  DIVIDER_VARIANT,
  hasLegacyBrandToken,
  ICON_SLOT,
  IMAGE_BASE,
  IMAGE_HOVER,
  IMAGE_PLACEHOLDER,
  IMAGE_SIZE,
  IMAGE_TYPE,
  LIST_BULLET,
  LIST_MARKER,
  LIST_GAP,
  LIST_SPACE,
  LIST_GAP_MD,
  LIST_GAP_LG,
  IMAGE_BARE,
  IMAGE_BARE_IMG,
  IMAGE_ROUNDED,
  LIST_BULLET_ITEM,
  LIST_DIRECTION,
  STEPPER_BASE,
  STEPPER_CONNECTOR,
  STEPPER_CONNECTOR_STATE,
  STEPPER_LABEL_STATE,
  STEPPER_MARK,
  STEPPER_MARK_STATE,
  STEPPER_ORIENTATION,
  STEPPER_SELECT,
  STEPPER_STEP,
  TAB_LIST,
  TAB_NOTIF,
  TAB_NOTIF_SIZE,
  TAB_NOTIF_STATE,
  TAB_SIZE,
  TAB_STATE,
  TAB_TRIGGER,
} from './content-classes';
/* The whole module, so the coverage check below can compare the hand-assembled list against
   what `content-classes.ts` actually exports rather than against itself. */
import * as tables from './content-classes';

/**
 * A PURGED CLASS RENDERS UNSTYLED AGAINST A GREEN SUITE, and the behaviour guard cannot see
 * it — that guard only checks the class is ON the element, which it is either way. This is
 * the only gate in the package that can tell the difference between a badge with its colour
 * and a badge with a colour class Tailwind stopped emitting.
 *
 * It matters most for the token classes. Every colour, spacing and radius value in
 * `content-classes.ts` comes from the generated preset, which genuinely can stop emitting a
 * group — `IMAGE_SIZE` reaches for the SPACING scale for exactly that reason, because
 * Tailwind's `maxWidth` theme does not inherit spacing and a `max-w-ds-*` would have looked
 * fine in review and emitted nothing.
 *
 * Same reasoning and same siting as `overlays.purge.test.ts`: in this package, because
 * `turbo.json`'s `test` task hashes a package's own files and not its workspace dependencies'
 * (UMK-852), and loading the preset by RELATIVE path because `@umkmall/ui/tailwind-preset`
 * resolves through a node_modules symlink that is a different copy the moment anyone works in
 * a git worktree — which this slice was written in.
 *
 * AND IT SCANS SOURCE ONLY, never the tests or the stories. A glob of `src/**` sweeps this
 * file in and the class names below become their own content — every one would report as
 * emitted whether or not a component still uses it. That is the exact shape of a guard
 * passing because it is measuring itself.
 *
 * The expectations are DERIVED from the same tables the components render rather than
 * hand-listed, so a table that gains a value gains its purge check with it.
 *
 * WHAT THIS FILE CANNOT SEE, because the derivation above is also its blind spot: a TRUNCATED
 * table value. `ALL_TABLE_WORDS` is built from the same tables it checks, so shortening
 * `'bg-weak-brand text-default-brand'` to its first class shrinks the expectation by
 * exactly as much as the subject and every assertion here still passes. The check that catches
 * it is `AXIS_SHAPE` in the sibling `content.stories.test.tsx` — the one deliberately not
 * table-derived. Written down because running THIS file alone against a truncation and seeing
 * green is a reasonable thing to do and the wrong conclusion to draw: the two guards are
 * load-bearing together. `spreads every class table the module exports` below closes a
 * different hole — a new table never spread into the list — not this one.
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

/**
 * Every class the eight components depend on, spread from the tables themselves. Never
 * hand-list a subset: the sibling guard shipped with a docblock claiming wider scope than its
 * list, and breaking a size step left the suite green.
 */
const ALL_TABLE_WORDS = [
  ...BADGE_BASE.split(' '),
  ...words(BADGE_COLOR),
  ...words(BADGE_SIZE),
  ...CHIP_BASE.split(' '),
  ...words(CHIP_STATE),
  ...words(CHIP_SIZE),
  ...words(CHIP_COMPACT_WEIGHT),
  ...CHIP_COMPACT_IDLE_BORDER.split(' '),
  ...CARD_BASE.split(' '),
  ...words(CARD_PADDING),
  ...words(CARD_VARIANT),
  ...DIVIDER_BASE.split(' '),
  ...words(DIVIDER_VARIANT),
  ...words(DIVIDER_ORIENTATION),
  ...words(DIVIDER_RULE),
  ...DIVIDER_LABEL.split(' '),
  ...TAB_LIST.split(' '),
  ...TAB_TRIGGER.split(' '),
  ...words(TAB_STATE),
  ...words(TAB_SIZE),
  ...TAB_NOTIF.split(' '),
  ...words(TAB_NOTIF_SIZE),
  ...words(TAB_NOTIF_STATE),
  ...words(LIST_DIRECTION),
  ...LIST_BULLET_ITEM.split(' '),
  ...LIST_BULLET.split(' '),
  ...words(LIST_MARKER),
  ...words(LIST_GAP),
  ...words(LIST_SPACE),
  ...words(LIST_GAP_MD),
  ...words(LIST_GAP_LG),
  ...DISCLOSURE_BASE.split(' '),
  ...DISCLOSURE_SUMMARY.split(' '),
  ...DISCLOSURE_PANEL.split(' '),
  ...IMAGE_BASE.split(' '),
  ...IMAGE_BARE.split(' '),
  ...IMAGE_BARE_IMG.split(' '),
  ...words(IMAGE_ROUNDED),
  ...words(IMAGE_TYPE),
  ...words(IMAGE_SIZE),
  ...IMAGE_HOVER.split(' '),
  ...IMAGE_PLACEHOLDER.split(' '),
  ...ICON_SLOT.split(' '),
  ...CODE_BLOCK_BASE.split(' '),
  ...CODE_BLOCK_BAR.split(' '),
  ...CODE_BLOCK_BODY.split(' '),
  ...words(CODE_BLOCK_SIZE),
  ...CODE_BLOCK_ACTION.split(' '),
  ...CODE_BLOCK_ACTIONS.split(' '),
  ...CODE_BLOCK_FAILED.split(' '),
  ...STEPPER_BASE.split(' '),
  ...words(STEPPER_ORIENTATION),
  ...words(STEPPER_STEP),
  ...words(STEPPER_SELECT),
  ...STEPPER_MARK.split(' '),
  ...words(STEPPER_MARK_STATE),
  ...words(STEPPER_LABEL_STATE),
  ...words(STEPPER_CONNECTOR),
  ...words(STEPPER_CONNECTOR_STATE),
]
  /* Empty strings. `CARD_PADDING.none` is deliberately empty — "no padding" is the absence of
     a class rather than a class — and `''.split(' ')` yields one empty entry. */
  .filter((c) => c.length > 0);

/**
 * The purge-emission subset: every table word MINUS the arbitrary values, escaped as CSS
 * selectors. Kept separate from `ALL_TABLE_WORDS` above because the bracket filter is specific
 * to THIS assertion — the raw-palette and hex checks must see the arbitrary values, since
 * Tailwind's hex escape hatch is one.
 */
const REQUIRED = ALL_TABLE_WORDS
  /**
   * ARBITRARY VALUES ARE DROPPED, because this guard cannot falsify them. Tailwind's JIT
   * generates them from the very line the expectation is derived from, so the rule always
   * exists and the check always passes — a tautology, and exactly the measuring-itself shape
   * the docblock above warns about. Scale, variant and token classes are the real subject:
   * those come from the preset, which can genuinely stop emitting them.
   */
  .filter((c) => !c.includes('['))
  /**
   * Tailwind BACKSLASH-ESCAPES every character in a class name that CSS would otherwise read
   * as syntax — the `:` in a variant, the `/` in an opacity modifier. The emitted selector
   * for a variant class is literally `.md\\:max-w-sm`. Escaping a chosen subset builds a
   * selector the stylesheet never contains and reports a healthy class as purged; mirror
   * Tailwind's own rule instead of enumerating characters.
   */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the content classes survive the purge', () => {
  /* Compiled ONCE. The pipeline reads the same preset over the same content either way. */
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the eight components rely on', () => {
    /* A substring match is not enough: the trailing boundary is what makes this bite, since
       one class name is frequently a prefix of another.

       `\\` MUST be in the escape set. Tailwind writes a variant class with a literal
       backslash, so a regex that turns `\\:` back into a plain `:` looks for a selector the
       stylesheet does not contain and reports a perfectly healthy class as purged. */
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  /* Anti-vacuity: an empty REQUIRED list would make the assertion above pass by looking for
     nothing at all, which is the failure mode this whole file warns about. */
  it('has a non-trivial list to check', () => {
    expect(new Set(REQUIRED).size).toBeGreaterThan(40);
  });

  /**
   * EVERY EXPORTED TABLE IS ACCOUNTED FOR — the check that keeps this guard's coverage honest
   * as the file grows.
   *
   * The list above is hand-assembled, so a ninth component adding a table to
   * `content-classes.ts` and forgetting to spread it here loses its purge check silently:
   * nothing fails, the totals still look healthy, and only that component renders unstyled
   * when its token goes. Comparing against the module's own exports is what makes the omission
   * loud. `hasLegacyBrandToken` is a predicate rather than a class table, so it is excluded by
   * TYPE rather than by name — a future helper is excluded automatically, a future table is
   * not.
   */
  it('spreads every class table the module exports', () => {
    const classWords = (v: unknown): string[] =>
      typeof v === 'string'
        ? v.split(' ')
        : v && typeof v === 'object'
          ? Object.values(v as Record<string, string>).flatMap((s) => String(s).split(' '))
          : [];

    const covered = new Set(ALL_TABLE_WORDS);
    const missing: string[] = [];
    for (const [name, value] of Object.entries(tables)) {
      if (typeof value === 'function') continue;
      const words = classWords(value).filter((c) => c.length > 0);
      if (words.length === 0) continue;
      if (!words.every((c) => covered.has(c))) missing.push(name);
    }
    expect(missing, 'these exports are not spread into ALL_TABLE_WORDS').toEqual([]);
    /* And there is something to compare against, so an empty module read cannot pass. */
    expect(Object.keys(tables).length).toBeGreaterThan(20);
  });

  /**
   * THE COLOUR TOKENS SPECIFICALLY, because they are the group with a live retirement plan
   * and no other signal. The generated `surface` and `text` groups come out of
   * `build.mjs`; if it stopped emitting one, every one of these components would render
   * shape-correct and colourless, and nothing else in the package would notice.
   */
  it('emits the surface and text tokens the colour axes are built from', () => {
    for (const value of Object.values(BADGE_COLOR)) {
      for (const c of value.split(' ')) expect(css).toMatch(new RegExp(`\\.${c}(?![-\\w])`));
    }
    /* `bestseller` is the one whose treatment differs — solid surface, inverted text — so it
       is named explicitly rather than left to the loop. Flattening the six onto one tint
       shape is the refactor that would lose it. */
    expect(BADGE_COLOR.bestseller).toContain('bg-default-success');
    expect(BADGE_COLOR.bestseller).toContain('text-default-invert');
    /* `gradient` is the second odd one and is named for the same reason: it is the only value
       painted by two stops rather than one surface, and a loop over "has a bg class" would
       report it healthy with either stop gone. */
    expect(BADGE_COLOR.gradient).toContain('from-');
    expect(BADGE_COLOR.gradient).toContain('to-');
  });

  /**
   * NO LEGACY `z-*` BRAND TOKEN IN ANY TABLE. All four rewritten components carried them, and
   * that group is scheduled to retire — a survivor renders today and renders nothing on the
   * day it goes. The list is spread from the tables rather than hand-named, so a new table is
   * covered the moment it is added.
   */
  it('uses no legacy z-* brand token', () => {
    /* Each table's keys are prefixed with its name: a bare spread lets the next table overwrite the
       same-named keys (`small`, `large`, `default`), and the overwritten classes escape the scan. */
    const keyed = (name: string, table: Record<string, string>) =>
      Object.fromEntries(Object.entries(table).map(([k, v]) => [`${name}.${k}`, v]));
    const tables = {
      BADGE_BASE,
      ...keyed('BADGE_COLOR', BADGE_COLOR),
      ...keyed('BADGE_SIZE', BADGE_SIZE),
      CHIP_BASE,
      ...keyed('CHIP_STATE', CHIP_STATE),
      ...keyed('CHIP_SIZE', CHIP_SIZE),
      ...keyed('CHIP_COMPACT_WEIGHT', CHIP_COMPACT_WEIGHT),
      CHIP_COMPACT_IDLE_BORDER,
      CARD_BASE,
      ...keyed('CARD_PADDING', CARD_PADDING),
      ...keyed('CARD_VARIANT', CARD_VARIANT),
      DIVIDER_BASE,
      ...keyed('DIVIDER_VARIANT', DIVIDER_VARIANT),
      ...keyed('DIVIDER_ORIENTATION', DIVIDER_ORIENTATION),
      ...keyed('DIVIDER_RULE', DIVIDER_RULE),
      DIVIDER_LABEL,
      TAB_LIST,
      TAB_TRIGGER,
      ...keyed('TAB_STATE', TAB_STATE),
      ...keyed('TAB_SIZE', TAB_SIZE),
      TAB_NOTIF,
      ...keyed('TAB_NOTIF_SIZE', TAB_NOTIF_SIZE),
      ...keyed('TAB_NOTIF_STATE', TAB_NOTIF_STATE),
      ...keyed('LIST_DIRECTION', LIST_DIRECTION),
      LIST_BULLET_ITEM,
      LIST_BULLET,
      ...keyed('LIST_MARKER', LIST_MARKER),
      ...keyed('LIST_GAP', LIST_GAP),
      ...keyed('LIST_SPACE', LIST_SPACE),
      ...keyed('LIST_GAP_MD', LIST_GAP_MD),
      ...keyed('LIST_GAP_LG', LIST_GAP_LG),
      DISCLOSURE_BASE,
      DISCLOSURE_SUMMARY,
      DISCLOSURE_PANEL,
      IMAGE_BASE,
      IMAGE_BARE,
      IMAGE_BARE_IMG,
      ...keyed('IMAGE_ROUNDED', IMAGE_ROUNDED),
      ...keyed('IMAGE_TYPE', IMAGE_TYPE),
      ...keyed('IMAGE_SIZE', IMAGE_SIZE),
      IMAGE_HOVER,
      IMAGE_PLACEHOLDER,
      ICON_SLOT,
      CODE_BLOCK_BASE,
      CODE_BLOCK_BAR,
      CODE_BLOCK_BODY,
      ...keyed('CODE_BLOCK_SIZE', CODE_BLOCK_SIZE),
      CODE_BLOCK_ACTION,
      CODE_BLOCK_ACTIONS,
      CODE_BLOCK_FAILED,
      STEPPER_BASE,
      ...keyed('STEPPER_ORIENTATION', STEPPER_ORIENTATION),
      ...keyed('STEPPER_STEP', STEPPER_STEP),
      ...keyed('STEPPER_SELECT', STEPPER_SELECT),
      STEPPER_MARK,
      ...keyed('STEPPER_MARK_STATE', STEPPER_MARK_STATE),
      ...keyed('STEPPER_LABEL_STATE', STEPPER_LABEL_STATE),
      ...keyed('STEPPER_CONNECTOR', STEPPER_CONNECTOR),
      ...keyed('STEPPER_CONNECTOR_STATE', STEPPER_CONNECTOR_STATE),
    };
    /* Assert there is something to look at first — an empty table map would pass by never
       iterating, which is the vacuity this file's docblock warns about. */
    expect(Object.keys(tables).length).toBeGreaterThan(20);
    const offenders = Object.entries(tables)
      .filter(([, value]) => hasLegacyBrandToken(value))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  /**
   * NO RAW PALETTE AND NO HEX EITHER. The same four rewrites shipped `bg-blue-50`,
   * `border-gray-200` and inline hex, and a token-shaped table with one palette class left in
   * it renders perfectly while being outside the design system entirely.
   */
  it('uses no raw Tailwind palette class and no hex', () => {
    /**
     * READS THE UNFILTERED LIST, and that is the whole assertion.
     *
     * `REQUIRED` has already dropped every class containing `[`, because the purge check
     * cannot falsify an arbitrary value. But Tailwind's hex escape hatch IS an arbitrary
     * value — `bg-[#ff0000]` — so running this check against the filtered list makes it blind
     * to the exact thing it was added to catch. The bracket filter belongs to the emission
     * assertion above and nowhere else.
     */
    const all = ALL_TABLE_WORDS.join(' ');
    expect(all).not.toMatch(
      /(?:^|[\s:])(?:bg|text|border|from|via|to|ring|fill|stroke|shadow|outline|decoration|accent|caret|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
    );
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    /* Anti-vacuity: the unfiltered list must be strictly larger than the filtered one, or the
       bracket-bearing classes this check exists to see are not reaching it. */
    expect(ALL_TABLE_WORDS.length).toBeGreaterThan(REQUIRED.length);
    expect(ALL_TABLE_WORDS.some((c) => c.includes('['))).toBe(true);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('content.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('content.stories.test.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('Badge.stories.tsx'))).toBe(false);
    /* `.test-d.` is not `.test.`, so a filter keyed on the latter sweeps every type-level
       test in as content — and a class named in one would then prop this guard up on its own
       expectations. Named per file rather than as a total, so ONE of them reappearing is
       visible (UMK-956). */
    expect(scanned.some((f) => f.endsWith('field-support.test-d.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('content-classes.ts'))).toBe(true);
    /* Both directories, because the eight components are split across them and a scan root
       that silently stopped reaching `compositions/` would leave Card and Tabs unguarded
       while the totals still looked healthy (UMK-956). */
    expect(scanned.some((f) => f.includes('/compositions/'))).toBe(true);
    expect(scanned.some((f) => f.includes('/primitives/'))).toBe(true);
  });
});
