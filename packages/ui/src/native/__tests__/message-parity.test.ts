/**
 * THE NATIVE MESSAGE FAMILY DRAWS WHAT THE WEB ONE DRAWS, table by table and value by value
 * (UMK-1129).
 *
 * The contract has no spacing, radius or colour dimension, so nothing links the web's
 * `primitives/message-classes.ts` to `native/message-styles.ts` at compile time: move a web
 * density rung and the native one is green and wrong. This is the `button-paint.test.ts`
 * arrangement applied to the message family. The web side is the REAL class table, each class
 * resolved through the token group Tailwind resolves it through (`bg-` → Surface or the callout
 * group, `text-` → Text, `border-` → Border, a `-ds-` rung → the spacing or radius ladder, a bare
 * Tailwind step → four points a step). The native side is the real style table. Two independent
 * sources compared, not one table read back against itself.
 *
 * EVERY WEB TABLE IS CLASSIFIED. Paired with its native table below, or named in `WEB_ONLY` with
 * the reason it has no native partner — a DOM structure a platform list does not have, or a
 * sibling that keeps its table in its own module. A web table added later that is neither reds
 * the first case, so a new rung cannot arrive on the web alone.
 *
 * WHAT THIS CANNOT SEE: that either platform matches a design (there is none — Ensyra publishes no
 * message set), and a pixel. It proves the two agree.
 *
 * PROVED RED (2026-09-22), one injection each, applied, run and reverted, each written from the
 * failure it stands for rather than read off the resolver:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | native `MESSAGE_INSET.balanced` → `s.lg` (a density rung drifting) | 1 — MESSAGE_INSET |
 * | native `MESSAGE_BUBBLE_SENDER.user.ink` → `'brand'` (the callout-blue defect, native side) | 1 — MESSAGE_BUBBLE_SENDER |
 * | native `MESSAGE_GROUP_END.first` → `borderBottomStartRadius` (a physical/logical swap) | 1 — MESSAGE_GROUP_END |
 * | native `MESSAGE_META_STATUS.sent.pulse` → `true` (a settled state that moves) | 1 — MESSAGE_META_STATUS |
 * | native `MESSAGE_SCROLL_BUTTON_FILL.pressed` → `surface.hover.primary` | 1 — MESSAGE_SCROLL_BUTTON |
 * | a new web export `MESSAGE_LIST_FOOTER` with no native partner and no `WEB_ONLY` row | 1 — classification |
 * | `bubbleStyle`'s ghost arm spreading `MESSAGE_BLOCK` back in (the append the web retired) | 9 — every sender × density cell of the ONE ghost case; no other case |
 * | `bubbleStyle` tucking the user side toward START | 1 — the tuck follows the sender |
 */
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';
import * as WEB from '../../primitives/message-classes';
import { tokens } from '../../tokens';
import * as NATIVE from '../message-styles';
import { TEXT_COLOR_VALUES, type TextColor } from '../theme';

const { bubbleStyle } = NATIVE;

type Style = Record<string, unknown>;

const SPACING_KEY: Record<string, string> = {
  p: 'padding',
  px: 'paddingHorizontal',
  py: 'paddingVertical',
  gap: 'gap',
  mb: 'marginBottom',
  mt: 'marginTop',
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  h: 'height',
  w: 'width',
};

const CORNER_KEY: Record<string, string> = {
  es: 'borderBottomStartRadius',
  ss: 'borderTopStartRadius',
  ee: 'borderBottomEndRadius',
  se: 'borderTopEndRadius',
};

const KEYWORD: Record<string, [string, unknown]> = {
  'w-full': ['width', '100%'],
  'max-w-none': ['maxWidth', undefined],
  'self-stretch': ['alignSelf', 'stretch'],
  'items-start': ['alignItems', 'flex-start'],
  'items-end': ['alignItems', 'flex-end'],
  'items-center': ['alignItems', 'center'],
  'justify-center': ['justifyContent', 'center'],
  'flex-row': ['flexDirection', 'row'],
  'flex-row-reverse': ['flexDirection', 'row-reverse'],
  'shrink-0': ['flexShrink', 0],
  'min-w-0': ['minWidth', 0],
  'min-h-0': ['minHeight', 0],
  'flex-1': ['flex', 1],
  relative: ['position', 'relative'],
  absolute: ['position', 'absolute'],
  border: ['borderWidth', tokens.borderWidth.sm],
  'animate-pulse': ['pulse', true],
};

const lookup = (group: unknown, path: string[]): string | undefined => {
  let at: unknown = group;
  for (const part of path) at = (at as Record<string, unknown> | undefined)?.[part];
  return typeof at === 'string' ? at : undefined;
};

/**
 * One web class → one native style key and value, or `null` for a class with no native meaning
 * here (a type size, a transition, a focus ring, `flex` itself). A colour- or rung-SHAPED class
 * that does not resolve THROWS: skipping is how a parser quietly reads a subset.
 */
const resolveClass = (cls: string): [string, unknown] | null => {
  if (cls in KEYWORD) return KEYWORD[cls];

  let m = /^(-)?(p|px|py|gap|mb|mt|top|right|bottom|h|w)-ds-(.+)$/.exec(cls);
  if (m) {
    const [, neg, prop, rung] = m;
    const value = (tokens.spacing as Record<string, number>)[rung];
    if (value === undefined) throw new Error(`'${cls}' names no spacing rung`);
    return [SPACING_KEY[prop], neg ? -value : value];
  }
  m = /^rounded(?:-(es|ss|ee|se))?-ds-(.+)$/.exec(cls);
  if (m) {
    const value = (tokens.radius as Record<string, number>)[m[2]];
    if (value === undefined) throw new Error(`'${cls}' names no radius rung`);
    return [m[1] ? CORNER_KEY[m[1]] : 'borderRadius', value];
  }
  m = /^(h|w)-(\d+(?:\.\d+)?)$/.exec(cls);
  if (m) return [SPACING_KEY[m[1]], Number(m[2]) * 4];
  m = /^max-w-\[(\d+%)\]$/.exec(cls);
  if (m) return ['maxWidth', m[1]];

  m = /^(hover:)?bg-(.+)$/.exec(cls);
  if (m) {
    const key = m[1] ? 'pressedBackgroundColor' : 'backgroundColor';
    const rest = m[2];
    if (rest === 'transparent') return [key, 'transparent'];
    if (rest === 'hover-neutral') return [key, tokens.surface.hoverNeutral];
    const hex = rest.startsWith('callout-')
      ? lookup(tokens.callout, rest.slice('callout-'.length).split('-'))
      : lookup(tokens.surface, rest.split('-'));
    if (hex === undefined) throw new Error(`'${cls}' names no surface token`);
    return [key, hex];
  }
  m = /^text-([a-z]+)-([a-z]+)$/.exec(cls);
  if (m) {
    const hex = lookup(tokens.text, [m[1], m[2]]);
    /* `text-sm`/`text-xs` never reach here (one segment); anything two-segment is a colour. */
    if (hex === undefined) throw new Error(`'${cls}' names no text token`);
    return ['ink', hex];
  }
  m = /^border-([a-z]+)-([a-z]+)$/.exec(cls);
  if (m) {
    const hex = lookup(tokens.border, [m[1], m[2]]);
    if (hex === undefined) throw new Error(`'${cls}' names no border token`);
    return ['borderColor', hex];
  }
  if (/^inset-x-0$/.test(cls)) return ['insetX', 0];
  return null;
};

/** A web class string resolved to the style it asks for. `ignore` drops classes on purpose. */
const webStyle = (classes: string, ignore: readonly string[] = []): Style => {
  const out: Style = {};
  for (const cls of classes.split(/\s+/).filter(Boolean)) {
    if (ignore.includes(cls)) continue;
    const hit = resolveClass(cls);
    if (hit) out[hit[0]] = hit[1];
  }
  return out;
};

/** A native style with its colour WORDS resolved to hexes, so the two sides compare in one unit. */
const ink = (word: TextColor) => TEXT_COLOR_VALUES[word];

const nativeView = (style: object, extra: Style = {}): Style => {
  const out: Style = { ...(style as Style), ...extra };
  if ('left' in out && 'right' in out && out.left === 0 && out.right === 0 && !('insetX' in out)) out.insetX = 0;
  return out;
};

/**
 * The comparison: every key the web class string resolved must hold the same value natively.
 * The floor is per table — a table that resolved NOTHING is a parse that went dark.
 */
const agree = (name: string, web: Style, native: Style, floor = 1) => {
  expect(Object.keys(web).length, `${name}: the web table resolved suspiciously few classes`).toBeGreaterThanOrEqual(floor);
  const picked: Style = {};
  for (const key of Object.keys(web)) picked[key] = native[key];
  expect(picked, name).toEqual(web);
};

const DENSITIES = contract.ChatMessage.axes.density;
const SENDERS = contract.ChatMessage.axes.sender;

/** A per-axis table whose web entries are class strings and native entries are numbers. */
const SCALAR_TABLES: [name: string, key: string][] = [
  ['MESSAGE_CONTENT_GAP', 'gap'],
  ['MESSAGE_AUTHOR_PULL', 'marginBottom'],
  ['MESSAGE_META_PULL', 'marginTop'],
  ['MESSAGE_INSET', 'paddingHorizontal'],
  ['MESSAGE_BLOCK', 'paddingVertical'],
  ['MESSAGE_LIST_PAD', 'padding'],
  ['MESSAGE_LIST_DENSITY_GAP', 'gap'],
  ['MESSAGE_LIST_GAP', 'gap'],
];

/**
 * Web tables with NO native partner, each with the reason. Keyed by export name.
 */
const WEB_ONLY: Record<string, string> = {
  MESSAGE_LIST_ROOT: 'the web log region wrapping its content element — the platform list is one element',
  MESSAGE_LIST_CONTENT: 'the element the web frame observes for growth — a platform list reports its own size',
  MESSAGE_LIST_SPACER: 'the bottom-alignment spacer — native justifies a growing content container (`MESSAGE_LIST_ALIGN`)',
  MESSAGE_LIST_SENTINEL: 'the load-older intersection target — a platform list has `onStartReached`',
  MESSAGE_THREAD_SCROLLER: 'the web frame owns a scroll box — on native the list is the scroller',
  MESSAGE_TTS_BUTTON: '`ChatMessageTTSButton`, whose native table lives in its own module',
  MESSAGE_TTS_STATE: '`ChatMessageTTSButton`, whose native table lives in its own module',
  MESSAGE_TTS_GLYPH: '`ChatMessageTTSButton`, whose native table lives in its own module',
  MESSAGE_SCROLL_BUTTON_GLYPH: 'an icon SIZE WORD natively (`sm`, 16) — `Icon` sizes on a closed axis, not a style',
  MESSAGE_META_GLYPH: 'a recorded divergence, asserted on its own below',
};

/** Every web table paired with a native one below. The classification case checks the union. */
const PAIRED = [
  ...SCALAR_TABLES.map(([name]) => name),
  'MESSAGE_ROOT',
  'MESSAGE_AUTHOR',
  'MESSAGE_AVATAR',
  'MESSAGE_CONTENT_ALIGN',
  'MESSAGE_NAME',
  'MESSAGE_BUBBLE_BASE',
  'MESSAGE_BUBBLE_SENDER',
  'MESSAGE_BUBBLE_GHOST',
  'MESSAGE_BUBBLE_WIDTH',
  'MESSAGE_GROUP_START',
  'MESSAGE_GROUP_END',
  'MESSAGE_META_ROOT',
  'MESSAGE_META_DIRECTION',
  'MESSAGE_META_SEPARATOR',
  'MESSAGE_META_STATUS',
  'MESSAGE_META_STATUS_GROUP',
  'MESSAGE_LIST_EMPTY',
  'MESSAGE_LIST_PENDING',
  'MESSAGE_THREAD_ROOT',
  'MESSAGE_THREAD_PILL_SLOT',
  'MESSAGE_SCROLL_BUTTON',
  'MESSAGE_SCROLL_BUTTON_SHAPE',
  'MESSAGE_SCROLL_BUTTON_BADGE',
];

const web = WEB as unknown as Record<string, unknown>;
const native = NATIVE as unknown as Record<string, unknown>;

describe('the native message family agrees with the web', () => {
  it('classifies every web table as paired or web-only, and every pair exists on both sides', () => {
    const webTables = Object.keys(web).filter((k) => k.startsWith('MESSAGE_')).sort();
    /* Sized to the real count, not `> 0`: a namespace import that lost half its exports would
       still be non-empty. 45 today. */
    expect(webTables.length).toBeGreaterThanOrEqual(40);
    expect(webTables).toEqual([...PAIRED, ...Object.keys(WEB_ONLY)].sort());
    for (const name of PAIRED) expect(native[name], `${name} has no native partner in message-styles.ts`).toBeDefined();
  });

  it.each(SCALAR_TABLES)('%s agrees on every axis value', (name, key) => {
    const w = web[name] as Record<string, string>;
    const n = native[name] as Record<string, number>;
    const values = Object.keys(w);
    expect(values.length, `${name} has no values`).toBeGreaterThanOrEqual(3);
    expect(Object.keys(n).sort()).toEqual([...values].sort());
    for (const v of values) expect({ [v]: n[v] }, `${name}.${v}`).toEqual({ [v]: webStyle(w[v])[key] });
  });

  it('MESSAGE_CONTENT_ALIGN agrees per sender', () => {
    for (const sender of SENDERS) {
      agree(`MESSAGE_CONTENT_ALIGN.${sender}`, webStyle(WEB.MESSAGE_CONTENT_ALIGN[sender]), {
        alignItems: NATIVE.MESSAGE_CONTENT_ALIGN[sender],
      });
    }
  });

  it('MESSAGE_ROOT agrees', () => {
    agree('MESSAGE_ROOT', webStyle(WEB.MESSAGE_ROOT), nativeView(NATIVE.MESSAGE_ROOT), 2);
  });

  /**
   * RECORDED WEB-AHEAD DIVERGENCE (UMK-1041, L23; native owner UMK-1371). The web author header now
   * matches the live agent chat — 8px between a framed 28px face and a strong, semibold name —
   * and native has not been touched (no native code in this ticket). Asserted exactly, both
   * sides, so it cannot rot: when native catches up the NATIVE half reds, and this case is
   * deleted in favour of the plain `agree` calls it replaced.
   */
  it('records the web-ahead author header exactly (web L23, native unchanged)', () => {
    expect(WEB.MESSAGE_AUTHOR).toBe('flex items-center gap-2');
    expect(NATIVE.MESSAGE_AUTHOR.gap).toBe(tokens.spacing['3xs']);
    expect(WEB.MESSAGE_AVATAR).toBe(
      'flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-default-primary bg-default-primary shadow-sm',
    );
    expect(NATIVE.MESSAGE_AVATAR).toEqual({ flexShrink: 0 });
    expect(WEB.MESSAGE_NAME).toBe('text-ds-paragraph-mobile font-semibold text-default-primary');
    expect(webStyle(WEB.MESSAGE_NAME).ink).toBe(ink('primary'));
    expect(NATIVE.MESSAGE_NAME).toEqual({ role: 'bodyLg', color: 'secondary' });
  });

  it('MESSAGE_BUBBLE_BASE agrees', () => {
    agree('MESSAGE_BUBBLE_BASE', webStyle(WEB.MESSAGE_BUBBLE_BASE), nativeView(NATIVE.MESSAGE_BUBBLE_BASE), 2);
  });

  it('MESSAGE_BUBBLE_SENDER agrees on fill AND ink per sender', () => {
    for (const sender of SENDERS) {
      const n = NATIVE.MESSAGE_BUBBLE_SENDER[sender];
      agree(
        `MESSAGE_BUBBLE_SENDER.${sender}`,
        webStyle(WEB.MESSAGE_BUBBLE_SENDER[sender]),
        { backgroundColor: n.backgroundColor, ink: ink(n.ink) },
        2,
      );
    }
  });

  it('MESSAGE_BUBBLE_GHOST and MESSAGE_BUBBLE_WIDTH agree', () => {
    agree('MESSAGE_BUBBLE_GHOST', webStyle(WEB.MESSAGE_BUBBLE_GHOST), nativeView(NATIVE.MESSAGE_BUBBLE_GHOST));
    for (const width of contract.ChatMessageBubble.axes.width) {
      agree(`MESSAGE_BUBBLE_WIDTH.${width}`, webStyle(WEB.MESSAGE_BUBBLE_WIDTH[width]), nativeView(NATIVE.MESSAGE_BUBBLE_WIDTH[width]));
    }
  });

  it.each(['MESSAGE_GROUP_START', 'MESSAGE_GROUP_END'] as const)('%s tucks the same logical corners', (name) => {
    for (const group of contract.ChatMessageBubble.axes.group) {
      /* `none` paints nothing on either side — compared whole, so a stray corner reds too. */
      expect(nativeView(NATIVE[name][group]), `${name}.${group}`).toEqual(webStyle(WEB[name][group]));
    }
  });

  it('the metadata row agrees: root, direction, separator and status group', () => {
    agree(
      'MESSAGE_META_ROOT',
      webStyle(WEB.MESSAGE_META_ROOT),
      nativeView(NATIVE.MESSAGE_META_ROOT, { ink: ink(NATIVE.MESSAGE_META_TYPE.color) }),
      3,
    );
    for (const sender of SENDERS) {
      agree(`MESSAGE_META_DIRECTION.${sender}`, webStyle(WEB.MESSAGE_META_DIRECTION[sender]), {
        flexDirection: NATIVE.MESSAGE_META_DIRECTION[sender],
      });
    }
    agree('MESSAGE_META_SEPARATOR', webStyle(WEB.MESSAGE_META_SEPARATOR), { ink: ink(NATIVE.MESSAGE_META_SEPARATOR) });
    agree('MESSAGE_META_STATUS_GROUP', webStyle(WEB.MESSAGE_META_STATUS_GROUP), nativeView(NATIVE.MESSAGE_META_STATUS_GROUP), 3);
  });

  /**
   * Only two statuses draw anything of their own. The web writes nothing for the three settled
   * ones, so their expectation is the ROW's own tone and no motion — an empty web entry is a
   * claim ("inherits"), not an absence of one.
   */
  it('MESSAGE_META_STATUS agrees per status, settled states included', () => {
    const rowTone = webStyle(WEB.MESSAGE_META_ROOT).ink;
    for (const status of contract.ChatMessageMetadata.axes.status) {
      const expected = { pulse: false, ink: rowTone, ...webStyle(WEB.MESSAGE_META_STATUS[status]) };
      const n = NATIVE.MESSAGE_META_STATUS[status];
      expect({ pulse: n.pulse, ink: ink(n.ink) }, `MESSAGE_META_STATUS.${status}`).toEqual(expected);
    }
  });

  it('the list rows agree: empty state and pending row', () => {
    agree(
      'MESSAGE_LIST_EMPTY',
      webStyle(WEB.MESSAGE_LIST_EMPTY),
      nativeView(NATIVE.MESSAGE_LIST_EMPTY, { ink: ink(NATIVE.MESSAGE_LIST_EMPTY_TYPE.color) }),
      4,
    );
    agree('MESSAGE_LIST_PENDING', webStyle(WEB.MESSAGE_LIST_PENDING), nativeView(NATIVE.MESSAGE_LIST_PENDING), 4);
  });

  it('the frame agrees: root and pill slot', () => {
    agree('MESSAGE_THREAD_ROOT', webStyle(WEB.MESSAGE_THREAD_ROOT), nativeView(NATIVE.MESSAGE_THREAD_ROOT), 4);
    /* `justify-center` centres a web ROW; the native slot is a column and centres with
       `alignItems`, which is asserted instead. `pointer-events-none` + the pill's own `auto` is
       the web spelling of the native `box-none`. */
    agree(
      'MESSAGE_THREAD_PILL_SLOT',
      webStyle(WEB.MESSAGE_THREAD_PILL_SLOT, ['justify-center']),
      nativeView(NATIVE.MESSAGE_THREAD_PILL_SLOT),
      3,
    );
    expect(NATIVE.MESSAGE_THREAD_PILL_SLOT.alignItems).toBe('center');
    expect(NATIVE.MESSAGE_THREAD_PILL_SLOT.pointerEvents).toBe('box-none');
  });

  it('the pill agrees at rest AND pressed, per shape, and on its mark', () => {
    agree(
      'MESSAGE_SCROLL_BUTTON',
      webStyle(WEB.MESSAGE_SCROLL_BUTTON),
      nativeView(NATIVE.MESSAGE_SCROLL_BUTTON, {
        backgroundColor: NATIVE.MESSAGE_SCROLL_BUTTON_FILL.rest,
        pressedBackgroundColor: NATIVE.MESSAGE_SCROLL_BUTTON_FILL.pressed,
        ink: ink(NATIVE.MESSAGE_SCROLL_BUTTON_TYPE.color),
      }),
      8,
    );
    for (const shape of contract.ChatScrollButton.axes.shape) {
      agree(
        `MESSAGE_SCROLL_BUTTON_SHAPE.${shape}`,
        webStyle(WEB.MESSAGE_SCROLL_BUTTON_SHAPE[shape]),
        nativeView(NATIVE.MESSAGE_SCROLL_BUTTON_SHAPE[shape]),
      );
    }
    agree('MESSAGE_SCROLL_BUTTON_BADGE', webStyle(WEB.MESSAGE_SCROLL_BUTTON_BADGE), nativeView(NATIVE.MESSAGE_SCROLL_BUTTON_BADGE), 7);
  });

  /**
   * THE ONE RECORDED DIVERGENCE. The web status glyph is 14 and native draws 12, because `Icon`'s
   * size axis is closed and the ladder publishes no 14 (see `MESSAGE_META_GLYPH`'s docblock).
   * Asserted both ways so it cannot rot: if the web moves to a rung native CAN say, this reds and
   * the divergence is deleted rather than left describing something no longer true.
   */
  it('records the status glyph divergence exactly', () => {
    expect(webStyle(WEB.MESSAGE_META_GLYPH).height).toBe(14);
    expect(NATIVE.MESSAGE_META_GLYPH).toBe('xs');
  });
});

describe('bubbleStyle', () => {
  const CELLS = SENDERS.flatMap((sender) => DENSITIES.map((density) => [sender, density] as const));

  /**
   * The GHOST SELECTS. It keeps the inline inset and takes neither the sender fill nor the block
   * padding — asserted as ABSENCE of the key, because a ghost that merely overrode the padding
   * with zero would read identically here and is the append shape the web retired.
   */
  it.each(CELLS)('a %s ghost at %s keeps the inset and nothing else of the bubble', (sender, density) => {
    const ghost = bubbleStyle({ sender, density, ghost: true, group: 'none', width: 'auto' });
    expect(ghost.paddingHorizontal).toBe(NATIVE.MESSAGE_INSET[density]);
    expect(ghost.backgroundColor).toBe('transparent');
    expect('paddingVertical' in ghost).toBe(false);
  });

  it.each(CELLS)('a %s bubble at %s takes both density halves and its sender fill', (sender, density) => {
    const bubble = bubbleStyle({ sender, density, ghost: false, group: 'none', width: 'auto' });
    expect(bubble.paddingHorizontal).toBe(NATIVE.MESSAGE_INSET[density]);
    expect(bubble.paddingVertical).toBe(NATIVE.MESSAGE_BLOCK[density]);
    expect(bubble.backgroundColor).toBe(NATIVE.MESSAGE_BUBBLE_SENDER[sender].backgroundColor);
  });

  /** The user side tucks toward the inline END, the other two toward the START — logical corners. */
  it.each(SENDERS)('a %s run tucks toward its own edge', (sender) => {
    const middle = bubbleStyle({ sender, density: 'balanced', ghost: false, group: 'middle', width: 'auto' });
    const table = sender === 'user' ? NATIVE.MESSAGE_GROUP_END : NATIVE.MESSAGE_GROUP_START;
    for (const [corner, value] of Object.entries(table.middle)) expect(middle[corner as keyof typeof middle]).toBe(value);
    const other = sender === 'user' ? NATIVE.MESSAGE_GROUP_START : NATIVE.MESSAGE_GROUP_END;
    for (const corner of Object.keys(other.middle)) expect(corner in middle).toBe(false);
  });
});

