import { useCallback, type Ref, type RefCallback } from 'react';

/**
 * Point a forwarded ref AND a local one at the same node.
 *
 * Three components need the element for themselves — the date field for the popover's focus
 * return, the select for its trigger, the upload for its file input — while still honouring
 * the ref their caller passed. Each had its own three-line copy of this, which is the shape
 * `field-classes.ts` and `focus-ring-classes.ts` already exist to stop: a value living in more
 * than one file where nothing compares the copies.
 *
 * Handles both ref forms, because a caller may pass either and React does not normalise them:
 * a callback ref is CALLED, an object ref is ASSIGNED, and treating one as the other silently
 * does nothing.
 */
/**
 * A HOOK, so the callback identity is stable across renders.
 *
 * A fresh closure every render makes React detach and re-attach the ref on each one — it calls
 * the previous callback with `null` and the new one with the node. Memoising on the forwarded
 * ref means that happens only when the ref itself changes, which is what it is for.
 *
 * The forwarded callback's RETURN VALUE is passed through, because React 19 lets a callback ref
 * return a cleanup function. Discarding it silently drops the caller's teardown — the ref is
 * never released, and nothing anywhere reports it.
 */
export const useMergedRef = <T,>(
  local: { current: T | null },
  forwarded: Ref<T>,
): RefCallback<T> =>
  useCallback<RefCallback<T>>(
    (node: T | null) => {
      local.current = node;
      if (typeof forwarded === 'function') return forwarded(node);
      if (forwarded) (forwarded as { current: T | null }).current = node;
      return undefined;
    },
    // `local` is a ref object and stable by construction; only the forwarded ref can change.
    [forwarded, local],
  );
