import React from 'react';
import { AccessibilityInfo, Animated, PanResponder, Platform, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { Alert, alertGlyph, type AlertSize, type AlertVariant } from './Alert';
import { ALERT_VARIANT_LABEL, TOAST_CLOSE_GLYPH, toastSizeForWidth } from './feedback-styles';
import { haptic } from './haptics';
import { EASING, MOTION, PressableScaleHost, useReducedMotion } from './motion';
import {
  claimsToastSwipe,
  dismissesOnRelease,
  drawOrder,
  pruneExited,
  reconcileShown,
  takeToastHaptic,
  toastDrag,
  toastSwipeTravel,
} from './toast-exit';
import { isActiveToastHost, registerToastHost, subscribeToastHosts } from './toast-hosts';
import { ICON_REGISTRY } from './icon-registry';
import { ICON_COLOR_VALUES, tokens, type TextColor } from './theme';

/**
 * The toast host and its imperative `toast()` — the native reading of `primitives/Toaster`.
 *
 * The web wraps `sonner`, which is DOM-only. What sonner supplies there — a queue with a
 * cap, a timer per toast, ONE live region, and a close affordance — is small enough to own
 * here, and owning it keeps the consumer contract identical: mount a `<Toaster />` near the
 * root, call `toast(...)` from anywhere.
 *
 * `toast()` is callable OUTSIDE React on purpose (a fetch helper, a store), which is why the
 * queue is a module-level store the host subscribes to rather than a context.
 *
 * NATIVE MAY MOUNT MORE THAN ONE HOST, unlike the web: the root one, and one inside a sheet's `Modal`
 * that must show a toast over itself (a `Modal` is its own window, so the root host draws beneath
 * it). Only the most recently mounted host DRAWS — one toast, one live region (`toast-hosts.ts`);
 * the others render nothing and queue no exits until they are active again.
 */
export interface ToastOptions {
  variant?: AlertVariant;
  /** Defaults from the width — Medium from 768 up, Small below, the web host's own rule. Passing one wins. */
  size?: AlertSize;
  /** Auto-dismiss, in ms. Overrides the host's default for this toast. */
  duration?: number;
  /**
   * Stays until it is closed (its X, or `toast.dismiss`) — no dwell timer. For a message the reader
   * must act on rather than glance at: an OTP lockout or an expired code (UMK-1487). Wins over
   * `duration`.
   */
  sticky?: boolean;
  /** A trailing action node (a retry link, say). Placed before the close button. */
  action?: React.ReactNode;
}

interface ToastEntry extends ToastOptions {
  id: number;
  message: string;
}

type Listener = (entries: readonly ToastEntry[]) => void;

/**
 * The most lines a toast draws (UMK-1623). A toast is a short notice with a close button; a message
 * long enough to wrap past this — a whole AI reply once reached one — would otherwise cover the
 * screen and push its own close button off it. The cut is visual only: `Alert` speaks the whole
 * string, so a screen reader still hears everything.
 */
const TOAST_MAX_LINES = 4;

let nextId = 1;
let queue: readonly ToastEntry[] = [];
const listeners = new Set<Listener>();

const publish = () => listeners.forEach((l) => l(queue));

/** The toasts whose haptic has played (`takeToastHaptic`): module-level, like the queue, because more
 *  than one host can draw the same toast and the phone must tick once. Pruned as each leaves. */
const felt = new Set<number>();

const dismiss = (id: number) => {
  queue = queue.filter((t) => t.id !== id);
  felt.delete(id);
  publish();
};

/** Enqueue a toast. Returns its id, which `toast.dismiss` accepts. */
export const toast = Object.assign(
  (message: string, options: ToastOptions = {}): number => {
    const id = nextId++;
    queue = [...queue, { id, message, ...options }];
    publish();
    /* iOS has no live region: VoiceOver hears a toast only when told, and it is told HERE, once per
       toast, rather than by a host — two hosts can draw the same queue (one under a sheet, one over
       it), and each telling would speak it twice. Android speaks from the host's live region. */
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(`${ALERT_VARIANT_LABEL[options.variant ?? 'info']}: ${message}`);
    return id;
  },
  {
    success: (message: string, o: Omit<ToastOptions, 'variant'> = {}) => toast(message, { ...o, variant: 'success' }),
    info: (message: string, o: Omit<ToastOptions, 'variant'> = {}) => toast(message, { ...o, variant: 'info' }),
    warning: (message: string, o: Omit<ToastOptions, 'variant'> = {}) => toast(message, { ...o, variant: 'warning' }),
    danger: (message: string, o: Omit<ToastOptions, 'variant'> = {}) => toast(message, { ...o, variant: 'danger' }),
    dismiss,
  },
);

export interface ToasterProps {
  /** Queue cap. Anything beyond this waits rather than stacking without limit. */
  visibleToasts?: number;
  /** Auto-dismiss, in ms. Per-toast `duration` overrides it. */
  duration?: number;
  /**
   * Distance from the top edge. The host has no safe-area knowledge on its own — this
   * package carries no Expo dependency — so the app passes its inset. The default clears a
   * status bar on most devices and nothing more.
   */
  topInset?: number;
  closeLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export const Toaster = ({
  visibleToasts = 3,
  duration = 4000,
  topInset = tokens.spacing['3xlMobile'],
  closeLabel = 'Tutup',
  style,
}: ToasterProps) => {
  const [entries, setEntries] = React.useState<readonly ToastEntry[]>(queue);

  React.useEffect(() => {
    listeners.add(setEntries);
    setEntries(queue);
    return () => {
      listeners.delete(setEntries);
    };
  }, []);

  /* ONE host draws the queue: the most recently mounted (`toast-hosts.ts`). A sheet's own host
     claims it while the sheet is up, and the root host renders nothing meanwhile — so the root's
     copy cannot show through the sheet's scrim, and only one live region speaks. Registered in a
     LAYOUT effect, so a sheet's host has claimed the queue before its first paint. */
  const [token] = React.useState<object>(() => ({}));
  const [active, setActive] = React.useState(false);
  React.useLayoutEffect(() => {
    const sync = () => setActive(isActiveToastHost(token));
    const unsubscribe = subscribeToastHosts(sync);
    const unregister = registerToastHost(token);
    sync();
    return () => {
      unsubscribe();
      unregister();
    };
  }, [token]);
  /* A toast that leaves the queue (closed, timed out, dismissed by its caller) stays drawn until its
     exit has played; `leaving` holds it until then. An inactive host queues no exits (`toast-exit.ts`). */
  const visible = entries.slice(0, visibleToasts);
  const [leaving, setLeaving] = React.useState<readonly ToastEntry[]>([]);
  const [shown, setShown] = React.useState<readonly ToastEntry[]>(visible);
  const next = reconcileShown(shown, visible, leaving, active);
  if (next) {
    if (next.leaving !== leaving) setLeaving(next.leaving);
    setShown(next.shown);
  }
  const drawn = drawOrder(visible, leaving);

  if (!active) return null;

  return (
    /* One container, absolutely positioned and non-blocking outside its children, so a toast
       never eats a tap meant for the screen beneath it. */
    <View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={[
        {
          position: 'absolute',
          top: topInset,
          left: tokens.spacing.md,
          right: tokens.spacing.md,
          gap: tokens.spacing['2xs'],
          zIndex: tokens.elevation.overlay,
          elevation: tokens.elevation.overlay,
        },
        style,
      ]}
    >
      {drawn.map((entry) => (
        <ToastItem
          key={entry.id}
          entry={entry}
          leaving={leaving.includes(entry)}
          travel={topInset}
          duration={entry.duration ?? duration}
          closeLabel={closeLabel}
          onExited={() => setLeaving((now) => pruneExited(now, entry))}
        />
      ))}
    </View>
  );
};

Toaster.displayName = 'Toaster';

/**
 * One toast, with the identity's motion (§7.2 "Sheet" applied to a toast): it SLIDES DOWN from above
 * the screen on `spring.sheet` while fading in, and leaves upward over `duration.exit` on
 * `easing.exit`. UMK-1601 adds the rest of Figma's toast:
 *
 * - the success check POPS on `spring.pop`, `delay.toastIcon` after the toast starts in;
 * - a success toast plays the `success` haptic and a danger toast the `error` one, once per toast;
 * - a drag UP follows the finger, and past `TOAST_SWIPE_DISMISS` dismisses it early (shorter drags
 *   spring back on `spring.press`).
 *
 * Reduce Motion: no travel and no pop, a plain fade in over `duration.fast` and out over
 * `duration.exit`. The haptic still plays — it is feedback, not motion.
 */
const ToastItem = ({
  entry,
  leaving,
  travel,
  duration,
  closeLabel,
  onExited,
}: {
  entry: ToastEntry;
  leaving: boolean;
  /** How far above the host's top edge the screen ends — the toast starts that far plus its own height up. */
  travel: number;
  duration: number;
  closeLabel: string;
  onExited: () => void;
}) => {
  const [progress] = React.useState(() => new Animated.Value(0));
  /* The check's pop (success only) and the finger's drag, each its own value. */
  const [pop] = React.useState(() => new Animated.Value(0));
  const [drag] = React.useState(() => new Animated.Value(0));
  /* The `dy` the swipe was claimed at, before the grant zeroed it. */
  const claimDy = React.useRef(0);
  const [height, setHeight] = React.useState<number>(tokens.spacing['3xlMobile']);
  const reduce = useReducedMotion();
  const pops = entry.variant === 'success' && !reduce;

  /* Felt on the first drawing only: a second host drawing the same toast mounts this again. */
  React.useEffect(() => {
    const kind = takeToastHaptic(felt, entry);
    if (kind) haptic(kind);
    // The entry's id is the toast; a re-render with the same id is the same toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const swipe = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => {
          const claims = claimsToastSwipe(g.dx, g.dy);
          if (claims) claimDy.current = g.dy;
          return claims;
        },
        onPanResponderMove: (_e, g) => drag.setValue(toastDrag(g.dy)),
        onPanResponderRelease: (_e, g) => {
          /* Dismissed from where the finger let go: the exit carries it on up from there. The grant
             zeroed `dy`, so the claim's travel is added back — the threshold counts from touch-down. */
          if (dismissesOnRelease(toastSwipeTravel(claimDy.current, g.dy))) dismiss(entry.id);
          else Animated.spring(drag, { toValue: 0, ...MOTION.spring.press, useNativeDriver: true }).start();
        },
        /* Another responder took the gesture: not a decision to dismiss. */
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, ...MOTION.spring.press, useNativeDriver: true }).start(),
      }),
    [drag, entry.id],
  );

  React.useEffect(() => {
    if (entry.sticky) return;
    const timer = setTimeout(() => dismiss(entry.id), duration);
    return () => clearTimeout(timer);
  }, [entry.id, entry.sticky, duration]);

  React.useEffect(() => {
    const anim = leaving
      ? Animated.timing(progress, { toValue: 0, duration: MOTION.duration.exit, easing: EASING.exit, useNativeDriver: true })
      : reduce
        ? Animated.timing(progress, { toValue: 1, duration: MOTION.duration.fast, easing: EASING.standard, useNativeDriver: true })
        : Animated.parallel([
            Animated.spring(progress, { toValue: 1, ...MOTION.spring.sheet, useNativeDriver: true }),
            Animated.sequence([
              Animated.delay(MOTION.delay.toastIcon),
              Animated.spring(pop, { toValue: 1, ...MOTION.spring.pop, useNativeDriver: true }),
            ]),
          ]);
    anim.start(({ finished }) => {
      if (finished && leaving) onExited();
    });
    return () => anim.stop();
    // `onExited` is a fresh closure per render; the animation follows `leaving` alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, reduce, progress, pop]);

  const rise = reduce ? 0 : -(height + travel);
  const ink = entry.variant === 'warning' ? 'primary' : 'invert';

  /* Figma's two sizes, chosen by the width — the same 768 the web host reads (UMK-1057). The web
     reads it ONCE when the toast is raised, because a browser toast does not outlive a rotation
     worth listening for; a hook here follows one, which costs nothing and is the native answer.
     A `size` in the options still wins, as it does there. */
  const { width } = useWindowDimensions();
  const size = entry.size ?? toastSizeForWidth(width);

  return (
    <Animated.View
      {...swipe.panHandlers}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      pointerEvents={leaving ? 'none' : 'box-none'}
      /* A leaving toast is gone for a screen reader at once, whatever its exit still draws. */
      accessibilityElementsHidden={leaving}
      importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'}
      style={{
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
        transform: [{ translateY: Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }), drag) }],
      }}
    >
      <Alert
        type="toast"
        variant={entry.variant ?? 'info'}
        size={size}
        numberOfLines={TOAST_MAX_LINES}
        /* The same glyph the Alert would draw (`alertGlyph`), inside the pop: from nothing to full size
           on `spring.pop`, overshooting once. Not popped under Reduce Motion, or for a toast that is
           not a success. */
        icon={
          <Animated.View style={{ transform: [{ scale: pops ? pop : 1 }] }}>
            {alertGlyph('toast', entry.variant ?? 'info', size)}
          </Animated.View>
        }
        /* The host's own live region announces; the element stays silent so a toast is not
           spoken twice. */
        announce={false}
        action={
          <>
            {entry.action}
            <PressableScaleHost
              scale="icon"
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              hitSlop={tokens.spacing['2xs']}
              onPress={() => dismiss(entry.id)}
            >
              <CloseGlyph px={TOAST_CLOSE_GLYPH[size]} color={ink} />
            </PressableScaleHost>
          </>
        }
      >
        {entry.message}
      </Alert>
    </Animated.View>
  );
};

/**
 * The close glyph at a PIXEL size, through the registry rather than `Icon`.
 *
 * `Icon`'s `size` is the contract's five steps and 18 is not one of them — Figma draws the Small
 * toast's close at 18, the web spells it `h-[18px]`, and widening `Icon` to take a number would hand
 * every screen that escape (the reason `apps/mobile`'s `Glyph` reads the registry directly too). So
 * the one place that needs it reads the same registry `Icon` does, and stays decorative the way
 * `Icon` does: the `Pressable` around it carries the label.
 */
const CloseX = ICON_REGISTRY.x;

const CloseGlyph = ({ px, color }: { px: number; color: TextColor }) => (
  <CloseX
    size={px}
    color={ICON_COLOR_VALUES[color]}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
  />
);
