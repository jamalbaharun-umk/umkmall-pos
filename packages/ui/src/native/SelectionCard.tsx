import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { splitDescription } from '../shared/selection-card';
import {
  SELECTION_CARD_BASE,
  SELECTION_CARD_INDICATOR,
  SELECTION_CARD_INDICATOR_MARK,
  SELECTION_CARD_INDICATOR_SHAPE,
  SELECTION_CARD_INDICATOR_STATE,
  SELECTION_CARD_INK,
  SELECTION_CARD_LAYOUT,
  SELECTION_CARD_ROW,
  SELECTION_CARD_SIZE,
  SELECTION_CARD_STATE,
  SELECTION_CARD_TILE_BADGE,
  SELECTION_CARD_TILE_TEXT,
  SELECTION_CARD_TILE_TEXT_ALIGN,
} from './field-styles';
import { FieldLabel, useFieldIds } from './field-support';
import { PressableScaleHost } from './motion';
import { Text } from './Text';

type Axes = typeof contract.SelectionCard.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const SIZE = SELECTION_CARD_SIZE satisfies Record<Of<'size'>, unknown>;
const STATE = SELECTION_CARD_STATE satisfies Record<Of<'state'>, unknown>;
const LAYOUT = SELECTION_CARD_LAYOUT satisfies Record<Of<'layout'>, unknown>;

export interface SelectionCardOption {
  label: React.ReactNode;
  value: string;
  icon?: React.ReactNode;
  /** A newline splits this: first line becomes the heading, the rest the body. */
  description?: string;
  badge?: React.ReactNode;
}

export interface SelectionCardProps {
  label?: React.ReactNode;
  /** The accessible name when there is no visible label. */
  accessibilityLabel?: string;
  options: readonly SelectionCardOption[];
  value?: readonly string[];
  onValueChange?: (value: string[]) => void;
  /** Checkboxes rather than radios, and more than one may be selected. */
  multiple?: boolean;
  size?: Of<'size'>;
  /** `row` (default) or `tile`: a centred stack with the control drawn in the top-right corner (UMK-1218). */
  layout?: Of<'layout'>;
  disabled?: boolean;
  /** Groups the controls. Generated when omitted, so two pickers never share a group. */
  name?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A group of selectable option cards.
 *
 * THE CARD IS THE CONTROL HERE, where the web hides a real radio or checkbox inside the label
 * and lets the platform supply the group role, the roving focus and the arrow keys. React
 * Native has none of that to borrow — there is no native radio and no `sr-only` — so each card
 * is a `Pressable` carrying `radio`/`checkbox` and its own `accessibilityState.checked`.
 *
 * The guarantee the web is actually making survives that: selection reaches assistive
 * technology through the CONTROL's state rather than through the card's colour, which is not a
 * channel every reader has.
 *
 * NO CHIP RENDERING HERE. `Chip` already covers the badge-shaped affordance.
 *
 * PRESS MOTION (native-ui-v2, identity doc §7.2): each card shrinks to
 * `motion.scale.press.default` while a finger is down — motion only, still no pressed PAINT (its
 * feedback stays the selected state). Through `PressableScaleHost`, because the card's border and
 * fill live on the pressable; a disabled card does not move.
 */
export const SelectionCard = ({
  label,
  accessibilityLabel,
  options,
  value = [],
  onValueChange,
  multiple,
  size = 'large',
  layout = 'row',
  disabled,
  name,
  style,
}: SelectionCardProps) => {
  const shape = SELECTION_CARD_INDICATOR_SHAPE[multiple ? 'checkbox' : 'radio'];
  const align = layout === 'tile' ? SELECTION_CARD_TILE_TEXT_ALIGN : undefined;
  const { fieldId, labelId } = useFieldIds(name);
  const selected = new Set(value);

  const toggle = (optionValue: string) => {
    if (!multiple) return onValueChange?.([optionValue]);
    const next = new Set(selected);
    if (next.has(optionValue)) next.delete(optionValue);
    else next.add(optionValue);
    /* Ordered by the OPTION list, not by tap order — a set's iteration order would make the
       emitted array depend on what the user happened to tap first. */
    onValueChange?.(options.map((o) => o.value).filter((v) => next.has(v)));
  };

  return (
    <View
      accessibilityRole={multiple ? undefined : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
      nativeID={fieldId}
      style={[SELECTION_CARD_ROW, style]}
    >
      {label !== undefined && <FieldLabel id={labelId} label={label} />}

      {options.map((option) => {
        const { title, body } = splitDescription(option.description);
        const isSelected = selected.has(option.value);
        const state: Of<'state'> = disabled ? 'disabled' : isSelected ? 'selected' : 'default';
        const ink = SELECTION_CARD_INK[state];

        return (
          <PressableScaleHost
            key={option.value}
            scale="default"
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: isSelected, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => toggle(option.value)}
            style={[SELECTION_CARD_BASE, SIZE[size], STATE[state], LAYOUT[layout]]}
          >
            {layout === 'tile' && (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                testID="selection-card-indicator"
                style={[SELECTION_CARD_INDICATOR, shape, SELECTION_CARD_INDICATOR_STATE[state]]}
              >
                {isSelected && <View style={[SELECTION_CARD_INDICATOR_MARK, shape]} />}
              </View>
            )}
            {option.icon !== undefined && option.icon !== null && (
              <View accessibilityElementsHidden>{option.icon}</View>
            )}

            <View style={layout === 'tile' ? SELECTION_CARD_TILE_TEXT : { flex: 1, minWidth: 0 }}>
              {/* THE INVERSION: with a split-out title, the authored label becomes the eyebrow
                  and the title becomes the heading. The agent surface's flow validation matches
                  the AUTHORED label, so a generated title cannot be written into the label —
                  the split is the only place it can go, and a card that renders the label as
                  the heading regardless gets every one of those wrong. */}
              {title !== undefined ? (
                <>
                  <Text variant="bodyMd" color={ink.body} style={align}>
                    {option.label}
                  </Text>
                  <Text variant="bodyLg" weight="bold" color={ink.heading} style={align}>
                    {title}
                  </Text>
                </>
              ) : typeof option.label === 'string' ? (
                <Text variant="bodyLg" weight="bold" color={ink.heading} style={align}>
                  {option.label}
                </Text>
              ) : (
                option.label
              )}
              {body !== undefined && (
                <Text variant="bodyLg" color={ink.body} style={align}>
                  {body}
                </Text>
              )}
            </View>

            {option.badge !== undefined && option.badge !== null && (
              <View style={layout === 'tile' ? SELECTION_CARD_TILE_BADGE : undefined}>{option.badge}</View>
            )}
          </PressableScaleHost>
        );
      })}
    </View>
  );
};

SelectionCard.displayName = 'SelectionCard';
