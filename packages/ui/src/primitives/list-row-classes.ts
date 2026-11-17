/**
 * The web list row's class tables (UMK-1840), in one place, as the tab bar keeps its own.
 *
 * Same siting rule as the other `*-classes.ts` modules: component chrome, not a general mapping, and
 * not in `contract/`, which may not name a Tailwind class at all. Both guards read this file as data:
 * `list-row.purge.test.ts` derives its required list from the whole module, and
 * `list-row.stories.test.tsx` reads the tables rather than retyping them.
 *
 * THE VALUES ARE THE NATIVE ROW'S (`native/ListRow.tsx`): a `tile` row at least 56 tall with its own
 * 12 inset and its glyph in a 36 brand tile; a `plain` row (Profil, Figma "Teman AI Page" 15044:52555)
 * 52 tall with no inset of its own, its two glyphs bare at 18. Glyph, text and trailing sit 12 apart,
 * and the hover, press and current tint is the weak brand surface, rounded at 16.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a class
 * named in a comment is emitted whether or not anything still uses it.
 */

import { FOCUS_RING } from '../utils';

/** What every row shares: one line of glyph, text and trailing, 12 apart, the tint rounded at 16. */
export const LIST_ROW = `relative flex w-full min-w-0 items-center gap-ds-sm rounded-ds-xl text-left outline-none transition-colors duration-150 ${FOCUS_RING.control}`;

/** The box per variant: the tile row's 56 floor and inset, the plain row's 16 above and below a 20 line. */
export const LIST_ROW_BOX = {
  tile: 'min-h-14 px-ds-sm py-ds-2xs',
  plain: 'py-ds-md',
} as const;

/** Hover and press tint the row; the current row keeps the tint; a disabled row takes neither. */
export const LIST_ROW_TINT = {
  interactive: 'cursor-pointer hover:bg-weak-brand active:bg-weak-brand',
  active: 'bg-weak-brand',
  disabled: 'cursor-not-allowed',
} as const;

/** The 36 tile around a tile row's glyph: the weak brand surface, the glyph in brand ink. */
export const LIST_ROW_TILE = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-ds-lg bg-weak-brand text-default-brand';

/** A tile row's glyphs, 20. */
export const LIST_ROW_TILE_GLYPH = 'h-5 w-5 shrink-0';

/** A plain row's two glyphs at 18, Figma's size, which is on no ladder step (the toast's close is the same). */
export const LIST_ROW_PLAIN_GLYPH = 'h-[18px] w-[18px] shrink-0';

/** The glyph ink, which greys with a disabled row's label. */
export const LIST_ROW_GLYPH_INK = {
  enabled: 'text-default-primary',
  disabled: 'text-disable-primary',
} as const;

/** The label and its optional meta line, taking the room the glyphs leave. */
export const LIST_ROW_TEXT = 'flex min-w-0 flex-1 flex-col';

/** One line each: a long label truncates rather than wrapping the row taller. */
export const LIST_ROW_TRUNCATE = 'truncate';
