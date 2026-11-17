import React from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { CoinGlyph } from './coin-glyph';
import {
  COIN_CHIP_BALANCE,
  COIN_CHIP_BASE,
  COIN_CHIP_SIZE,
  COIN_CHIP_VARIANT,
  countUpFrame,
  formatCoins,
  hitSlopFor,
} from './identity-card-styles';
import { MOTION, PressableScale, useReducedMotion } from './motion';
import { measure, tokens } from './theme';
import { Text } from './Text';

type Axes = typeof contract.CoinChip.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type CoinChipVariant = Of<'variant'>;
export type CoinChipSize = Of<'size'>;

const VARIANT = COIN_CHIP_VARIANT satisfies Record<CoinChipVariant, unknown>;
const SIZE = COIN_CHIP_SIZE satisfies Record<CoinChipSize, unknown>;

interface CoinChipBase {
  /** `sm` or `md` for the inline chips. `balance` is one size by role (40 pt) and ignores it. */
  size?: CoinChipSize;
  /** Makes the chip a button — the header balance chip opens Profil. */
  onPress?: () => void;
  /** Overrides the announced name (default: the amount and "koin"). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Both variants REQUIRE an amount, and a caller with no price must render no chip at all (identity
 * D6: never a guess). There is no "Gratis" chip: native shows a coin only where the web shows a
 * cost, and the web shows none for a free start (identity §4.2). `null` is the unlimited balance
 * and renders `∞`.
 */
export type CoinChipProps = CoinChipBase & { variant?: CoinChipVariant; amount: number | null };

const EASE = Easing.bezier(...MOTION.easing.standard);

/**
 * The number the chip DRAWS, which on a balance chip trails the value it was handed: a change
 * counts up (or down) over `motion.duration.slow` (§7.2 "Number change"). The first value is
 * drawn as-is — a count-up from zero on mount would announce a change nobody made — and reduced
 * motion skips the count entirely (§7.3 rule 5).
 *
 * The JS driver, necessarily: the animated thing is a STRING in a `Text`, which the native driver
 * cannot reach. It runs only on the one balance chip in a header, never on a list of prices.
 */
const useCountUp = (target: number | null, enabled: boolean): number | null => {
  const [shown, setShown] = React.useState(target);
  const shownRef = React.useRef(target);
  const reduce = useReducedMotion();

  React.useEffect(() => {
    const from = shownRef.current;
    const set = (value: number | null) => {
      shownRef.current = value;
      setShown(value);
    };
    if (!enabled || reduce || from === null || target === null || from === target) {
      set(target);
      return;
    }
    const progress = new Animated.Value(0);
    const id = progress.addListener(({ value }) => set(countUpFrame(from, target, value)));
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: MOTION.duration.slow,
      easing: EASE,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => finished && set(target));
    return () => {
      anim.stop();
      progress.removeListener(id);
    };
  }, [target, enabled, reduce]);

  return shown;
};

/**
 * How far away the coin's flip is seen from. A LAYOUT number, not a motion value: Android draws a
 * `rotateY` with no perspective as a flat squash, so the transform leads with one.
 */
const FLIP_PERSPECTIVE = measure.full;

/**
 * The coin glyph's flip on a balance chip (UMK-1605, UMK-1602 "Coin chip"): when the balance CHANGES
 * the coin turns once about its vertical axis, over `duration.slow`, beside the count-up. Not on
 * mount — the first value changed nothing — and not under reduced motion. A separate native-driver
 * value from the count-up's JS-driver one, on the glyph's own `Animated.View`.
 */
const useCoinFlip = (balance: number | null, enabled: boolean): Animated.Value => {
  const [turn] = React.useState(() => new Animated.Value(0));
  const last = React.useRef(balance);
  const reduce = useReducedMotion();

  React.useEffect(() => {
    const from = last.current;
    last.current = balance;
    if (!enabled || reduce || from === balance) return;
    turn.setValue(0);
    const anim = Animated.timing(turn, { toValue: 1, duration: MOTION.duration.slow, easing: EASE, useNativeDriver: true });
    anim.start();
    /* Stopped mid-turn (Reduce Motion switched on, or unmounted), the coin goes back to face-on. */
    return () => {
      anim.stop();
      turn.setValue(0);
    };
  }, [balance, enabled, reduce, turn]);

  return turn;
};

/**
 * A coin amount: the coin glyph then the number (identity §4.7). Two variants — `price` (the
 * inline cost on a card or a sheet header) and `balance` (the white header chip, which counts up
 * when the balance moves).
 *
 * IT NEVER DECIDES A PRICE. The amount is whatever the caller read from the live price book; this
 * component only draws it, Indonesian-style (`2.813`), through the same rule as the app's
 * `formatCredits`.
 */
export const CoinChip = (props: CoinChipProps) => {
  const { size = 'md', onPress, accessibilityLabel, style, amount } = props;
  const variant: CoinChipVariant = props.variant ?? 'price';
  const isBalance = variant === 'balance';
  const shown = useCountUp(amount, isBalance);
  const turn = useCoinFlip(amount, isBalance);

  const metrics = isBalance ? COIN_CHIP_BALANCE : SIZE[size];
  const paint = VARIANT[variant];
  const label = formatCoins(shown);
  const spoken = accessibilityLabel ?? `${formatCoins(amount)} koin`;

  const body = (
    <View
      testID="coin-chip"
      style={[
        COIN_CHIP_BASE,
        {
          height: metrics.height,
          paddingHorizontal: metrics.paddingHorizontal,
          backgroundColor: paint.bg,
          ...(paint.border ? { borderWidth: tokens.borderWidth.sm, borderColor: paint.border } : {}),
        },
        onPress ? undefined : style,
      ]}
      {...(onPress ? {} : { accessible: true, accessibilityRole: 'text' as const, accessibilityLabel: spoken })}
    >
      <Animated.View
        testID="coin-chip-glyph"
        style={{ transform: [{ perspective: FLIP_PERSPECTIVE }, { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}
      >
        <CoinGlyph size={metrics.glyph} />
      </Animated.View>
      <Text variant={metrics.role} weight={isBalance ? 'bold' : 'semibold'} style={{ color: paint.ink }}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) return body;

  const slop = hitSlopFor(metrics.height);
  return (
    <PressableScale
      scale="default"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      style={[{ alignSelf: 'flex-start' }, style]}
    >
      {body}
    </PressableScale>
  );
};

CoinChip.displayName = 'CoinChip';
