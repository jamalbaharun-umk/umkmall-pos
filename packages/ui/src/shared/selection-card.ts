/**
 * Rules `SelectionCard` needs on BOTH platforms, in one place.
 *
 * `splitDescription` used to live in `primitives/SelectionCard/SelectionCard.tsx`, which
 * imports React and the web class tables — unreachable from `@umkmall/ui/native` without
 * dragging a DOM tree into the app bundle. The alternative was reimplementing it natively and
 * pinning the two copies with a shared table, which is the shape this repo has been burned by
 * before: two implementations of one rule agree until they do not.
 *
 * So it moved here instead. This module imports NOTHING — no React, no `cva`, no DOM type —
 * for the same reason `contract/` imports nothing, and the web keeps re-exporting
 * `splitDescription` from `primitives/SelectionCard` so its public path is unchanged.
 */

/**
 * Split an option's description into an optional heading and a body.
 *
 * A description with no newline is all body and the authored label stays the heading. One
 * with a newline hands its first line over as the heading — and everything after the first
 * newline is body, INCLUDING further newlines, which is why this splits once rather than on
 * every break.
 *
 * The inversion matters more than it looks. The agent surface's flow validation matches
 * against the AUTHORED label, so a generated title cannot be written into the label; the
 * split is the only place it can go. A card that renders the label as the heading regardless
 * gets every one of those wrong.
 */
export const splitDescription = (
  description?: string,
): { title: string | undefined; body: string | undefined } => {
  if (!description) return { title: undefined, body: undefined };
  const at = description.indexOf('\n');
  if (at === -1) return { title: undefined, body: description };
  return { title: description.slice(0, at), body: description.slice(at + 1) };
};
