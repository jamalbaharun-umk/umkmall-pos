import React from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
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

type Axes = typeof contract.Radio.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * `CheckBox`'s scale minus the largest step — the radio set does not publish it. The dot is
 * a third of the box, as `h-1/3` is on the web, read off the spacing ladder so it stays a
 * token.
 */
const SIZE = {
  large: { box: CONTROL_SIZE.large, dot: tokens.spacing['2xs'] },
  medium: { box: CONTROL_SIZE.medium, dot: tokens.spacing['3xs'] },
  small: { box: CONTROL_SIZE.small, dot: tokens.spacing['4xs'] },
} satisfies Record<Of<'size'>, { box: number; dot: number }>;

export interface RadioProps extends Omit<PressableProps, 'style' | 'children' | 'disabled'> {
  label: React.ReactNode;
  size?: Of<'size'>;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  checked?: boolean;
  /**
   * Fires with `true` only. A radio in a group is chosen or it is not, and unchoosing one is
   * done by choosing another — the group's state, which the parent owns, is what decides.
   */
  onCheckedChange?: (checked: true) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The web `Radio`. Controlled only: there is no `defaultChecked` because a radio's state
 * is a property of its group, and an uncontrolled single radio that can never be unchecked
 * is a control that looks like a checkbox and behaves like neither.
 */
export const Radio = ({
  label,
  nativeID,
  size = 'medium',
  error,
  disabled,
  required,
  checked = false,
  onCheckedChange,
  style,
  onPress,
  ...props
}: RadioProps) => {
  const { fieldId, labelId, errorId } = useFieldIds(nativeID);
  const { box, dot } = SIZE[size];

  return (
    <View style={[FIELD_STACK, style]}>
      <Pressable
        {...props}
        nativeID={fieldId}
        accessibilityRole="radio"
        accessibilityLabel={labelText(label)}
        accessibilityLabelledBy={labelId}
        accessibilityHint={error}
        accessibilityState={{ checked, disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={(e) => {
          if (!checked) onCheckedChange?.(true);
          onPress?.(e);
        }}
        style={CONTROL_ROW}
      >
        {({ pressed }) => (
          <>
            <View
              style={[
                CONTROL_BOX,
                { width: box, height: box, borderRadius: tokens.radius.full, alignItems: 'center', justifyContent: 'center' },
                checked && CONTROL_BOX_CHECKED,
                pressed && !disabled && CONTROL_BOX_PRESSED,
                error && CONTROL_BOX_ERROR,
                disabled && (checked ? CONTROL_BOX_DISABLED_CHECKED : CONTROL_BOX_DISABLED),
              ]}
            >
              {/* A dot rather than a glyph: the radio mark is a filled circle at every size. */}
              {checked && (
                <View
                  style={{
                    width: dot,
                    height: dot,
                    borderRadius: tokens.radius.full,
                    backgroundColor: tokens.surface.default.primary,
                  }}
                />
              )}
            </View>
            <Text nativeID={labelId} variant={CONTROL_LABEL.role} weight={CONTROL_LABEL.weight} style={{ flexShrink: 1 }}>
              {label}
              {required && <RequiredMark />}
            </Text>
          </>
        )}
      </Pressable>
      <FieldError id={errorId} message={error} />
    </View>
  );
};

Radio.displayName = 'Radio';
