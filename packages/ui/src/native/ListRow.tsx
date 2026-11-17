import React from 'react';
import { Animated, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { Icon, type IconName } from './Icon';
import { ICON_REGISTRY } from './icon-registry';
import { EASING, MOTION, PressableScaleHost, useReducedMotion } from './motion';
import { Text } from './Text';
import { ICON_COLOR_VALUES, measure, tokens, type TextColor } from './theme';

type Axes = typeof contract.ListRow.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type ListRowTrailing = Of<'trailing'>;
export type ListRowVariant = Of<'variant'>;
export type ListRowValueTone = Of<'valueTone'>;

/**
 * Which way the row leads (identity doc §4.5): `chevron` navigates INSIDE the app, `external`
 * leaves it (WhatsApp, the website), `none` draws nothing. The two glyphs are never mixed —
 * a reader learns "›" as "stays here" and "↗" as "goes somewhere else".
 */
const TRAILING_ICON = {
  chevron: 'chevron-right',
  external: 'external-link',
  none: undefined,
} as const satisfies Record<ListRowTrailing, IconName | undefined>;

/** The trailing value's ink: muted by default, brand for Profil's plan name ("Basic"). */
const VALUE_TONE = {
  muted: 'muted',
  brand: 'brand',
} as const satisfies Record<ListRowValueTone, TextColor>;

/**
 * What both rows share: one line of glyph, text and trailing, 12 apart. The pressed and active
 * highlight rounds at `radius.xl` — the canvas draws 18, which has no step, and 16 is the nearest.
 */
const ROW = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing.sm,
  borderRadius: tokens.radius.xl,
} as const satisfies ViewStyle;

/** The tile row's box: at least the identity's 56, above the 44 target floor, padded inside its group's container. */
const TILE_ROW = {
  minHeight: measure['3-5'],
  paddingHorizontal: tokens.spacing.sm,
  paddingVertical: tokens.spacing['2xs'],
} as const satisfies ViewStyle;

/**
 * The plain row's box (Figma `Mobile/Profile` 14980:77345): 52 tall — 16 above and below the 20
 * line, above the 44 target floor — and NO horizontal padding. The page carries the 16 inset, so
 * the glyph starts on the page's own edge, where Figma draws it.
 */
const PLAIN_ROW = { paddingVertical: tokens.spacing.md } as const satisfies ViewStyle;

/**
 * The plain row's two glyphs, in PIXELS: Figma draws the leading glyph and the chevron at 18. 18
 * is on no ladder (the measurement scale steps 16, 20; `Icon`'s five steps are 12 … 32), so — as
 * `TOAST_CLOSE_GLYPH` does for the toast's 18 close — it is one number, with the reason, in one
 * place, drawn through the registry rather than by widening `Icon`'s closed `size`.
 */
const PLAIN_GLYPH = 18;

/** Pressed and active share one tint: `surface.weak.brand`. */
const ROW_TINTED = { backgroundColor: tokens.surface.weak.brand } as const satisfies ViewStyle;

/**
 * The plain row's highlight: the same tint, on a layer under the content whose OPACITY fades, so
 * the press can ease in (UMK-1614) where the tile row's paint snaps. Fills the row
 * (`StyleSheet.absoluteFill`, drawn first so the content paints over it) and rounds with it.
 */
const HIGHLIGHT = {
  borderRadius: tokens.radius.xl,
  backgroundColor: tokens.surface.weak.brand,
} as const satisfies ViewStyle;

/** The 36 pt icon tile: a pale brand surface with the brand-dark glyph on it. */
const ICON_TILE = {
  width: measure['2-25'],
  height: measure['2-25'],
  borderRadius: tokens.radius.lg,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: tokens.surface.weak.brand,
} as const satisfies ViewStyle;

export interface ListRowProps extends Omit<PressableProps, 'style' | 'children'> {
  /** The row's name — what it opens. One line; it truncates rather than wrapping the row taller. */
  label: string;
  /** An optional second line under the label, in the muted meta ink. */
  meta?: string;
  /**
   * The glyph. `tile`: in the 36 pt tile. `plain`: bare, 18 pt, in the default ink. Omit it for a
   * row with no glyph (a history entry).
   */
  icon?: IconName;
  /** `chevron` (in-app), `external` (leaves the app) or `none`. Default `none`. */
  trailing?: ListRowTrailing;
  /**
   * The row leaves the app though it draws a `chevron` (Profil's final design, UMK-1832): it still
   * announces as a `link`, because what it does is what a screen reader must say, not its glyph.
   */
  leavesApp?: boolean;
  /**
   * `tile` (default): the identity row, glyph in a tinted tile. `plain`: Profil's row (UMK-1601) —
   * no tile, a Medium 14 label, and a press that fades its tint in. Pair it with `ListGroup variant="plain"`.
   */
  variant?: ListRowVariant;
  /** Short trailing text before the direction glyph — Profil's current plan name ("Basic"). */
  value?: string;
  /** The value's ink: `muted` (default) or `brand`. */
  valueTone?: ListRowValueTone;
  /**
   * The row is the CURRENT one — the open chat in the history sidebar. Draws the same tint as a
   * press and announces it as selected.
   */
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A registry glyph at `PLAIN_GLYPH`, decorative, in the default ink — Figma inks both of the plain
 * row's glyphs `#042648` — or the disabled ink on a disabled row, as its label greys. A name with no ported artwork goes to `Icon`, so it throws `Icon`'s own
 * message rather than drawing nothing.
 */
const PlainGlyph = ({ name, disabled = false }: { name: IconName; disabled?: boolean }) => {
  const Glyph = ICON_REGISTRY[name];
  if (!Glyph) return <Icon name={name} />;
  return (
    <Glyph
      size={PLAIN_GLYPH}
      color={disabled ? ICON_COLOR_VALUES.disable : ICON_COLOR_VALUES.primary}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
};

/**
 * The plain row's insides, a component of its own because its highlight and nudge are an
 * animation that must run on a CHANGE of `lit` — which only an effect can see.
 *
 * The first render takes `lit` as it is (a playbook specimen held pressed shows lit at once) and
 * animates nothing; each change after that fades the highlight over `duration.press`. The same
 * value nudges an `external` row's ↗ up and right by `distance.nudge` — and, under Reduce Motion,
 * the fade stays (a short fade is the identity's reduced form, §7.3 rule 5) while the nudge does not.
 */
const PlainRowBody = ({
  lit,
  testID,
  icon,
  label,
  meta,
  value,
  valueTone,
  trailing,
  disabled,
}: {
  lit: boolean;
  testID?: string;
  icon?: IconName;
  label: string;
  meta?: string;
  value?: string;
  valueTone: ListRowValueTone;
  trailing: ListRowTrailing;
  disabled: boolean;
}) => {
  const progress = React.useRef(new Animated.Value(lit ? 1 : 0)).current;
  const reduce = useReducedMotion();
  const mounted = React.useRef(false);

  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: lit ? 1 : 0,
      duration: MOTION.duration.press,
      easing: EASING.standard,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [lit, progress]);

  const glyph = TRAILING_ICON[trailing];
  const nudge = reduce ? 0 : MOTION.distance.nudge;

  return (
    <>
      <Animated.View
        pointerEvents="none"
        testID={testID ? `${testID}-highlight` : undefined}
        style={[StyleSheet.absoluteFill, HIGHLIGHT, { opacity: progress }]}
      />
      {icon !== undefined && <PlainGlyph name={icon} disabled={disabled} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="paragraph" weight="medium" color={disabled ? 'disable' : 'primary'} numberOfLines={1}>
          {label}
        </Text>
        {meta !== undefined && (
          <Text variant="bodyMd" color="muted" numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
      {value !== undefined && (
        <Text variant="paragraph" weight="semibold" color={VALUE_TONE[valueTone]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {glyph !== undefined && (
        <Animated.View
          testID={testID ? `${testID}-trailing` : undefined}
          style={
            trailing === 'external'
              ? {
                  transform: [
                    { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, nudge] }) },
                    { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -nudge] }) },
                  ],
                }
              : undefined
          }
        >
          <PlainGlyph name={glyph} disabled={disabled} />
        </Animated.View>
      )}
    </>
  );
};

/**
 * One row of a `ListGroup` (native-ui-v2, docs/guidelines/mobile-design-identity.md §4.5): an
 * icon tile, a label with an optional meta line, an optional trailing value, and a trailing
 * direction glyph. `variant="plain"` is Profil's row (UMK-1601, Figma `Mobile/Profile`
 * 14980:77345): 52 tall with no inset of its own, the glyph and the direction glyph bare at 18 in
 * the default ink, no tile, a Medium 14 label and a SemiBold 14 value.
 *
 * PRESS: the identity press through `PressableScaleHost`, whose paint stays on the pressable, and
 * the `surface.weak.brand` tint while a finger is down. A `tile` row presses at
 * `motion.scale.press.default` and its tint snaps on; a `plain` row presses at the `card` scale and
 * its tint FADES in over `duration.press` on a layer under the content (UMK-1614), its ↗ nudging
 * `distance.nudge` up and right when it leaves the app. A disabled row neither tints nor moves,
 * and its label greys.
 *
 * DESTRUCTIVE ACTIONS ARE NOT ROWS. "Keluar" and anything like it is a full-width outlined
 * danger button BELOW the groups — `<Button type="ghost" color="danger" width="full">` — never a
 * `ListRow`, however red its glyph. A row reads as "go somewhere"; an action that cannot be undone
 * must not look like one (identity §4.5, §9).
 *
 * An `external` row announces itself as a `link`: it leaves the app, which is what a link does. So
 * does a `leavesApp` row whose design draws a chevron.
 */
export const ListRow = ({
  label,
  meta,
  icon,
  trailing = 'none',
  leavesApp = false,
  variant = 'tile',
  value,
  valueTone = 'muted',
  active = false,
  disabled,
  style,
  testID,
  accessibilityState,
  ...props
}: ListRowProps) => {
  const plain = variant === 'plain';
  const glyph = TRAILING_ICON[trailing];
  const isLit = (pressed: boolean) => active || (pressed && !disabled);

  return (
    <PressableScaleHost
      {...props}
      testID={testID}
      scale={plain ? 'card' : 'default'}
      accessibilityRole={trailing === 'external' || leavesApp ? 'link' : 'button'}
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled), selected: active }}
      disabled={disabled}
      style={({ pressed }) => [ROW, plain ? PLAIN_ROW : TILE_ROW, !plain && isLit(pressed) && ROW_TINTED, style]}
    >
      {({ pressed }) =>
        plain ? (
          <PlainRowBody
            lit={isLit(pressed)}
            testID={testID}
            icon={icon}
            label={label}
            meta={meta}
            value={value}
            valueTone={valueTone}
            trailing={trailing}
            disabled={Boolean(disabled)}
          />
        ) : (
          <>
            {icon !== undefined && (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={ICON_TILE}>
                <Icon name={icon} size="md" tint={tokens.brand.b500} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="paragraph" weight="semibold" color={disabled ? 'disable' : 'primary'} numberOfLines={1}>
                {label}
              </Text>
              {meta !== undefined && (
                <Text variant="bodyLg" numberOfLines={1} style={{ color: tokens.text.default.muted }}>
                  {meta}
                </Text>
              )}
            </View>
            {value !== undefined && (
              <Text variant="bodyLg" weight="medium" color={VALUE_TONE[valueTone]} numberOfLines={1}>
                {value}
              </Text>
            )}
            {glyph !== undefined && <Icon name={glyph} size="md" tint={tokens.text.default.muted} />}
          </>
        )
      }
    </PressableScaleHost>
  );
};

ListRow.displayName = 'ListRow';
