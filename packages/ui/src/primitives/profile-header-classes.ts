/**
 * The web profile header's class tables (UMK-1840), in one place, as `list-row-classes.ts` keeps the
 * row's. Both guards read this file as data: `profile-header.purge.test.ts` derives its required list
 * from the whole module, and `profile-header.stories.test.tsx` reads the tables rather than retyping
 * them.
 *
 * THE VALUES ARE THE NATIVE HEADER'S (`native/ProfileHeader.tsx`, Figma "Teman AI Page" 15044:52555):
 * a 50 circle on the brand fill holding one white initial, 16 from a text column of the name over one
 * secondary line. 50 is on no ladder step, so it is an arbitrary value, which the behaviour guard pins.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a class
 * named in a comment is emitted whether or not anything still uses it.
 */

/** The avatar and the text column, 16 apart. No padding: the page carries its own inset. */
export const PROFILE_HEADER = 'flex min-w-0 items-center gap-ds-md';

/** The 50 circle on the brand fill, its initial (or the user glyph) in white. */
export const PROFILE_HEADER_AVATAR =
  'flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full bg-default-brand text-default-invert';

/** The user glyph drawn when there is no initial, 24. */
export const PROFILE_HEADER_GLYPH = 'h-6 w-6';

/** The name over the line, taking the room the avatar leaves. */
export const PROFILE_HEADER_TEXT = 'flex min-w-0 flex-1 flex-col';

/** One line each: a long name truncates rather than wrapping. */
export const PROFILE_HEADER_TRUNCATE = 'truncate';
