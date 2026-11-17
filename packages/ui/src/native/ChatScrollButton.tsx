import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { Icon } from './Icon';
import {
  MESSAGE_SCROLL_BUTTON,
  MESSAGE_SCROLL_BUTTON_BADGE,
  MESSAGE_SCROLL_BUTTON_FILL,
  MESSAGE_SCROLL_BUTTON_GLYPH,
  MESSAGE_SCROLL_BUTTON_HIT_SLOP,
  MESSAGE_SCROLL_BUTTON_SHAPE,
  MESSAGE_SCROLL_BUTTON_TYPE,
} from './message-styles';
import { Text } from './Text';

type Axes = typeof contract.ChatScrollButton.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * What the pill's accessible name gains while a new message is waiting — the SPOKEN half of the
 * mark. No web equivalent exists to copy: the web pill's name never changes because the web's log
 * region reads each arriving row aloud, which native deliberately does not do (see
 * `ChatMessageList`). Lowercase because it follows the label after a comma.
 */
export const NEW_MESSAGES_LABEL = 'ada pesan baru';

export interface ChatScrollButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  /**
   * The accessible name, and REQUIRED. A pill that cannot be announced is a control a
   * screen-reader user meets as "button".
   */
  label: string;
  /**
   * Which geometry to draw. `icon` — the default — is a circle holding a glyph and shows no text,
   * because a translated string inside a 36pt circle clips. `labelled` expands and puts the glyph
   * in front of the words.
   */
  shape?: Of<'shape'>;
  /**
   * A message arrived while the reader was away. Draws a textless mark for the eye AND extends the
   * accessible name with `newMessagesLabel`, so a screen reader meets the same news.
   */
  hasNewMessages?: boolean;
  /**
   * What the accessible name gains while `hasNewMessages` is set, after a comma — "Ke pesan
   * terbaru, ada pesan baru" by default. The host's copy, like `label`.
   */
  newMessagesLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The return-to-bottom pill — the native sibling of the web `ChatScrollButton` (UMK-1129). Built
 * ahead of its screen; `ChatMessage`'s docblock says why.
 *
 * PRESENTATIONAL. It knows nothing about scrolling: `ChatThread` decides when it appears and what
 * pressing it does, which is what lets a surface render its own pill in the same slot.
 *
 * `onPress`, NOT `onClick` — the platform's own name for the web's handler, the rename every native
 * sibling makes (`TextField` takes `onChangeText`). It is a rename, not a gap.
 *
 * `pressed` STANDS WHERE THE WEB HAS `hover`, the rule `Button` and `Menu` follow: the web pill
 * lightens to the neutral hover surface under a pointer, and a finger gets the same surface while
 * it is down. That makes this a pressed treatment, so the playbook owes it a pressed specimen and
 * `press-states.test.ts` lists it.
 *
 * THE MARK CARRIES NO TEXT and is hidden from assistive technology, for the web's reason — a count
 * would be copy in a language this component does not own. What a screen reader gets instead is the
 * NAME: while `hasNewMessages` is set the pill is "Ke pesan terbaru, ada pesan baru", so a reader who
 * finds the pill finds the news with it. (The one-shot announcement when the message lands is the
 * frame's — `ChatThread` — because only the frame knows it arrived.)
 *
 * THE TOUCH TARGET IS 48 AND THE DRAWING IS 36. `hitSlop` grows the target to the platform minimum
 * (Android's 48, past iOS's 44) without growing the circle, which stays the web's size. A caller's
 * own `hitSlop` wins.
 *
 * AUTOCAPTURE. A touch here records the props of every ANCESTOR, and the pill sits inside the
 * transcript frame. This component carries no user text of its own — the label is the host's copy,
 * the same string on every screen — so it needs no marker; what needs one is the frame around it,
 * which a host marks by spreading `apps/mobile`'s `noCapture` onto `ChatThread` (it forwards every
 * view prop to its root). One marker there covers the list and this pill together.
 */
export const ChatScrollButton = ({
  label,
  shape = 'icon',
  hasNewMessages = false,
  newMessagesLabel = NEW_MESSAGES_LABEL,
  style,
  hitSlop,
  ...props
}: ChatScrollButtonProps) => (
  <Pressable
    {...props}
    hitSlop={hitSlop ?? MESSAGE_SCROLL_BUTTON_HIT_SLOP}
    accessibilityRole="button"
    accessibilityLabel={hasNewMessages ? `${label}, ${newMessagesLabel}` : label}
    style={({ pressed }) => [
      MESSAGE_SCROLL_BUTTON,
      MESSAGE_SCROLL_BUTTON_SHAPE[shape],
      { backgroundColor: pressed ? MESSAGE_SCROLL_BUTTON_FILL.pressed : MESSAGE_SCROLL_BUTTON_FILL.rest },
      style,
    ]}
  >
    <Icon name="chevron-down" size={MESSAGE_SCROLL_BUTTON_GLYPH.size} color={MESSAGE_SCROLL_BUTTON_GLYPH.color} />
    {shape === 'labelled' && (
      /* The pill already carries the name; the visible word must not be announced a second time. */
      <Text
        variant={MESSAGE_SCROLL_BUTTON_TYPE.role}
        color={MESSAGE_SCROLL_BUTTON_TYPE.color}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </Text>
    )}
    {hasNewMessages && (
      <View
        testID="chat-scroll-button-mark"
        style={MESSAGE_SCROLL_BUTTON_BADGE}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    )}
  </Pressable>
);

ChatScrollButton.displayName = 'ChatScrollButton';
