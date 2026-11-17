import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as HEADER_CLASSES from './header-classes';

const { HEADER_BASE, HEADER_TABS, HEADER_TITLE, HEADER_TYPE } = HEADER_CLASSES;

/**
 * `Header` carries no contract `family`, exactly as `Sidebar` does, so none of the four
 * family guard pairs can see it — each reconciles its own module map against the entries
 * that CLAIM its family, and an unfamilied component is never expected anywhere. This file
 * and its behaviour sibling are therefore the whole of its coverage rather than extras.
 *
 * WHAT IT IS FOR: a purged class renders unstyled against a green suite. The one axis this
 * component has is seven treatments that differ ONLY by class, so a dropped rule turns two
 * published types into the same header while every behaviour assertion — which checks the
 * class is on the element — stays green.
 *
 * Same siting and mechanics as `sidebar.purge.test.ts`: in this package, because turbo's
 * `test` hash covers a package's own files and not its workspace dependencies' (UMK-852),
 * and the preset is loaded by RELATIVE path because the bare specifier resolves through a
 * node_modules symlink that is a different copy inside a git worktree.
 *
 * AND IT SCANS SOURCE ONLY. A glob that swept this file in would make these class names
 * their own content, and every one would report as emitted whether or not any component
 * still uses it.
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
 * NOT A HAND-MAINTAINED LIST ANY MORE, and that is the fix rather than a tidy-up. There used to
 * be two registrations of the same module here — the required list and the exit-animation map —
 * written out by hand, and they had already drifted: the back control, the title and the actions
 * slot were in the first and missing from the second, so an exit animation added to any of them
 * was unchecked. Nor could the map's own `> 4` count floor see it, because the two spread tables
 * padded the count past four on their own. Both are now derived from ONE namespace import, so a
 * table cannot be in one and not the other, and the completeness check below is what notices a
 * table shaped in a way this cannot flatten. A count is not a substitute for either: it cannot
 * name what went missing.
 *
 * ONE EXPORT IS NOT A CLASS TABLE. The published type vocabulary is a list of NAMES, not classes,
 * and it is excluded BY NAME rather than by its shape — an exclusion inferred from shape would
 * quietly swallow the next table that happened to be written as a list.
 */
const NOT_CLASSES = new Set(['HEADER_TYPES']);

const flatten = (module_: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(module_)
      .filter(([name]) => !NOT_CLASSES.has(name))
      .flatMap(([name, value]) =>
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

const TABLES = flatten(HEADER_CLASSES as unknown as Record<string, unknown>);

const REQUIRED = Object.values(TABLES)
  .flatMap((v) => v.split(' '))
  /* Arbitrary values cannot be falsified: Tailwind's JIT generates them from the very line
     the expectation is read off, so the rule always exists and the check always passes. */
  .filter((c) => !c.includes('['))
  /* Mirror Tailwind's own escape rule rather than enumerating characters — the emitted
     selector for a variant class carries a literal backslash, and escaping a chosen subset
     builds a selector the stylesheet never contains. */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the header classes survive the purge', () => {
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the header relies on', () => {
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  /**
   * KTD18b, asserted PER CONTRIBUTOR rather than in aggregate (UMK-956). The whole of the
   * mobile/desktop axis is these prefixes: there is no size prop, so a contributor that
   * silently loses its gate leaves that part of the bar frozen at one of the two sizes while
   * the rest reflows, and a total that stays healthy proves nothing about any one of them.
   */
  it('gates every part that reflows, and gates them all at one breakpoint', () => {
    const prefix = /(?:^|\s)md:/;
    for (const value of [HEADER_BASE, HEADER_TITLE, HEADER_TABS]) expect(prefix.test(value)).toBe(true);

    /* One breakpoint, not two. A bar whose padding and whose title change at different
       widths has a band where they disagree, and no assertion about either alone sees it. */
    const others = /(?:^|\s)(?:sm|lg|xl|2xl):/;
    for (const value of [HEADER_BASE, HEADER_TITLE, HEADER_TABS, ...Object.values(HEADER_TYPE)])
      expect(others.test(value)).toBe(false);
  });

  /**
   * A STATED TEST SCENARIO: no raw palette class and no hex anywhere in the tables. A colour
   * written literally survives every purge check in this file — it is emitted, it renders,
   * and it silently opts this component out of theming.
   */
  it('names only semantic tokens, never a palette step or a literal colour', () => {
    const all = Object.values(TABLES).join(' ');
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    /* Tailwind's numeric palette steps, in every colour position this component could use. */
    expect(all).not.toMatch(
      /(?:^|\s|:)(?:bg|text|border|ring|from|via|to|shadow|divide|outline)-[a-z]+-\d{2,3}(?![-\w])/,
    );
  });

  /**
   * The seven published treatments have to differ, or the axis is decoration. This is the
   * failure a purge cannot cause but a careless edit can: two entries collapsing onto one
   * class string, which every behaviour assertion still passes.
   */
  it('gives each type its own class set', () => {
    const values = Object.values(HEADER_TYPE);
    expect(values.length).toBe(7);
    expect(new Set(values).size).toBe(7);
  });

  /* KTD9. Nothing here is a Radix surface, so the Presence mechanism does not apply — the
     header animates its shadow in and never declares a closed-state exit, for one rule
     across the shell rather than a per-component judgement call. */
  it('sets no exit animation on any header surface', () => {
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
   * table declared in a shape `flatten` cannot walk would be skipped in silence, and so would one
   * that quietly acquired the name of the excluded vocabulary export. Every export is named here
   * and asserted to be either a shape this file handles or the one documented exclusion.
   */
  it('reads every export of the class module, in a shape it can flatten', () => {
    const exports_ = Object.entries(HEADER_CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(
      exports_.filter(([name, v]) => !NOT_CLASSES.has(name) && !isTable(v)).map(([name]) => name),
    ).toEqual([]);
    /* And every one of them reached the derived map, rather than merely being acceptable. */
    for (const [name] of exports_.filter(([name]) => !NOT_CLASSES.has(name)))
      expect(Object.keys(TABLES).some((k) => k === name || k.startsWith(`${name}.`))).toBe(true);
    /* The exclusion is a real export, not a stale name nothing answers to. */
    for (const name of NOT_CLASSES) expect(exports_.map(([n]) => n)).toContain(name);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('header.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('Header.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('header-classes.ts'))).toBe(true);
  });
});
