import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as tables from './a2ui-classes';

/**
 * UMK-1307, rewritten by UMK-1380. `a2ui-classes.ts` used to be the ONE library file allowed raw hex; it
 * now carries none, and `src/no-raw-colour.test.ts` owns that ban (one matcher, UMK-900 — a second hex
 * regex here would be a second definition of "raw colour"). What this file still guards is what that
 * ban cannot see: a colour class that is not raw but does not RESOLVE, which renders as no colour at
 * all with nothing failing.
 */
const source = readFileSync(join(__dirname, 'a2ui-classes.ts'), 'utf8');
const preset = createRequire(import.meta.url)('../../tokens.preset.js').theme.extend as Record<string, Record<string, unknown>>;

const words = (v: unknown): string[] =>
  typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : Object.values(v as object).flatMap(words);
const ALL = Object.values(tables).flatMap(words);

/** utility prefix -> the preset map that must hold the name. Sizes (`text-ds-*`, `border-t`) are not colours and never match. */
const SOURCE: Record<string, Record<string, unknown>> = {
  text: preset.textColor,
  marker: preset.textColor,
  placeholder: preset.textColor,
  bg: preset.backgroundColor,
  border: preset.borderColor,
  ring: preset.ringColor,
  from: preset.gradientColorStops,
  via: preset.gradientColorStops,
  to: preset.gradientColorStops,
  accent: { 'brand-primary': 1 },
  divide: preset.borderColor,
  fill: preset.fill,
  stroke: preset.stroke,
  // No colour map backs these: a colour name after them can only be dead.
  outline: {},
  shadow: {},
  decoration: {},
  caret: {},
};
/** Names that are a size, width, alignment or style, never a colour. Anything else after a colour utility MUST resolve in the preset, so a misspelling (`bg-defualt-primary`) is dead, not skipped. */
const NOT_A_COLOUR = /^(?:ds-|legacy|[trblxy](?:-|$)|\d|px$|xs$|sm$|base$|lg$|xl$|\dxl$|left$|right$|center$|justify$|start$|end$|ellipsis$|clip$|wrap$|nowrap$|balance$|pretty$|transparent$|current$|inherit$|none$|dashed$|dotted$|solid$|double$|gradient-|cover$|contain$|md$|2xl$|inner$|card$)/;

/** `[&_*]:text-x`, `hover:`, `focus-within:`, `marker:` … -> prefix + name, opacity dropped; undefined when it is no colour class. */
function colourClass(token: string): { prefix: string; name: string } | undefined {
  const m = /^(?:.*:)?!?(text|bg|border|ring|from|via|to|accent|divide|outline|fill|stroke|shadow|decoration|caret)-([a-z0-9-]+)(?:\/\d+)?$/.exec(token.replace(/\[[^\]]*\]:/g, ''));
  if (!m || NOT_A_COLOUR.test(m[2]!)) return undefined;
  const marker = /(?:^|:)(marker|placeholder):/.exec(token)?.[1];
  return { prefix: marker ?? m[1]!, name: m[2]! };
}

describe('the a2ui class file (UMK-1307, UMK-1380)', () => {
  it('exports a real set of class constants (anti-vacuity)', () => {
    expect(Object.keys(tables).length, 'the scan found nothing to check').toBeGreaterThan(20);
    expect(ALL.length).toBeGreaterThan(150);
  });

  it('names only colour classes the preset publishes', () => {
    const found = ALL.map(colourClass).filter((c): c is { prefix: string; name: string } => !!c);
    expect(found.length, 'no colour class was recognised').toBeGreaterThan(60);
    const dead = found.filter((c) => !(c.name in SOURCE[c.prefix]!)).map((c) => `${c.prefix}-${c.name}`);
    expect(dead).toEqual([]);
  });

  it.each(['hover:text-hover-nonexistent', 'bg-defualt-primary', 'border-brand', 'text-defualt-primary', 'via-default-x', 'divide-defualt-primary', 'fill-defualt-primary', 'outline-defualt-brand'])(
    'would red on %s, a colour class the preset does not publish',
    (token) => {
      const c = colourClass(token)!;
      expect(c, 'a misspelling must be read as a colour, not skipped').toBeDefined();
      expect(c.name in SOURCE[c.prefix]!).toBe(false);
    },
  );

  it('never writes a ds- rung, which would sit beside the default look instead of replacing it', () => {
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/(?<!text)-ds-/); // text-ds-* type tokens are allowed (UMK-1325): they scale, they are not a rung
  });
});
