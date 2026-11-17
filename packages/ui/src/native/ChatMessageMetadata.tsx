import React from 'react';
import { Animated, Easing, View, type ViewProps } from 'react-native';
import { contract } from '../contract';
import { isMetadataPresent, MESSAGE_STATUS_DRAWN } from '../shared/message-status';
import { Icon, type IconName } from './Icon';
import {
  MESSAGE_META_DIRECTION,
  MESSAGE_META_GLYPH,
  MESSAGE_META_ROOT,
  MESSAGE_META_SEPARATOR,
  MESSAGE_META_STATUS,
  MESSAGE_META_STATUS_GROUP,
  MESSAGE_META_TYPE,
} from './message-styles';
import { SlotText, useReducedMotion, useSender } from './message-support';
import { Text } from './Text';

type Axes = typeof contract.ChatMessageMetadata.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** The shared glyphs and labels, narrowed to this platform's registry. See `shared/message-status.ts`. */
const DRAWN = MESSAGE_STATUS_DRAWN satisfies Record<Of<'status'>, { icon: IconName; label: string }>;

export interface ChatMessageMetadataProps extends ViewProps {
  /** When the message was sent, already formatted. This component never formats a time. */
  timestamp?: React.ReactNode;
  /** Anything the host wants between the time and the status — a model name, a cost, an action. */
  footer?: React.ReactNode;
  /** Where the message got to. Omit it for a row with no delivery state to report. */
  status?: Of<'status'>;
}

/**
 * The `sending` pulse: opacity down to half and back, the web's `animate-pulse` in shape.
 *
 * UNDER REDUCED MOTION IT DOES NOT RUN AT ALL — the status holds still at full opacity rather than
 * slowing down, which is what the web's `motion-reduce:animate-none` resolves to as well.
 */
const PULSE_LOW = 0.5;
const PULSE_HALF_MS = 1000;

const Pulse = ({ on, children }: { on: boolean; children: React.ReactNode }) => {
  const reduce = useReducedMotion();
  const opacity = React.useRef(new Animated.Value(1)).current;
  const running = on && !reduce;

  React.useEffect(() => {
    if (!running) {
      opacity.setValue(1);
      return;
    }
    const half = (toValue: number) =>
      Animated.timing(opacity, { toValue, duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([half(PULSE_LOW), half(1)]));
    loop.start();
    return () => loop.stop();
  }, [opacity, running]);

  return <Animated.View style={[MESSAGE_META_STATUS_GROUP, { opacity }]}>{children}</Animated.View>;
};

/**
 * The line under a message — the native sibling of the web `ChatMessageMetadata` (UMK-1129). Built
 * ahead of its screen; `ChatMessage`'s docblock says why.
 *
 * IT RENDERS NOTHING WHEN GIVEN NOTHING, a real branch: a caller renders it under every row and
 * most rows have nothing to say.
 *
 * THE SEPARATORS ARE COMPUTED FROM WHAT IS PRESENT — one shared rule (`isMetadataPresent`) on both
 * platforms, so neither draws a dangling dot the other does not.
 *
 * THE LABEL IS USED TWO WAYS HERE, where the web uses it three: the visible word, and — lower-cased
 * — the accessible name of the status group, which is ONE accessibility element so the glyph and
 * its word are announced as one phrase. The third web use, the hover title, has no meaning on
 * touch.
 */
export const ChatMessageMetadata = ({ timestamp, footer, status, style, ...rest }: ChatMessageMetadataProps) => {
  const sender = useSender();

  const pieces: React.ReactNode[] = [];
  if (isMetadataPresent(timestamp))
    pieces.push(
      <SlotText key="time" role={MESSAGE_META_TYPE.role} color={MESSAGE_META_TYPE.color}>
        {timestamp}
      </SlotText>,
    );
  if (isMetadataPresent(footer))
    pieces.push(
      <SlotText key="footer" role={MESSAGE_META_TYPE.role} color={MESSAGE_META_TYPE.color}>
        {footer}
      </SlotText>,
    );
  if (status !== undefined) {
    const { icon, label } = DRAWN[status];
    const drawn = MESSAGE_META_STATUS[status];
    pieces.push(
      <View key="status" accessible accessibilityLabel={label.toLowerCase()} testID={`message-status-${status}`}>
        <Pulse on={drawn.pulse}>
          <Icon name={icon} size={MESSAGE_META_GLYPH} color={drawn.ink} />
          <Text variant={MESSAGE_META_TYPE.role} color={drawn.ink}>
            {label}
          </Text>
        </Pulse>
      </View>,
    );
  }

  if (pieces.length === 0) return null;

  return (
    <View {...rest} style={[MESSAGE_META_ROOT, { flexDirection: MESSAGE_META_DIRECTION[sender] }, style]}>
      {pieces.map((piece, at) => (
        /* The separator belongs BETWEEN two present pieces, so it is emitted from the gap rather than
           from either side of it. The index is a stable key: three fixed slots, built in one pass. */
        <React.Fragment key={at}>
          {at > 0 && (
            <Text
              variant={MESSAGE_META_TYPE.role}
              color={MESSAGE_META_SEPARATOR}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              ·
            </Text>
          )}
          {piece}
        </React.Fragment>
      ))}
    </View>
  );
};

ChatMessageMetadata.displayName = 'ChatMessageMetadata';
