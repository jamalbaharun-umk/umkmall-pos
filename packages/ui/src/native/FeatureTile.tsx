import React from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { ICON_REGISTRY, type IconName } from './icon-registry';
import {
  CHECK_SCALE_FROM,
  DISABLED_OPACITY,
  FEATURE_TILE_CHECK,
  FEATURE_TILE_CHECK_MARK_SIZE,
  FEATURE_TILE_GLYPH_SIZE,
  FEATURE_TILE_ICON_BOX,
  FEATURE_TILE_LAYOUT,
  FEATURE_TILE_SELECTED,
  FEATURE_TILE_STACK_BOX,
  FEATURE_TILE_STACK_GLYPH_SIZE,
  FEATURE_TILE_TEXT,
  FEATURE_TILE_TONE,
  MUTED_TEXT,
} from './identity-card-styles';
import { MOTION, PressableScale, useReducedMotion } from './motion';
import { Text } from './Text';
import { tokens } from './theme';

type Axes = typeof contract.FeatureTile.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** The seven identity tones (§2.3) — the same seven words as `surface.tile.*` / `icon.tile.*`. */
export type FeatureTileTone = Of<'tone'>;
export type FeatureTileLayout = Of<'layout'>;

const TONE = FEATURE_TILE_TONE satisfies Record<FeatureTileTone, unknown>;
const LAYOUT = FEATURE_TILE_LAYOUT satisfies Record<FeatureTileLayout, unknown>;

/**
 * A library glyph by name, or a render function for artwork the library does not carry (the
 * app's own template-tile glyphs). Either way the TILE decides the glyph's size and colour, so a
 * caller cannot paint a tone's glyph in the wrong ink.
 */
export type FeatureTileIcon = IconName | ((glyph: { size: number; color: string }) => React.ReactNode);

export interface FeatureTileProps {
  tone: FeatureTileTone;
  icon: FeatureTileIcon;
  title: string;
  /** One line of what it is for (two at most), in `text.default.muted`. */
  description?: string;
  /**
   * The price slot — normally a `CoinChip` fed from the live price book. Omit it when the price is
   * unknown: the tile never shows a guess, and it never computes one either.
   */
  price?: React.ReactNode;
  /**
   * `grid` (the "Pilih Template" card, the solid white card), `row` (the Alat sheet row), or `stack` (the
   * TemanAI home's category tile: the toned square with the name under it, no card, no description).
   */
  layout?: FeatureTileLayout;
  /**
   * NO DEFAULT, like `Chip`'s state: omitting it makes the tile an ACTION; passing it makes it a
   * TOGGLE, with a check slot and checkbox semantics. A tile announcing a selection nobody made is
   * worse than one that announces nothing.
   */
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const renderGlyph = (icon: FeatureTileIcon, color: string, size: number = FEATURE_TILE_GLYPH_SIZE): React.ReactNode => {
  if (typeof icon === 'function') return icon({ size, color });
  const Glyph = ICON_REGISTRY[icon];
  return Glyph ? <Glyph size={size} color={color} /> : null;
};

/**
 * The selected state's two animated halves (§7.2 "Select / toggle"): the brand border and fill
 * CROSSFADE in over `duration.fast`, and the check circle springs from 0.6 to 1 on `spring.press`.
 * Opacity and scale only, on the native driver (§7.3 rule 2). Under reduced motion the spring
 * becomes a `duration.press` timing (rule 5).
 *
 * The first render starts AT the current state rather than animating into it: an entrance is
 * `Enter`'s job, and a pre-selected tile that springs its check on mount announces a tap that
 * never happened.
 */
const useSelection = (selected: boolean) => {
  const fill = React.useRef(new Animated.Value(selected ? 1 : 0)).current;
  const check = React.useRef(new Animated.Value(selected ? 1 : 0)).current;
  const reduce = useReducedMotion();
  const first = React.useRef(true);

  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const to = selected ? 1 : 0;
    const fade = Animated.timing(fill, { toValue: to, duration: MOTION.duration.fast, useNativeDriver: true });
    const pop = reduce
      ? Animated.timing(check, { toValue: to, duration: MOTION.duration.press, useNativeDriver: true })
      : Animated.spring(check, { toValue: to, ...MOTION.spring.press, useNativeDriver: true });
    const both = Animated.parallel([fade, pop]);
    both.start();
    return () => both.stop();
  }, [selected, reduce, fill, check]);

  return {
    fill,
    check,
    checkScale: check.interpolate({ inputRange: [0, 1], outputRange: [CHECK_SCALE_FROM, 1] }),
  };
};

/**
 * A feature tile (identity §4.2): a toned icon tile, a title, one line of purpose, and the
 * price. `grid` is the template grid's solid card; `row` is the Alat sheet's row with the price
 * and the check on the right; `stack` is the TemanAI home's category tile, the square over its name
 * (no description, price or check: Figma draws none).
 *
 * Every press goes through `PressableScale` — `card` depth for the grid tile (a big surface moving
 * 3% reads as a jump), `default` for a row.
 */
export const FeatureTile = ({
  tone,
  icon,
  title,
  description,
  price,
  layout = 'grid',
  selected,
  disabled,
  onPress,
  accessibilityHint,
  style,
  testID,
}: FeatureTileProps) => {
  const isToggle = selected !== undefined;
  const { fill, check, checkScale } = useSelection(Boolean(selected));
  const paint = TONE[tone];
  const isRow = layout === 'row';

  const iconTile = (
    <View style={[FEATURE_TILE_ICON_BOX, { backgroundColor: paint.surface }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {renderGlyph(icon, paint.glyph)}
    </View>
  );

  const checkCircle = isToggle ? (
    <Animated.View
      testID="feature-tile-check"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[FEATURE_TILE_CHECK, { opacity: check, transform: [{ scale: checkScale }] }]}
    >
      <CheckMark />
    </Animated.View>
  ) : null;

  const text = (
    <View style={isRow ? styles.rowText : styles.gridText}>
      <Text variant={FEATURE_TILE_TEXT.title.role} weight={FEATURE_TILE_TEXT.title.weight} numberOfLines={isRow ? 1 : 2}>
        {title}
      </Text>
      {description ? (
        <Text variant={FEATURE_TILE_TEXT.description.role} weight={FEATURE_TILE_TEXT.description.weight} numberOfLines={2} style={MUTED_TEXT}>
          {description}
        </Text>
      ) : null}
    </View>
  );

  return (
    <PressableScale
      scale={isRow ? 'default' : 'card'}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={isToggle ? 'checkbox' : 'button'}
      accessibilityState={{ disabled: Boolean(disabled), ...(isToggle ? { checked: Boolean(selected) } : {}) }}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={[LAYOUT[layout], disabled ? { opacity: DISABLED_OPACITY } : undefined, style]}
    >
      {/* The selected paint, crossfaded rather than swapped. It sits under the content, starts at the
          tile's OUTER edge and takes its radius, so the brand border covers the resting one. */}
      <Animated.View
        pointerEvents="none"
        testID="feature-tile-selected"
        style={[selectedInset(LAYOUT[layout].borderWidth), FEATURE_TILE_SELECTED, { borderRadius: LAYOUT[layout].borderRadius, opacity: fill }]}
      />
      {layout === 'stack' ? (
        <>
          <View style={[FEATURE_TILE_STACK_BOX, { backgroundColor: paint.surface }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {renderGlyph(icon, paint.glyph, FEATURE_TILE_STACK_GLYPH_SIZE)}
          </View>
          <Text variant="bodyLg" weight="medium" numberOfLines={2} style={styles.stackTitle}>
            {title}
          </Text>
        </>
      ) : isRow ? (
        <>
          {iconTile}
          {text}
          {price}
          {checkCircle}
        </>
      ) : (
        <>
          <View style={styles.gridTop}>
            {iconTile}
            <View style={styles.gridTrailing}>
              {price}
              {checkCircle}
            </View>
          </View>
          {text}
        </>
      )}
    </PressableScale>
  );
};

/** The white mark inside the check circle — the library's `check` glyph, sized to the circle. */
const CheckMark = () => {
  const Glyph = ICON_REGISTRY.check;
  return <Glyph size={FEATURE_TILE_CHECK_MARK_SIZE} color={tokens.icon.default.invert} />;
};

FeatureTile.displayName = 'FeatureTile';

/** An absolute box over the tile's OUTER edge: `absoluteFill` alone stops inside the border. */
const selectedInset = (border: number): ViewStyle => ({ position: 'absolute', top: -border, right: -border, bottom: -border, left: -border });

const styles = StyleSheet.create({
  gridTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: tokens.spacing['2xs'] },
  gridTrailing: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing['2xs'] },
  gridText: { gap: tokens.spacing['4xs'] },
  rowText: { flex: 1, minWidth: 0, gap: tokens.spacing['5xs'] },
  /* Figma: 12/500 on an 18 line, centred under the square. */
  stackTitle: { textAlign: 'center', lineHeight: 18 },
});
