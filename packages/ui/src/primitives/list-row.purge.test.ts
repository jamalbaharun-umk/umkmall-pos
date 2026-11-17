import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as CLASSES from './list-row-classes';

/**
 * The web list row's purge guard (UMK-1840), a copy of `tab-bar.purge.test.ts`'s mechanics.
 *
 * It carries no contract `family`, so no family guard pair can see it; this file and its behaviour
 * sibling are its web coverage (`unfamilied-coverage.test.ts`). A purged class renders unstyled
 * against a green suite, and the behaviour guard only checks a class is ON the element.
 *
 * IN THIS PACKAGE, because turbo's `test` hash covers a package's own files (UMK-852); the preset is
 * loaded by RELATIVE path. IT SCANS SOURCE ONLY, so its own expectations are not its content.
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

const TABLES = flatten(CLASSES as unknown as Record<string, unknown>);

const REQUIRED = Object.values(TABLES)
  .flatMap((v) => v.split(' '))
  /* Arbitrary values cannot be falsified (the JIT generates them from the line the expectation is
     read off); the behaviour sibling pins those on the element instead. */
  .filter((c) => !c.includes('['))
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the list row classes survive the purge', () => {
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the list row relies on', () => {
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  it('reads every export of the class module, in a shape it can flatten', () => {
    const exports_ = Object.entries(CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(exports_.filter(([, v]) => !isTable(v)).map(([name]) => name)).toEqual([]);
    for (const [name] of exports_)
      expect(Object.keys(TABLES).some((k) => k === name || k.startsWith(`${name}.`))).toBe(true);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('list-row.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('ListRow/ListRow.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('list-row-classes.ts'))).toBe(true);
  });
});
