import React from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { tokens } from './theme';

type Axes = typeof contract.ChatSoundWave.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface ChatSoundWaveProps {
  /** Whether the bars are moving. Defaults to `listening`, which is when this is ever mounted. */
  state?: Of<'state'>;
  /** How many bars. A quantity rather than a look — see the contract entry. */
  bars?: number;
  style?: StyleProp<ViewStyle>;
}

/** The web's `0.5s` keyframe, split into its two halves, and the per-bar delay that staggers it. */
const HALF_MS = 250;
const STAGGER_MS = 100;
const RESTING = 0.3;

/**
 * The five bars that say a microphone is open — the native reading of `ChatSoundWave`.
 *
 * ONE ANIMATED VALUE PER BAR, driven natively. The web gets its stagger free from five
 * `animation-delay` values on one keyframe; here the delay has to be a step inside each bar's own
 * sequence, and the trailing delay is what makes the five loops the SAME length — without it a
 * bar that started later also finishes its cycle later, and after a few seconds the waveform has
 * drifted into noise rather than a wave.
 *
 * `useNativeDriver` because every animated property here is a transform. A width or a height
 * could not be driven natively at all, which is the other half of the reason the web animates
 * `scaleY` too.
 *
 * `accessibilityElementsHidden` / `importantForAccessibility`, unconditionally: it is decoration
 * for a state the row around it already announces.
 */
export const ChatSoundWave = ({ state = 'listening', bars = 5, style }: ChatSoundWaveProps) => {
  const values = React.useMemo(
    () => Array.from({ length: bars }, () => new Animated.Value(RESTING)),
    [bars],
  );

  React.useEffect(() => {
    if (state !== 'listening') {
      for (const value of values) value.setValue(RESTING);
      return;
    }
    const tail = Math.max(0, (bars - 1) * STAGGER_MS);
    const loops = values.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * STAGGER_MS),
          Animated.timing(value, { toValue: 1, duration: HALF_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(value, { toValue: RESTING, duration: HALF_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay(tail - i * STAGGER_MS),
        ]),
      ),
    );
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
    };
  }, [state, values, bars]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.wave, style]}
    >
      {values.map((value, i) => (
        <Animated.View key={i} style={[styles.bar, { transform: [{ scaleY: value }] }]} />
      ))}
    </View>
  );
};

ChatSoundWave.displayName = 'ChatSoundWave';

const styles = StyleSheet.create({
  /** `flex h-4 items-center gap-0.5` — 16 tall, 2 between. */
  wave: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing['5xs'], height: 16 },
  /** `h-full w-1 rounded-full bg-default-brand`. The bar owns its height so `scaleY` has a box. */
  bar: { width: 4, height: 16, borderRadius: tokens.radius.full, backgroundColor: tokens.surface.default.brand },
});
