'use client';

import React from 'react';
import { MESSAGE_MARKER } from './message-context';

/**
 * THE LOCK, AND IT IS POSITIONAL RATHER THAN EVENT-SOURCED.
 *
 * A transcript follows a streaming reply until the reader scrolls away from the bottom, and
 * resumes following when they come back. The obvious way to build that is a wheel or touch
 * listener — "the reader did something, stop following" — and it is wrong on both ends: it misses
 * a keyboard scroll and a scrollbar drag entirely, and it fires on a momentum frame the reader did
 * not intend. So the release is decided from POSITION alone.
 *
 * TWO PROPERTIES MAKE THAT WORK, and both are the kind a later simplification removes:
 *
 *  - The hook records its OWN writes into the same position reference it compares against. Without
 *    that, a reader scroll that the next follow frame outruns looks like the position going UP,
 *    and the release never fires — the transcript drags the reader back to the bottom and nothing
 *    anywhere fails.
 *  - "Landed at the bottom" is read from the client height, never the offset height. The offset
 *    variant includes the border and a horizontal scrollbar, so a browser clamping the scroll
 *    position on resize reads as the reader deliberately moving up, and the follow stops mid-reply.
 *
 * IT IS THIS LIBRARY'S FIRST PUBLIC HOOK and gets no contract entry: the contract is
 * component-keyed, and an entry would demand a story file for a thing with nothing to show. The
 * cost is that it is invisible to all six contract guards, which is the same shape as the
 * unfamilied-component hole — so the family's behaviour guard enumerates the barrel's
 * non-component exports, and deleting this one reddens rather than shortening the suite.
 */

/** Within this far of the bottom, a settled scroll re-engages the lock. */
const RELOCK_PX = 32;

/** Within this far of the bottom counts as having landed there. */
const BOTTOM_PX = 4;

/** How much of the remaining distance each follow frame closes. */
const FOLLOW = 0.2;

/**
 * THE ANCHORING SUPPRESSION IS AN ATTRIBUTE PLUS ONE INJECTED RULE, never a write to the element.
 *
 * A browser that anchors scroll position keeps the reader's viewport pinned to the content that
 * was there, which fights every follow frame. Turning it off by writing the element's own property
 * means owning a value the consumer may have set — and "restoring" it later restores whatever this
 * code happened to read, which is not the same thing as leaving it alone. A rule keyed on an
 * attribute this hook adds and removes touches nothing the consumer owns.
 */
const ANCHOR_ATTRIBUTE = 'data-chat-stream-scroll';
const ANCHOR_STYLE_ID = 'chat-stream-scroll-anchoring';

const installAnchorRule = (): void => {
  if (typeof document === 'undefined' || document.getElementById(ANCHOR_STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = ANCHOR_STYLE_ID;
  style.textContent = `[${ANCHOR_ATTRIBUTE}] { overflow-anchor: none; }`;
  document.head.appendChild(style);
};

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export interface ChatStreamScrollOptions {
  /**
   * The element that actually scrolls. The host owns it; this only reads and writes its top.
   *
   * IT IS THE ELEMENT, NOT A REF, AND THAT IS A CORRECTNESS REQUIREMENT RATHER THAN A TASTE.
   * This took a `RefObject` for one run. A ref object's IDENTITY never changes, so the effects
   * below — which early-return on a null scroller — depended on a value that could not tell them
   * the scroller had arrived. A host rendering its scroller unconditionally is fine, because React
   * fills the ref during commit before effects run; a host that renders it behind a loading
   * branch, a `Suspense` boundary or a collapsed panel got a hook that wired NOTHING and stayed
   * that way: the follow never released, the pill never appeared, the reader was dragged to the
   * bottom forever, and nothing threw. A missing wiring read as a successful read of the default,
   * which is the hazard this file's own header names.
   *
   * An element VALUE re-runs every effect the moment it appears or goes away, so the same class of
   * bug is no longer expressible. It also matches `content` below, which was always an element.
   */
  container: HTMLElement | null;
  /**
   * The element whose HEIGHT means "content arrived" — the list's inner element, not the scroll
   * box. The two are different measurements: the scroll box also changes size when the viewport
   * does, and treating that as content would follow on every resize.
   */
  content: HTMLElement | null;
  /**
   * Changes when the transcript becomes a DIFFERENT conversation. Optional, and omitting it is
   * only safe for a host that remounts instead.
   *
   * WITHOUT IT A CONVERSATION SWITCH SPRINGS THROUGH THE WHOLE NEW HISTORY. The first-fill
   * one-shot and the last-message reference are per-mount, so a host that swaps its children from
   * session A to session B without remounting re-enters the GROWTH path: the new transcript
   * animates from wherever the old one sat — precisely the scroll animation the one-shot exists to
   * prevent — and if the swap lands while released, a conversation the reader just opened
   * announces new messages. `/temanai/{id}` to another id is that path, and the app takes it
   * constantly.
   *
   * A host may equally give its frame a React `key` per conversation, which remounts and needs
   * nothing here. This exists because a hook cannot make its caller do that, and the failure is
   * silent when they do not.
   */
  resetKey?: string | number;
  /**
   * Re-pin to the bottom when the SCROLLER ITSELF changes height (a sheet under the phone keyboard), but only for a reader who
   * was at the bottom before it. OPT-IN and false by default: a surface that passes nothing creates no observer and keeps
   * its existing behaviour exactly.
   */
  followResize?: boolean;
}

export interface ChatStreamScroll {
  /** The reader has moved away from the bottom, so the transcript is no longer following. */
  isScrolledUp: boolean;
  /** A message arrived while they were away. Cleared when they get back. */
  hasNewMessages: boolean;
  /** Return to the newest message and resume following. */
  scrollToBottom: () => void;
}

export const useChatStreamScroll = ({
  container,
  content,
  resetKey,
  followResize = false,
}: ChatStreamScrollOptions): ChatStreamScroll => {
  const [isScrolledUp, setIsScrolledUp] = React.useState(false);
  const [hasNewMessages, setHasNewMessages] = React.useState(false);

  const locked = React.useRef(true);
  /** The last position anyone left the scroller at — the READER or this hook. See the file note. */
  const lastTop = React.useRef(0);
  const frame = React.useRef<number | null>(null);
  const firstFill = React.useRef(true);
  const lastMessage = React.useRef<Element | null>(null);

  const cancel = React.useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  /**
   * THE ONE ENTRY POINT. Every caller — first fill, growth, the pill — arrives here, which is what
   * makes the reduced-motion substitution a single branch. Spread across three call sites it would
   * be three branches, and the growth path is the one that gets forgotten: it is the only caller
   * that is not a user action, so it is the only one nobody thinks to try with motion turned off.
   */
  const settle = React.useCallback(
    (instant: boolean) => {
      const element = container;
      if (element === null) return;
      /* ALWAYS, not only on the instant path: a live loop and a fresh assignment fight each other,
         and the loop wins on the next frame — so the jump appears to do nothing. */
      cancel();
      if (instant || prefersReducedMotion()) {
        const target = element.scrollHeight - element.clientHeight;
        element.scrollTop = target;
        lastTop.current = element.scrollTop;
        return;
      }
      const step = () => {
        const live = container;
        /**
         * THE LOOP RUNS ONLY WHILE FOLLOWING, and this is the line that makes that true.
         *
         * Without it a release mid-stream left the loop alive: the reader scrolled up, the pill
         * appeared telling them they were away, and the next frames dragged them back to the
         * bottom anyway. Measured at 1100 -> 2780 over five frames.
         *
         * The check lives HERE rather than as a `cancel()` inside `release()` on purpose. Stated
         * as the loop's own precondition it holds for every path that clears the lock, including
         * one a later change adds and forgets to cancel from — where a cancel in today's single
         * release path would have to be remembered again.
         */
        /* The null arm stays even though the element is now captured rather than re-read: the
           callback is rebuilt when the scroller changes, and a queued frame from the previous one
           must not write to an element the host has taken away. */
        if (live === null || !locked.current) {
          frame.current = null;
          return;
        }
        const target = live.scrollHeight - live.clientHeight;
        const remaining = target - live.scrollTop;
        if (remaining < 1) {
          live.scrollTop = target;
          lastTop.current = live.scrollTop;
          frame.current = null;
          return;
        }
        live.scrollTop = live.scrollTop + remaining * FOLLOW;
        /* The hook's own write, recorded where the reader's would be. This is the line that keeps a
           reader scroll detectable when the next frame outruns it. */
        lastTop.current = live.scrollTop;
        frame.current = requestAnimationFrame(step);
      };

      frame.current = requestAnimationFrame(step);
    },
    [cancel, container],
  );

  const release = React.useCallback(() => {
    locked.current = false;
    setIsScrolledUp(true);
  }, []);

  const engage = React.useCallback(() => {
    locked.current = true;
    setIsScrolledUp(false);
    setHasNewMessages(false);
  }, []);

  const scrollToBottom = React.useCallback(() => {
    engage();
    settle(false);
  }, [engage, settle]);

  /**
   * The scroll seam itself: the release, the re-engage, and the anchoring attribute.
   *
   * BOTH DECISIONS COME FROM POSITION, ON ONE EVENT. The re-engage rode `scrollend` for one run,
   * which reads as the more precise signal and is the wrong one: WebKit shipped that event in
   * Safari 18.2, so on anything older `engage()` had no non-manual caller at all — a reader who
   * scrolled back to the bottom never resumed following and the pill never cleared. The plan
   * promises the opposite, and nothing failed.
   *
   * Deciding both from the scroll position needs no event that might not exist and no feature
   * detection. The cost is that a re-engage can land on a passing frame rather than only on a
   * settled scroll, which is the behaviour the surfaces this replaces already have.
   */
  React.useEffect(() => {
    const element = container;
    if (element === null) return;
    installAnchorRule();

    const onScroll = () => {
      const top = element.scrollTop;
      /* CLIENT HEIGHT, NEVER OFFSET HEIGHT — see the file note. The offset variant turns a resize
         clamp into a reader intent, and the follow stops mid-reply. */
      const distance = element.scrollHeight - top - element.clientHeight;
      const atBottom = distance <= BOTTOM_PX;
      /* Release first: a reader moving away wins over the proximity test below, so a gesture that
         passes near the bottom on its way up does not re-engage on the same event.

         A CONTENT SHRINK RE-ENGAGES A READER WHO NEVER MOVED, AND THAT IS THE INTENDED READING.
         A streaming placeholder replaced by a shorter message clamps the scroll position down, so
         the event arrives as a move away that has LANDED at the bottom — the first arm refuses it
         and the proximity arm resumes following with no gesture. It is the mirror of the resize
         clamp the release deliberately ignores, and the same justification holds: position is the
         whole signal, and they are at the bottom now. Pinned by a test rather than left to be
         rediscovered as a surprise. */
      if (top < lastTop.current && !atBottom) release();
      else if (!locked.current && distance <= RELOCK_PX) engage();
      lastTop.current = top;
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
    };
  }, [container, engage, release]);

  /* The attribute rides the lock: suppressed while following, handed back the moment it releases. */
  React.useEffect(() => {
    const element = container;
    if (element === null) return;
    if (isScrolledUp) element.removeAttribute(ANCHOR_ATTRIBUTE);
    else element.setAttribute(ANCHOR_ATTRIBUTE, '');
    /* Handed back on unmount too. The scroller is this frame's own element today, so it leaves
       with the attribute either way — but a host that passes a ref to an element it owns and
       outlives would keep the suppression forever, and the cleanup costs a line. */
    return () => element.removeAttribute(ANCHOR_ATTRIBUTE);
  }, [container, isScrolledUp]);

  /**
   * GROWTH. The first fill jumps in one frame — springing from the top of a restored conversation
   * is a scroll animation nobody asked for — and every later change follows.
   *
   * THE NEW-MESSAGE FLAG IS RAISED BY A CHANGE OF THE LAST MESSAGE ELEMENT, not by the height
   * moving. A streaming reply grows continuously, so a height-keyed flag would announce a new
   * message on every token while the reader is reading something else.
   */
  React.useEffect(() => {
    if (content === null) return;
    const observer = new ResizeObserver(() => {
      const messages = content.querySelectorAll(`[${MESSAGE_MARKER}]`);
      const last = messages.length === 0 ? null : messages[messages.length - 1];
      const arrived = last !== lastMessage.current;
      lastMessage.current = last;

      if (locked.current) {
        /**
         * THE ONE-SHOT IS SPENT ONLY ON A FILL THAT HAS SOMEWHERE TO GO.
         *
         * The observer delivers an initial observation on `observe()`, and this content element is
         * never zero-height even when empty — it carries the density padding and the alignment
         * spacer. So an unconditional spend burned the jump at mount, and the real first fill then
         * animated from the top: the exact scroll animation the one-shot exists to prevent, on the
         * commonest mount order there is (an empty transcript that loads its history).
         */
        const live = container;
        const scrollable = live !== null && live.scrollHeight - live.clientHeight > 0;
        settle(firstFill.current && scrollable);
        if (scrollable) firstFill.current = false;
        return;
      }
      if (arrived) setHasNewMessages(true);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [container, content, settle]);

  /**
   * THE SCROLLER ITSELF RESIZING, which is what an on-screen keyboard does to a sheet. Only when `followResize` is on.
   *
   * The growth observer above watches the CONTENT, so a scroller that shrinks under a reader who was
   * following never moved the newest message: its top stayed where it was and the last line slid
   * below the new, shorter edge, hidden until the next message arrived. A resize fires no scroll
   * event either (the position did not change), so nothing else notices.
   *
   * RE-PIN ONLY A READER WHO WAS AT THE BOTTOM BEFORE THE RESIZE, measured against the PREVIOUS
   * client height: the distance the reader had, not the one the resize just made. A reader who had
   * scrolled up stays exactly where they are.
   */
  React.useEffect(() => {
    const element = container;
    if (element === null || !followResize) return;
    let lastClient = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const client = element.clientHeight;
      if (client === lastClient) return;
      const wasAtBottom = element.scrollHeight - element.scrollTop - lastClient <= BOTTOM_PX;
      lastClient = client;
      if (!wasAtBottom) return;
      cancel();
      element.scrollTop = element.scrollHeight - client;
      lastTop.current = element.scrollTop;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container, cancel, followResize]);

  /**
   * THE RESET, AND IT DELIBERATELY RE-ENGAGES. A new conversation starts at its newest message
   * following, which is where a reader opening one expects to be — carrying the old one's released
   * state over would open the new transcript scrolled up, with a pill offering to take them
   * somewhere they have never been.
   *
   * Keyed on `resetKey` alone: it does not run on mount, because the mount path already starts in
   * exactly this state and spending the one-shot here would burn the first fill.
   */
  const firstReset = React.useRef(true);
  React.useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    cancel();
    firstFill.current = true;
    lastMessage.current = null;
    engage();
  }, [resetKey, cancel, engage]);

  React.useEffect(() => cancel, [cancel]);

  return { isScrolledUp, hasNewMessages, scrollToBottom };
};
