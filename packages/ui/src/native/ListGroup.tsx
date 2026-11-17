import React from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { CARD_EDGE } from './content-styles';
import { List } from './List';
import { Text } from './Text';
import { tokens } from './theme';

type Axes = typeof contract.ListGroup.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type ListGroupVariant = Of<'variant'>;

/**
 * The outlined container (identity doc §4.1, list form): the solid card on the white page
 * (UMK-1603) — a white fill and the one card edge (`CARD_EDGE`), as `Card variant="outlined"` draws
 * them — `radius.2xl`, and padding 4 so the rows pad themselves.
 */
const CONTAINER = {
  backgroundColor: tokens.surface.default.primary,
  ...CARD_EDGE,
  borderRadius: tokens.radius['2xl'],
  padding: tokens.spacing['4xs'],
} as const satisfies ViewStyle;

/**
 * The section label: Bold, uppercase, in the muted meta ink, on the 12 step (the identity's
 * 11–12). Inset to the rows' own text edge — the container's 4 plus the row's 12.
 *
 * The identity's 0.08em tracking is NOT drawn: the token set publishes only negative letter
 * spacing, and a positive literal is not ours to invent.
 */
const LABEL = {
  color: tokens.text.default.muted,
  textTransform: 'uppercase',
  paddingHorizontal: tokens.spacing.md,
} as const;

/**
 * The plain group's label (Figma `Mobile/Profile` 14980:77345): sentence case as written ("Teman
 * AI", "Lainnya"), SemiBold 14, in the light secondary ink Figma fills it with (`#93A2B0`,
 * `text.default.secondary`). No inset: the page carries the 16, and the plain rows under it start
 * on the same edge.
 */
const PLAIN_LABEL = { color: tokens.text.default.secondary } as const;

/** Figma stacks a plain group 4 apart — label to first row, and row to row (`List`'s own 4). */
const PLAIN_GROUP = { gap: tokens.spacing['4xs'] } as const;

/** The outlined group's label sits 8 over its container. */
const OUTLINED_GROUP = { gap: tokens.spacing['2xs'] } as const;

export interface ListGroupProps extends Omit<ViewProps, 'style' | 'children'> {
  /**
   * The section label over the container. `outlined`: written in any case, drawn uppercase ("AKUN").
   * `plain`: drawn as written ("Teman AI"), SemiBold 14 in the secondary ink.
   */
  label?: string;
  /**
   * `outlined` (default): the solid white card with the one card edge. `plain`: no container and no separators —
   * the rows sit on the page, as Profil draws them (UMK-1601). Pair it with `ListRow variant="plain"`.
   */
  variant?: ListGroupVariant;
  /** `ListRow`s. */
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A labelled group of `ListRow`s on an outlined container (native-ui-v2,
 * docs/guidelines/mobile-design-identity.md §4.5) — the history sidebar — or, `plain`, straight on
 * the page with a sentence-case label: Profil's "Teman AI" and "Lainnya" (UMK-1601).
 *
 * BUILT ON `List`, NOT AS A VARIANT OF IT. `List` is the content stack the a2ui renderer draws
 * prose into, with no contract axes and `direction` deliberately kept off the contract; a
 * labelled container of navigation rows is chrome, not a layout. So the rows still stack
 * through `List` (its vertical gap), and the label and the container are this component's.
 *
 * DESTRUCTIVE ACTIONS DO NOT GO IN A GROUP — see `ListRow`.
 */
export const ListGroup = ({ label, variant = 'outlined', children, style, ...props }: ListGroupProps) => {
  const plain = variant === 'plain';
  return (
    <View style={[plain ? PLAIN_GROUP : OUTLINED_GROUP, style]} {...props}>
      {label !== undefined &&
        (plain ? (
          <Text variant="paragraph" weight="semibold" accessibilityRole="header" style={PLAIN_LABEL}>
            {label}
          </Text>
        ) : (
          <Text variant="bodyLg" weight="bold" accessibilityRole="header" style={LABEL}>
            {label}
          </Text>
        ))}
      {plain ? (
        <List>{children}</List>
      ) : (
        <View style={CONTAINER}>
          <List>{children}</List>
        </View>
      )}
    </View>
  );
};

ListGroup.displayName = 'ListGroup';
