/**
 * The brand sweep, as the Tailwind classes that render it.
 *
 * Lives here rather than in a family class table for the same reason as
 * `focus-ring-classes.ts`: it crosses families. A badge is content, a progress bar is
 * feedback, and both draw the same sweep — so a copy in each file is two places for one
 * decision to drift, which is exactly what the family tables exist to prevent WITHIN a family
 * and cannot see ACROSS one.
 *
 * BOTH STOPS ARE STATIC TOKEN CLASSES. The one sanctioned escape from the class-only rule is a
 * computed POSITION, which travels as a number in a custom property; a stop is never inline.
 * Brand to its own deeper hover shade rather than reaching across token families: the live
 * evidence is one brand sweep, not three different second colours.
 */
export const BRAND_GRADIENT = 'bg-gradient-to-r from-default-brand to-hover-brand';
