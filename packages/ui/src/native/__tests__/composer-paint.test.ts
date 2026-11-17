/**
 * THE NATIVE COMPOSER BUTTONS PAINT WHAT THE WEB ONES PAINT, per button and per state
 * (UMK-1128).
 *
 * Checking the two siblings against each other when UMK-1128 ported the `state` axis found
 * THREE differences the suite was green over, none of them a decision:
 *
 * - the active MINUS (tools and attachment, open) drew at 20 on native and 24 on the web —
 *   the published size, which the contract's own `ChatAttachmentButton` note names;
 * - send's `stop` drew on the resting BLUE on native while its docblock said red — the web
 *   paints the error fill, the one the recording mic takes;
 * - a disabled send's glyph took the icon group's `disable` hex (#c3cbd3) where the web takes
 *   the secondary TEXT token (#93a2b0).
 *
 * Nothing could say so: the contract has no colour dimension, the native suite cannot load
 * `react-native`, and a wrong hex is green everywhere. This is `button-paint.test.ts`'s method
 * for the composer family: the web side is the REAL class tables in `composer-classes.ts`,
 * resolved through the token groups Tailwind resolves them through (`bg-` → Surface, `text-` →
 * Text, `border-` → Border); the native side is `composer-styles.ts`, which imports nothing from
 * `react-native` at runtime and so loads here, with its ink WORD resolved through the icon
 * group exactly as `Icon` resolves it. Two independent sources compared, not one read back.
 *
 * WHAT THIS CANNOT SEE. That either surface matches Figma; a pixel; a `hover:` treatment,
 * which native has no counterpart for on these buttons; and MOTION — the web's `waiting`
 * spinner spins and native's does not, which is recorded here rather than guarded.
 *
 * ONE KNOWN SIZE DELTA, recorded rather than hidden: the web draws send's stop square at 14
 * (`COMPOSER_GLYPH.tight`), and native `Icon`'s size ladder is closed with no 14 step, so native
 * draws it at 16. The glyph assertions below cover the toggles' 20/24 pair only.
 *
 * PROVED RED, one injection each:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | native `COMPOSER_BUTTON_ACTIVE.voice` back to the brand fill | 1 — voice × active |
 * | native `COMPOSER_BUTTON_IDLE.tools` border to `tokens.border.default.brand` | **2** — tools ×
 *   default AND tools × disabled, because a disabled cell IS the resting one with the disabled
 *   row laid over it, on both platforms; no resting-cell break can isolate to one |
 * | native `COMPOSER_SEND_STATE.stop` emptied to `{}` (the pre-UMK-1128 blue stop) | 1 — send × stop |
 * | native `COMPOSER_BUTTON_DISABLED.send` ink back to `'disable'` | 1 — send × disabled |
 * | native `COMPOSER_BUTTON_DISABLED.attachment` opacity to 0.6 | 1 — attachment × disabled |
 * | `glyphSizeFor` in `composer-button.tsx` mapping the minus to `'md'` again | 1 — the minus glyph |
 * | `fill={COMPOSER_SEND_STATE[state]}` dropped from `ChatSendButton.tsx` | 1 — send wiring |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';
import * as WEB from '../../primitives/composer-classes';
import { tokens } from '../../tokens';
import * as NATIVE from '../composer-styles';
import { ICON_COLOR_VALUES, measure, type TextColor } from '../theme';

type Paint = { backgroundColor?: string; borderColor?: string; ink?: string; opacity?: number };
type Kind = keyof typeof WEB.COMPOSER_BUTTON_IDLE;
type SendState = (typeof contract.ChatSendButton.axes.state)[number];

const KINDS = Object.keys(WEB.COMPOSER_BUTTON_IDLE) as Kind[];
const TOGGLES = KINDS.filter((k) => k !== 'send');
const GROUP = { bg: tokens.surface, text: tokens.text, border: tokens.border } as const;
const KEY = { bg: 'backgroundColor', text: 'ink', border: 'borderColor' } as const;

/**
 * One class string's colour classes, split into resting and `disabled:`. A colour-shaped class
 * that names no token THROWS rather than being skipped — a parser that skips is one that quietly
 * reads a subset. Classes with other modifiers (`hover:`, `focus-visible:`) are not paint native
 * has a counterpart for, and are left out by modifier rather than by failing to parse.
 */
const readWeb = (classes: string) => {
  const by: Record<'rest' | 'disabled', Paint> = { rest: {}, disabled: {} };
  let colourClasses = 0;
  for (const cls of classes.split(/\s+/).filter(Boolean)) {
    const m = /^(?:([\w-]+):)?(bg|text|border|opacity)-(.+)$/.exec(cls);
    if (!m) continue;
    const [, modifier, utility, rest] = m as unknown as [string, string | undefined, 'bg' | 'text' | 'border' | 'opacity', string];
    if (modifier !== undefined && modifier !== 'disabled') continue;
    const bucket = by[modifier === 'disabled' ? 'disabled' : 'rest'];
    if (utility === 'opacity') {
      bucket.opacity = Number(rest) / 100;
      continue;
    }
    if (rest === 'transparent') {
      bucket[KEY[utility]] = 'transparent';
      colourClasses++;
      continue;
    }
    const [state, leaf, ...extra] = rest.split('-');
    /* `text-sm` and friends are sizes, and `border` alone is a width: a colour always has both. */
    if (leaf === undefined) continue;
    const group = GROUP[utility] as Record<string, Record<string, string> | undefined>;
    const hex = extra.length === 0 ? group[state]?.[leaf] : undefined;
    if (typeof hex !== 'string') throw new Error(`'${cls}' names no ${utility} token`);
    bucket[KEY[utility]] = hex;
    colourClasses++;
  }
  return { ...by, colourClasses };
};

/** A native treatment with its ink WORD resolved the way `Icon` resolves it. */
const readNative = (style: object): Paint => {
  const { ink, backgroundColor, borderColor, opacity } = style as Paint & { ink?: TextColor };
  const out: Paint = {};
  if (backgroundColor !== undefined) out.backgroundColor = backgroundColor;
  if (borderColor !== undefined) out.borderColor = borderColor;
  if (ink !== undefined) out.ink = ICON_COLOR_VALUES[ink];
  if (opacity !== undefined) out.opacity = opacity;
  return out;
};

const code = (src: string) => src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const read = (file: string) => code(readFileSync(resolve(__dirname, '..', file), 'utf8'));

describe('native composer button paint', () => {
  it('covers the four kinds and send\'s three states on both platforms', () => {
    expect([...KINDS].sort()).toEqual(['attachment', 'send', 'tools', 'voice']);
    expect(Object.keys(NATIVE.COMPOSER_BUTTON_IDLE).sort()).toEqual([...KINDS].sort());
    expect(Object.keys(NATIVE.COMPOSER_SEND_STATE).sort()).toEqual([...contract.ChatSendButton.axes.state].sort());
    expect(Object.keys(WEB.COMPOSER_SEND_STATE).sort()).toEqual([...contract.ChatSendButton.axes.state].sort());
  });

  /** The toggles' `default`, and send's resting `send`: the IDLE tables. */
  it.each(KINDS)('%s × default agrees with the web', (kind) => {
    const web = readWeb(WEB.COMPOSER_BUTTON_IDLE[kind]);
    /* Sized to a PARTIAL parse: every resting cell names a fill, a stroke and an ink. */
    expect(web.colourClasses, `${kind}: parsed suspiciously few colour classes`).toBe(3);
    expect(readNative(NATIVE.COMPOSER_BUTTON_IDLE[kind])).toEqual(web.rest);
  });

  it.each(TOGGLES)('%s × active agrees with the web', (kind) => {
    const web = readWeb(WEB.COMPOSER_BUTTON_ACTIVE[kind]);
    expect(web.colourClasses).toBe(3);
    expect(readNative(NATIVE.COMPOSER_BUTTON_ACTIVE[kind])).toEqual(web.rest);
  });

  /** Disabled is the resting cell with the `disabled:` classes over it — what CSS does. */
  it.each(KINDS)('%s × disabled agrees with the web', (kind) => {
    const web = readWeb(`${WEB.COMPOSER_BUTTON_IDLE[kind]} ${WEB.COMPOSER_BUTTON_DISABLED[kind]}`);
    expect(
      readNative({ ...NATIVE.COMPOSER_BUTTON_IDLE[kind], ...NATIVE.COMPOSER_BUTTON_DISABLED[kind] }),
    ).toEqual({ ...web.rest, ...web.disabled });
  });

  it.each(contract.ChatSendButton.axes.state)('send × %s agrees with the web', (state: SendState) => {
    const web = readWeb(`${WEB.COMPOSER_BUTTON_IDLE.send} ${WEB.COMPOSER_SEND_STATE[state]}`);
    expect(readNative({ ...NATIVE.COMPOSER_BUTTON_IDLE.send, ...NATIVE.COMPOSER_SEND_STATE[state] })).toEqual(
      web.rest,
    );
  });

  /**
   * The table is only half of it: `ChatSendButton` has to hand its row to the base, and the
   * base has to lay it over the resting fill. Source-scanned, because neither file loads here.
   */
  it('wires send\'s state table through the base', () => {
    expect(read('ChatSendButton.tsx')).toMatch(/fill=\{COMPOSER_SEND_STATE\[state\]\}/);
    expect(read('composer-button.tsx')).toMatch(/\{\s*\.\.\.COMPOSER_BUTTON_IDLE\[kind\],\s*\.\.\.fill\s*\}/);
  });

  /**
   * The web draws the minus at `h-6` and every other toggle glyph at `h-5` — 24 and 20, on
   * Tailwind's 4px spacing unit. Native reaches the same two numbers through `Icon`'s `lg` and
   * `md`, which read the measurement ladder.
   */
  it('draws the active minus at 24 and the other toggle glyphs at 20, as the web does', () => {
    const px = (cls: string) => Number(/\bh-(\d+)\b/.exec(cls)?.[1]) * 4;
    expect(px(WEB.COMPOSER_GLYPH.wide)).toBe(24);
    expect(px(WEB.COMPOSER_GLYPH.default)).toBe(20);
    expect(measure['1-5'], "Icon's lg").toBe(24);
    expect(measure['1-25'], "Icon's md").toBe(20);
    expect(read('Icon.tsx')).toMatch(/lg:\s*measure\['1-5'\]/);
    expect(read('Icon.tsx')).toMatch(/md:\s*measure\['1-25'\]/);
    /* UMK-1371: the rule also reads the `size` axis. On `landing` the web moves every glyph up
       to 24 (`COMPOSER_GLYPH_LANDING.default`), which is the same `lg` the compact minus takes;
       its landing minus is 28, a step `Icon`'s ladder does not have — the recorded delta in
       `composer-button.tsx`, asserted here so it cannot become an unrecorded one. */
    expect(px(WEB.COMPOSER_GLYPH_LANDING.default)).toBe(24);
    expect(px(WEB.COMPOSER_GLYPH_LANDING.wide)).toBe(28);
    expect(read('composer-button.tsx')).toMatch(
      /const glyphSizeFor = \(name: IconName, size: ComposerButtonSize\)[^=]*=>\s*size === 'landing' \|\| name === 'composer-minus' \? 'lg' : 'md'/,
    );
  });
});
