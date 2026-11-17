import React from 'react';
import { View, type ViewProps } from 'react-native';
import { contract } from '../contract';
import {
  bubbleStyle,
  MESSAGE_AUTHOR_PULL,
  MESSAGE_BUBBLE_SENDER,
  MESSAGE_BUBBLE_TYPE,
  MESSAGE_INSET,
  MESSAGE_META_PULL,
  MESSAGE_NAME,
} from './message-styles';
import { SlotText, useDensity, useSender } from './message-support';

type Axes = typeof contract.ChatMessageBubble.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface ChatMessageBubbleProps extends ViewProps {
  /** Where this bubble sits in a run from one sender. `none` — the default — keeps all four corners. */
  group?: Of<'group'>;
  /** Escapes the width cap. `auto` is the cap; `full` spans the message column. */
  width?: Of<'width'>;
  /**
   * Drop the fill and the vertical padding, keep the SIDE padding — how a non-bubble child (a media
   * grid, a card) gets its leading edge lined up with the text column above it.
   */
  ghost?: boolean;
  /** A per-bubble name slot, for the first bubble of a grouped run. */
  name?: React.ReactNode;
  /** A per-bubble metadata slot — a timestamp riding the LAST bubble of a run. */
  metadata?: React.ReactNode;
  /** A string takes the bubble's type and its sender's ink; any other node is drawn as handed over. */
  children?: React.ReactNode;
}

/**
 * The visible bubble — the native sibling of the web `ChatMessageBubble` (UMK-1129). Built ahead
 * of its screen; `ChatMessage`'s docblock says why.
 *
 * IT RETURNS A FRAGMENT, NOT A WRAPPER, for the web's reason: the two slots are SIBLINGS of the
 * bubble inside the row's column, so a run of grouped bubbles stays evenly spaced, and each slot
 * pulls most of the column gap back so it reads as part of the bubble it belongs to.
 *
 * IT READS ITS SENDER FROM THE ROW and takes no sender prop at all. Outside a row it draws as the
 * assistant side at the middle density — the standalone default.
 *
 * THE GHOST SELECTS, IT DOES NOT OVERRIDE. `bubbleStyle` takes the transparent fill INSTEAD OF the
 * sender fill and the block padding. On the web that is forced by the class merger (two named
 * padding rungs are not a conflict it can resolve); a React Native style array would resolve an
 * appended override last-wins, so the mechanics are not what carries here — the rule is, and it is
 * written the same way so both platforms read as one decision.
 *
 * A CALLER'S `style` DOES win here, deterministically, and that is the one place native is kinder
 * than the web: the `className` trap in `packages/ui/CLAUDE.md` (two density rungs on one element,
 * the stylesheet's order deciding) cannot happen to a style array. Passing the component's own
 * props is still the way to change a density — a style override is invisible to the parity guard.
 */
export const ChatMessageBubble = ({
  group = 'none',
  width = 'auto',
  ghost = false,
  name,
  metadata,
  children,
  style,
  ...rest
}: ChatMessageBubbleProps) => {
  const sender = useSender();
  const density = useDensity();

  return (
    <>
      {name !== undefined && (
        <View style={{ paddingHorizontal: MESSAGE_INSET[density], marginBottom: MESSAGE_AUTHOR_PULL[density] }}>
          <SlotText role={MESSAGE_NAME.role} color={MESSAGE_NAME.color}>
            {name}
          </SlotText>
        </View>
      )}
      <View {...rest} style={[bubbleStyle({ sender, density, ghost, group, width }), style]}>
        <SlotText role={MESSAGE_BUBBLE_TYPE} color={MESSAGE_BUBBLE_SENDER[sender].ink}>
          {children}
        </SlotText>
      </View>
      {metadata !== undefined && (
        <View style={{ paddingHorizontal: MESSAGE_INSET[density], marginTop: MESSAGE_META_PULL[density] }}>
          {metadata}
        </View>
      )}
    </>
  );
};

ChatMessageBubble.displayName = 'ChatMessageBubble';
