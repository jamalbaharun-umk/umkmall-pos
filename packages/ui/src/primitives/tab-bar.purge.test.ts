import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as TAB_BAR_CLASSES from './tab-bar-classes';

const { TAB_BAR } = TAB_BAR_CLASSES;

/**
 * The web tab bar's purge guard (UMK-1757), a copy of `sidebar.purge.test.ts`'s mechanics.
 *
 * `TabBar` carries no contract `family`, so no family guard pair can see it; this file and its
 * behaviour sibling are its web coverage (`unfamilied-coverage.test.ts`). A purged class renders
 * unstyled against a green suite, and the behaviour guard only checks a class is ON the element.
 *
 * IN THIS PACKAGE, because turbo's `test` hash covers a package's own files (UMK-852); the preset
 * is loaded by RELATIVE path. IT SCANS SOURCE ONLY, so its own expectations are not its content.
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

/** Derived from the whole module, so a new table is picked up with no edit here. */
const flatten = (module_: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(module_).flatMap(([name, value]) =>
      typeof value === 'string'
        ? [[name, value] as const]
        : Object.entries(value as Record<string, string>).map(([step, v]) => [`${name}.${step}`, v] as const),
    ),
  );

const isTable = (value: unknown): boolean =>
  typeof value === 'string' ||
  (typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string'));

const TABLES = flatten(TAB_BAR_CLASSES as unknown as Record<string, unknown>);

const REQUIRED = Object.values(TABLES)
  .flatMap((v) => v.split(' '))
  /* Arbitrary values cannot be falsified (the JIT generates them from the line the expectation is
     read off); the safe-area inset is pinned on the element by the behaviour sibling instead. */
  .filter((c) => !c.includes('['))
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the tab bar classes survive the purge', () => {
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the tab bar relies on', () => {
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  /* The bar is the phone's navigation and the sidebar is the desktop's: a dropped gate gives a
     desktop both, and a second breakpoint gives a band with both or neither (UMK-956: asserted on
     the one contributor, not in aggregate). */
  it('hides the bar from the package breakpoint up, and at no other', () => {
    expect(/(?:^|\s)md:hidden(?:\s|$)/.test(TAB_BAR)).toBe(true);
    expect(/(?:^|\s)(?:sm|lg|xl|2xl):/.test(TAB_BAR)).toBe(false);
    expect(css).toMatch(/\.md\\:hidden(?![-\w])/);
  });

  it('reads every export of the class module, in a shape it can flatten', () => {
    const exports_ = Object.entries(TAB_BAR_CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(exports_.filter(([, v]) => !isTable(v)).map(([name]) => name)).toEqual([]);
    for (const [name] of exports_)
      expect(Object.keys(TABLES).some((k) => k === name || k.startsWith(`${name}.`))).toBe(true);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('tab-bar.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('TabBar.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('tab-bar-classes.ts'))).toBe(true);
  });
});
