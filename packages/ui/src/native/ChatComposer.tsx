import React from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { ChatComposerInput, type ChatComposerInputProps } from './ChatComposerInput';
import { COMPOSER_BASE, COMPOSER_GROUP, COMPOSER_OUTER, COMPOSER_RAISED, COMPOSER_ROW, COMPOSER_TRAY, COMPOSER_TRAY_TONE } from './composer-styles';
import { tokens } from './theme';

type Axes = typeof contract.ChatComposer.axes;
export type ChatComposerTone = Axes['tone'][number];

export interface ChatComposerProps
  extends Pick<
    ChatComposerInputProps,
    'value' | 'onValueChange' | 'placeholder' | 'placeholderSlot' | 'disabled' | 'onKeyPress' | 'onSubmitEditing' | 'onFocus' | 'onBlur' | 'maxRows'
  > {
  /** The editor's accessible name. Required — it has no visible label. */
  editorLabel: string;
  /**
   * The two button groups, composed BY THE HOST rather than configured through the shell.
   * That single decision took the web shell from 34 props to 17: a composer that took
   * `showVoice`, `voiceActive`, `onVoicePress`… for four buttons is a shell reimplementing
   * each of them badly.
   */
  toolActions?: React.ReactNode;
  sendActions?: React.ReactNode;
  /**
   * REPLACES the two groups and spans the row — `ChatVoiceBar` is what goes in it.
   *
   * The groups are a LAYOUT, one flex item each side of a `space-between` row and both sized to
   * their content, so a control that spans the row cannot be either of them; passed as
   * `toolActions` the bar renders at its intrinsic width with the rest of the row empty beside
   * it, and nothing fails. It REPLACES rather than stacks because the listening bar stands in for
   * the row, and its two heights exist so the composer does not jump when recording starts.
   */
  actionRow?: React.ReactNode;
  /** Slots OUTSIDE the bordered box, inside the tray. Usually a `ChatDrawer`. */
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Tints the TRAY, not a slot. Filling `header` or `footer` turns the outer column into ONE
   * tinted panel running behind the white editor box and showing as a margin around it — so
   * there is one place to tint and a composer cannot say danger at the top and warning at the
   * bottom. That is the trade, taken deliberately.
   */
  tone?: ChatComposerTone;
  /** Anchored inside the editor box, top-right — the fullscreen trigger's home. */
  editorAffordance?: React.ReactNode;
  /** Covers the whole composer — a drop target, a disabled veil. */
  overlay?: React.ReactNode;
  /**
   * Anchored to the EDITOR box rather than the whole composer, so a menu positioned against the
   * text sits against the text. Distinct from `overlay`, which covers the composer.
   */
  editorOverlay?: React.ReactNode;
  /** The editor's soft-keyboard hints — see `ChatComposerInput`. */
  editorInputMode?: ChatComposerInputProps['inputMode'];
  editorEnterKeyHint?: ChatComposerInputProps['enterKeyHint'];
  editorAutoCapitalize?: ChatComposerInputProps['autoCapitalize'];
  editorSpellCheck?: ChatComposerInputProps['spellCheck'];
  /**
   * Extra style for the editor's input (a minimum height) — the native spelling of the web's
   * `editorClassName`, as `style` is of `className` everywhere else in this library.
   */
  editorStyle?: StyleProp<TextStyle>;
  /**
   * Lifts the box with a shadow. For the one composer that is the page's subject (a hero), not
   * for the composer in a thread — the web's `raised` (UMK-1041).
   */
  raised?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The chat composer shell.
 *
 * ONE PRESENTATION, no size axis. The published Desktop/Mobile pair was collapsed onto the
 * mobile values by product decision, which makes this port simpler than it looks: there is no
 * axis to re-decide, because a native screen having one width is the assumption the web
 * already adopted.
 *
 * THE TRAY IS THE PART A PORT MISSES. It carries NO padding of its own and tucks UNDER the
 * bordered box rather than framing it, so whatever room a slot needs is that slot's padding
 * and a slot that wants to sit flush can. Its radius is the box's, so with no inset the two
 * are equal and move together.
 */
export const ChatComposer = ({
  value,
  onValueChange,
  placeholder,
  placeholderSlot,
  editorLabel,
  disabled,
  onKeyPress,
  onSubmitEditing,
  onFocus,
  onBlur,
  maxRows,
  toolActions,
  sendActions,
  actionRow,
  header,
  footer,
  tone,
  editorAffordance,
  overlay,
  editorOverlay,
  editorInputMode,
  editorEnterKeyHint,
  editorAutoCapitalize,
  editorSpellCheck,
  editorStyle,
  raised = false,
  style,
}: ChatComposerProps) => {
  /* Only a FILLED slot makes the tray visible — an untinted composer is the bordered box on
     the surface behind it, with nothing painted around it. */
  const trayTone = tone !== undefined && (header !== undefined || footer !== undefined) ? COMPOSER_TRAY_TONE[tone] : undefined;

  return (
    <View style={[COMPOSER_OUTER, style]}>
      <View style={[COMPOSER_TRAY, trayTone && { backgroundColor: trayTone.backgroundColor }]}>
        {header}

        <View style={[COMPOSER_BASE, raised && COMPOSER_RAISED]}>
          <ChatComposerInput
            value={value}
            onValueChange={onValueChange}
            placeholder={placeholder}
            placeholderSlot={placeholderSlot}
            label={editorLabel}
            disabled={disabled}
            affordance={editorAffordance}
            overlay={editorOverlay}
            inputMode={editorInputMode}
            enterKeyHint={editorEnterKeyHint}
            autoCapitalize={editorAutoCapitalize}
            spellCheck={editorSpellCheck}
            inputStyle={editorStyle}
            onKeyPress={onKeyPress}
            onSubmitEditing={onSubmitEditing}
            onFocus={onFocus}
            onBlur={onBlur}
            maxRows={maxRows}
          />

          {/* ONE ROW EITHER WAY, so the composer's height does not change when it is swapped. */}
          <View style={COMPOSER_ROW}>
            {actionRow ?? (
              <>
                <View style={COMPOSER_GROUP}>{toolActions}</View>
                <View style={COMPOSER_GROUP}>{sendActions}</View>
              </>
            )}
          </View>
        </View>

        {footer}
      </View>

      {/* Absolute over everything, and inert unless the overlay itself takes touches. */}
      {overlay !== undefined && (
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: tokens.radius.xl, overflow: 'hidden' }}>
          {overlay}
        </View>
      )}
    </View>
  );
};

ChatComposer.displayName = 'ChatComposer';
