import { describe, expect, it } from 'vitest';
import { drawOrder, pruneExited, reconcileShown } from '../toast-exit';

/**
 * The Toaster host's exit queue (UMK-1487), as `Toaster.tsx` drives it: the queue changes, the host
 * reconciles (`reconcileShown`), draws `drawOrder(visible, leaving)`, and prunes an entry when its
 * exit reports done (`pruneExited`). The rendered half — out of the accessibility tree at once, out of
 * the tree after the exit — is `apps/mobile/src/design/__tests__/toaster-exit.test.tsx`.
 *
 * PROVED RED, one injection each, reverted:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `pruneExited` returns `leaving` unchanged (an exit never prunes) | "is gone once its exit ends", "two in a row" |
 * | `reconcileShown` with the `!active` branch removed (an inactive host queues exits) | "an inactive host queues no exit …" |
 * | `reconcileShown` drops `gone` (a dismissed toast skips its exit) | "keeps a dismissed toast drawn while it leaves", "two in a row", "never queues … twice", "draws a new toast beside one still leaving" |
 */

const a = { id: 1 };
const b = { id: 2 };

/** One host pass, as Toaster.tsx runs it. */
const pass = (state: { shown: readonly { id: number }[]; leaving: readonly { id: number }[] }, visible: readonly { id: number }[]) => {
  const next = reconcileShown(state.shown, visible, state.leaving);
  return next ?? state;
};

describe('the toast exit queue', () => {
  it('changes nothing while the visible window is the same', () => {
    expect(reconcileShown([a], [a], [])).toBeNull();
  });

  it('keeps a dismissed toast drawn while it leaves', () => {
    const after = pass({ shown: [a], leaving: [] }, []);
    expect(after.leaving).toEqual([a]);
    expect(drawOrder([], after.leaving)).toEqual([a]);
  });

  it('is gone once its exit ends', () => {
    const leaving = pass({ shown: [a], leaving: [] }, []).leaving;
    expect(drawOrder([], pruneExited(leaving, a))).toEqual([]);
  });

  it('two in a row: both leave, each pruned on its own exit, in raise order meanwhile', () => {
    let state = pass({ shown: [a, b], leaving: [] }, [b]);
    state = pass(state, []);
    expect(drawOrder([], state.leaving)).toEqual([a, b]);
    const afterA = pruneExited(state.leaving, a);
    expect(afterA).toEqual([b]);
    expect(pruneExited(afterA, b)).toEqual([]);
  });

  it('never queues an entry twice while it is already leaving', () => {
    const state = pass({ shown: [a], leaving: [] }, []);
    expect(reconcileShown([a], [], state.leaving)?.leaving).toEqual([a]);
  });

  it('draws a new toast beside one still leaving', () => {
    const state = pass({ shown: [a], leaving: [] }, []);
    const next = pass(state, [b]);
    expect(drawOrder([b], next.leaving)).toEqual([a, b]);
  });

  it('an inactive host queues no exit, and drops any it held', () => {
    /* Another host draws the queue (a sheet's): a toast dismissed meanwhile must not pile up here. */
    expect(reconcileShown([a], [], [], false)).toEqual({ shown: [], leaving: [] });
    expect(reconcileShown([b], [b], [a], false)).toEqual({ shown: [b], leaving: [] });
    expect(reconcileShown([b], [b], [], false)).toBeNull();
  });
});
