/**
 * The transcript's FOLLOW rule and load-older guard, as the native family runs them (UMK-1129).
 *
 * `message-follow.ts` holds the decisions `ChatThread` and `ChatMessageList` make on every scroll
 * event and every edge event, as plain functions, so they load here where `react-native` cannot.
 * The web half is `primitives/ChatMessage/use-chat-stream-scroll.ts` and `ChatMessageList.tsx`,
 * whose behaviour tests in `message.test.tsx` pin the same rules against a DOM; this file pins
 * that the native reading keeps them.
 *
 * WHAT IT CANNOT SEE: that the components CALL these at the right moments. That is
 * `message-wiring.test.ts`'s job, and the playbook's jest render test drives the real list.
 *
 * PROVED RED (2026-09-22), one injection each, applied, run and reverted, written from the failure
 * rather than from the assertion:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `followStep` checks proximity BEFORE the release (a gesture up past the end re-engages) | 1 — release wins |
 * | `followStep` drops the `!atBottom` arm (a content shrink reads as a reader leaving) | 1 — a shrink is not a release |
 * | `FOLLOW_RELOCK` moved to `measure['0-25']` (the reader must hit the exact end to re-engage) | 1 — the web hook's thresholds (the relock case reads the constant, so it moves with it) |
 * | `startLoadOlder` resets `inFlight` before calling (the double load) | 1 — once per arrival |
 * | `startLoadOlder` evaluates the action in the argument position (a sync throw wedges it) | 1 — a sync throw |
 * | `defaultItemKey` prefers `id` over `key` (FlatList's own order reversed) | 1 — FlatList's default |
 * | `isArrival` drops the count half (only "the last key changed") | 2 — a removal; a same-length swap |
 * | `isArrival` drops the key half (only "the count grew") | 1 — an older page |
 */
import { describe, expect, it } from 'vitest';
import { defaultItemKey, FOLLOW_BOTTOM, FOLLOW_RELOCK, followStep, isArrival, startLoadOlder } from '../message-follow';

/** A 1000-tall transcript in a 400-tall viewport: the end is at offset 600. */
const at = (top: number, lastTop: number, locked: boolean) =>
  followStep({ top, lastTop, contentHeight: 1000, viewportHeight: 400, locked });

describe('followStep', () => {
  it('keeps the web hook’s two thresholds', () => {
    expect(FOLLOW_BOTTOM).toBe(4);
    expect(FOLLOW_RELOCK).toBe(32);
  });

  it('releases when the reader moves up and lands away from the end', () => {
    expect(at(500, 600, true)).toBe('release');
  });

  /** A move up that LANDS at the end is a content shrink clamping the offset, not a reader leaving. */
  it('does not release on a move up that lands at the end — a shrink is not a release', () => {
    expect(at(598, 600, true)).toBe('hold');
  });

  it('holds while following and moving down', () => {
    expect(at(600, 500, true)).toBe('hold');
  });

  /** The keyboard opening shrinks the viewport, not the offset: no move up, so no release. */
  it('does not release when only the viewport shrinks', () => {
    expect(followStep({ top: 600, lastTop: 600, contentHeight: 1000, viewportHeight: 100, locked: true })).toBe('hold');
  });

  it('re-engages a released reader within the relock distance, and not beyond it', () => {
    expect(at(600 - FOLLOW_RELOCK, 400, false)).toBe('engage');
    expect(at(600 - FOLLOW_RELOCK - 1, 400, false)).toBe('hold');
  });

  /** Release wins over proximity: a gesture passing near the end on its way UP stays released. */
  it('lets the release win over proximity', () => {
    expect(at(590, 599, false)).toBe('release');
  });
});

describe('startLoadOlder', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('calls the action once per arrival, however many edge events fire meanwhile', async () => {
    let resolveAction!: () => void;
    let calls = 0;
    const action = () => {
      calls++;
      return new Promise<void>((resolve) => {
        resolveAction = resolve;
      });
    };
    const state = { inFlight: false };
    let settled = 0;

    expect(startLoadOlder(state, action, () => settled++)).toBe(true);
    expect(startLoadOlder(state, action, () => settled++)).toBe(false);
    expect(startLoadOlder(state, action, () => settled++)).toBe(false);
    expect(calls).toBe(1);

    resolveAction();
    await flush();
    expect(settled).toBe(1);
    expect(startLoadOlder(state, action, () => settled++)).toBe(true);
    expect(calls).toBe(2);
  });

  it('survives an action that throws synchronously', async () => {
    const state = { inFlight: false };
    let settled = 0;
    expect(
      startLoadOlder(
        state,
        () => {
          throw new Error('host bug');
        },
        () => settled++,
      ),
    ).toBe(true);
    await flush();
    expect(settled).toBe(1);
    expect(state.inFlight).toBe(false);
  });

  it('survives a rejected action', async () => {
    const state = { inFlight: false };
    let settled = 0;
    startLoadOlder(state, () => Promise.reject(new Error('offline')), () => settled++);
    await flush();
    expect(settled).toBe(1);
    expect(state.inFlight).toBe(false);
  });

  it('does nothing with no action — a host dropped it to say there are no older pages', () => {
    const state = { inFlight: false };
    expect(startLoadOlder(state, undefined, () => {})).toBe(false);
    expect(state.inFlight).toBe(false);
  });
});

describe('defaultItemKey', () => {
  it('follows FlatList’s own default: key, else id, else the index', () => {
    expect(defaultItemKey({ key: 'k', id: 'i' }, 3)).toBe('k');
    expect(defaultItemKey({ id: 7 }, 3)).toBe('7');
    expect(defaultItemKey({}, 3)).toBe('3');
    expect(defaultItemKey('plain', 3)).toBe('3');
  });
});

describe('isArrival — a new message at the end, and nothing else', () => {
  const tail = (key: string | null, count: number) => ({ key, count });

  it('is never the first report: that is the conversation as it opened', () => {
    expect(isArrival(undefined, tail('m9', 10))).toBe(false);
  });

  it('is a longer list with a different last item', () => {
    expect(isArrival(tail('m9', 10), tail('m10', 11))).toBe(true);
    /* Index keys append the same way. */
    expect(isArrival(tail('9', 10), tail('10', 11))).toBe(true);
  });

  it('is not a removal — with index keys the last key moves from "9" to "8"', () => {
    expect(isArrival(tail('9', 10), tail('8', 9))).toBe(false);
  });

  it('is not an older page landing above: longer, same last item', () => {
    expect(isArrival(tail('m9', 10), tail('m9', 14))).toBe(false);
  });

  it('is not a same-length swap, nor the last row growing, nor the list emptying', () => {
    expect(isArrival(tail('tmp-1', 10), tail('m10', 10))).toBe(false);
    expect(isArrival(tail('m9', 10), tail('m9', 10))).toBe(false);
    expect(isArrival(tail('m9', 10), tail(null, 0))).toBe(false);
  });
});
