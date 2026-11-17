import React from 'react';
import { Animated, Easing, Modal, Pressable, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import {
  COMPOSER_DRAWER,
  COMPOSER_DRAWER_DISMISS,
  COMPOSER_DRAWER_HANDLE,
  COMPOSER_DRAWER_SUMMARY,
  COMPOSER_DRAWER_TOGGLE,
  COMPOSER_DRAWER_VARIANT,
} from './composer-styles';
import { Icon } from './Icon';
import { MOTION, useReducedMotion } from './motion';
import {
  FLOATING_DRAWER_CONTENT,
  FLOATING_DRAWER_INSET,
  FLOATING_DRAWER_PANEL,
  FLOATING_DRAWER_SCRIM,
  FLOATING_DRAWER_WIDTH,
} from './nav-styles';

type Axes = typeof contract.ChatDrawer.axes;
export type ChatDrawerVariant = Axes['variant'][number];

export interface ChatDrawerProps {
  /**
   * Its own fill. `inherit` PAINTS NOTHING and is the default, because a drawer inside a
   * composer sits on the tray's tint — drawing a filled drawer inside a filled tray is the
   * doubling this vocabulary was corrected out of. The four fills exist for a drawer used
   * OUTSIDE a composer, where nothing supplies a surface.
   *
   * `floating` is a different PRESENTATION, not a fill: the native-ui-v2 chat-history sidebar
   * (docs/guidelines/mobile-design-identity.md §5.2) — an inset white panel over a scrim, on its
   * own modal, driven by `open`/`onDismiss`. The collapse toggle and the corner dismiss are not
   * drawn there; the panel's content brings its own header.
   */
  variant?: ChatDrawerVariant;
  /** Controlled, like `Menu` — the host owns whether it is open. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  collapseLabel?: string;
  /** What shows in place of the content while collapsed — "3 lampiran". */
  collapsedSummary?: React.ReactNode;
  /**
   * Callback-gated, like `Lightbox`: no handler, no control. On `floating` it is the CLOSE: a
   * scrim tap and Android Back call it, and no corner control is drawn — the panel's own header
   * (the host's content) carries the visible close (identity doc §5.2).
   */
  onDismiss?: () => void;
  dismissLabel?: string;
  /**
   * `floating` only: whether the panel is shown. CONTROLLED, like `Dialog`'s `open` — the exit
   * plays when it goes false, and the panel stays mounted until the exit finishes.
   */
  open?: boolean;
  /** `floating` only: the top safe-area inset; the panel starts 8 pt below it. */
  topInset?: number;
  /** `floating` only: the bottom safe-area inset; the panel ends 24 pt above it. */
  bottomInset?: number;
  /** `floating` only: the panel's accessible name ("Riwayat percakapan"). */
  panelLabel?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A CONTAINER, not the attachment list.
 *
 * It holds whatever a surface puts above or below the editor, and it sits OUTSIDE the bordered
 * box — the box carries the focus band, so a drawer inside it made typing draw a focus ring
 * around the attachments.
 *
 * COLLAPSED HIDES THE CHILDREN, it does not unmount them. The web swaps `flex` for `hidden`
 * and keeps the subtree; doing the same here means an image already decoded stays decoded, and
 * a host's per-file upload state is not thrown away by a collapse. `display: 'none'` is the
 * native equivalent and keeps the layout out too.
 */
export const ChatDrawer = ({
  variant = 'inherit',
  collapsed = false,
  onCollapsedChange,
  collapseLabel = 'Sembunyikan lampiran',
  collapsedSummary,
  onDismiss,
  dismissLabel = 'Tutup',
  open = false,
  topInset = 0,
  bottomInset = 0,
  panelLabel,
  children,
  style,
}: ChatDrawerProps) => {
  if (variant === 'floating') {
    return (
      <FloatingDrawer
        open={open}
        onDismiss={onDismiss}
        dismissLabel={dismissLabel}
        topInset={topInset}
        bottomInset={bottomInset}
        panelLabel={panelLabel}
        style={style}
      >
        {children}
      </FloatingDrawer>
    );
  }
  return (
    <View style={[COMPOSER_DRAWER, COMPOSER_DRAWER_VARIANT[variant], style]}>
      {onCollapsedChange !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={collapseLabel}
          accessibilityState={{ expanded: !collapsed }}
          onPress={() => onCollapsedChange(!collapsed)}
          style={COMPOSER_DRAWER_TOGGLE}
        >
          <View accessibilityElementsHidden style={COMPOSER_DRAWER_HANDLE} />
        </Pressable>
      )}

      {collapsed && collapsedSummary !== undefined && <View style={COMPOSER_DRAWER_SUMMARY}>{collapsedSummary}</View>}

      {/* Hidden, never unmounted — see the docblock. */}
      <View
        style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }, collapsed && { display: 'none' }]}
        accessibilityElementsHidden={collapsed}
        importantForAccessibility={collapsed ? 'no-hide-descendants' : 'yes'}
      >
        {children}
      </View>

      {onDismiss !== undefined && (
        <Pressable accessibilityRole="button" accessibilityLabel={dismissLabel} onPress={onDismiss} style={COMPOSER_DRAWER_DISMISS}>
          <Icon name="x" size="sm" color="secondary" />
        </Pressable>
      )}
    </View>
  );
};

ChatDrawer.displayName = 'ChatDrawer';

const EASE_STANDARD = Easing.bezier(...MOTION.easing.standard);
const EASE_EXIT = Easing.bezier(...MOTION.easing.exit);

interface FloatingDrawerProps {
  open: boolean;
  onDismiss?: () => void;
  dismissLabel: string;
  topInset: number;
  bottomInset: number;
  panelLabel?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * `variant="floating"`: the chat-history sidebar (identity doc §5.2) — an inset white panel
 * over a scrim, on its own `Modal` so it covers the tab bar and takes Android Back.
 *
 * MOTION (§7.2 "Sidebar"). ENTER: the panel springs in from `-motion.distance.sidebar` while
 * fading (`motion.spring.sheet`), and the scrim fades over `motion.duration.base`. EXIT: both
 * run over `motion.duration.fast` on `motion.easing.exit` — shorter than the entrance, because
 * the reader has already decided (§7.3 rule 1). Transform and opacity only, on the native
 * driver. Under reduced motion the panel does not travel and the spring becomes a
 * `duration.fast` timing.
 *
 * The `Modal` stays presented until the exit FINISHES, and what exits is what was on screen:
 * the children are held while leaving, so a host that clears its list on close does not blank
 * the panel mid-slide (`Dialog`'s rule).
 */
const FloatingDrawer = ({ open, onDismiss, dismissLabel, topInset, bottomInset, panelLabel, style, children: liveChildren }: FloatingDrawerProps) => {
  const reduce = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();
  const [present, setPresent] = React.useState(open);
  const panel = React.useRef(new Animated.Value(0)).current;
  const scrim = React.useRef(new Animated.Value(0)).current;

  const held = React.useRef(liveChildren);
  if (open) held.current = liveChildren;
  const children = open ? liveChildren : held.current;

  React.useLayoutEffect(() => {
    if (open) setPresent(true);
  }, [open]);

  React.useEffect(() => {
    if (!present) return;
    const animation = open
      ? Animated.parallel([
          reduce
            ? Animated.timing(panel, { toValue: 1, duration: MOTION.duration.fast, easing: EASE_STANDARD, useNativeDriver: true })
            : Animated.spring(panel, { toValue: 1, ...MOTION.spring.sheet, useNativeDriver: true }),
          Animated.timing(scrim, { toValue: 1, duration: MOTION.duration.base, easing: EASE_STANDARD, useNativeDriver: true }),
        ])
      : Animated.parallel([
          Animated.timing(panel, { toValue: 0, duration: MOTION.duration.fast, easing: EASE_EXIT, useNativeDriver: true }),
          Animated.timing(scrim, { toValue: 0, duration: MOTION.duration.fast, easing: EASE_EXIT, useNativeDriver: true }),
        ]);
    animation.start(({ finished }) => {
      if (finished && !open) setPresent(false);
    });
    return () => animation.stop();
  }, [open, present, reduce, panel, scrim]);

  const travel = reduce ? 0 : -MOTION.distance.sidebar;
  const close = () => {
    if (open) onDismiss?.();
  };

  return (
    <Modal
      visible={present}
      transparent
      /* The window does not move: the scrim fades and the panel slides inside it. */
      animationType="none"
      /* The pair, never one half — see `Dialog` (UMK-1001). */
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <Animated.View testID="chat-drawer-scrim" style={[FLOATING_DRAWER_SCRIM, { opacity: scrim }]}>
        {onDismiss !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dismissLabel}
            onPress={close}
            style={{ flex: 1 }}
          />
        )}
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        accessibilityLabel={panelLabel}
        testID="chat-drawer-panel"
        style={[
          FLOATING_DRAWER_PANEL,
          {
            top: FLOATING_DRAWER_INSET.top + Math.max(topInset, 0),
            bottom: FLOATING_DRAWER_INSET.bottom + Math.max(bottomInset, 0),
            /* Never wider than the window less the left inset on both sides. */
            width: Math.min(FLOATING_DRAWER_WIDTH, windowWidth - 2 * FLOATING_DRAWER_INSET.left),
            opacity: panel.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [{ translateX: panel.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) }],
          },
          style,
        ]}
      >
        {/* Solid white (§5.2, UMK-1603), so nothing reads through the panel. */}
        <View style={FLOATING_DRAWER_CONTENT}>
          {children}
        </View>
      </Animated.View>
    </Modal>
  );
};
