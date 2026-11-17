import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as TABLE_CLASSES from './table-classes';

/**
 * `Table` and `Pagination` carry no contract `family`, so none of the family guard pairs can see
 * them. This file is their purge guard: a purged class renders unstyled against a green suite.
 *
 * Same mechanics as `lightbox.purge.test.ts` — sited in this package (UMK-852), the preset
 * loaded by RELATIVE path, and scanning SOURCE ONLY so these expectations are not their own
 * content.
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

const isTable = (value: unknown): boolean =>
  typeof value === 'string' ||
  (typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string'));

const TABLES: Record<string, string> = Object.fromEntries(
  Object.entries(TABLE_CLASSES as unknown as Record<string, unknown>).flatMap(([name, value]) =>
    typeof value === 'string'
      ? [[name, value]]
      : Object.entries(value as Record<string, string>).map(([k, v]) => [`${name}.${k}`, v]),
  ),
);

/* Arbitrary values are generated from the very line the expectation is read off, so they are
   filtered; everything else must come out of the compiled stylesheet. */
const selectorsOf = (value: string) =>
  value
    .split(' ')
    .filter((c) => c && !c.includes('['))
    .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

/**
 * PER COMPONENT, so losing any one of them reds by name (UMK-956): each component file must
 * still import the tables it is styled by. A total over the module would stay green with one
 * component rendering unstyled.
 */
const COMPONENTS: Array<[file: string, prefix: RegExp]> = [
  ['primitives/Pagination/Pagination.tsx', /\bPAGINATION_[A-Z_]+/g],
  ['primitives/Table/Table.tsx', /\bTABLE_[A-Z_]+|\bTABLE\b/g],
  ['primitives/Table/DataTable.tsx', /\bDATATABLE_[A-Z_]+/g],
];

describe('the table and pagination classes survive the purge', () => {
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the tables rely on', () => {
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(Object.values(TABLES).flatMap(selectorsOf))].filter((s) => !emitted(s));
    expect(missing).toEqual([]);
  });

  it('names only semantic tokens, never a palette step or a literal colour', () => {
    const all = Object.values(TABLES).join(' ');
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(all).not.toMatch(
      /(?:^|\s|:)(?:bg|text|border|ring|from|via|to|shadow|divide|outline)-[a-z]+-\d{2,3}(?![-\w])/,
    );
  });

  it('reads every export of the class module, in a shape it can flatten', () => {
    const exports_ = Object.entries(TABLE_CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(exports_.filter(([, v]) => !isTable(v)).map(([name]) => name)).toEqual([]);
  });

  it.each(COMPONENTS)('%s is still styled by its tables', (file, prefix) => {
    const source = readFileSync(resolve(PACKAGE, 'src', file), 'utf8');
    const used = new Set(source.match(prefix) ?? []);
    expect(used.size).toBeGreaterThan(3);
    for (const name of used) expect(Object.keys(TABLES).some((k) => k.split('.')[0] === name), name).toBe(true);
  });

  it('scans source only, and finds the class module and every component', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('table.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('table-classes.ts'))).toBe(true);
    for (const [file] of COMPONENTS) expect(scanned.some((f) => f.endsWith(file))).toBe(true);
  });
});
