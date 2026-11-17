import React from 'react';
import {
  PanResponder,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { contract } from '../contract';
import { FIELD_LABEL, SLIDER_SIZE, SLIDER_THUMB } from './field-styles';
import { labelText, resolveLabelling, useFieldIds, type LabelledProps } from './field-support';
import { Text } from './Text';
import { tokens } from './theme';

type Axes = typeof contract.Slider.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** Track height and thumb diameter per size; the values live in `field-styles.ts`. */
const SIZE = SLIDER_SIZE satisfies Record<Of<'size'>, { track: number; thumb: number }>;

/** A type alias, not an interface: an interface cannot extend the labelling union. */
export type SliderProps = LabelledProps & {
  nativeID?: string;
  size?: Of<'size'>;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  /**
   * Fired once when the user lets go — the end of a drag, or one assistive-technology step. The
   * web's range input gets this for free from `pointerup`/`keyup`; a consumer that writes something
   * on RELEASE (rather than on every frame of a drag) needs the same moment here.
   */
  onSlidingComplete?: (value: number) => void;
  disabled?: boolean;
  /**
   * Turns the raw number into something worth hearing. Without a formatter the raw value is
   * announced, the same as the web's `aria-valuetext` rule.
   */
  formatValue?: (value: number) => string;
  style?: StyleProp<ViewStyle>;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * A single-value slider drawn from tokens. Figma publishes `Slider` 1308:8026 with a `Size`
 * axis only (UMK-1091) — the track and thumb geometry come from it; the rest of the
 * vocabulary is ours, and the disabled fade stays because the set publishes no disabled
 * variant (the contract's recorded divergence, on both surfaces).
 *
 * NO NATIVE MODULE. `@react-native-community/slider` would need a rebuild and a device
 * reinstall for a control two screens might use; a `PanResponder` over two Views is the
 * whole gesture. What the platform range input gives the web for free — the role, the
 * value triple, increment/decrement — is wired here by hand: `adjustable` with
 * `accessibilityActions`, so a screen-reader user steps it without touching the track.
 */
export const Slider = ({
  label,
  accessibilityLabel,
  nativeID,
  size = 'large',
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue,
  onValueChange,
  onSlidingComplete,
  disabled,
  formatValue,
  style,
}: SliderProps) => {
  const { fieldId, labelId } = useFieldIds(nativeID);
  const labelling = resolveLabelling(label, accessibilityLabel);
  /** A bare range input defaults to the MIDDLE of its range, and so does this. */
  const [internal, setInternal] = React.useState(defaultValue ?? (min + max) / 2);
  const current = clamp(value ?? internal, min, max);
  const span = max - min || 1;
  const pct = ((current - min) / span) * 100;
  const { track, thumb } = SIZE[size];

  const width = React.useRef(0);
  const startValue = React.useRef(current);
  const latest = React.useRef({ value, onValueChange, onSlidingComplete, disabled, min, max, step, current });
  latest.current = { value, onValueChange, onSlidingComplete, disabled, min, max, step, current };
  /** The last value this slider emitted, so a release reports where the drag ENDED even when the
   *  parent has not re-rendered with it yet. */
  const lastEmitted = React.useRef(current);

  const commit = React.useCallback((next: number) => {
    const {
      value: controlled,
      onValueChange: emit,
      min: lo,
      max: hi,
      step: inc,
      disabled: off,
    } = latest.current;
    /* Guarded HERE rather than at each caller: the pan responder already refuses to start when
       disabled, but `onAccessibilityAction` is a second entry point — without this an
       assistive-technology user can move a slider the pointer cannot. */
    if (off) return;
    const snapped = clamp(Math.round((next - lo) / inc) * inc + lo, lo, hi);
    if (controlled === undefined) setInternal(snapped);
    lastEmitted.current = snapped;
    emit?.(snapped);
    return snapped;
  }, []);

  const release = React.useCallback(() => {
    if (latest.current.disabled) return;
    latest.current.onSlidingComplete?.(lastEmitted.current);
  }, []);

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !latest.current.disabled,
        onMoveShouldSetPanResponder: () => !latest.current.disabled,
        onPanResponderGrant: (e) => {
          startValue.current = latest.current.current;
          lastEmitted.current = latest.current.current;
          const { min: lo, max: hi } = latest.current;
          if (width.current > 0) commit(lo + (e.nativeEvent.locationX / width.current) * (hi - lo));
        },
        onPanResponderMove: (_e, g) => {
          const { min: lo, max: hi } = latest.current;
          if (width.current > 0) commit(startValue.current + (g.dx / width.current) * (hi - lo));
        },
        onPanResponderRelease: release,
        /* NOT a release: a terminate is another responder (a parent ScrollView) taking the gesture —
           the user is scrolling, not settling a value. Firing `onSlidingComplete` here committed
           whatever value the touch-down landed on, e.g. a price written by a scroll that merely
           started on the slider. */
        onPanResponderTerminate: () => {
          /* …but the drag already moved the value through `onValueChange`, so put it BACK to where
             the gesture started. Leaving it moved shows a value that `onSlidingComplete` never
             committed — on the Calculator, a price on the card that is not the `chosen` on the wire. */
          commit(startValue.current);
        },
      }),
    [commit, release],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    width.current = e.nativeEvent.layout.width;
  };

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') commit(current + step);
    if (e.nativeEvent.actionName === 'decrement') commit(current - step);
    release();
  };

  return (
    <View style={[{ gap: tokens.spacing['2xs'] }, style]}>
      {labelling.visible !== undefined && (
        <Text nativeID={labelId} variant={FIELD_LABEL.role} weight={FIELD_LABEL.weight}>
          {labelling.visible}
        </Text>
      )}
      <View
        nativeID={fieldId}
        accessible
        accessibilityRole="adjustable"
        /* iOS reads the string, Android the id pair — so the label arm sets both and the
           accessibilityLabel arm sets only the string it was given. Wiring `labelledBy` on
           the string arm would point Android at a `Text` that is not rendered. */
        accessibilityLabel={labelling.visible !== undefined ? labelText(labelling.visible) : labelling.accessibilityLabel}
        accessibilityLabelledBy={labelling.visible !== undefined ? labelId : undefined}
        accessibilityState={{ disabled: Boolean(disabled) }}
        accessibilityValue={{ min, max, now: current, text: formatValue ? formatValue(current) : undefined }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
        onLayout={onLayout}
        {...pan.panHandlers}
        /* The hit area is the thumb's height, not the track's: a 12px strip is not a target. */
        style={{ height: thumb, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}
        /* The fade must apply to the slider as ONE layer. Android otherwise fades each child on
           its own, so the half-transparent thumb lets the fill track show through its white
           centre — a half-blue dot, seen on a Pixel 9 (UMK-1121). iOS already groups it. */
        needsOffscreenAlphaCompositing={Boolean(disabled)}
      >
        <View
          style={{
            height: track,
            borderRadius: tokens.radius.full,
            backgroundColor: tokens.surface.default.secondary,
            overflow: 'hidden',
          }}
        >
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: tokens.surface.default.brand }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${pct}%`,
            marginLeft: -thumb / 2,
            width: thumb,
            height: thumb,
            borderRadius: tokens.radius.full,
            ...SLIDER_THUMB,
          }}
        />
      </View>
    </View>
  );
};

Slider.displayName = 'Slider';
