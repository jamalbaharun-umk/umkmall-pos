import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { ChatSoundWave } from './ChatSoundWave';
import { Icon, type IconSize } from './Icon';
import { Text } from './Text';
import { tokens, type TextRole } from './theme';

type Axes = typeof contract.ChatVoiceBar.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface ChatVoiceBarProps {
  /** Which icon row this bar is standing in for — it is the bar's height, not a general scale. */
  size: Of<'size'>;
  /** What the bar says it is doing. The caller's, because it is the only copy on the row. */
  label: string;
  /** The accessible name of the stop control, which is a different sentence from `label`. */
  stopLabel: string;
  /** Halts the recording. The bar never stops anything itself. */
  onStop: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Everything on this row is sized from the row, so the two heights drive ONE table.
 *
 * `satisfies Record<Of<'size'>, …>` rather than a local keyset: a third value added to the
 * contract must red here, which is the coupling the whole package is built on.
 */
const SIZED = {
  compact: { bar: 32, puck: 24, glyph: 'xs', stop: 20, role: 'bodyLg' },
  landing: { bar: 36, puck: 32, glyph: 'sm', stop: 28, role: 'paragraph' },
} as const satisfies Record<
  Of<'size'>,
  { bar: number; puck: number; glyph: IconSize; stop: number; role: TextRole }
>;

/**
 * The row the composer shows in place of its icon row while the microphone is open.
 *
 * NO HALO HERE, and that is a recorded difference rather than an omission: the web pings a ring
 * behind the puck with `animate-ping`, which on native would be a third animated value running
 * for the whole recording next to five others. The shipped mobile bar draws the ring STATIC for
 * exactly that reason, and this mirrors it — a static ring reads as part of the puck, where a
 * missing one would read as a smaller button.
 *
 * `accessibilityLiveRegion="polite"` is the native half of the web's `aria-live`: the bar appears
 * mid-composition, takes no focus, and replaces the controls a reader was about to reach for.
 */
export const ChatVoiceBar = ({ size, label, stopLabel, onStop, style }: ChatVoiceBarProps) => {
  const sized = SIZED[size];
  return (
    <View accessibilityLiveRegion="polite" style={[styles.bar, { height: sized.bar }, style]}>
      <View style={styles.puckBox}>
        <View style={[styles.ring, { width: sized.puck, height: sized.puck }]} />
        <View style={[styles.puck, { width: sized.puck, height: sized.puck }]}>
          {/* From the registry, never redrawn here — the app inlined this artwork at both of its
              call sites and the two copies had already diverged. */}
          <Icon name="composer-mic" size={sized.glyph} color="invert" />
        </View>
      </View>

      <View style={styles.middle}>
        <Text variant={sized.role} weight="medium" style={styles.label}>
          {label}
        </Text>
        <ChatSoundWave state="listening" />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={stopLabel}
        onPress={onStop}
        style={[styles.stop, { width: sized.stop, height: sized.stop }]}
      >
        {/* A PAUSE on the error fill: red says "this is recording", the shape says it halts
            rather than being discarded. The label carries the action, never the glyph. */}
        <Icon name="pause" size="xs" color="invert" />
      </Pressable>
    </View>
  );
};

ChatVoiceBar.displayName = 'ChatVoiceBar';

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.sm,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.default.brand,
    backgroundColor: tokens.surface.weak.brand,
    paddingHorizontal: tokens.spacing.sm,
  },
  puckBox: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderRadius: tokens.radius.full, backgroundColor: tokens.surface.weak.brand },
  puck: { borderRadius: tokens.radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.surface.default.brand },
  middle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, minWidth: 0 },
  label: { color: tokens.text.default.brand },
  stop: { borderRadius: tokens.radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.surface.default.error },
});
