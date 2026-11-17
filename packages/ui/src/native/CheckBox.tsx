import React from 'react';
import { Animated, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { Icon, type IconSize } from './Icon';
import { EASING, MOTION, PressableScaleHost, useReducedMotion } from './motion';
import {
  CONTROL_BOX,
  CONTROL_BOX_CHECKED,
  CONTROL_BOX_DISABLED,
  CONTROL_BOX_DISABLED_CHECKED,
  CONTROL_BOX_ERROR,
  CONTROL_BOX_PRESSED,
  CONTROL_LABEL,
  CONTROL_ROW,
  CONTROL_SIZE,
  FIELD_STACK,
} from './field-styles';
import { FieldError, labelText, RequiredMark, useFieldIds } from './field-support';
import { Text } from './Text';
import { tokens } from './theme';

type Axes = typeof contract.CheckBox.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** The tick fills the box minus a token of padding on each side, as `p-ds-5xs` does. */
const GLYPH: Record<Of<'size'>, IconSize> = {
  xlarge: 'lg',
  large: 'md',
  medium: 'sm',
  small: 'xs',
};

const SIZE = CONTROL_SIZE satisfies Record<Of<'size'>, number>;

export interface CheckBoxProps extends Omit<PressableProps, 'style' | 'children' | 'disabled'> {
  label: React.ReactNode;
  size?: Of<'size'>;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /**
   * A partly-selected parent: neither checked nor unchecked, which is why it is its own
   * boolean rather than a third value of `checked`. Announced as `mixed`. While it is set,
   * a press reports `checked: true` and it is the parent's job to drop the prop.
   */
  indeterminate?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The web `CheckBox`. The whole row is the target — label included — which is a hit-area
 * requirement rather than a styling preference, and on a phone the difference between a
 * control that can be pressed and one that can be pressed by a thumb.
 *
 * MOTION (identity §7, UMK-1486), every value from `MOTION`: the row presses on
 * `PressableScaleHost`; the brand fill crossfades over `duration.fast` (in on `easing.standard`,
 * out on `easing.exit`); the tick springs in on `spring.press` and fades out over
 * `duration.fast`. Under Reduce Motion the tick does not scale — every change is a plain
 * `duration.fast` fade. The fill is a LAYER over the box rather than a swapped style, because a
 * style swap cannot fade; the disabled arms stay on the box itself, unanimated, since a lock is
 * not something the reader did.
 *
 * NAME. A string label is the accessible name. A NODE label (a sentence with links in it) has no
 * string to read, so the caller's `accessibilityLabel` names it instead — a node label without one
 * leaves iOS to concatenate the child text and Android to follow `accessibilityLabelledBy`.
 */
export const CheckBox = ({
  label,
  nativeID,
  size = 'medium',
  error,
  disabled,
  required,
  checked,
  defaultChecked = false,
  onCheckedChange,
  indeterminate,
  style,
  onPress,
  ...props
}: CheckBoxProps) => {
  const { fieldId, labelId, errorId } = useFieldIds(nativeID);
  const [internal, setInternal] = React.useState(defaultChecked);
  const isChecked = checked ?? internal;
  const on = Boolean(isChecked || indeterminate);
  const px = SIZE[size];
  const reduce = useReducedMotion();
  const [fill] = React.useState(() => new Animated.Value(on ? 1 : 0));
  const [tick] = React.useState(() => new Animated.Value(on ? 1 : 0));
  /* The fill layer is MOUNTED only while it shows — ticked, or fading out — so an empty box
     carries no brand paint at all, not even at opacity 0 (the playbook's pressed probe reads
     painted colours, and the box's pressed border IS the brand). Raised during render, the
     derived-state pattern; lowered when the fade-out finishes. */
  const [layer, setLayer] = React.useState(on);
  if (on && !layer) setLayer(true);

  React.useEffect(() => {
    /* In and out are separate branches so each names its own token easing. */
    const animation = on
      ? Animated.parallel([
          Animated.timing(fill, { toValue: 1, duration: MOTION.duration.fast, easing: EASING.standard, useNativeDriver: true }),
          reduce
            ? Animated.timing(tick, { toValue: 1, duration: MOTION.duration.fast, easing: EASING.standard, useNativeDriver: true })
            : Animated.spring(tick, { toValue: 1, ...MOTION.spring.press, useNativeDriver: true }),
        ])
      : Animated.parallel([
          Animated.timing(fill, { toValue: 0, duration: MOTION.duration.fast, easing: EASING.exit, useNativeDriver: true }),
          Animated.timing(tick, { toValue: 0, duration: MOTION.duration.fast, easing: EASING.exit, useNativeDriver: true }),
        ]);
    animation.start(({ finished }) => {
      if (finished && !on) setLayer(false);
    });
    return () => animation.stop();
  }, [on, reduce, fill, tick]);

  return (
    <View style={[FIELD_STACK, style]}>
      <PressableScaleHost
        {...props}
        nativeID={fieldId}
        accessibilityRole="checkbox"
        accessibilityLabel={labelText(label) ?? props.accessibilityLabel}
        accessibilityLabelledBy={labelId}
        accessibilityHint={error}
        accessibilityState={{
          checked: indeterminate ? 'mixed' : isChecked,
          disabled: Boolean(disabled),
        }}
        disabled={disabled}
        onPress={(e) => {
          const next = indeterminate ? true : !isChecked;
          if (checked === undefined) setInternal(next);
          onCheckedChange?.(next);
          onPress?.(e);
        }}
        style={CONTROL_ROW}
      >
        {({ pressed }) => (
          <>
            <View
              style={[
                CONTROL_BOX,
                { width: px, height: px, borderRadius: tokens.radius.xs, alignItems: 'center', justifyContent: 'center' },
                pressed && !disabled && CONTROL_BOX_PRESSED,
                error && CONTROL_BOX_ERROR,
                disabled && (isChecked || indeterminate ? CONTROL_BOX_DISABLED_CHECKED : CONTROL_BOX_DISABLED),
              ]}
            >
              {/* The checked fill, faded in and out. Over the border too, so a ticked box is one
                  brand square — except with an error, whose red border must stay visible. A
                  disabled box paints its own arm above and takes no layer. */}
              {!disabled && layer && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    CONTROL_BOX_CHECKED,
                    {
                      position: 'absolute',
                      ...(error ? FILL_INSET.inside : FILL_INSET.overBorder),
                      borderWidth: 0,
                      borderRadius: tokens.radius.xs,
                      opacity: fill,
                    },
                  ]}
                />
              )}
              <Animated.View style={{ opacity: tick, transform: [{ scale: reduce ? 1 : tick }] }}>
                <Icon name={indeterminate ? 'minus' : 'check'} size={GLYPH[size]} color="invert" strokeWidth={3} />
              </Animated.View>
            </View>
            <Text nativeID={labelId} variant={CONTROL_LABEL.role} weight={CONTROL_LABEL.weight} style={{ flexShrink: 1 }}>
              {label}
              {required && <RequiredMark />}
            </Text>
          </>
        )}
      </PressableScaleHost>
      <FieldError id={errorId} message={error} />
    </View>
  );
};

/** Where the fill layer sits: over the box's border, or inside it when an error border must show. */
const FILL_INSET = {
  overBorder: { top: -CONTROL_BOX.borderWidth, left: -CONTROL_BOX.borderWidth, right: -CONTROL_BOX.borderWidth, bottom: -CONTROL_BOX.borderWidth },
  inside: { top: 0, left: 0, right: 0, bottom: 0 },
} as const;

CheckBox.displayName = 'CheckBox';
