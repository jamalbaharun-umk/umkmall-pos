import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { tokens, type TextColor } from './theme';

type Axes = typeof contract.ChatMessageTTSButton.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * WHAT EACH STATE DRAWS — the native reading of `MESSAGE_TTS_STATE`.
 *
 * `idle` alone rests on nothing and takes the secondary ink; the other four take a weak fill,
 * because a control that is doing something has to be findable in a row of five identical grey
 * glyphs. The hues are the SUCCESS and WARNING tokens rather than the teal and orange both live
 * surfaces paint — see the contract entry's second divergence, which records the four hexes that
 * move and why a raw palette step is not sayable in this package.
 *
 * `backgroundColor: 'transparent'` on idle is written out rather than omitted: a key missing from
 * one row of a `satisfies Record<…>` table is legal, and the resulting style object then inherits
 * whatever the previous render left, which is the kind of difference no assertion here can see.
 */
const STATE = {
  idle: { backgroundColor: 'transparent', ink: 'secondary' },
  loading: { backgroundColor: tokens.surface.weak.success, ink: 'success' },
  playing: { backgroundColor: tokens.surface.weak.success, ink: 'success' },
  paused: { backgroundColor: tokens.surface.weak.warning, ink: 'warning' },
  error: { backgroundColor: tokens.surface.weak.error, ink: 'error' },
} as const satisfies Record<Of<'state'>, { backgroundColor: string; ink: TextColor }>;

export interface ChatMessageTTSButtonProps {
  /** Where playback has got to. The host's state machine owns it; this draws it. */
  state: Of<'state'>;
  /**
   * The accessible name FOR THIS STATE — "Dengarkan", "Jeda", "Lanjutkan", "Memproses…".
   *
   * Required and caller-supplied: the same control means four different actions depending on
   * `state`, so a component that drew its own word would announce the wrong one four times out
   * of five, in a language it does not own.
   */
  label: string;
  /** Toggles playback. Never called while `loading`, which the button refuses on its own. */
  onToggle: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The per-message LISTEN control.
 *
 * IT OWNS NO AUDIO. Fetching the speech, caching it, playing the chunks in order and making sure
 * only one message speaks at a time is host machinery — `apps/mobile`'s `useTts` on this platform,
 * a different hook on the web — and none of it belongs to a design system.
 *
 * `loading` REFUSES THE PRESS ITSELF rather than leaving it to the caller, and says so through
 * `accessibilityState` as well as by ignoring the tap: a second tap while the speech is still
 * being fetched starts a second fetch against a control that already looks busy.
 */
export const ChatMessageTTSButton = ({
  state,
  label,
  onToggle,
  disabled,
  style,
}: ChatMessageTTSButtonProps) => {
  const drawn = STATE[state];
  const off = disabled || state === 'loading';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, selected: state !== 'idle' }}
      disabled={off}
      onPress={onToggle}
      hitSlop={tokens.spacing['2xs']}
      style={[styles.button, { backgroundColor: drawn.backgroundColor }, style]}
    >
      {state === 'loading' ? (
        /* `label=""` — the control already carries the accessible name, and a spinner announcing
           a second one would make it read as two things. */
        <Spinner size="sm" variant="primary" label="" />
      ) : (
        <Icon name={state === 'playing' ? 'pause' : 'speaker'} size="sm" color={drawn.ink} />
      )}
    </Pressable>
  );
};

ChatMessageTTSButton.displayName = 'ChatMessageTTSButton';

const styles = StyleSheet.create({
  /**
   * `p-ds-3xs rounded-ds-sm` around the 16 glyph — a 28px box, the same as the web and the same as
   * both live surfaces. `hitSlop` below takes the TOUCH target past it; the drawn box is what has
   * to match, and 2px padding drew a 20px one on both platforms.
   */
  button: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: tokens.spacing['3xs'],
    borderRadius: tokens.radius.sm,
  },
});
