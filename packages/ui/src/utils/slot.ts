import type { ReactNode } from 'react';

/**
 * Is a slot actually filled?
 *
 * AN OMITTED SLOT MUST RENDER NOTHING. Every shell component in this package wraps its slots
 * in a box that carries padding, a gap or a border, so a slot rendered unconditionally puts an
 * EMPTY one in the layout — invisible in a screenshot and still taking its own space out of
 * the frame. That is the bug this predicate exists to make hard to reintroduce.
 *
 * Three components landed their own copy of the check — the sidebar's slots, the header's
 * actions and tabs, the shell's four regions — and two of them spelled it as the negation of
 * the other, which is how a fourth ends up subtly different. Same reason `mergeRefs` and
 * `focus-ring-classes.ts` exist: a rule living in more than one file where nothing compares
 * the copies.
 *
 * THE LIST IS THE NODES REACT ITSELF DROPS, and `''` is deliberately NOT one of them.
 * `field-support.tsx` treats an empty string as absent because a label is TEXT and an empty one
 * names nothing; a slot takes arbitrary content, so a caller passing `''` has passed content and
 * gets its box. A truthiness check would also swallow `0`, which is a legitimate thing to render
 * into a slot. Both stay FILLED here, for the same reason as before.
 *
 * `true` AND `[]` ARE ON THE LIST TOO, and the empty array is the realistic one. React renders a
 * boolean as nothing whichever way it points, so `false` being absent while `true` is present was
 * never a distinction React honours. And `sidebar={items.map(...)}` over an empty list is how a
 * caller ordinarily fills this slot — an empty result reaches here as `[]`, renders nothing, and
 * produced exactly the empty padded box this predicate exists to prevent. A NON-empty array is
 * left alone: its elements may each render nothing, but deciding that would mean walking the tree,
 * and the box is then the caller's own composition rather than an omitted slot.
 */
export const isSlotFilled = (content: ReactNode): boolean =>
  content !== undefined &&
  content !== null &&
  typeof content !== 'boolean' &&
  !(Array.isArray(content) && content.length === 0);
