import React from 'react';
import { AccessibilityInfo, Animated, Platform, View } from 'react-native';
import { EASING, MOTION, useReducedMotion } from './motion';
import { Text } from './Text';
import { tokens } from './theme';

/**
 * 0 → 1 while `on` over `motion.duration.fast`, 1 → 0 when it goes off over the shorter
 * `duration.press` with `easing.exit` (§7.3 rule 1: exits are shorter) — the identity's crossfade
 * for a field's focus ring (§7.2 "Select / toggle"). Starts AT its target, so a field mounted
 * focused does not fade in on first paint; only a change animates.
 *
 * `mounted` says whether the faded layer should exist at all: true from the moment `on` turns
 * true until the fade OUT has finished. A layer at opacity 0 is still a layer — it would carry the
 * ring's colour on an unfocused field, which is exactly what the playbook's focus guard rules out.
 */
export const useFieldFade = (on: boolean): { opacity: Animated.Value; mounted: boolean } => {
  const value = React.useRef(new Animated.Value(on ? 1 : 0)).current;
  const [mounted, setMounted] = React.useState(on);
  if (on && !mounted) setMounted(true);

  React.useEffect(() => {
    const anim = on
      ? Animated.timing(value, { toValue: 1, duration: MOTION.duration.fast, easing: EASING.standard, useNativeDriver: true })
      : Animated.timing(value, { toValue: 0, duration: MOTION.duration.press, easing: EASING.exit, useNativeDriver: true });
    anim.start(({ finished }) => {
      if (finished && !on) setMounted(false);
    });
    return () => anim.stop();
  }, [on, value]);
  return { opacity: value, mounted: on || mounted };
};

/**
 * A stable `nativeID` for the control and one for its label.
 *
 * Android reads `accessibilityLabelledBy` against a `nativeID`; iOS does not, so every
 * control ALSO sets `accessibilityLabel` from a string label. Both, or one platform announces
 * an unnamed control.
 */
export const useFieldIds = (id?: string) => {
  const generated = React.useId();
  const fieldId = id ?? generated;
  return { fieldId, labelId: `${fieldId}-label`, errorId: `${fieldId}-error` };
};

/**
 * The labelling pair, as ONE union — the native reading of the web helper of the same name.
 *
 * The arms differ by PLATFORM here, not only by markup: iOS announces from a string
 * `accessibilityLabel`, Android from `accessibilityLabelledBy` against a `nativeID`. The
 * label arm renders a `Text` and wires the id pair; the `accessibilityLabel` arm renders no
 * label element and hands the string straight to the control, which is the only name the
 * A2UI wire format can supply.
 */
export type LabelledProps =
  | { label: React.ReactNode; accessibilityLabel?: never }
  | { label?: never; accessibilityLabel: string };

/**
 * Which arm a caller landed on. Passing both is a compile error, but a plain-JS caller can
 * still do it and "undefined" is not a name a screen reader can read: the visible label wins
 * and the string is dropped, so one control never carries two different names.
 */
export const resolveLabelling = (label: React.ReactNode, accessibilityLabel?: string) =>
  /* `''` counts as ABSENT — see the web helper of the same name for the failure it prevents. */
  label != null && label !== false && label !== ''
    ? { visible: label as React.ReactNode, accessibilityLabel: undefined }
    : { visible: undefined, accessibilityLabel };

/** A string label is what the platforms can announce; a node label is left to its own text. */
export const labelText = (label: React.ReactNode): string | undefined =>
  typeof label === 'string' ? label : undefined;

/**
 * Decorative. The semantics ride the control's own `required`, not this glyph — a screen
 * reader announcing "asterisk" instead of "required" is the failure mode here.
 *
 * Token error red, which is what Figma specifies: the asterisk is bound to **Text/Error**.
 */
export const RequiredMark = () => (
  <Text color="error" accessibilityElementsHidden importantForAccessibility="no">
    {' *'}
  </Text>
);

/**
 * The error region, ALWAYS mounted.
 *
 * Mounting the container and the message together is the trap: Android's live region
 * watches an element for changes, and a region that appears already holding its text may
 * not be announced at all. So the container exists from first render and only its contents
 * change. iOS has no live-region prop, so the message is announced explicitly there — an
 * error that appears under a field and is never spoken is the whole failure.
 *
 * The message ANIMATES IN (identity §7): it fades in while settling down half of
 * `motion.distance.enter`, out from under the control, over `duration.fast` each time a new
 * message lands, rather than snapping. Only the message moves —
 * the region itself never animates, so the live region above stays as it was. Reduce Motion: the
 * same fade with no rise.
 */
export const FieldError = ({ id, message }: { id: string; message?: string }) => {
  React.useEffect(() => {
    if (message && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return (
    <View nativeID={id} accessibilityLiveRegion="polite" style={{ minHeight: message ? undefined : 0 }}>
      {/* Keyed on the message, so a DIFFERENT error replays the entrance and the same one does not. */}
      {message ? <FieldErrorMessage key={message} message={message} /> : null}
    </View>
  );
};

/** The lowest opacity the error message starts from: above 0, so it stays visible to accessibility. */
const ANNOUNCEABLE_OPACITY = 0.01;

const FieldErrorMessage = ({ message }: { message: string }) => {
  const progress = React.useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  React.useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: MOTION.duration.fast,
      easing: EASING.standard,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress]);

  const rise = reduce ? 0 : MOTION.distance.enter / 2;
  return (
    <Animated.View
      testID="field-error-message"
      style={{
        /* Never a true 0. Android's `View.isVisibleToUser` treats a view under an alpha-0 ancestor
           as invisible, and TalkBack can drop the live-region announcement that fires as the text
           lands — exactly the silent-error failure `FieldError` exists to prevent. */
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [ANNOUNCEABLE_OPACITY, 1] }),
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-rise, 0] }) }],
      }}
    >
      <Text variant="bodyLg" color="error">
        {message}
      </Text>
    </Animated.View>
  );
};

/** The label line above a text-shaped box. */
export const FieldLabel = ({
  id,
  label,
  required,
  muted,
}: {
  id: string;
  label: React.ReactNode;
  required?: boolean;
  /** The compact `TextField`'s caption ink (UMK-1548). */
  muted?: boolean;
}) => (
  <Text nativeID={id} variant="bodyLg" weight="medium" style={{ color: muted ? tokens.text.default.muted : tokens.text.default.primary }}>
    {label}
    {required && <RequiredMark />}
  </Text>
);
