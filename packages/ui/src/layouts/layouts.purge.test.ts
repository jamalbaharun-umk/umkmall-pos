import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as LAYOUT_CLASSES from './layout-classes';

const { SHELL_BODY, SHELL_BOTTOM, SHELL_HEADER, SHELL_MAIN, SHELL_NAV, SHELL_ROOT } = LAYOUT_CLASSES;

/**
 * `AppShell` carries no contract `family`, so the four family guard pairs cannot see it at all
 * — they reconcile their `MODULES` keyset against the entries that CLAIM a family, and an
 * unfamilied component is simply never expected anywhere. That is why this file and its
 * behaviour sibling exist rather than being optional extras.
 *
 * WHAT IT IS FOR: a purged class renders unstyled against a green suite, and this component is
 * nothing BUT chrome. Lose the height unit and the frame is as tall as its content, so the page
 * scrolls instead of the region and the header scrolls away with it. Lose one link of the
 * overflow chain and the caller's scroller silently stops scrolling. Lose one of the two
 * navigation gates and a narrow viewport gets two navigations or none. Every one of those is
 * invisible to a behaviour guard, which only checks that the class is ON the element.
 *
 * Same siting and same mechanics as `sidebar.purge.test.ts`: in this package, because turbo's
 * `test` hash covers a package's own files and not its workspace dependencies' (UMK-852), and
 * the preset is loaded by RELATIVE path because the bare specifier resolves through a
 * node_modules symlink that is a different copy inside a git worktree.
 *
 * AND IT SCANS SOURCE ONLY. A glob that swept this file in would make these class names their
 * own content, and every one would report as emitted whether or not the component still uses it.
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
 * both written out by hand, so a new table in `layout-classes.ts` was invisible to both until
 * someone made two edits, and a table present in one and absent from the other was unchecked
 * with nothing red. Nor could the map's own `> 4` count floor see that: the one spread table
 * padded the count past four on its own, and a count cannot name what went missing anyway. Both
 * registrations are now derived from ONE namespace import, so a table cannot be in one and not
 * the other, and the completeness check below is what notices a table shaped in a way this
 * cannot flatten.
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

const TABLES = flatten(LAYOUT_CLASSES as unknown as Record<string, unknown>);

const REQUIRED = Object.values(TABLES)
  .flatMap((v) => v.split(' '))
  /* Arbitrary values cannot be falsified: Tailwind's JIT generates them from the very line the
     expectation is read off, so the rule always exists and the check always passes. */
  .filter((c) => !c.includes('['))
  /* Mirror Tailwind's own escape rule rather than enumerating characters — the emitted selector
     for a variant class carries a literal backslash, and escaping a chosen subset builds a
     selector the stylesheet never contains. */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the app shell classes survive the purge', () => {
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the shell relies on', () => {
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  /**
   * KTD18b. The two navigation slots reach the layout by OPPOSITE prefixes of the same
   * breakpoint, so they are asserted per contributor rather than in aggregate (UMK-956): a
   * total that stays healthy while one side goes dark proves nothing about either side.
   */
  it('keeps both halves of the responsive split gated, and gated at one breakpoint', () => {
    const prefix = /(?:^|\s)md:/;
    /* The rail is gated. The drawer slot is NOT, deliberately (UMK-1041): it hosts a Sidebar that
       gates its own rail and drawer, so hiding the slot above the breakpoint would hide the rail. */
    expect(prefix.test(SHELL_NAV.rail)).toBe(true);
    expect(SHELL_NAV.drawer.split(' ')).toEqual(['contents']);
    expect(Object.values(SHELL_NAV).length).toBeGreaterThan(1);
    /* The bottom bar slot (UMK-1757) is the rail's complement: hidden from the breakpoint up, on its
       own rather than in aggregate, so a desktop never shows a tab bar beside the rail. */
    expect(/(?:^|\s)md:hidden(?:\s|$)/.test(SHELL_BOTTOM)).toBe(true);

    /* One breakpoint, not two. Mixing prefixes gives a width band where both navigations are
       mounted and visible, which no assertion about either one alone can see — and it would
       also disagree with the sidebar's own gate one level down. */
    const others = /(?:^|\s)(?:sm|lg|xl|2xl):/;
    for (const value of [SHELL_ROOT, SHELL_BODY, SHELL_MAIN, SHELL_HEADER, SHELL_BOTTOM, ...Object.values(SHELL_NAV)])
      expect(others.test(value)).toBe(false);
  });

  /**
   * THE DYNAMIC HEIGHT UNIT (UMK-653), asserted against the SOURCE rather than against a name
   * this file spells. On a phone the large viewport unit is the height the page would have with
   * the browser chrome retracted, and the chrome can never retract here because the body itself
   * never scrolls — so the frame's bottom sits permanently behind it. The wrong unit is a
   * one-character edit that looks right in every desktop check.
   */
  it('sizes the frame in the dynamic viewport unit, not the large one', () => {
    const heights = SHELL_ROOT.split(' ').filter((c) => /^h-/.test(c));
    expect(heights).toHaveLength(1);
    expect(heights[0]!.endsWith('dvh')).toBe(true);
  });

  /**
   * THE OVERFLOW CHAIN. The caller's scroller only scrolls if every ancestor between it and the
   * frame refuses to grow past the frame, and a flex child's default minimum is its content —
   * so a missing minimum is a chain that compiles, renders and does not scroll.
   */
  it('pins a minimum on every link of the chain down to the content region', () => {
    for (const link of [SHELL_BODY, SHELL_MAIN]) expect(link).toContain('min-h-0');
    for (const surface of [SHELL_ROOT, SHELL_BODY, SHELL_MAIN])
      expect(surface).toContain('overflow-hidden');
    /* And the content column must not be squeezed sideways by a wide child either. */
    expect(SHELL_MAIN).toContain('min-w-0');
  });

  /**
   * NO EXIT ANIMATION (KTD9). Nothing here unmounts behind Radix's Presence, so the stranding
   * mechanism does not apply — this is the package-wide rule held in the one place a class can
   * be read, so that a shell surface never quietly acquires one.
   */
  it('sets no exit animation on any shell surface', () => {
    const offenders = Object.entries(TABLES)
      .filter(([, value]) =>
        /data-\[state=closed\]:(?:animate-out|fade-out|zoom-out|slide-out)/.test(value),
      )
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  /* ONE ELEVATION TOKEN, and the shell claims none of it (KTD11). The frame is in the flow; a
     stacking value here would put the whole app on a scale beside the overlays' single token,
     which is the mess that token exists to have collapsed. */
  it('claims no stacking value of its own', () => {
    for (const value of [SHELL_ROOT, SHELL_BODY, SHELL_MAIN, SHELL_HEADER, ...Object.values(SHELL_NAV)])
      expect(/(?:^|\s)z-/.test(value)).toBe(false);
  });

  /**
   * THE DERIVATION'S OWN COMPLETENESS CHECK. Deriving from the module removes the drift between
   * two hand-written registrations; it does not by itself prove the module was fully read. A
   * table declared in a shape `flatten` cannot walk — an array, a nested record — would be
   * skipped in silence, which is the same hole one register lower down. So every export is named
   * here and asserted to be a shape this file handles.
   */
  it('reads every export of the class module, in a shape it can flatten', () => {
    const exports_ = Object.entries(LAYOUT_CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(exports_.filter(([, v]) => !isTable(v)).map(([name]) => name)).toEqual([]);
    /* And every one of them reached the derived map, rather than merely being acceptable. */
    for (const [name] of exports_)
      expect(Object.keys(TABLES).some((k) => k === name || k.startsWith(`${name}.`))).toBe(true);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('layouts.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('AppShell.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('layout-classes.ts'))).toBe(true);
  });

  /* The frame is reachable from the package root as well as from its subpath — the decision
     KTD16 asked for, held where a later tidy-up of the barrel would trip over it. */
  it('is exported from the package root, not only from its subpath', () => {
    const root = readFileSync(resolve(PACKAGE, 'src/index.ts'), 'utf8');
    expect(/from\s*'\.\/layouts'/.test(root)).toBe(true);
  });
});
