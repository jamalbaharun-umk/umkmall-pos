import { View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { Text } from './Text';
import { measure, tokens } from './theme';

type Axes = typeof contract.ProgressBar.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** The web's Tailwind palette words (`bg-green-500`…), as the surface tokens that render them. */
const VARIANT = {
  default: tokens.surface.default.brand,
  success: tokens.surface.default.success,
  warning: tokens.surface.default.warning,
  error: tokens.surface.default.error,
  gray: tokens.border.default.invert,
/**
 * `gradient` DEGRADES TO ITS FIRST STOP HERE, deliberately and visibly.
 *
 * React Native draws no gradient without a native module, and pulling one in is a rebuild and
 * a device reinstall — the same call `native/index.ts` already recorded for the date picker.
 * The vocabulary stays shared because the contract is one list for both platforms; what
 * differs is the fidelity, and a flat brand fill is the honest reading of a brand sweep rather
 * than an approximation of a second colour nobody asked for. When a screen needs the real
 * thing, it arrives with the module, not by widening this map.
 */
  gradient: tokens.surface.default.brand,
} satisfies Record<Of<'variant'>, string>;

/**
 * The web's `h-3` / `h-2` / `h-1` track thicknesses, off the measurement ladder.
 *
 * `small` is the DEFAULT on both platforms, and it is the value native hardcoded before this
 * axis existed — so adding the axis moves nothing that is already on screen.
 */
const SIZE = {
  large: measure['0-75'],
  medium: measure['0-5'],
  small: measure['0-25'],
} as const satisfies Record<Of<'size'>, number>;

export interface ProgressBarProps {
  variant?: Of<'variant'>;
  /**
   * Track thickness. On the web this axis doubles as the radial gauge's DIAMETER; native
   * publishes no radial shape yet, so here it is a thickness only. See the contract entry's
   * `native.missingAxes` for why the gauge has not been ported.
   */
  size?: Of<'size'>;
  /** Progress value (0–`max`). */
  value?: number;
  max?: number;
  /** Shown above the bar with the percentage. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A progress bar. The percentage is announced as the value, and the label names what is
 * progressing — a bar that says "75" and nothing else is a number without a noun.
 */
export const ProgressBar = ({ variant = 'default', size = 'small', value = 0, max = 100, label, style }: ProgressBarProps) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max, now: value, text: `${Math.round(percentage)}%` }}
      style={style}
    >
      {label && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: tokens.spacing['2xs'] }}>
          <Text variant="paragraph" color="secondary">
            {label}
          </Text>
          <Text variant="paragraph" weight="medium">
            {Math.round(percentage)}%
          </Text>
        </View>
      )}
      <View
        style={{
          alignSelf: 'stretch',
          height: SIZE[size],
          borderRadius: tokens.radius.xs,
          backgroundColor: tokens.surface.default.secondary,
          overflow: 'hidden',
        }}
      >
        <View style={{ width: `${percentage}%`, height: '100%', borderRadius: tokens.radius.xs, backgroundColor: VARIANT[variant] }} />
      </View>
    </View>
  );
};

ProgressBar.displayName = 'ProgressBar';
