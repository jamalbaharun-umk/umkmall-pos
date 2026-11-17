import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as SIDEBAR_CLASSES from './sidebar-classes';

const {
  SIDEBAR_ASIDE,
  SIDEBAR_DRAWER,
  SIDEBAR_DRAWER_STATE,
  SIDEBAR_SCRIM,
  SIDEBAR_WIDTH,
} = SIDEBAR_CLASSES;

/**
 * `Sidebar` carries no contract `family`, so the four family guard pairs cannot see it at all
 * — they reconcile their `MODULES` keyset against the entries that CLAIM a family, and an
 * unfamilied component is simply never expected anywhere. That is why this file and its
 * behaviour sibling exist rather than being optional extras.
 *
 * WHAT IT IS FOR: a purged class renders unstyled against a green suite, and this component
 * is almost entirely breakpoint-gated chrome. The rail lives behind one prefix and the drawer
 * behind its complement, so a dropped responsive utility gives a phone two navigations at once
 * or a desktop none — while the behaviour guard, which only checks the class is ON THE
 * ELEMENT, stays green.
 *
 * Same siting and same mechanics as `overlays.purge.test.ts`: in this package, because
 * turbo's `test` hash covers a package's own files and not its workspace dependencies'
 * (UMK-852), and the preset is loaded by RELATIVE path because the bare specifier resolves
 * through a node_modules symlink that is a different copy inside a git worktree.
 *
 * AND IT SCANS SOURCE ONLY. A glob that swept this file in would make these class names their
 * own content, and every one would report as emitted whether or not the component still uses
 * it.
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
 * written out by hand, and they had already drifted: five tables were in the first and missing
 * from the second, so an exit animation added to any of them was unchecked. Nor could the map's
 * own `> 4` count floor see it, because the two spread tables padded the count past four on their
 * own. Both are now derived from ONE namespace import, so a table cannot be in one and not the
 * other, and the completeness check below is what notices a table shaped in a way this cannot
 * flatten. A count is not a substitute for either: it cannot name what went missing.
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

const TABLES = flatten(SIDEBAR_CLASSES as unknown as Record<string, unknown>);

const REQUIRED = Object.values(TABLES)
  .flatMap((v) => v.split(' '))
  /* Arbitrary values cannot be falsified: Tailwind's JIT generates them from the very line
     the expectation is read off, so the rule always exists and the check always passes. */
  .filter((c) => !c.includes('['))
  /* Mirror Tailwind's own escape rule rather than enumerating characters — the emitted
     selector for a variant class carries a literal backslash, and escaping a chosen subset
     builds a selector the stylesheet never contains. */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the sidebar classes survive the purge', () => {
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the sidebar relies on', () => {
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  /**
   * KTD18b. EVERY breakpoint-gated class the component depends on is asserted here, per
   * contributor rather than in aggregate (UMK-956): the rail and the drawer reach the layout
   * by opposite prefixes of the SAME breakpoint, so a total that stays healthy while one side
   * goes dark proves nothing about either side.
   */
  it('keeps both halves of the responsive split gated, and gated at one breakpoint', () => {
    const prefix = /(?:^|\s)md:/;
    expect(prefix.test(SIDEBAR_ASIDE)).toBe(true);
    expect(prefix.test(SIDEBAR_DRAWER)).toBe(true);
    expect(prefix.test(SIDEBAR_SCRIM)).toBe(true);

    /* The rail ladder is the DIALOG_SIZE failure mode exactly: a purged step renders a
       full-width unstyled aside while the class is still on the element. */
    const steps = Object.values(SIDEBAR_WIDTH);
    expect(steps.length).toBeGreaterThan(1);
    for (const step of steps) expect(step.startsWith('md:')).toBe(true);

    /* One breakpoint, not two. Mixing prefixes gives a width band where both navigations are
       mounted and visible, which no assertion about either one alone can see. */
    const others = /(?:^|\s)(?:sm|lg|xl|2xl):/;
    for (const value of [SIDEBAR_ASIDE, SIDEBAR_DRAWER, SIDEBAR_SCRIM, ...steps])
      expect(others.test(value)).toBe(false);
  });

  /* The single elevation token (KTD11). The preset's own `z` group is a COLOUR group, so
     nothing else in the pipeline would notice this one falling off the scale — and a drawer
     under the app chrome is a drawer that cannot be tapped. */
  it('puts the drawer and its scrim on the one elevation token', () => {
    expect(SIDEBAR_DRAWER).toContain('z-ds-overlay');
    expect(SIDEBAR_SCRIM).toContain('z-ds-overlay');
    expect(css).toMatch(/\.z-ds-overlay(?![-\w])/);
  });

  /**
   * NO EXIT ANIMATION (KTD9), and the reason here is NOT Radix's Presence.
   *
   * This drawer is always mounted and translates off-screen, so nothing suspends an unmount
   * and nothing is stranded. It slides both ways on ONE transform transition (L20), so neither
   * state carries an `animate-*` utility.
   */
  /* E18: the closed drawer parks off-screen with no shadow, so a 2xl shadow does not bleed into the viewport. */
  it('carries the drawer shadow only while open', () => {
    expect(SIDEBAR_DRAWER).not.toContain('shadow-');
    expect(SIDEBAR_DRAWER_STATE.open).toContain('shadow-2xl');
    expect(SIDEBAR_DRAWER_STATE.closed).toContain('shadow-none');
    expect(SIDEBAR_DRAWER_STATE.closed).not.toContain('shadow-2xl');
    expect(css).toMatch(/\.shadow-none\b/);
  });

  it('slides the drawer on a transform transition that respects reduced motion', () => {
    for (const c of ['transition-transform', 'duration-300', 'ease-in-out', 'motion-reduce:transition-none'])
      expect(SIDEBAR_DRAWER).toContain(c);
    expect(SIDEBAR_DRAWER_STATE.open).not.toContain('animate-');
    expect(css).toMatch(/\.transition-transform\b/);
    expect(css).toMatch(/\.motion-reduce\\:transition-none\b/);
  });

  it('sets no exit animation on any sidebar surface', () => {
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
    const exports_ = Object.entries(SIDEBAR_CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(exports_.filter(([, v]) => !isTable(v)).map(([name]) => name)).toEqual([]);
    /* And every one of them reached the derived map, rather than merely being acceptable. */
    for (const [name] of exports_)
      expect(Object.keys(TABLES).some((k) => k === name || k.startsWith(`${name}.`))).toBe(true);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('sidebar.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('Sidebar.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('sidebar-classes.ts'))).toBe(true);
  });
});
