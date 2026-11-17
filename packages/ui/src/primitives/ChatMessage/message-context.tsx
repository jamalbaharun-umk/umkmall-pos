'use client';

import React from 'react';
import { contract } from '../../contract';

type MessageAxes = typeof contract.ChatMessage.axes;

export type ChatMessageSender = MessageAxes['sender'][number];
export type ChatMessageDensity = MessageAxes['density'][number];

/**
 * THE FAMILY'S CONTEXTS, AND THERE ARE SEVERAL ON PURPOSE.
 *
 * The message context carries who is speaking and how much room the row takes; the list context
 * carries the density alone. Collapsing them into one would mean a bubble rendered directly inside
 * a list — no message row around it — inheriting a sender the list has no business having an
 * opinion about, and every list would have to invent one.
 *
 * BOTH RETURN NULL WHEN ABSENT, AND NOTHING THROWS. A bubble on its own is a legitimate thing to
 * render: a docs page, a story, a hand-built row. It reads as the assistant side at the middle
 * density, which is the standalone default, rather than crashing on a provider a caller had no
 * reason to mount. That is the opposite call from a compound control whose parts are meaningless
 * apart — these parts are all independently useful, which is the whole reason they are exported.
 */
const MessageContext = React.createContext<{
  sender: ChatMessageSender;
  density: ChatMessageDensity;
} | null>(null);

const ListContext = React.createContext<{ density: ChatMessageDensity } | null>(null);

export const MessageProvider = MessageContext.Provider;
export const ListProvider = ListContext.Provider;

/** The row a part sits in, or null when it stands alone. */
export const useMessageContext = () => React.useContext(MessageContext);

/** The transcript a row sits in, or null when the row stands alone. */
export const useListContext = () => React.useContext(ListContext);

/** The standalone answers, in one place so no consumer spells its own default. */
export const STANDALONE_SENDER: ChatMessageSender = 'assistant';
export const STANDALONE_DENSITY: ChatMessageDensity = 'balanced';

/**
 * The density a part should draw at: its own prop, else the row it sits in, else the transcript
 * around that, else the standalone default.
 *
 * ONE RESOLVER RATHER THAN FOUR COPIES OF THE LADDER. Each part would otherwise spell the same
 * four-step fallback, and a part that spelled three of them would silently stop following a
 * transcript that had set a density — which draws correctly in every story and wrong in the one
 * place it matters.
 */
export const useDensity = (own?: ChatMessageDensity): ChatMessageDensity => {
  const message = useMessageContext();
  const list = useListContext();
  return own ?? message?.density ?? list?.density ?? STANDALONE_DENSITY;
};

/** The sender a part should draw as: the row it sits in, else the standalone default. */
export const useSender = (): ChatMessageSender => useMessageContext()?.sender ?? STANDALONE_SENDER;

/**
 * THE MARKER THE SCROLL MACHINERY FINDS THE LAST MESSAGE BY, as ONE constant.
 *
 * The frame reads the last message element through this attribute to notice that a NEW message
 * arrived rather than that the existing one grew. Two spellings would compile, render, and leave
 * the new-message flag and the jump-to-last permanently inert with nothing failing — so the row
 * renders it from here and the family's behaviour guard asserts it is present.
 */
export const MESSAGE_MARKER = 'data-chat-message';

/**
 * THE TRANSCRIPT FRAME'S SEAM, and it is deliberately absent-tolerant.
 *
 * A list rendered inside a frame publishes its inner content element here so the scroll owner can
 * watch that grow; a list rendered anywhere else registers nothing and still works. That
 * tolerance is also the hazard: a missing provider is a SUCCESSFUL read of the default, so a frame
 * that never mounted one would leave the scroll machinery permanently inert with nothing throwing
 * and nothing blank. The family's behaviour guard asserts the WIRING rather than trusting it.
 */
const ThreadContext = React.createContext<{
  /**
   * The element that actually scrolls. The list roots its top sentinel on it when present.
   *
   * AN ELEMENT, NOT A REF, for the same reason `useChatStreamScroll` takes one: a ref object's
   * identity never changes, so a consumer whose effect early-returns on a null scroller had
   * nothing that could tell it the scroller arrived. Publishing the element means this seam
   * object's own identity changes when it does, and every consumer's effect re-runs.
   */
  scrollContainer: HTMLElement | null;
  /** Called with the list's inner content element, and with null when it unmounts. */
  registerContent: (element: HTMLElement | null) => void;
} | null>(null);

export const ThreadProvider = ThreadContext.Provider;

export const useThreadContext = () => React.useContext(ThreadContext);
