/**
 * The `Toaster` host's exit queue, as plain functions (UMK-1487).
 *
 * A toast that leaves the queue — closed, timed out, dismissed by its caller — is not unmounted at
 * once: it stays DRAWN while its exit plays, and is pruned when the exit reports done. The host keeps
 * two lists: `shown` (the visible window it last rendered) and `leaving` (entries playing their exit).
 * Getting either wrong fails silently — a toast that never prunes stays drawn forever, one that never
 * enters `leaving` vanishes without its exit — so the bookkeeping lives here, where vitest can pin it
 * (`__tests__/toast-exit.test.ts`), and `Toaster.tsx` only calls it.
 *
 * Pure: no `react-native` import.
 */

import type { HapticKind } from './haptics';

/** The two kinds a toast plays. Typed off `HapticKind`, so dropping either from the haptics door
 *  does not compile here. */
type ToastHaptic = Extract<HapticKind, 'success' | 'error'>;

export interface ToastKeyed {
  id: number;
}

/**
 * After the queue changed: every entry that was shown and is no longer visible starts leaving.
 * Returns `null` when nothing needs to change (the host must not set state then — this runs during
 * render).
 *
 * An INACTIVE host (`toast-hosts.ts`: another host draws the queue) queues no exits and drops any it
 * held: it draws nothing, so a toast that departed meanwhile must not pile up there and replay as an
 * exit — briefly in its live region — the moment it becomes active again.
 */
export function reconcileShown<T extends ToastKeyed>(
  shown: readonly T[],
  visible: readonly T[],
  leaving: readonly T[],
  active = true,
): { shown: readonly T[]; leaving: readonly T[] } | null {
  const same = shown.length === visible.length && shown.every((entry, i) => entry === visible[i]);
  if (!active) return same && leaving.length === 0 ? null : { shown: visible, leaving: [] };
  if (same) return null;
  const gone = shown.filter((entry) => !visible.includes(entry) && !leaving.includes(entry));
  return { shown: visible, leaving: gone.length ? [...leaving, ...gone] : leaving };
}

/** An entry's exit has finished: it is no longer drawn. */
export const pruneExited = <T extends ToastKeyed>(leaving: readonly T[], entry: T): readonly T[] =>
  leaving.filter((e) => e !== entry);

/** What the host draws: the visible window and the entries still leaving, in the order they were raised. */
export const drawOrder = <T extends ToastKeyed>(visible: readonly T[], leaving: readonly T[]): readonly T[] =>
  [...visible, ...leaving].sort((a, b) => a.id - b.id);

/* ------------------------------------------------------------------------------------------ */
/* The gesture and the haptic that go with a toast's way in and out (UMK-1601). Pure for the   */
/* same reason as the queue above: `Toaster.tsx` cannot load under vitest, these can            */
/* (`__tests__/toast-motion.test.ts`).                                                          */
/* ------------------------------------------------------------------------------------------ */

/** pt a toast must be dragged UP to be dismissed early. Shorter drags spring back. A distance on
 *  the finger, not a motion value: nothing animates over it. */
export const TOAST_SWIPE_DISMISS = 24;

/** pt of upward travel before the toast claims the gesture from what it holds, so a tap on its
 *  close (or its action) that wobbles a point is still a tap. */
export const TOAST_SWIPE_SLOP = 4;

/** The toast takes the gesture only for a mostly-vertical move UP past the slop. A downward or
 *  sideways drag is left to the screen beneath. */
export const claimsToastSwipe = (dx: number, dy: number): boolean =>
  dy < -TOAST_SWIPE_SLOP && Math.abs(dy) > Math.abs(dx);

/** Where the toast is drawn while dragged: it follows the finger up, never down past its rest. */
export const toastDrag = (dy: number): number => Math.min(0, dy);

/** On release: far enough up dismisses; anything shorter springs back to rest. `dy` is the whole
 *  travel from touch-down (`toastSwipeTravel`), so the slop counts toward the threshold. */
export const dismissesOnRelease = (dy: number): boolean => dy <= -TOAST_SWIPE_DISMISS;

/**
 * The finger's travel from touch-down. `PanResponder` zeroes `dy` when it GRANTS the gesture, so a
 * release's `dy` counts only what moved after the claim; the `dy` the claim was made at (the slop and
 * a little) is added back. Without it a swipe had to travel the threshold PLUS the slop to dismiss.
 */
export const toastSwipeTravel = (claimDy: number, dy: number): number => claimDy + dy;

/** The haptic a toast plays when it is shown: success and danger are felt, info and warning are not. */
export const toastHaptic = (variant: string | undefined): ToastHaptic | null =>
  variant === 'success' ? 'success' : variant === 'danger' ? 'error' : null;

/**
 * The haptic for a toast being shown, ONCE per toast. A toast can be drawn more than once — a sheet's
 * host takes the queue over the root host and draws the same entries again (`toast-hosts.ts`), and the
 * root draws them again when the sheet closes — and every drawing mounts afresh. The phone must tick
 * on the first only, so the host keeps the ids it has played in `felt` and asks here.
 */
export const takeToastHaptic = (
  felt: Set<number>,
  entry: ToastKeyed & { variant?: string },
): ToastHaptic | null => {
  const kind = toastHaptic(entry.variant);
  if (!kind || felt.has(entry.id)) return null;
  felt.add(entry.id);
  return kind;
};
