import React from 'react';
import {
  AccessibilityInfo,
  type FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { contract } from '../contract';
import { Text } from './Text';
import type { TextColor, TextRole } from './theme';

/**
 * The chat MESSAGE family's native contexts and helpers (UMK-1129) — the React Native reading of
 * the web's `primitives/ChatMessage/message-context.tsx`.
 *
 * Lowercase, so it is not a component file: `press-states.test.ts` and the playbook guard count
 * capitalised `.tsx` siblings, and nothing here is a component a screen renders on its own.
 *
 * THE SAME SEVERAL CONTEXTS, FOR THE WEB'S REASON. The message context carries who is speaking
 * and how much room the row takes; the list context carries the density alone, so a bubble
 * rendered straight inside a list does not inherit a sender the list has no opinion about. Both
 * return null when absent and nothing throws — a bubble on its own is a legitimate render (the
 * playbook draws dozens) and takes the standalone default.
 */

type MessageAxes = typeof contract.ChatMessage.axes;

export type ChatMessageSender = MessageAxes['sender'][number];
export type ChatMessageDensity = MessageAxes['density'][number];

const MessageContext = React.createContext<{ sender: ChatMessageSender; density: ChatMessageDensity } | null>(null);
const ListContext = React.createContext<{ density: ChatMessageDensity } | null>(null);

export const MessageProvider = MessageContext.Provider;
export const ListProvider = ListContext.Provider;

/** The standalone answers, in one place so no part spells its own default. The web's values. */
export const STANDALONE_SENDER: ChatMessageSender = 'assistant';
export const STANDALONE_DENSITY: ChatMessageDensity = 'balanced';

/**
 * The density a part draws at: its own prop, else the row, else the transcript, else the
 * standalone default. ONE resolver, so no part can spell three of the four steps and silently stop
 * following a transcript that set a density.
 */
export const useDensity = (own?: ChatMessageDensity): ChatMessageDensity => {
  const message = React.useContext(MessageContext);
  const list = React.useContext(ListContext);
  return own ?? message?.density ?? list?.density ?? STANDALONE_DENSITY;
};

/** The sender a part draws as: the row it sits in, else the standalone default. */
export const useSender = (): ChatMessageSender => React.useContext(MessageContext)?.sender ?? STANDALONE_SENDER;

/**
 * THE TRANSCRIPT FRAME'S SEAM — the native shape of the web's `ThreadContext`.
 *
 * On the web the frame owns a scroll box and the list inside it publishes its content element for
 * the frame to observe. On native the PLATFORM LIST IS THE SCROLLER, so the direction of the
 * handoff reverses: the frame publishes the handlers that make up its follow machinery, and the
 * list — the one element that receives scroll, size and layout events — feeds them. The rule the
 * web records survives the reversal intact: this seam is absent-tolerant, a list outside a frame
 * wires nothing and still scrolls, and that tolerance is the hazard — a frame that never mounted
 * its provider leaves the follow inert with nothing throwing. `message-wiring.test.ts` asserts the
 * wiring rather than trusting it.
 */
export interface ThreadSeam {
  /**
   * The list hands the frame its instance, so the frame can scroll it to the end — and `null` when
   * it unmounts, which is the frame's cue to forget everything it knew about THAT list. A host
   * switching conversations by remounting the list (a `key` per conversation) gets a frame that
   * opens the next one following, with no mark carried over from the last.
   */
  attachList: (list: FlatList<unknown> | null) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: (width: number, height: number) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  /**
   * The key of the list's last item (null when it holds none) and its length — how an ARRIVAL is
   * told from growth, a removal or an older page. The rule is `isArrival` in `message-follow.ts`.
   */
  onLastItem: (key: string | null, count: number) => void;
}

const ThreadContext = React.createContext<ThreadSeam | null>(null);

export const ThreadProvider = ThreadContext.Provider;

export const useThreadContext = () => React.useContext(ThreadContext);

/**
 * The platform's reduced-motion setting, live. The same `AccessibilityInfo` pattern `Skeleton`
 * uses: the web expresses reduced motion as a class a guard can read, and the native answer is to
 * ask the platform and stop the animation, not merely slow it.
 */
export const useReducedMotion = (): boolean => {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setReduce(on));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
};

/**
 * A slot's content, with a string given the slot's own type.
 *
 * THE WEB GETS THIS FOR FREE AND NATIVE DOES NOT. A class on the web's slot element styles any
 * text inside it through inheritance; a React Native `Text` inherits nothing from a `View`, and a
 * bare string outside a `Text` is a crash. So a string or a number is wrapped in the slot's type
 * step and ink, and any other node — a caller's own `Text`, a badge, an icon — is left exactly as
 * it was handed over, which is the web's rule for a non-text child too.
 */
export const SlotText = ({
  role,
  color,
  children,
}: {
  role: TextRole;
  color: TextColor;
  children: React.ReactNode;
}) =>
  typeof children === 'string' || typeof children === 'number' ? (
    <Text variant={role} color={color}>
      {children}
    </Text>
  ) : (
    <>{children}</>
  );
