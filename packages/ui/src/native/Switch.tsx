import React from 'react';
import { Animated, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { labelText, useFieldIds } from './field-support';
import { Spinner } from './Spinner';
import { Text } from './Text';
import { measure, tokens } from './theme';

type Axes = typeof contract.Switch.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * track / thumb per size, as the web's `h-8 w-14` … `h-5 w-9`. The thumb's travel is
 * DERIVED — track width minus both edges minus the thumb — rather than a third table entry,
 * so a resized track cannot leave the thumb short of the far edge.
 */
const SIZE = {
  large: { trackW: measure['3-5'], trackH: measure['2'], thumb: measure['1-5'] },
  medium: { trackW: measure['2-75'], trackH: measure['1-5'], thumb: measure['1'] },
  small: { trackW: measure['2-25'], trackH: measure['1-25'], thumb: measure['0-75'] },
} satisfies Record<Of<'size'>, { trackW: number; trackH: number; thumb: number }>;

/** `border-2` plus `p-ds-5xs` on the web: the inset from track edge to thumb. */
const EDGE = 2 + tokens.spacing['5xs'];

export interface SwitchProps extends Omit<PressableProps, 'style' | 'children' | 'disabled'> {
  /**
   * The label does NOT change with state — "Notifikasi" stays "Notifikasi" whether the
   * switch is on or off. The accessible state already says which way it is set.
   */
  label: React.ReactNode;
  size?: Of<'size'>;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** An in-flight change has to be visible AND perceivable — `busy`, not colour alone. */
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Figma and the reference design system both call this Toggle. Same component, different
 * word — see the recorded divergence. NO `error`, NO `required`: a control that applies
 * instantly has nothing to validate against.
 */
export const Switch = ({
  label,
  nativeID,
  size = 'medium',
  checked,
  defaultChecked = false,
  onCheckedChange,
  loading,
  disabled,
  style,
  onPress,
  ...props
}: SwitchProps) => {
  const { fieldId, labelId } = useFieldIds(nativeID);
  const [internal, setInternal] = React.useState(defaultChecked);
  const isOn = checked ?? internal;
  const { trackW, trackH, thumb } = SIZE[size];
  const travel = trackW - EDGE * 2 - thumb;
  const inert = Boolean(disabled || loading);

  const position = React.useRef(new Animated.Value(isOn ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(position, { toValue: isOn ? 1 : 0, duration: 150, useNativeDriver: true }).start();
  }, [isOn, position]);

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing['2xs'] }, style]}>
      <Pressable
        {...props}
        nativeID={fieldId}
        accessibilityRole="switch"
        accessibilityLabel={labelText(label)}
        accessibilityLabelledBy={labelId}
        accessibilityState={{ checked: isOn, disabled: inert, busy: Boolean(loading) }}
        disabled={inert}
        onPress={(e) => {
          if (checked === undefined) setInternal(!isOn);
          onCheckedChange?.(!isOn);
          onPress?.(e);
        }}
        style={{
          width: trackW,
          height: trackH,
          borderRadius: tokens.radius.full,
          padding: EDGE,
          justifyContent: 'center',
          /**
           * ONE resolution from on-ness and inertness together — the same shape the web
           * sibling now uses. `isOn && !disabled` said a locked-ON switch is OFF, which is
           * the defect stated outright: the user was told a setting was off while it was on.
           * The contract carries no colour dimension, so fixing one surface and not the
           * other reds nothing and the divergence is undiscoverable (UMK-1091 KTD2).
           */
          backgroundColor: inert
            ? isOn
              ? tokens.surface.disable.brand
              : tokens.surface.disable.primary
            : isOn
              ? tokens.surface.default.brand
              : tokens.surface.default.secondary,
        }}
      >
        <Animated.View
          style={{
            width: thumb,
            height: thumb,
            borderRadius: tokens.radius.full,
            backgroundColor: tokens.surface.default.primary,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) }],
          }}
        >
          {loading && <Spinner size="sm" variant="primary" label="" style={{ width: thumb, height: thumb }} />}
        </Animated.View>
      </Pressable>
      {/* The label goes pale with the track — Figma `05 Toggle` 775:3361 paints it `#c3cbd3`
          in both disabled variants. Same rule as the web sibling, keyed on the same `inert`. */}
      <Text
        nativeID={labelId}
        variant="paragraph"
        color={inert ? 'disable' : 'primary'}
        style={{ flexShrink: 1 }}
      >
        {label}
      </Text>
    </View>
  );
};

Switch.displayName = 'Switch';
