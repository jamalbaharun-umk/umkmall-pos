import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as LIGHTBOX_CLASSES from './lightbox-classes';

const { LIGHTBOX_PANEL, LIGHTBOX_SCRIM, LIGHTBOX_SCRIM_LIGHT } = LIGHTBOX_CLASSES;

/**
 * `Lightbox` carries no contract `family`, exactly as `Header`, `Sidebar` and `AppShell` do,
 * so none of the four family guard pairs can see it — each reconciles its own module map
 * against the entries that CLAIM its family, and an unfamilied component is never expected
 * anywhere. This file and its behaviour sibling are the whole of its coverage.
 *
 * WHAT IT IS FOR: a purged class renders unstyled against a green suite. The behaviour
 * sibling can see that the image is IN the panel; it cannot see that the panel still covers
 * the page or that the scrim is still dark.
 *
 * Same siting and mechanics as `header.purge.test.ts`: in this package, because turbo's
 * `test` hash covers a package's own files and not its workspace dependencies' (UMK-852), and
 * the preset is loaded by RELATIVE path because the bare specifier resolves through a
 * node_modules symlink that is a different copy inside a git worktree.
 *
 * AND IT SCANS SOURCE ONLY. A glob that swept this file in would make these class names their
 * own content, and every one would report as emitted whether or not any component uses it.
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
 * both written out by hand, so a new table in `lightbox-classes.ts` was invisible to both until
 * someone made two edits, and a table present in one and absent from the other was unchecked
 * with nothing red. Nor could the map's own `> 4` count floor see that: a count cannot name what
 * went missing. Both registrations are now derived from ONE namespace import, and the
 * completeness check below is what notices a table shaped in a way this cannot flatten.
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

const TABLES = flatten(LIGHTBOX_CLASSES as unknown as Record<string, unknown>);

const REQUIRED = Object.values(TABLES)
  .flatMap((v) => v.split(' '))
  /* Arbitrary values cannot be falsified: Tailwind's JIT generates them from the very line
     the expectation is read off, so the rule always exists and the check always passes. */
  .filter((c) => !c.includes('['))
  /* Mirror Tailwind's own escape rule rather than enumerating characters — the emitted
     selector for a variant class carries a literal backslash, and escaping a chosen subset
     builds a selector the stylesheet never contains. */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the lightbox classes survive the purge', () => {
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the lightbox relies on', () => {
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  /**
   * FULL-BLEED AT EVERY BREAKPOINT, asserted PER SURFACE rather than in aggregate (UMK-956).
   * The scrim and the panel each have to cover the page on their own: a viewer whose panel
   * lost its cover but whose scrim kept it is a dark page with the image pinned in a corner,
   * and a total that stays healthy proves nothing about either one.
   *
   * NO BREAKPOINT PREFIX ANYWHERE. Unlike the dialog, which is a sheet below the package
   * breakpoint and a card above it, this surface has ONE presentation — a responsive prefix
   * here would mean a width band where it is not full-bleed, which is the whole component.
   */
  it('covers the viewport on every surface, at every width', () => {
    for (const value of [LIGHTBOX_SCRIM, LIGHTBOX_SCRIM_LIGHT, LIGHTBOX_PANEL]) {
      expect(value.split(' ')).toContain('fixed');
      expect(value.split(' ')).toContain('inset-0');
    }
    for (const value of Object.values(TABLES))
      expect(/(?:^|\s)(?:sm|md|lg|xl|2xl):/.test(value)).toBe(false);
  });

  /**
   * ONE ELEVATION TOKEN (KTD11), and it is the package's only one. A second value here
   * re-opens the four-scale mess the overlay tables collapsed; a MISSING one puts a
   * full-bleed viewer under the app chrome it is meant to cover, with every behaviour
   * assertion still green.
   */
  it('elevates the scrim and the panel on the one overlay token', () => {
    for (const value of [LIGHTBOX_SCRIM, LIGHTBOX_SCRIM_LIGHT, LIGHTBOX_PANEL])
      expect(value.split(' ').filter((c) => c.startsWith('z-'))).toEqual(['z-ds-overlay']);
  });

  /**
   * KTD9, and here the mechanism genuinely applies: this is a Radix surface. Radix reads the
   * computed animation name on close and suspends the unmount waiting for an event that never
   * arrives on this stack — which strands the node visible and hit-testable and leaks every
   * side effect the behaviour sibling asserts is released.
   */
  it('sets no exit animation on any lightbox surface', () => {
    const offenders = Object.entries(TABLES)
      .filter(([, value]) =>
        /data-\[state=closed\]:(?:animate-out|fade-out|zoom-out|slide-out)/.test(value),
      )
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  /**
   * A STATED TEST SCENARIO: no raw palette step and no literal hex anywhere in the tables. A
   * colour written literally survives every purge check in this file — it is emitted, it
   * renders, and it silently opts this component out of theming.
   */
  it('names only semantic tokens, never a palette step or a literal colour', () => {
    const all = Object.values(TABLES).join(' ');
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(all).not.toMatch(
      /(?:^|\s|:)(?:bg|text|border|ring|from|via|to|shadow|divide|outline)-[a-z]+-\d{2,3}(?![-\w])/,
    );
  });

  /**
   * THE DERIVATION'S OWN COMPLETENESS CHECK. Deriving from the module removes the drift between
   * two hand-written registrations; it does not by itself prove the module was fully read. A
   * table declared in a shape `flatten` cannot walk — an array, a nested record — would be
   * skipped in silence, which is the same hole one register lower down. So every export is named
   * here and asserted to be a shape this file handles.
   */
  it('reads every export of the class module, in a shape it can flatten', () => {
    const exports_ = Object.entries(LIGHTBOX_CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(exports_.filter(([, v]) => !isTable(v)).map(([name]) => name)).toEqual([]);
    /* And every one of them reached the derived map, rather than merely being acceptable. */
    for (const [name] of exports_)
      expect(Object.keys(TABLES).some((k) => k === name || k.startsWith(`${name}.`))).toBe(true);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('lightbox.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('Lightbox.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('lightbox-classes.ts'))).toBe(true);
  });
});
