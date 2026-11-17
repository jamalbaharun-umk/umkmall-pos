import React from 'react';
import { AccessibilityInfo, Animated, Easing, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { SKELETON_BASE, SKELETON_SHAPE, SKELETON_SHEEN } from './feedback-styles';

type Axes = typeof contract.Skeleton.axes;

export type SkeletonShape = Axes['shape'][number];

const SHAPE = SKELETON_SHAPE satisfies Record<SkeletonShape, ViewStyle>;

export interface SkeletonProps {
  /** `text` is a line, `circle` an avatar, `rect` a block. Size the rest with `style`. */
  shape?: SkeletonShape;
  style?: StyleProp<ViewStyle>;
}

/**
 * One shape primitive and one shimmer.
 *
 * DELIBERATELY SILENT. A skeleton is a placeholder, and a live region firing on every load
 * is noise; the surface owning the loading state does the announcing. Hidden from both
 * platforms' accessibility trees — the contract records it as a divergence rather than
 * leaving it to be "fixed" later.
 *
 * REDUCED MOTION removes the sweep rather than pausing it: a paused keyframe freezes
 * mid-travel and leaves a permanent bright band across the placeholder. The base tint alone
 * is the correct reduced-motion form — still visible, simply static.
 */
export const Skeleton = ({ shape = 'text', style }: SkeletonProps) => {
  const sweep = React.useRef(new Animated.Value(0)).current;
  const [width, setWidth] = React.useState(0);
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setReduceMotion(on));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  React.useEffect(() => {
    if (reduceMotion || width === 0) return;
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, sweep, width]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={onLayout}
      style={[SKELETON_BASE, SHAPE[shape], style]}
    >
      {!reduceMotion && width > 0 && (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: width / 2,
            backgroundColor: SKELETON_SHEEN,
            opacity: 0.6,
            transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-width / 2, width] }) }],
          }}
        />
      )}
    </View>
  );
};

Skeleton.displayName = 'Skeleton';
