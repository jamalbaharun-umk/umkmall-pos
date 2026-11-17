import React from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { contract } from '../contract';
import { Icon } from './Icon';
import { BOX_INK, BOX_SIZE, BOX_HEIGHT_COMPACT, BOX_SIZE_COMPACT, BOX_STATE, BOX_STATE_COMPACT, FIELD_COUNTER, FIELD_STACK, FIELD_STACK_COMPACT, FOCUS_RING } from './field-styles';
import { FieldError, FieldLabel, labelText, useFieldIds, useFieldFade } from './field-support';
import { Text } from './Text';
import { useTextScale } from './text-scale';
import { resolveTextStyle, tokens } from './theme';

type Axes = typeof contract.TextField.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/* `xsmall` is web-only (recorded on the contract entry's native reason): native has no such rung. `compact` (UMK-1548) is on both. */
type NativeSize = Exclude<Of<'size'>, 'xsmall'>;

/** Re-tied to THIS component's own size axis, so a size added to the entry reddens the table. */
const SIZE = { ...BOX_SIZE, compact: BOX_SIZE_COMPACT } satisfies Record<NativeSize, unknown>;

/**
 * The web's `type` attribute, as the keyboard it implies. A native input has no `type`;
 * it has a keyboard, an autocapitalisation rule and a secure-entry flag, and this is the
 * one place the web word is translated so call sites keep saying `type="email"`.
 */
const KEYBOARD = {
  text: {},
  password: { secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false },
  email: { keyboardType: 'email-address', autoCapitalize: 'none', autoCorrect: false },
  tel: { keyboardType: 'phone-pad' },
  number: { keyboardType: 'numeric' },
  url: { keyboardType: 'url', autoCapitalize: 'none', autoCorrect: false },
} as const satisfies Record<string, Partial<TextInputProps>>;

export type TextFieldType = keyof typeof KEYBOARD;

export interface TextFieldProps
  extends Omit<TextInputProps, 'style' | 'editable' | 'secureTextEntry' | 'multiline' | 'numberOfLines'> {
  /** Owned by the component, never optional: a label prop cannot be forgotten the way a sibling can. */
  label: React.ReactNode;
  size?: NativeSize;
  /** The message itself, not a flag. The region is always mounted — see `FieldError`. */
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /** Renders a multi-line input. A prop, not a second component: it changes the element, not the look. */
  multiline?: boolean;
  rows?: number;
  /** Plain props, not contract booleans: neither is a visual variant. */
  readOnly?: boolean;
  type?: TextFieldType;
  showReveal?: boolean;
  /**
   * An INTERACTIVE slot inside the box, before the adornment and the input (UMK-1186) — a
   * country picker in front of a phone number. Unlike `leadingAdornment` it is NOT hidden
   * from assistive technology, because a control inside it must stay reachable; its
   * accessible name is the caller's. Order when both are set: prefix, adornment, input.
   */
  prefix?: React.ReactNode;
  /**
   * Rendered inside the box, before and after the input.
   *
   * DECORATIVE BY DEFAULT, matching the web: an adornment that is interactive is the
   * caller's own element and the caller owns its accessible name; this component will not
   * invent one. The trailing slot sits before the reveal toggle, so a password field can
   * carry both.
   */
  leadingAdornment?: React.ReactNode;
  trailingAdornment?: React.ReactNode;
  /**
   * Shows `used / limit` under the box. DRIVEN BY `maxLength`, never by its own number — two
   * sources for one limit is how a counter ends up saying 200 while the field stops at 180.
   * Passing it without a `maxLength` renders nothing rather than a half-counter.
   */
  showCounter?: boolean;
  /** Escape hatch for a2ui, whose journey authors supply a border colour the tables cannot see. */
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
  /** React 19: a plain prop, no `forwardRef`. Reaches the `TextInput` for `.focus()`. */
  ref?: React.Ref<TextInput>;
}

/**
 * The web `TextField`, on `TextInput`.
 *
 * Figma's nine-value `Status` is three orthogonal booleans wearing an enum — error ×
 * disabled × hasValue — and the contract records the divergence. "Filled" is DERIVED from
 * the value, and a caller cannot pass it, because a caller passing it wrong is the only way
 * it can ever disagree with the text in the box.
 *
 * `onChangeText`, not `onChange`: the event shape is the one thing that legitimately
 * differs per platform. Every axis and every boolean keeps the web's name.
 */
export const TextField = ({
  label,
  nativeID,
  size = 'large',
  error,
  disabled,
  required,
  multiline,
  rows = 3,
  readOnly,
  type = 'text',
  showReveal = true,
  prefix,
  leadingAdornment,
  trailingAdornment,
  showCounter,
  accentColor,
  style,
  value,
  defaultValue,
  onChangeText,
  onFocus,
  onBlur,
  placeholderTextColor,
  ref,
  maxLength,
  ...props
}: TextFieldProps) => {
    const { fieldId, labelId, errorId } = useFieldIds(nativeID);
    const [revealed, setRevealed] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    /** Tracked rather than read off the input so an uncontrolled field still knows it is filled. */
    const [typed, setTyped] = React.useState(() => String(defaultValue ?? '').length);
    const length = value !== undefined ? String(value).length : typed;
    const filled = length > 0;

    /* Driven by `maxLength`, never by its own number — see `showCounter`. Without a limit
       there is nothing to count towards, so it renders nothing rather than a half-counter. */
    const counting = Boolean(showCounter && maxLength !== undefined);
    const atLimit = counting && length >= Number(maxLength);

    const isPassword = type === 'password';
    const state = disabled ? 'disabled' : error ? 'error' : filled ? 'filled' : 'default';
    const { role, ...box } = SIZE[size];
    const scale = useTextScale();
    const compact = size === 'compact';
    const text = {
      ...resolveTextStyle(role, 'regular', scale),
      ...(compact && multiline ? { lineHeight: Math.round(BOX_HEIGHT_COMPACT.multilineLineHeight * scale) } : null),
    };
    const keyboard = KEYBOARD[type];

    /* Typed off the props rather than off an event name: the focus event's shape has moved
       between React Native releases, and the prop is the one thing that tracks it. */
    /* The focus treatment crossfades in and out (identity §7, `duration.fast`) rather than
       snapping: two layers that draw nothing but a border, whose OPACITY moves, never a colour, so it runs on the
       native driver. The brand border is skipped while disabled and under an `accentColor`,
       exactly where the static border used to be overridden. */
    const ring = useFieldFade(focused);
    const showFocusBorder = !disabled && !accentColor;

    const handleFocus: NonNullable<TextInputProps['onFocus']> = (e) => {
      setFocused(true);
      onFocus?.(e);
    };
    const handleBlur: NonNullable<TextInputProps['onBlur']> = (e) => {
      setFocused(false);
      onBlur?.(e);
    };

    return (
      <View style={[size === 'compact' ? FIELD_STACK_COMPACT : FIELD_STACK, style]}>
        <FieldLabel id={labelId} label={label} required={required} muted={size === 'compact'} />

        {/* The ring's slot: always 2 wide and transparent, so nothing shifts on focus. The ring
            itself is the first faded layer below, drawn into this slot. */}
        <View
          style={{
            borderWidth: FOCUS_RING.ringWidth,
            borderColor: 'transparent',
            borderRadius: box.borderRadius + FOCUS_RING.ringWidth,
          }}
        >
          <View
            style={[
              {
                flexDirection: 'row',
                alignItems: multiline ? 'flex-start' : 'center',
                borderWidth: 1,
                gap: box.gap,
                paddingHorizontal: box.paddingHorizontal,
                paddingVertical: box.paddingVertical,
                borderRadius: box.borderRadius,
              },
              BOX_STATE[state],
              compact && (state === 'default' || state === 'filled') ? BOX_STATE_COMPACT[state] : null,
              compact && !multiline ? BOX_HEIGHT_COMPACT.single : null,
              accentColor ? { borderColor: accentColor } : null,
            ]}
          >
            {prefix !== undefined && prefix !== null && <View>{prefix}</View>}

            {leadingAdornment !== undefined && (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {leadingAdornment}
              </View>
            )}

            <TextInput
              /* Caller props FIRST, so a stray `accessibilityLabelledBy` cannot silently replace
                 the association this component exists to make un-forgettable. */
              {...props}
              {...keyboard}
              ref={ref}
              nativeID={fieldId}
              accessibilityLabel={labelText(label)}
              accessibilityLabelledBy={labelId}
              accessibilityState={{ disabled: Boolean(disabled) }}
              /* `aria-invalid` on the web. iOS has no equivalent; the error text is announced by
                 `FieldError` instead. */
              accessibilityHint={error}
              editable={!disabled && !readOnly}
              secureTextEntry={isPassword && !revealed}
              multiline={multiline}
              numberOfLines={multiline ? rows : undefined}
              value={value}
              defaultValue={defaultValue}
              maxLength={maxLength}
              onChangeText={(next) => {
                setTyped(next.length);
                onChangeText?.(next);
              }}
              onFocus={handleFocus}
              onBlur={handleBlur}
              placeholderTextColor={placeholderTextColor ?? BOX_INK.placeholder}
              style={[
                text,
                {
                  flex: 1,
                  minWidth: 0,
                  padding: 0,
                  color: disabled ? BOX_INK.disabled : BOX_INK.default,
                },
                multiline && {
                  minHeight: (text.lineHeight ?? 0) * rows,
                  textAlignVertical: 'top',
                },
              ]}
            />

            {trailingAdornment !== undefined && (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {trailingAdornment}
              </View>
            )}

            {isPassword && showReveal && !multiline && (
              <Pressable
                accessibilityRole="togglebutton"
                accessibilityLabel={revealed ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                accessibilityState={{ checked: revealed, disabled: Boolean(disabled) }}
                disabled={disabled}
                onPress={() => setRevealed((v) => !v)}
                hitSlop={tokens.spacing['2xs']}
              >
                <Icon name={revealed ? 'eye-off' : 'eye'} size="md" color="secondary" />
              </Pressable>
            )}
          </View>

          {ring.mounted && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -FOCUS_RING.ringWidth,
                left: -FOCUS_RING.ringWidth,
                right: -FOCUS_RING.ringWidth,
                bottom: -FOCUS_RING.ringWidth,
                borderWidth: FOCUS_RING.ringWidth,
                borderColor: FOCUS_RING.ring,
                borderRadius: box.borderRadius + FOCUS_RING.ringWidth,
                opacity: ring.opacity,
              }}
            />
          )}
          {ring.mounted && showFocusBorder && (
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { borderWidth: 1, borderColor: FOCUS_RING.border, borderRadius: box.borderRadius, opacity: ring.opacity },
              ]}
            />
          )}
        </View>

        {counting && (
          /* Not a live region, matching the web: announcing a new count on every keystroke is
             noise. It is reachable because the input points at it — `accessibilityHint` there
             carries the error, so the count rides the field's own text instead. */
          <Text variant="bodyMd" style={atLimit ? FIELD_COUNTER.limit : FIELD_COUNTER.default}>
            {`${length}/${maxLength}`}
          </Text>
        )}

        <FieldError id={errorId} message={error} />
      </View>
    );
};

TextField.displayName = 'TextField';
