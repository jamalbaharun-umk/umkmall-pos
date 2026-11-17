/**
 * The web list group's class tables (UMK-1840), in one place, as `list-row-classes.ts` keeps the row's.
 * Both guards read this file as data: `list-group.purge.test.ts` derives its required list from the
 * whole module, and `list-group.stories.test.tsx` reads the tables rather than retyping them.
 *
 * THE VALUES ARE THE NATIVE GROUP'S (`native/ListGroup.tsx`): an `outlined` group is its uppercase
 * label 8 over a white container with the one card edge, rounded at 24 and padded 4; a `plain` group
 * (Profil, Figma "Teman AI Page" 15044:52555) is its sentence-case label 4 over rows that sit on the
 * page, with no container. Rows stack 4 apart in both.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a class
 * named in a comment is emitted whether or not anything still uses it.
 */

/** The label over the rows: 8 apart over a container, 4 over plain rows. */
export const LIST_GROUP_STACK = {
  outlined: 'flex min-w-0 flex-col gap-ds-2xs',
  plain: 'flex min-w-0 flex-col gap-ds-4xs',
} as const;

/** The label's box. The outlined label insets to the rows' own text edge (the container's 4 and a row's 12). */
export const LIST_GROUP_LABEL = {
  outlined: 'min-w-0 truncate px-ds-md uppercase',
  plain: 'min-w-0 truncate',
} as const;

/** The outlined group's container: the solid white card with the one card edge. */
export const LIST_GROUP_CONTAINER = 'rounded-ds-2xl border border-default-primary bg-default-primary p-ds-4xs';

/** The rows, 4 apart. */
export const LIST_GROUP_ROWS = 'flex min-w-0 flex-col gap-ds-4xs';
