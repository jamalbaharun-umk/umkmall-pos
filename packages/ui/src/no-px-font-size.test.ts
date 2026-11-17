import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UMK-1325: type is rem, so the text-size setting can reach it. A Tailwind arbitrary px font size
 * (`text-[10px]`) anywhere in this package — stories included — is text that can never scale.
 * Scope: that class spelling only. An inline `style={{ fontSize }}` or a `.css` font-size is not scanned. Keyed on the INTENT (a Tailwind
 * font-size utility with a px length), not on the one spelling in use: variant prefixes, a
 * fraction and a typed value all count.
 */
export const PX_FONT_SIZE = /text-\[(?:length:|absolute-size:)?-?\d*\.?\d+px\]/;

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

const SELF = 'no-px-font-size.test.ts';

/**
 * UMK-1325, second ban: a plain Tailwind size (`text-sm`, `md:text-lg`, `text-2xl`) or a bracketed
 * rem is text that does not follow `--ds-text-scale`. Use the matching `text-ds-*` token (14/20 is
 * `ds-paragraph-mobile`, 16/24 `ds-paragraph-desktop`, 18/28 `ds-h6-desktop`, 20/28 `ds-h5-desktop`,
 * 24/32 `ds-h4-desktop`) or a `ds-legacy-*` entry in `tailwind.preset.js`. `native/` is NativeWind,
 * not this scale, and is out of scope.
 */
export const PLAIN_TEXT_SIZE =
  /(?<![\w-])(?:[\w-]+:)*text-(?:xs|sm|base|lg|xl|[2-9]xl|1\.5xl|\[-?\d*\.?\d+rem\])(?![\w-])/;

describe('no px font size in packages/ui/src', () => {
  it('matches every spelling of the ban', () => {
    for (const c of ['text-[10px]', 'md:text-[10px]', 'text-[10.5px]', 'text-[length:10px]', 'hover:md:text-[.5px]'])
      expect(c).toMatch(PX_FONT_SIZE);
    for (const c of ['text-[0.625rem]', 'text-[color:#fff]', 'w-[10px]'])
      expect(c).not.toMatch(PX_FONT_SIZE);
  });

  it('matches every spelling of the plain-size ban', () => {
    for (const c of ['text-sm', 'md:text-lg', 'hover:md:text-2xl', 'text-[0.625rem]', "'p-4 text-xs'"])
      expect(c).toMatch(PLAIN_TEXT_SIZE);
    for (const c of ['text-ds-h5-desktop', 'text-default-primary', 'text-center', 'text-ellipsis', 'text-inherit', 'context-sm'])
      expect(c).not.toMatch(PLAIN_TEXT_SIZE);
  });

  it('writes no plain Tailwind text size outside native/, stories included', () => {
    const hits = files(__dirname)
      .filter((f) => !f.endsWith(SELF) && !f.includes('/native/'))
      .filter((f) => PLAIN_TEXT_SIZE.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('finds none, stories included', () => {
    const all = files(__dirname);
    expect(all.length).toBeGreaterThan(200);
    const hits = all
      .filter((f) => !f.endsWith(SELF))
      .filter((f) => PX_FONT_SIZE.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
