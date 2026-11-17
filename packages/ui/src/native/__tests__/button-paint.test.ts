/**
 * THE NATIVE BUTTON PAINTS WHAT THE WEB BUTTON PAINTS, cell by cell and state by state
 * (UMK-1091).
 *
 * UMK-1091 moved the web `Button` onto design-system tokens (b80867406), gave every cell its
 * own disabled paint instead of one `opacity-50`, and corrected `dark` to mean a button FOR
 * dark chrome (cd724ca47). None of that reached `native/Button.tsx`, and nothing could say so:
 * the contract has no colour dimension, the native suite cannot load `react-native`, and a
 * wrong hex is green everywhere. The native sibling kept the legacy navy `dark`, the old
 * `hoverNeutral` press on filled light, a 2px stroke on every ghost, and the fade.
 *
 * HOW. `button-styles.ts` holds the native table and imports nothing from `react-native`, so
 * it loads here. The web side is the REAL `buttonVariants` — its class string for each cell,
 * resolved through the same token groups Tailwind resolves it through (`bg-` → Surface,
 * `text-` → Text, `ring-` → Border; see `tokens.preset.js`). Two independent sources compared,
 * not one table read back against itself. A `hover:` class is the native `pressed` paint and
 * a `disabled:` class the disabled one, each falling back to the resting value it does not
 * override — which is what CSS does with an unset property.
 *
 * WHAT THIS CANNOT SEE. That the hexes are the right ones is Figma's to say; this proves the
 * two surfaces agree, not that either matches the design. And it cannot see a pixel.
 *
 * PROVED RED, one injection each:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | native ghost `dark` rest ink back to `t.default.primary` (the legacy navy) | 1 — ghost × dark |
 * | native filled `light` pressed bg back to `s.hoverNeutral` | 1 — primary × light |
 * | native ghost `primary` strokeWidth back to 2 | 1 — ghost × primary |
 * | native text `danger` disabled ink set to `t.disable.primary` | 1 — text × danger |
 * | `opacity: inert ? 0.5 : 1` restored in `Button.tsx` | 1 — the fade ban |
 * | `backgroundColor: treatment.rest.backgroundColor` in `Button.tsx` | 1 — the wiring |
 * | `const { disabled: off } = treatment` in `Button.tsx` | 1 — the wiring |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';
import { buttonVariants } from '../../primitives/Button/Button';
import { tokens } from '../../tokens';
import { BUTTON_TREATMENT, type ButtonPaint } from '../button-styles';

type Type = (typeof contract.Button.axes.type)[number];
type Color = (typeof contract.Button.axes.color)[number];

const CELLS: [Type, Color][] = contract.Button.axes.type.flatMap((type) =>
  contract.Button.axes.color.map((color): [Type, Color] => [type, color]),
);

/** The token group each web utility reads, as `tokens.preset.js` maps it. */
const GROUP = { bg: tokens.surface, text: tokens.text, ring: tokens.border, border: tokens.border } as const;
const PAINT_KEY = { bg: 'backgroundColor', text: 'ink', ring: 'borderColor', border: 'borderColor' } as const;

type CellPaint = { backgroundColor?: string; ink?: string; borderColor?: string; strokeWidth?: number };

/**
 * One web cell's classes, split by modifier. A colour-shaped class that does not resolve
 * THROWS rather than being skipped: skipping is how a parser quietly reads a subset, and a
 * subset compared against a full native table would red for the wrong reason — or, worse,
 * match a native table that dropped the same cell.
 */
const readWebCell = (type: Type, color: Color) => {
  const classes = buttonVariants({ type, color, size: null, width: null }).split(/\s+/).filter(Boolean);
  const by: Record<'rest' | 'hover' | 'disabled', CellPaint> = { rest: {}, hover: {}, disabled: {} };
  let colourClasses = 0;

  for (const cls of classes) {
    /* UMK-1548: the `outline` type draws its stroke as a real `border`, a bare `border` being 1px. */
    if (cls === 'border') {
      by.rest.strokeWidth = 1;
      continue;
    }
    const m = /^(?:(hover|disabled):)?(bg|text|ring|border)-(.+)$/.exec(cls);
    if (!m) continue;
    const [, modifier, utility, rest] = m as unknown as [string, 'hover' | 'disabled' | undefined, 'bg' | 'text' | 'ring' | 'border', string];
    const bucket = by[modifier ?? 'rest'];

    if ((utility === 'ring' || utility === 'border') && /^\d+$/.test(rest)) {
      bucket.strokeWidth = Number(rest);
      continue;
    }
    if (utility === 'bg' && rest === 'transparent') {
      bucket.backgroundColor = 'transparent';
      colourClasses++;
      continue;
    }
    const [state, leaf, ...extra] = rest.split('-');
    /* `text-base` and friends are type-size classes, not colours — `size: null` keeps them
       out, and this is the backstop: a colour class always has a state AND a leaf. */
    if (utility === 'text' && leaf === undefined) continue;
    const group = GROUP[utility] as Record<string, Record<string, string> | undefined>;
    const hex = extra.length === 0 ? group[state]?.[leaf] : undefined;
    if (typeof hex !== 'string') throw new Error(`${type} × ${color}: '${cls}' names no ${utility} token`);
    bucket[PAINT_KEY[utility]] = hex;
    colourClasses++;
  }
  return { ...by, colourClasses };
};

const paintOf = (p: CellPaint): ButtonPaint => {
  const out: ButtonPaint = { backgroundColor: p.backgroundColor!, ink: p.ink! };
  if (p.borderColor !== undefined) out.borderColor = p.borderColor;
  return out;
};

const code = (src: string) => src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const BUTTON = code(readFileSync(resolve(__dirname, '..', 'Button.tsx'), 'utf8'));

describe('native Button paint', () => {
  /** The cross-product is 4 × 4 from the contract; an empty or short list is a vacuous suite. */
  it('covers every Type × Colors cell', () => {
    expect(CELLS).toHaveLength(16);
    for (const [type, color] of CELLS) {
      expect(BUTTON_TREATMENT[type][color], `${type} × ${color} has no native cell`).toBeDefined();
    }
  });

  it.each(CELLS)('%s × %s agrees with the web in every state', (type, color) => {
    const web = readWebCell(type, color);
    const native = BUTTON_TREATMENT[type][color];

    /* Sized to a PARTIAL parse, not a total one: every web cell names at least a resting fill,
       a resting ink and two disabled or hover colours. A parser that drops one utility family
       leaves fewer than four, and would otherwise hand the comparison below `undefined`s. */
    expect(web.colourClasses, `${type} × ${color}: the web cell parsed suspiciously few colour classes`).toBeGreaterThanOrEqual(4);
    expect(web.rest.backgroundColor, 'no resting fill parsed').toBeTypeOf('string');
    expect(web.rest.ink, 'no resting ink parsed').toBeTypeOf('string');

    const rest = paintOf(web.rest);
    expect(native.rest, 'rest').toEqual(rest);
    expect(native.pressed, 'pressed (the web hover)').toEqual(paintOf({ ...web.rest, ...web.hover }));
    expect(native.disabled, 'disabled').toEqual(paintOf({ ...web.rest, ...web.disabled }));
    expect(native.strokeWidth, 'stroke width').toBe(web.rest.strokeWidth ?? 0);
  });

  /**
   * NO FADE. The intent is "a disabled button is not made paler by transparency"; the web
   * dropped `disabled:opacity-50` for per-cell paint and so does native. `opacity` is banned
   * as a WORD in every spelling a style can carry it (`opacity:`, `'opacity'`, a shorthand
   * `{ opacity }`), and so is an alpha channel on a colour literal — the other way to fade —
   * as an 8-digit hex or an `rgba(`/`hsla(` call.
   *
   * The one opacity a button carries is the 180 ms STATE crossfade between two cell paints
   * (UMK-1485), kept in `button-state-fade.tsx` so this ban still reads `Button.tsx` whole. At rest
   * that layer does not exist; `apps/mobile/src/design/__tests__/button-state-fade.test.tsx` pins it.
   */
  it('does not fade a disabled button', () => {
    const styles = code(readFileSync(resolve(__dirname, '..', 'button-styles.ts'), 'utf8'));
    for (const [file, src] of [['Button.tsx', BUTTON], ['button-styles.ts', styles]] as const) {
      expect(src.match(/\bopacity\b/i), `${file} fades instead of painting`).toBeNull();
      expect(src.match(/#[0-9a-f]{8}\b|\b(?:rgba|hsla)\s*\(/i), `${file} fades through an alpha colour`).toBeNull();
    }
  });

  /**
   * THE ONLY WAY A PAINT LEAVES THE TABLE IS `buttonPaint`. The table can agree with the web
   * perfectly while `Button.tsx` reads `treatment.rest` directly and never shows the pressed
   * or disabled paint at all. So every reference to the cell in the component has to be one
   * of four allowed forms; a direct member read, an index, a destructure or an alias is a
   * reference outside them, and the count says so whatever it is spelled as.
   */
  it('resolves every paint through buttonPaint', () => {
    const body = BUTTON.replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?/gm, '');
    const allowed = [
      /const treatment = BUTTON_TREATMENT\[type\]\[color\];/g,
      /\btreatment\.strokeWidth\b/g,
      /\btreatment\.spinner\b/g,
      /buttonPaint\(treatment, \{ pressed, inert \}\)/g,
      /* The state crossfade's OLD paint (UMK-1485): the state the button just left, resolved through
         `buttonPaint` like the other two, never read off the cell. */
      /buttonPaint\(treatment, \{ pressed: false, inert: wasInert \}\)/g,
    ];
    const paints = body.match(allowed[3]) ?? [];
    expect(paints.length, 'Button.tsx must resolve both the box and the ink through buttonPaint').toBe(2);
    const leftover = allowed.reduce((src, re) => src.replace(re, ''), body);
    expect(leftover.match(/\b(?:treatment|BUTTON_TREATMENT)\b/g), 'Button.tsx reads a cell outside buttonPaint').toBeNull();
    expect(body, 'the box does not take the resolved fill').toMatch(/backgroundColor: paint\.backgroundColor/);
    expect(body, 'the box does not take the resolved stroke').toMatch(/borderColor: paint\.borderColor/);
  });
});
