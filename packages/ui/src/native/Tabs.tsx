import React from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { TAB_LIST, TAB_NOTIF, TAB_NOTIF_SIZE, TAB_NOTIF_STATE, TAB_SIZE, TAB_STATE, TAB_TRIGGER } from './content-styles';
import { Text } from './Text';

type Axes = typeof contract.Tabs.axes;

export type TabSize = Axes['size'][number];
export type TabState = Axes['state'][number];

const SIZE = TAB_SIZE satisfies Record<TabSize, unknown>;
const STATE = TAB_STATE satisfies Record<TabState, unknown>;

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  size: TabSize;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

const useTabsContext = () => {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('Tabs components must be used within a Tabs component');
  return context;
};

export interface TabsProps {
  /** The active tab. Optional — omit it and the component owns the state. */
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  size?: TabSize;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export interface TabsListProps extends Omit<ViewProps, 'style'> {
  /** Names the tablist. */
  label?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

interface TabsTriggerBase extends Omit<PressableProps, 'style' | 'children'> {
  value: string;
  /** Figma's `Show Icon Left` slot. Decorative — the title carries the name. */
  iconLeft?: React.ReactNode;
  /** Figma's `Show Notif` badge, as the COUNT it displays rather than a boolean. */
  notif?: number;
  /** Names what `notif` counts, for screen readers. Defaults to a bare count. */
  notifLabel?: (count: number) => string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Figma's `Show Title`, as a UNION: hiding the title makes an icon-only tab with no name of
 * its own, so `accessibilityLabel` stops being optional. A compile error rather than an
 * unlabelled control nobody notices until an audit.
 */
export type TabsTriggerProps = TabsTriggerBase &
  ({ showTitle?: true } | { showTitle: false; accessibilityLabel: string });

export interface TabsContentProps extends Omit<ViewProps, 'style'> {
  value: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * The set and its panel SHRINK, because a panel is where a caller puts its `ScrollView` (UMK-1075).
 *
 * React Native defaults every flex child to `flexShrink: 0`. Inside a bounded parent — a sheet
 * capped at 88% of the screen — an unshrinking wrapper lays out at its content's full height, the
 * cap clips the overflow, and a `ScrollView` inside believes it already has room for everything,
 * so it never scrolls. The settings sheet shipped exactly that: Simpan, Hapus Akun and "Keluar dari
 * semua perangkat" cut off on a 640dp phone with nothing to scroll.
 *
 * Harmless where nothing bounds the set: in an unbounded parent (a page `ScrollView`) there is no
 * overflow for shrinking to absorb. The tab list itself does NOT shrink — the triggers are the one
 * row that must stay whole. No `minHeight: 0` either: Yoga has no automatic minimum size, so the
 * web's `min-height: auto` trap does not exist here.
 *
 * Pinned by `__tests__/tabs-shrink.test.ts` in this package, and at the call site by
 * `apps/mobile/src/__tests__/overlay-scroll.test.tsx`.
 */
const SHRINK = { flexShrink: 1 } as const;

/**
 * How far the system text size may enlarge a tab label: one Android step ("Large", 1.15).
 *
 * A tab row is fixed-width chrome — three equal columns of a 360dp sheet — so a label has a known
 * amount of room and an unbounded system scale turns it into "Pera…". The shrink-to-fit that used
 * to absorb that is not portable (see the label below), so the scale is bounded instead and a row
 * is sized to fit at THIS multiplier: the settings sheet at `xsmall`, Informasi Paket at `small`
 * with its two triggers sized by content.
 * Exported so a test asserts against the value rather than a copy of it.
 */
export const TAB_LABEL_MAX_FONT_SCALE = 1.15;

/**
 * A tabbed interface. Which tab is active is a property of the SET — `state` stays a
 * contract axis but never a prop, because a per-trigger flag makes two active tabs
 * representable. Works controlled or uncontrolled.
 *
 * EVERY PANEL STAYS MOUNTED, hidden rather than absent, so a panel's state survives a tab
 * switch the way the web's does.
 */
export const Tabs = ({ value, onValueChange, defaultValue, size = 'large', children, style }: TabsProps) => {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? '');
  const controlled = value !== undefined;
  const active = controlled ? value : uncontrolled;

  const handleChange = React.useCallback(
    (next: string) => {
      if (!controlled) setUncontrolled(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );

  return (
    <TabsContext.Provider value={{ value: active, onValueChange: handleChange, size }}>
      <View style={[SHRINK, style]}>{children}</View>
    </TabsContext.Provider>
  );
};

export const TabsList = ({ label, children, style, ...props }: TabsListProps) => (
  <View {...props} accessibilityRole="tablist" accessibilityLabel={label} style={[TAB_LIST, style]}>
    {children}
  </View>
);

TabsList.displayName = 'TabsList';

export const TabsTrigger = ({
  value,
  iconLeft,
  notif,
  notifLabel,
  showTitle = true,
  children,
  onPress,
  disabled,
  style,
  ...props
}: TabsTriggerProps) => {
  const { value: activeValue, onValueChange, size } = useTabsContext();
  const state: TabState = activeValue === value ? 'active' : 'default';
  const { ink, weight, ...rule } = STATE[state];
  const { role, ...box } = SIZE[size];
  const notifStep = TAB_NOTIF_SIZE[size];

  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: state === 'active', disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={(e) => {
        onValueChange(value);
        onPress?.(e);
      }}
      style={[TAB_TRIGGER, box, rule, style]}
    >
      {iconLeft ? <View accessibilityElementsHidden>{iconLeft}</View> : null}
      {showTitle ? (
        typeof children === 'string' ? (
          /* ONE line, always (UMK-1161): a label that does not fit is clipped with an ellipsis, never
             wrapped — Figma never draws a two-line tab. A row too narrow for its labels takes a
             smaller STEP (`xsmall`, the web's dense bar), never a shrink-to-fit.

             NO `adjustsFontSizeToFit` (UMK-1369). On React Native's new architecture iOS ignores
             `minimumFontScale` (`RCTTextLayoutManager` reads only `minimumFontSize`, default 4pt,
             which JS cannot set), and its search falls back to that floor whenever no ratio passes
             its fit check — which our ABSOLUTE token lineHeight, unchanged by the shrink, can make
             every ratio fail. An idle "Perangkat" in the settings sheet drew at 4pt on iPhone while
             Android, which steps down whole pixels from the full size, looked right.

             What the shrink was really absorbing is the SYSTEM text size, so that is bounded
             instead: see TAB_LABEL_MAX_FONT_SCALE. */
          <Text
            variant={role}
            weight={weight}
            color={ink}
            numberOfLines={1}
            maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_SCALE}
          >
            {children}
          </Text>
        ) : (
          children
        )
      ) : null}
      {notif !== undefined ? (
        <View
          accessible
          accessibilityLabel={notifLabel ? notifLabel(notif) : `${notif}`}
          style={[TAB_NOTIF, { paddingHorizontal: notifStep.paddingHorizontal, paddingVertical: notifStep.paddingVertical }]}
        >
          <Text variant={notifStep.role} color={TAB_NOTIF_STATE[state]}>
            {notif}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
};

TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = ({ value, children, style, ...props }: TabsContentProps) => {
  const { value: activeValue } = useTabsContext();
  const active = activeValue === value;
  return (
    <View
      {...props}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      style={[SHRINK, active ? null : { display: 'none' }, style]}
    >
      {children}
    </View>
  );
};

TabsContent.displayName = 'TabsContent';
