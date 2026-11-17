import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import {
  ALERT_BASE,
  ALERT_GLYPH_INK,
  ALERT_INK,
  ALERT_SIZE,
  ALERT_SURFACE,
  ALERT_TREATMENT,
  ALERT_TREATMENT_EDGE,
  ALERT_TREATMENT_GLYPH_TINT,
  ALERT_VARIANT_ICON,
  ALERT_VARIANT_LABEL,
} from './feedback-styles';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Axes = typeof contract.Alert.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type AlertType = Of<'type'>;
export type AlertVariant = Of<'function'>;
export type AlertSize = Of<'size'>;
export type AlertTreatment = Of<'treatment'>;

const SIZE = ALERT_SIZE satisfies Record<AlertSize, unknown>;
const SURFACE = ALERT_SURFACE satisfies Record<AlertType, Record<AlertVariant, string>>;

export interface AlertProps {
  /** `alert` is the inline box; `toast` is the same component on a solid fill, for the host. */
  type?: AlertType;
  /** Figma's `Function`, as this package's standard `variant` prop. Values are Figma's — `danger`, not `error`. */
  variant?: AlertVariant;
  size?: AlertSize;
  /**
   * The look, independently of the severity. `full` is the tinted box this component has
   * always drawn; `accent` adds a left rule, `coach` a full border, `banner` a solid fill.
   *
   * Defaults to `full`, and that arm reads NONE of the treatment tables — so an alert
   * without this prop renders exactly as it did before the axis existed.
   */
  treatment?: AlertTreatment;
  /** The glyph. Defaults per function; pass a node to override, or `null` to drop it. */
  icon?: React.ReactNode;
  /**
   * Whether this element announces itself. An inline alert does; the toast host renders
   * with it OFF and announces from its own live region, so a toast is not spoken twice.
   */
  announce?: boolean;
  /** A trailing slot OUTSIDE the message — the toast host puts its close button here. */
  action?: React.ReactNode;
  /**
   * Caps how many lines of a STRING message are drawn; the rest is cut with an ellipsis. The spoken
   * label is built from the whole string either way, so nothing is lost to a screen reader. The
   * toast host sets it (UMK-1623); an inline alert leaves it unset and wraps freely.
   */
  numberOfLines?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * The glyph an Alert draws when it is given none. Exported (not from the package entry) so the toast
 * host can wrap the SAME glyph in its pop (UMK-1601) rather than keep a second copy of the fork below.
 *
 * The ONE place a type draws a different glyph from its function's default, and the web `Alert`
 * forks in exactly the same spot: Figma's success toast is the filled check — a white disc with
 * the tick knocked out so the green reads through it — while the inline alert keeps lucide's
 * outline on a tint. Two drawings for two jobs, and the registry says neither name may be
 * repointed at the other. So the fork is HERE and not in `ALERT_VARIANT_ICON`: that table still
 * answers for the inline alert, and repointing its `success` would drag the alert somewhere the
 * web's did not go. A second fork turns this into a table; one does not (UMK-1057).
 */
export const alertGlyph = (type: AlertType, fn: AlertVariant, size: AlertSize, treatment: AlertTreatment = 'full') => {
  const name: IconName = type === 'toast' && fn === 'success' ? 'check-circle-filled' : ALERT_VARIANT_ICON[fn];
  const treated = treatment === 'full' ? null : treatment;
  return (
    <Icon
      name={name}
      size={SIZE[size].glyph}
      color={ALERT_GLYPH_INK[type][fn]}
      tint={treated ? ALERT_TREATMENT_GLYPH_TINT[treated][fn] : undefined}
    />
  );
};

/**
 * One Alert for all 24 Figma variants — `type` × `function` × `size`.
 *
 * The severity word (`Berhasil`, `Kesalahan`…) is visually hidden on the web and read out
 * by assistive technology. React Native has no visually-hidden text, so the word is folded
 * into the element's `accessibilityLabel` when the message is a string — which is what a
 * screen reader hears either way.
 */
export const Alert = ({
  type = 'alert',
  variant: fn = 'info',
  size = 'medium',
  treatment = 'full',
  icon,
  announce = type === 'alert',
  action,
  numberOfLines,
  children,
  style,
}: AlertProps) => {
  /* The glyph step is `alertGlyph`'s to read; the box takes the role and the padding. */
  const { role, paddingHorizontal, paddingVertical } = SIZE[size];
  /* `full` takes the original path untouched — see `treatment`'s docblock. */
  const treated = treatment === 'full' ? null : ALERT_TREATMENT[treatment][fn];
  const ink = ALERT_INK[type][fn];
  const content = icon === undefined ? alertGlyph(type, fn, size, treatment) : icon;
  const spoken = typeof children === 'string' ? `${ALERT_VARIANT_LABEL[fn]}: ${children}` : ALERT_VARIANT_LABEL[fn];

  return (
    <View
      accessible={announce}
      accessibilityRole={announce ? 'alert' : undefined}
      accessibilityLabel={spoken}
      accessibilityLiveRegion={announce ? 'assertive' : 'none'}
      style={[
        ALERT_BASE,
        { paddingHorizontal, paddingVertical },
        { backgroundColor: treated ? treated.bg : SURFACE[type][fn] },
        treated && ALERT_TREATMENT_EDGE[treatment as Exclude<AlertTreatment, 'full'>],
        treated?.edge ? { borderColor: treated.edge } : null,
        style,
      ]}
    >
      {content !== null && <View style={{ flexShrink: 0 }}>{content}</View>}
      {typeof children === 'string' ? (
        <Text
          variant={role}
          color={ink}
          numberOfLines={numberOfLines}
          style={[{ flex: 1, minWidth: 0 }, treated ? { color: treated.ink } : null]}
        >
          {children}
        </Text>
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      )}
      {action}
    </View>
  );
};

Alert.displayName = 'Alert';
