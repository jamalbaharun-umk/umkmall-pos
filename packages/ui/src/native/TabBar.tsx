import React from 'react';
import { Animated, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { haptic } from './haptics';
import { ICON_REGISTRY, type IconName } from './icon-registry';
import { EASING, MOTION, PressableScale, useReducedMotion } from './motion';
import {
  TAB_BAR,
  TAB_BAR_CELL,
  TAB_BAR_HEIGHT,
  TAB_BAR_ICON,
  TAB_BAR_ICON_SIZE,
  TAB_BAR_INDICATOR,
  TAB_BAR_INK,
  TAB_BAR_ITEM,
  TAB_BAR_LAYER,
  TAB_BAR_ROW,
  tabIndicatorEdges,
  tabIndicatorTransform,
  type IndicatorArith,
} from './nav-styles';
import { Text } from './Text';

export interface TabBarItem {
  /** Stable id. Under expo-router this is the ROUTE NAME (see `navigatorTabBar`). */
  key: string;
  label: string;
  /** A registered icon name, drawn while the tab is inactive — the V2 set is `nav-chat`, `nav-jalur`, `nav-aktivitas`, `nav-profil`. */
  icon: IconName;
  /** Drawn while the tab is active — Figma's filled twin (`nav-chat-active`, …). Without one, `icon` in the active ink. */
  activeIcon?: IconName;
  /** What a screen reader announces, when it should say more than the label. */
  accessibilityLabel?: string;
}

export interface TabBarProps {
  items: readonly TabBarItem[];
  /** The selected item's `key`. A key matching no item draws no indicator. */
  activeKey: string;
  /** Called on every press, the active tab included (a host may scroll it to the top). */
  onSelect: (key: string) => void;
  /** The bottom safe-area inset, added under the bar's own 56. */
  bottomInset?: number;
  /**
   * Steps the bar aside — it slides down out of view and fades, and slides back when this clears.
   * The bar stays MOUNTED while hidden (so it can animate back, and keep its measurements), but it
   * takes no touches and is out of the accessibility tree.
   */
  hidden?: boolean;
  /** Names the tablist for a screen reader. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** One item's animated state, kept by key for the bar's lifetime. */
interface ItemMotion {
  /** 0 → 1: the brand faces of the glyph and the label over the navy ones. */
  on: Animated.Value;
  /** The glyph's scale, popped when the item becomes active. */
  pop: Animated.Value;
}

const motionOf = (motions: Map<string, ItemMotion>, key: string, active: boolean): ItemMotion => {
  let motion = motions.get(key);
  if (!motion) {
    motion = { on: new Animated.Value(active ? 1 : 0), pop: new Animated.Value(1) };
    motions.set(key, motion);
  }
  return motion;
};

/** The newly active item: the faces turn brand and the glyph pops. */
const enter = (motion: ItemMotion, reduce: boolean): Animated.CompositeAnimation[] => {
  const legs = [Animated.timing(motion.on, { toValue: 1, duration: MOTION.duration.fast, easing: EASING.standard, useNativeDriver: true })];
  motion.pop.setValue(1);
  if (!reduce) {
    legs.push(
      Animated.sequence([
        Animated.timing(motion.pop, { toValue: MOTION.pop.squash, duration: MOTION.duration.press, easing: EASING.standard, useNativeDriver: true }),
        Animated.timing(motion.pop, { toValue: MOTION.pop.overshoot, duration: MOTION.duration.press, easing: EASING.standard, useNativeDriver: true }),
        Animated.spring(motion.pop, { toValue: 1, ...MOTION.spring.press, useNativeDriver: true }),
      ]),
    );
  }
  return legs;
};

/** The item being left: the faces turn navy again. */
const leave = (motion: ItemMotion): Animated.CompositeAnimation[] => {
  motion.pop.setValue(1);
  return [Animated.timing(motion.on, { toValue: 0, duration: MOTION.duration.fast, easing: EASING.standard, useNativeDriver: true })];
};

/** The indicator's two edges, in px from the row's left. */
interface Edges {
  left: Animated.Value;
  right: Animated.Value;
}

/**
 * The indicator travels to `to`. The edge on the side it travels towards goes first on
 * `spring.snappy`; the other follows one `stagger.step` later, so the line stretches then settles.
 * Under reduced motion both edges move together over `duration.press`: no stretch.
 */
const slide = (edges: Edges, from: number, to: number, itemWidth: number, reduce: boolean): Animated.CompositeAnimation[] => {
  const target = tabIndicatorEdges(to, itemWidth);
  if (reduce) {
    return [
      Animated.timing(edges.left, { toValue: target.left, duration: MOTION.duration.press, easing: EASING.standard, useNativeDriver: true }),
      Animated.timing(edges.right, { toValue: target.right, duration: MOTION.duration.press, easing: EASING.standard, useNativeDriver: true }),
    ];
  }
  const towardsRight = to > from;
  const lead = towardsRight ? edges.right : edges.left;
  const trail = towardsRight ? edges.left : edges.right;
  return [
    Animated.spring(lead, { toValue: towardsRight ? target.right : target.left, ...MOTION.spring.snappy, useNativeDriver: true }),
    Animated.sequence([
      Animated.delay(MOTION.stagger.step),
      Animated.spring(trail, { toValue: towardsRight ? target.left : target.right, ...MOTION.spring.snappy, useNativeDriver: true }),
    ]),
  ];
};

/** The indicator's formula on `Animated` nodes — the same one `tab-indicator.test.ts` checks on numbers. */
type AnimatedNumber = Animated.Value | Animated.AnimatedAddition<number> | Animated.AnimatedMultiplication<number>;
const ANIMATED: IndicatorArith<AnimatedNumber> = {
  add: (a, b) => Animated.add(a, b),
  scale: (a, k) => Animated.multiply(a, k),
};

/**
 * The bottom tab bar (docs/guidelines/mobile-design-identity.md §5.1; Figma "Teman AI v2", UMK-1604):
 * a white bar on the bottom edge, four equal items, each a glyph over its label, and a 2 pt brand
 * line on the top edge of the active item.
 *
 * PRESENTATIONAL. It takes items, the active key and a callback, and knows nothing about a
 * router — `@umkmall/ui` carries no expo-router dependency. `navigatorTabBar` below adapts it
 * to expo-router `Tabs`' `tabBar` prop.
 *
 * MOTION (§7.2 "Tab switch", UMK-1602), every value from `MOTION`, every animation on the native
 * driver, transform and opacity only:
 * - the indicator slides to the new item on `spring.snappy` and stretches on the way (`slide`);
 * - the glyph and the label are each drawn TWICE, navy and brand, and the faces crossfade over
 *   `duration.fast`, because colour does not animate on the native driver;
 * - the new glyph pops 1 → `pop.squash` → `pop.overshoot` → 1;
 * - a press on ANOTHER tab plays the selection haptic; a press on the active tab plays nothing here
 *   (the host scrolls it to the top).
 * Under reduced motion there is no pop and no stretch: the indicator moves over `duration.press`.
 *
 * Until the row is measured the indicator is drawn invisible, so it is never seen at a guessed
 * position.
 */
export const TabBar = ({
  items,
  activeKey,
  onSelect,
  bottomInset = 0,
  hidden = false,
  accessibilityLabel,
  style,
}: TabBarProps) => {
  const reduce = useReducedMotion();
  const inset = Math.max(bottomInset, 0);
  const [rowWidth, setRowWidth] = React.useState(0);
  const itemWidth = items.length > 0 ? rowWidth / items.length : 0;
  const activeIndex = items.findIndex((item) => item.key === activeKey);

  const motions = React.useRef(new Map<string, ItemMotion>()).current;
  for (const item of items) motionOf(motions, item.key, item.key === activeKey);
  const edges = React.useRef<Edges>({ left: new Animated.Value(0), right: new Animated.Value(0) }).current;

  /* The animations in flight. A new switch stops the last one and starts from wherever it left
     every value; UNMOUNT stops both, because a native-driver animation left running on a view that
     is gone keeps scheduling work against a dead node (and in Jest fires after teardown). */
  const switching = React.useRef<Animated.CompositeAnimation | null>(null);
  const stepping = React.useRef<Animated.CompositeAnimation | null>(null);
  React.useEffect(
    () => () => {
      switching.current?.stop();
      stepping.current?.stop();
    },
    [],
  );

  /* The key the bar last drew as active: what a switch animates FROM. */
  const shownKey = React.useRef(activeKey);

  /* The row's width, and the indicator placed under the active item without animating — on the
     first measure and on a later resize alike. */
  const onRowLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setRowWidth(width);
    const index = items.findIndex((item) => item.key === shownKey.current);
    if (index < 0 || items.length === 0) return;
    const rest = tabIndicatorEdges(index, width / items.length);
    edges.left.setValue(rest.left);
    edges.right.setValue(rest.right);
  };

  /* Tab switch. Keyed on the key actually CHANGING, so a re-render with a fresh `items` array (the
     adapter filters one per render) never restarts or stops a switch in flight. */
  React.useEffect(() => {
    const from = shownKey.current;
    if (from === activeKey) return;
    shownKey.current = activeKey;
    switching.current?.stop();
    const legs: Animated.CompositeAnimation[] = [];
    for (const item of items) {
      const motion = motionOf(motions, item.key, false);
      if (item.key === activeKey) legs.push(...enter(motion, reduce));
      else if (item.key === from) legs.push(...leave(motion));
    }
    const fromIndex = items.findIndex((item) => item.key === from);
    const toIndex = items.findIndex((item) => item.key === activeKey);
    if (toIndex >= 0 && itemWidth > 0) {
      if (fromIndex >= 0) legs.push(...slide(edges, fromIndex, toIndex, itemWidth, reduce));
      else {
        const rest = tabIndicatorEdges(toIndex, itemWidth);
        edges.left.setValue(rest.left);
        edges.right.setValue(rest.right);
      }
    }
    switching.current = Animated.parallel(legs);
    switching.current.start();
  }, [activeKey, items, reduce, motions, edges, itemWidth]);

  /* Hide and show. Mounted throughout: the first render places it without animating. */
  const shown = React.useRef(new Animated.Value(hidden ? 0 : 1)).current;
  const wasHidden = React.useRef(hidden);
  React.useEffect(() => {
    if (wasHidden.current === hidden) return;
    wasHidden.current = hidden;
    stepping.current?.stop();
    stepping.current = hidden
      ? Animated.timing(shown, {
          toValue: 0,
          duration: reduce ? MOTION.duration.fast : MOTION.duration.base,
          easing: EASING.exit,
          useNativeDriver: true,
        })
      : reduce
        ? Animated.timing(shown, { toValue: 1, duration: MOTION.duration.fast, easing: EASING.standard, useNativeDriver: true })
        : Animated.spring(shown, { toValue: 1, ...MOTION.spring.sheet, useNativeDriver: true });
    stepping.current.start();
  }, [hidden, reduce, shown]);

  const travel = TAB_BAR_HEIGHT + inset;
  const barMotion = {
    opacity: shown.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [reduce ? 0 : travel, 0] }) }],
  };
  const indicator = tabIndicatorTransform(ANIMATED, edges.left, edges.right, itemWidth);

  return (
    <Animated.View
      testID="tab-bar"
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      pointerEvents={hidden ? 'none' : 'auto'}
      style={[TAB_BAR, { paddingBottom: inset }, barMotion, style]}
    >
      <View style={TAB_BAR_ROW} onLayout={onRowLayout} testID="tab-bar-row">
        {items.map((item) => {
          const motion = motionOf(motions, item.key, item.key === activeKey);
          const off = motion.on.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
          const Glyph = ICON_REGISTRY[item.icon];
          const ActiveGlyph = ICON_REGISTRY[item.activeIcon ?? item.icon];
          return (
            <View key={item.key} style={TAB_BAR_CELL} testID={`tab-bar-cell-${item.key}`}>
              <PressableScale
                scale="icon"
                testID={`tab-bar-item-${item.key}`}
                accessibilityRole="tab"
                accessibilityLabel={item.accessibilityLabel ?? item.label}
                accessibilityState={{ selected: item.key === activeKey }}
                onPress={() => {
                  if (item.key !== activeKey) haptic('selection');
                  onSelect(item.key);
                }}
                style={TAB_BAR_ITEM}
              >
                <Animated.View style={[TAB_BAR_ICON, { transform: [{ scale: motion.pop }] }]}>
                  <Animated.View testID={`tab-bar-glyph-${item.key}-off`} style={[TAB_BAR_LAYER, { opacity: off }]}>
                    <TabGlyph Glyph={Glyph} state="inactive" />
                  </Animated.View>
                  <Animated.View testID={`tab-bar-glyph-${item.key}-on`} style={[TAB_BAR_LAYER, { opacity: motion.on }]}>
                    <TabGlyph Glyph={ActiveGlyph} state="active" />
                  </Animated.View>
                </Animated.View>
                {/* The tab's accessible name is on the pressable, so both faces stay out of the tree. */}
                <View>
                  <Animated.View style={{ opacity: off }}>
                    <TabLabel label={item.label} state="inactive" />
                  </Animated.View>
                  <Animated.View testID={`tab-bar-label-${item.key}-on`} style={[TAB_BAR_LAYER, { opacity: motion.on }]}>
                    <TabLabel label={item.label} state="active" />
                  </Animated.View>
                </View>
              </PressableScale>
            </View>
          );
        })}
        <Animated.View
          testID="tab-bar-indicator"
          pointerEvents="none"
          style={[
            TAB_BAR_INDICATOR,
            { width: itemWidth, opacity: itemWidth > 0 && activeIndex >= 0 ? 1 : 0, transform: [{ translateX: indicator.translateX }, { scaleX: indicator.scaleX }] },
          ]}
        />
      </View>
    </Animated.View>
  );
};

TabBar.displayName = 'TabBar';

const TabGlyph = ({ Glyph, state }: { Glyph: (typeof ICON_REGISTRY)[IconName]; state: keyof typeof TAB_BAR_INK }) => (
  <Glyph
    size={TAB_BAR_ICON_SIZE}
    color={TAB_BAR_INK[state]}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
  />
);

/* Figma's 12/18 label is the mobile `bodyLg` step exactly. Brand `#0074E7` on white sits at the
   4.5:1 floor (identity §4.4), which this size meets. */
const TabLabel = ({ label, state }: { label: string; state: keyof typeof TAB_BAR_INK }) => (
  <Text
    variant="bodyLg"
    weight="semibold"
    numberOfLines={1}
    style={{ color: TAB_BAR_INK[state] }}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
  >
    {label}
  </Text>
);

/* ---------------------------------------------------------------------------------------- *
 * The expo-router adapter
 * ---------------------------------------------------------------------------------------- */

/**
 * The slice of `@react-navigation/bottom-tabs`' `BottomTabBarProps` the adapter reads, written
 * structurally so this package takes no navigation dependency. expo-router's `Tabs` hands its
 * `tabBar` render prop exactly this shape.
 */
export interface TabNavigatorBarProps {
  state: { index: number; routes: readonly { key: string; name: string }[] };
  navigation: {
    emit(event: { type: 'tabPress'; target: string; canPreventDefault: true }): { defaultPrevented: boolean };
    navigate(name: string): void;
  };
  insets: { bottom: number };
}

/**
 * Adapts `TabBar` to expo-router: `<Tabs tabBar={navigatorTabBar(ITEMS)}>`.
 *
 * An item's `key` is its ROUTE NAME. Routes with no item (a hidden `href: null` screen) get no
 * tab. A press does what the stock bar does: emit `tabPress` (so a screen can prevent it, or
 * scroll to the top when it is already focused) and navigate only when the route is not
 * focused and nothing prevented it. The bottom safe area comes from the navigator's insets.
 *
 * Hiding the bar on pushed screens and the chat thread (§5.1) is the HOST's routing decision
 * and is not made here. A host that steps the bar aside for a moment (the keyboard) passes
 * `hidden` alongside the navigator's props; the bar animates out and stays mounted.
 */
export const navigatorTabBar =
  (items: readonly TabBarItem[], options: { accessibilityLabel?: string } = {}) =>
  ({ state, navigation, insets, hidden }: TabNavigatorBarProps & { hidden?: boolean }) => {
    const focused = state.routes[state.index];
    const visible = items.filter((item) => state.routes.some((route) => route.name === item.key));
    return (
      <TabBar
        items={visible}
        activeKey={focused?.name ?? ''}
        bottomInset={insets.bottom}
        hidden={hidden}
        accessibilityLabel={options.accessibilityLabel}
        onSelect={(name) => {
          const route = state.routes.find((r) => r.name === name);
          if (!route) return;
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (route.key !== focused?.key && !event.defaultPrevented) navigation.navigate(route.name);
        }}
      />
    );
  };
