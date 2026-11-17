import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as OVERLAY_CLASSES from './overlay-classes';

const { DIALOG_SIZE, MENU_CONTENT, MENU_ITEM, MENU_SUB_CONTENT, MENU_SUB_TRIGGER, OVERLAY_SCRIM } =
  OVERLAY_CLASSES;

/**
 * A PURGED CLASS RENDERS UNSTYLED AGAINST A GREEN SUITE, and this pair of components is where
 * that matters most: `DIALOG_SIZE` is entirely `md:`-prefixed, and a responsive utility that
 * Tailwind stopped emitting leaves a dialog full-width on desktop while the behaviour guard —
 * which only checks the class is ON THE ELEMENT — stays green. Nothing else in this slice can
 * see that failure.
 *
 * Same reasoning and same siting as `feedback.purge.test.ts`: in this package, because
 * `turbo.json`'s `test` task hashes a package's own files and not its workspace dependencies'
 * (UMK-852), and loading the preset by RELATIVE path because `@umkmall/ui/tailwind-preset`
 * resolves through a node_modules symlink that is a different copy the moment anyone works in
 * a git worktree — which this slice was written in.
 *
 * AND IT SCANS SOURCE ONLY, never the tests. A glob of `src/**` sweeps this file in and the
 * class names below become their own content — every one would report as emitted whether or
 * not a component still uses it. That is the exact shape of a guard that passes because it is
 * measuring itself.
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

/**
 * NOT A HAND-MAINTAINED LIST ANY MORE (UMK-963), and that is the fix rather than a tidy-up.
 * This file used to register every table TWICE by hand — once in the required list and once in
 * the exit-animation map — with nothing linking the two, so a new table that reached only the
 * first was silently exempt from the second, and one that reached neither was invisible to
 * both while the `> 4` count floor stayed comfortably satisfied by the tables already there.
 * Both are now derived from ONE namespace import, the way `sidebar.purge.test.ts` derives its
 * own, so a table cannot be in one and not the other.
 *
 * The completeness check further down is what notices a table shaped in a way this cannot
 * flatten — a count can never name what went missing.
 */
const flatten = (module_: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(module_).flatMap(([name, value]) =>
      typeof value === 'string'
        ? [[name, value] as const]
        : Object.entries(value as Record<string, string>).map(
            ([step, v]) => [`${name}.${step}`, v] as const,
          ),
    ),
  );

/** A table is a class string, or a record of them. Anything else is not one — see below. */
const isTable = (value: unknown): boolean =>
  typeof value === 'string' ||
  (typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string'));

/* NOTHING IS EXCLUDED, and that is checked rather than assumed — see the completeness test.
   The module's two non-table exports, `DataAttributes` and `MenuVariant`, are types and are
   gone at runtime, so the namespace holds class tables and nothing else. */
const TABLES = flatten(OVERLAY_CLASSES as unknown as Record<string, unknown>);

/**
 * Every class the two overlays depend on — derived from the tables themselves, so a table that
 * gains a value gains its check with it. Never hand-list a subset: the sibling guard shipped
 * with a docblock claiming wider scope than its list, and breaking a size step left the suite
 * green.
 */
const REQUIRED = Object.values(TABLES)
  .flatMap((v) => v.split(' '))
  /**
   * ARBITRARY VALUES ARE DROPPED, because this guard cannot falsify them. Tailwind's JIT
   * generates `max-h-[88dvh]` from the very line the expectation is derived from, so the rule
   * always exists and the check always passes — a tautology, and exactly the measuring-itself
   * shape the docblock above warns about. Scale, variant and token classes are the real
   * subject: those come from the preset, which can genuinely stop emitting them.
   *
   * This drops the `data-[state=*]` animation variants too. They are arbitrary variants, and
   * their utilities (`animate-in`, `zoom-in-95`) survive here on their own.
   */
  .filter((c) => !c.includes('['))
  /**
   * Tailwind BACKSLASH-ESCAPES every character in a class name that CSS would otherwise read
   * as syntax — the `:` in a variant, the `/` in an opacity modifier, the `.` in a fraction.
   * The emitted selector for `md:max-w-sm` is literally `.md\\:max-w-sm`. Escaping a chosen
   * subset builds a selector the stylesheet never contains and reports a healthy class as
   * purged; mirror Tailwind's own rule instead of enumerating characters.
   */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the overlay classes survive the purge', () => {
  /* Compiled ONCE. The pipeline reads the same preset over the same content either way. */
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  /* E16: the rule is a border, not a 1px filled box — the live account menu draws `border-t`. */
  it('draws the menu separator as a border-t in both treatments, with no filled h-px', () => {
    const { MENU_SEPARATOR } = OVERLAY_CLASSES;
    expect(MENU_SEPARATOR.pill.split(' ')).toEqual(expect.arrayContaining(['mx-4', 'my-1', 'border-t', 'border-default-primary']));
    expect(MENU_SEPARATOR.boxed.split(' ')).toEqual(expect.arrayContaining(['my-1', 'border-t', 'border-default-primary']));
    expect(MENU_SEPARATOR.boxed).not.toContain('mx-');
    for (const v of Object.values(MENU_SEPARATOR)) {
      expect(v).not.toContain('h-px');
      expect(v).not.toContain('bg-default-primary');
    }
    expect(css).toMatch(/\.border-t\b/);
  });

  it('emits a rule for every class the two overlays rely on', () => {
    /* A substring match is not enough: `.max-w-sm` is a substring of nothing here, but
       `.rounded-2xl` is a substring of no real class only by luck — the boundary is what
       makes this guard bite in general.

       `\\` MUST be in the escape set. Tailwind writes a variant class with a literal
       backslash — `.md\\:max-w-sm` — so a regex that turns `\\:` back into a plain `:` looks
       for a selector the stylesheet does not contain and reports a perfectly healthy class
       as purged. */
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  /* The one class proving `build.mjs` still emits the `zIndex` group at all — the preset's
     own `z` group is a COLOUR group, so nothing else in the pipeline would notice its loss,
     and every overlay in this slice sits on this single token. */
  it('emits the elevation token both overlays share', () => {
    expect(OVERLAY_SCRIM).toContain('z-ds-overlay');
    /* PER VARIANT, not in aggregate (UMK-956): each treatment is its own contributor to the
       one token, and a total that stays healthy while one of them goes dark proves nothing
       about that one. The submenu is a THIRD surface on the token, and it is the newest — a
       nested panel that fell off the scale would sit under the menu that opened it. */
    for (const value of Object.values(MENU_CONTENT)) expect(value).toContain('z-ds-overlay');
    for (const value of Object.values(MENU_SUB_CONTENT)) expect(value).toContain('z-ds-overlay');
    expect(css).toMatch(/\.z-ds-overlay(?![-\w])/);
  });

  /* Every size step is `md:`-prefixed, which is the failure mode this file exists for: a
     purged responsive utility renders an unstyled full-width panel, and the behaviour guard
     cannot tell, because the class is on the element either way. */
  it('keeps the whole size ladder responsive rather than only the first step', () => {
    const steps = Object.values(DIALOG_SIZE);
    expect(steps.length).toBeGreaterThan(1);
    for (const step of steps) expect(step.startsWith('md:')).toBe(true);
  });

  /**
   * NO EXIT ANIMATION MAY RETURN TO THESE TABLES.
   *
   * Radix suspends an overlay's unmount while an exit animation is set and waits for an
   * `animationend` that never arrives here, so the content stays mounted at
   * `data-state="closed"` and strands the scroll lock and the document-wide `aria-hidden`
   * with it. A browser gate found that; happy-dom cannot, because it unmounts cleanly either
   * way. What a test CAN see is the class, so this asserts the class.
   *
   * The list is spread from the tables rather than hand-named, so a new table is covered the
   * moment it is added.
   */
  it('sets no exit animation on any overlay surface', () => {
    const offenders = Object.entries(TABLES)
      .filter(([, value]) =>
        /data-\[state=closed\]:(?:animate-out|fade-out|zoom-out|slide-out)/.test(value),
      )
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  /**
   * THE DERIVATION'S OWN COMPLETENESS CHECK. Deriving from the module removes the drift between
   * two hand-written registrations; it does not by itself prove the module was fully read. A
   * table declared in a shape `flatten` cannot walk — an array, a nested record — would be
   * skipped in silence, which is the same hole one register lower down. So every export is named
   * here and asserted to be a shape this file handles.
   */
  it('reads every export of the class module, in a shape it can flatten', () => {
    const exports_ = Object.entries(OVERLAY_CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(exports_.filter(([, v]) => !isTable(v)).map(([name]) => name)).toEqual([]);
    for (const [name] of exports_)
      expect(Object.keys(TABLES).some((k) => k === name || k.startsWith(`${name}.`))).toBe(true);
  });

  /**
   * THE TREATMENT AXIS, PER VARIANT (UMK-963). The two menu treatments are separate
   * contributors to the same tables: the required list above is a union, so a variant whose
   * every distinguishing class was purged would still leave the union satisfied by its sibling.
   * This asserts each one carries values the other does not, and that those values are emitted.
   */
  it('emits what makes each menu treatment different from the other', () => {
    const variants = Object.keys(MENU_CONTENT) as (keyof typeof MENU_CONTENT)[];
    expect(variants.length).toBeGreaterThan(1);
    for (const variant of variants) {
      const others = variants.filter((v) => v !== variant);
      for (const table of [MENU_CONTENT, MENU_ITEM, MENU_SUB_CONTENT, MENU_SUB_TRIGGER]) {
        const shared = new Set(others.flatMap((v) => table[v].split(' ')));
        const own = table[variant].split(' ').filter((c) => !shared.has(c));
        expect(own.length, `${variant} is indistinguishable from its sibling`).toBeGreaterThan(0);
        /* The DISTINCTNESS above counts arbitrary variants — a treatment can differ from its
           sibling by a `data-[state=open]:` colour alone, and one that did would otherwise
           read as identical here. The EMISSION below cannot: an arbitrary value is generated
           from the very line it is read off, so asserting it is a tautology. */
        for (const c of own.filter((v) => !v.includes('[')))
          expect(css).toMatch(
            new RegExp(`\\.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\\\${ch}`)}(?![-\\w])`),
          );
      }
    }
  });

  /**
   * NO RAW PALETTE CLASS AND NO HEX in the menu tables. The settings popover these values were
   * derived from writes its colours by hand; every one has a semantic token within a rounding
   * error, and a raw class copied across with the geometry would render correctly and be
   * invisible to every other check here. Colour is the whole reason the token layer exists.
   */
  it('spells the derived treatment in tokens rather than in the palette it came from', () => {
    const palette =
      /(?:^|:)(?:bg|text|border|ring|from|via|to)-(?:gray|slate|zinc|neutral|stone|red|blue|green|yellow|orange|amber|purple|pink|indigo|teal|cyan|lime|emerald|violet|fuchsia|rose|sky)-\d/;
    for (const [name, value] of Object.entries(TABLES)) {
      if (!name.startsWith('MENU_')) continue;
      for (const c of value.split(' ')) expect(palette.test(c), `${name}: ${c}`).toBe(false);
      expect(/#[0-9a-fA-F]{3,8}\b/.test(value), name).toBe(false);
    }
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('overlays.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('Dialog.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('overlay-classes.ts'))).toBe(true);
  });
});
