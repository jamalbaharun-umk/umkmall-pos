import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge has to be TOLD about the design system's font sizes.
 *
 * It resolves conflicts from a built-in map of Tailwind's own class names, so `ds-*` — a
 * scale this repo adds — is a key it has never heard of. Faced with `text-ds-paragraph-mobile`
 * it falls back to reading `text-<unknown>` as a text COLOUR, decides it conflicts with
 * `text-default-primary`, and drops whichever came first. The size disappears from a perfectly
 * valid class string with nothing to say so, and the text renders at the browser default.
 *
 * A validator rather than the 22 emitted keys: the list is generated from Figma and a
 * hand-copy of it goes stale the first time a role is added. `text-ds-*` is unambiguously a
 * font size here — colours are emitted unprefixed (`text-default-primary`), and the other
 * `ds-` scales are radius and spacing, which never wear a `text-` prefix.
 */
const isDs = (value: string) => value.startsWith('ds-');

/**
 * The same blindness for the other `ds-*` scales (UMK-957): `h-ds-4xl` and `h-16` are both
 * heights, but `ds-4xl` is not a value tailwind-merge knows, so it kept BOTH and the stylesheet
 * order decided — a `Skeleton` told `h-16` rendered 84px tall, with nothing to say so.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [isDs] }],
      h: [{ h: [isDs] }],
      w: [{ w: [isDs] }],
      size: [{ size: [isDs] }],
      rounded: [{ rounded: [isDs] }],
    },
  },
});

/**
 * Combines class names using clsx and tailwind-merge
 *
 * This utility intelligently merges Tailwind CSS classes, resolving conflicts
 * and removing duplicates. Use this instead of string concatenation for className props.
 *
 * @param inputs - Class names to merge (strings, arrays, objects, etc.)
 * @returns Merged class name string
 *
 * @example
 * ```typescript
 * cn('px-4 py-2', 'bg-blue-500') // => 'px-4 py-2 bg-blue-500'
 * cn('px-4', 'px-8') // => 'px-8' (later value wins)
 * cn('px-4', isActive && 'bg-blue-500') // => 'px-4 bg-blue-500' (if isActive is true)
 * cn({ 'bg-blue-500': isActive, 'bg-gray-500': !isActive }) // => 'bg-blue-500' (if isActive is true)
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
