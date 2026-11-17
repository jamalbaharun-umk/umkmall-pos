import React from 'react';
import { View, type ViewProps } from 'react-native';
import { contract } from '../contract';
import {
  MESSAGE_AUTHOR,
  MESSAGE_AUTHOR_PULL,
  MESSAGE_AVATAR,
  MESSAGE_CONTENT_ALIGN,
  MESSAGE_CONTENT_GAP,
  MESSAGE_INSET,
  MESSAGE_META_PULL,
  MESSAGE_NAME,
  MESSAGE_ROOT,
} from './message-styles';
import { MessageProvider, SlotText, useDensity, type ChatMessageDensity, type ChatMessageSender } from './message-support';

type Axes = typeof contract.ChatMessage.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface ChatMessageProps extends Omit<ViewProps, 'children'> {
  /** Whose turn this is. Decides the alignment and the fill of any bubble inside. */
  sender?: Of<'sender'>;
  /**
   * How much room the row takes. Omit it inside a transcript and it follows the list; omit it
   * outside one and it takes the standalone default.
   */
  density?: Of<'density'>;
  /** The speaker's face, avatar or initials. This slot supplies only the position and the refusal to shrink. */
  avatar?: React.ReactNode;
  /** The speaker's name, beside the avatar in the author header. A string takes the slot's type. */
  name?: React.ReactNode;
  /** The row-level metadata slot — usually a `ChatMessageMetadata`. Suppressed for a system message. */
  metadata?: React.ReactNode;
  /** Whatever this message is: bubbles, media, a card, a mix. This component takes no message object. */
  children?: React.ReactNode;
}

/**
 * One row of a chat transcript — the native sibling of the web `ChatMessage` (UMK-1129).
 *
 * BUILT AHEAD OF ITS SCREEN, AND ON PURPOSE. Nothing in `apps/mobile` renders this yet and nothing
 * should until the WEB transcript adopts the web sibling: Teman AI's web transcript is hand-drawn
 * and uses none of the message family, so moving the native transcript onto it now would break the
 * parity rule — native would stop matching what the web page actually draws. The playbook is where
 * it lives until then (UMK-878 owns the screen move).
 *
 * THE SPEAKER IS A HEADER ABOVE THE TURN and the user side flips by the column's alignment alone,
 * so the authored order — header, turn, metadata — is identical on both sides of the transcript
 * and a screen reader meets who is talking before what they said.
 *
 * `system` IS NOT A THIRD SPEAKER: it suppresses the avatar, the name and the metadata even when
 * all three are passed, and centres the content.
 *
 * TWO WEB MECHANISMS THAT DO NOT CROSS, and neither is a prop:
 *
 * - The accessible NAME. The web row is an `article` named by `name` or, failing that, the sender.
 *   A React Native `View` carrying an `accessibilityLabel` is not a landmark on either platform —
 *   on Android a labelled container becomes one focus stop whose label REPLACES the text of every
 *   child inside it, so the message itself would go unread. The name reaches a screen reader the
 *   honest way instead: the author header is the first thing in the row.
 * - The marker ATTRIBUTE the web's scroll machinery finds the last message by. A platform list
 *   knows its own last item, so `ChatMessageList` hands that to the frame directly and there is no
 *   attribute for a scroll hook to go looking for.
 */
export const ChatMessage = ({
  sender = 'assistant',
  density,
  avatar,
  name,
  metadata,
  children,
  style,
  ...rest
}: ChatMessageProps) => {
  const resolved = useDensity(density);
  const isSystem = sender === 'system';

  /* Stable across renders, so the provider does not re-render every consumer on an unrelated
     parent update. */
  const value = React.useMemo<{ sender: ChatMessageSender; density: ChatMessageDensity }>(
    () => ({ sender, density: resolved }),
    [sender, resolved],
  );

  return (
    <View
      {...rest}
      style={[MESSAGE_ROOT, { gap: MESSAGE_CONTENT_GAP[resolved], alignItems: MESSAGE_CONTENT_ALIGN[sender] }, style]}
    >
      {!isSystem && (avatar !== undefined || name !== undefined) && (
        <View
          style={[
            MESSAGE_AUTHOR,
            { paddingHorizontal: MESSAGE_INSET[resolved], marginBottom: MESSAGE_AUTHOR_PULL[resolved] },
          ]}
        >
          {avatar !== undefined && <View style={MESSAGE_AVATAR}>{avatar}</View>}
          {name !== undefined && (
            <SlotText role={MESSAGE_NAME.role} color={MESSAGE_NAME.color}>
              {name}
            </SlotText>
          )}
        </View>
      )}
      <MessageProvider value={value}>{children}</MessageProvider>
      {!isSystem && metadata !== undefined && (
        <View style={{ paddingHorizontal: MESSAGE_INSET[resolved], marginTop: MESSAGE_META_PULL[resolved] }}>
          {metadata}
        </View>
      )}
    </View>
  );
};

ChatMessage.displayName = 'ChatMessage';
