import React from 'react';
import { TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { COMPOSER_EDITOR_AFFORDANCE, COMPOSER_EDITOR_BOX } from './composer-styles';
import { useTextScale } from './text-scale';
import { resolveTextStyle, tokens } from './theme';

export interface ChatComposerInputProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /**
   * A NODE in place of the text property, for a host whose placeholder animates or rotates.
   * The text property is the fallback, not the whole contract — a string cannot express the
   * landing composer's rotating placeholder, and a host forced to choose between them would
   * reimplement the editor to keep it.
   */
  placeholderSlot?: React.ReactNode;
  /** The accessible name. Required — the editor has no visible label. */
  label: string;
  disabled?: boolean;
  /**
   * Anchored top-right INSIDE the editor box — where the fullscreen trigger lives. The modal
   * it opens is the host's; the button that opens it is not, because it is positioned against
   * this box and a host cannot place it there from outside.
   */
  affordance?: React.ReactNode;
  /**
   * The editor's own events, passed straight through. NOT SPECULATIVE API — every surface this
   * serves needs them today.
   *
   * `onKeyPress` REPLACES the web's `onKeyDown`, and the difference is not cosmetic: on a soft
   * keyboard there is no reliable Enter keydown and no IME composition event to guard against.
   * A host wanting Enter-to-send uses `onSubmitEditing` with `blurOnSubmit={false}`, which is
   * the platform's own answer; `onKeyPress` is here for hardware keyboards.
   *
   * There is no `onPaste`. React Native's `TextInput` does not expose one, so a host that turns
   * pasted images into attachments — which the web branch does — cannot do it here. That is a
   * real gap and it belongs to the host's clipboard integration, not to this component.
   */
  onKeyPress?: TextInputProps['onKeyPress'];
  onSubmitEditing?: () => void;
  /* Typed off `TextInputProps` rather than hand-written: RN's focus event is NOT the DOM's,
     and spelling it as `NativeSyntheticEvent<TextInputFocusEventData>` does not match what
     `TextInput` actually accepts. `TextField` types its own the same way. */
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  /** Grows with the content up to this many lines, matching the web's auto-resize. */
  maxRows?: number;
  /**
   * Anchored to the EDITOR box, not the whole composer: a menu that must sit directly above or
   * below the text (a slash menu). Rendered inside the editor box, after the input — the web's
   * prop of the same name (UMK-1041), mirrored in UMK-1371.
   */
  overlay?: React.ReactNode;
  /**
   * The soft-keyboard hints, handed to the `TextInput` under the web's own names (UMK-1371).
   * Typed off `TextInputProps` because the platform's vocabularies are not the DOM's:
   * `autoCapitalize` is `none | sentences | words | characters` here, and `spellCheck` is read
   * by iOS only. A host that drops them gets the platform default keyboard with nothing failing.
   */
  inputMode?: TextInputProps['inputMode'];
  enterKeyHint?: TextInputProps['enterKeyHint'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  spellCheck?: TextInputProps['spellCheck'];
  /**
   * Extra style for the INPUT itself — a minimum height. The web's `className` lands on its
   * `textarea` for the same job; `style` below is the box around it, as it always was.
   */
  inputStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  ref?: React.Ref<TextInput>;
}

/**
 * The composer's editor.
 *
 * TRANSPARENT AND BORDERLESS by design: the bordered box belongs to `ChatComposer`, which
 * carries the focus band. An editor drawing its own border inside that box would double it.
 */
export const ChatComposerInput = ({
  value,
  onValueChange,
  placeholder,
  placeholderSlot,
  label,
  disabled,
  affordance,
  onKeyPress,
  onSubmitEditing,
  onFocus,
  onBlur,
  maxRows = 6,
  overlay,
  inputMode,
  enterKeyHint,
  autoCapitalize,
  spellCheck,
  inputStyle,
  style,
  ref,
}: ChatComposerInputProps) => {
  const text = resolveTextStyle('bodyLg', 'regular', useTextScale());

  return (
    <View style={[COMPOSER_EDITOR_BOX, style]}>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        editable={!disabled}
        multiline
        value={value}
        onChangeText={onValueChange}
        /* The NODE wins when given: a rotating placeholder cannot be a string. */
        placeholder={placeholderSlot === undefined ? placeholder : undefined}
        placeholderTextColor={tokens.text.default.secondary}
        onKeyPress={onKeyPress}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={false}
        onFocus={onFocus}
        onBlur={onBlur}
        inputMode={inputMode}
        enterKeyHint={enterKeyHint}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        style={[
          text,
          {
            alignSelf: 'stretch',
            padding: 0,
            color: tokens.text.default.primary,
            maxHeight: (text.lineHeight ?? 0) * maxRows,
            textAlignVertical: 'top',
            opacity: disabled ? 0.6 : 1,
          },
          inputStyle,
        ]}
      />

      {/* Rendered OVER the input and inert, so a tap still lands in the editor. */}
      {placeholderSlot !== undefined && value === '' && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}>
          {placeholderSlot}
        </View>
      )}

      {affordance !== undefined && <View style={COMPOSER_EDITOR_AFFORDANCE}>{affordance}</View>}
      {overlay}
    </View>
  );
};

ChatComposerInput.displayName = 'ChatComposerInput';
