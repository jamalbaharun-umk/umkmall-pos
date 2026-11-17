import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from './Icon';
import { EASING, MOTION, PressableScaleHost } from './motion';
import {
  DIALOG_CLOSE,
  DIALOG_HANDLE,
  DIALOG_HANDLE_BAR,
  DIALOG_IDENTITY_SHEET,
  DIALOG_PANEL,
  DIALOG_PRESENTATION,
  DIALOG_TITLE,
  DIALOG_TITLE_BESIDE_CLOSE,
  OVERLAY_SCRIM,
} from './overlay-styles';
import { Text } from './Text';
import { tokens } from './theme';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires when the native Modal is presented; use it to focus controls that open the keyboard. */
  onShow?: () => void;
  children: React.ReactNode;
  /** The visible heading. */
  title?: React.ReactNode;
  /**
   * The supporting line assistive technology hears after the name — the web's
   * `aria-describedby`.
   *
   * NOT RENDERED, on either platform: the web marks its copy visually hidden, and React
   * Native has no visually-hidden text at all, so here it reaches the panel through
   * `accessibilityHint`. That is the platform's own "what this is for, beyond its name"
   * channel, which is exactly what a description is.
   *
   * Native was missing this outright until UMK-986, so a sheet's supporting line was
   * unreachable by a screen reader with nothing failing.
   */
  description?: string;
  /** The accessible name when there is no visible heading. Exactly one of `title` and `label`. */
  label?: string;
  /**
   * Whether the reader can dismiss the sheet by GESTURE — backdrop tap, swipe-down on the
   * handle, Android Back. Default `true`, the ordinary sheet.
   *
   * `false` is the LOCKED sheet (UMK-1075): the backdrop does nothing and is not announced as a
   * control, there is no handle and no swipe, Android Back does nothing. The only exits are
   * `showCloseButton` and the sheet's own actions — so a locked sheet MUST pass
   * `showCloseButton`, which `apps/mobile/src/__tests__/dialogs.test.ts` enforces.
   *
   * Lock a sheet only when a stray dismissal would DISCARD something the reader did — an action
   * already in flight, a reason already typed. Not because the action is irreversible:
   * cancelling a confirmation loses nothing, and the confirm's danger colour is the signal of
   * weight. Pass it as a LITERAL; `overlay-safe-area.test.tsx` refuses a runtime expression,
   * because a scan cannot tell which sheets are locked from one.
   */
  dismissible?: boolean;
  /**
   * `false` makes the backdrop tap do nothing (and not be announced as a control) while Android
   * Back, the swipe on the handle and `showCloseButton` still close the sheet. Default `true`.
   * Distinct from `dismissible={false}`, which locks all three gestures (UMK-1498).
   */
  dismissOnOutsidePress?: boolean;
  /**
   * How far the SHEET must stay clear of the bottom edge, in dp — the gesture-navigation
   * home indicator, in practice (UMK-913). ADDITIVE to the sheet's own 24 padding, so the
   * panel does not move and only its last action gains room.
   *
   * Handed in rather than read here, and the reason is the mechanism rather than the
   * dependency: `app/_layout.tsx` already hands `Toaster` its `topInset` from the one root
   * `SafeAreaProvider`, and a second source of insets is how two answers start disagreeing.
   * `apps/mobile/src/design/safe-area.ts` is the reading end and carries the evidence.
   *
   * `0` is the default and renders exactly what shipped before, so a call site with no inset
   * to give is not forced to invent one — but every sheet in the app passes one, and
   * `overlay-safe-area.test.tsx` enforces that.
   */
  bottomInset?: number;
  /**
   * A sheet of a few short rows (the ⋮ menu on an image, UMK-1702): the content box keeps `spacing.xs` above and below
   * instead of the 24 every sheet carries, so two rows do not float in 100 dp of white. `bottomInset` still adds to it. Default
   * `false` renders exactly what shipped; a sheet with a form or a long list must not pass it. A native-only prop.
   */
  compact?: boolean;
  showCloseButton?: boolean;
  closeLabel?: string;
  /**
   * Draw the native-ui-v2 sheet (docs/guidelines/mobile-design-identity.md §5.3, §7.2): top
   * corners at `radius.3xl`, `shadow.float`, and the identity's motion — the panel slides up on
   * `motion.spring.sheet`, the scrim fades over `motion.duration.base`, and the exit is shorter
   * and eases with `motion.easing.exit`. Default `false` keeps every existing sheet exactly as it
   * shipped; `Menu` passes it. A native-only prop: the web has no identity to opt into.
   */
  identity?: boolean;
  /**
   * A layer drawn INSIDE the sheet's window but outside its panel, over the whole screen — for
   * a message that belongs at the top of the screen while the sheet is up (the OTP sheet's error
   * toast, UMK-1487). A native-only prop, and the reason it exists is the platform: a `Modal` is
   * its own native window, so the app's root `Toaster` draws BENEATH an open sheet and a toast
   * raised from inside one is never seen. The layer is `box-none`, so only its own children take
   * touches; it owns its placement and its motion.
   */
  overlay?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const DISMISS_THRESHOLD = 100;

/** The enter and exit timings. Exit is quicker: the reader has already decided. */
export const DIALOG_ENTER_MS = 260;
export const DIALOG_EXIT_MS = 200;

/* -------------------------------------------------------------------------------------- *
 * A SHEET NEVER PRESENTS OVER ONE THAT IS STILL LEAVING.
 *
 * With the exit animated in-window, a closing sheet's `Modal` stays presented for
 * `DIALOG_EXIT_MS` after `open` goes false. Every "replace" in the app — the account sheet
 * handing over to its dangerous dialogs, a credit refusal handing over to the coin shop, a
 * `Menu` row opening a sheet — closes one sheet and opens another in the SAME commit. Presented
 * at once, that is two sibling native modals up together: iOS presents a modal from the
 * controller that is already presenting the leaving one, and dismissing that one takes whatever
 * sits above it down with it; Android would stack them, which is the "confirmation over a form"
 * the account sheet refuses by design.
 *
 * So an opening sheet WAITS while another sheet is LEAVING, and presents in the commit after the
 * leaving one's modal is gone. Only LEAVING sheets block — two sheets a screen opens on purpose
 * behave as they always did. A NESTED sheet (a `Select` inside a sheet's body) is never blocked by
 * the sheet around it, so ancestry rides a context.
 *
 * WHY THE MARK IS WRITTEN DURING RENDER. The two halves of a replace render in one pass in TREE
 * order, and the opener may come first (`BuyCreditSheet` sits above `CreditRefusalSheet`). The
 * leaving mark is set during render — idempotently, keyed on this dialog's own token — and the
 * opener decides in a LAYOUT effect, which runs only after every render in the pass. Deciding in
 * render would make the answer depend on which sheet is written higher in the file.
 * -------------------------------------------------------------------------------------- */

type Token = object;
const leaving = new Set<Token>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const DialogAncestry = React.createContext<readonly Token[]>([]);

/** The platform's reduce-motion setting — the pattern `Skeleton` reads it with. */
const useReduceMotion = (): boolean => {
  const [reduceMotion, setReduceMotion] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => live && on && setReduceMotion(true));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduceMotion;
};

/**
 * The web `Dialog`, on the core `Modal` — and on a phone that is ALWAYS a bottom sheet.
 *
 * NATIVE HAS NO CENTRED DIALOG (UMK-1075). UMK-913 chose the overlay by reversibility and gave
 * destructive confirmations a centred card; that is retired. What the card bought — no
 * backdrop, no Back, no swipe — is `dismissible={false}`, and the rule for it is narrower:
 * lock a sheet only where a stray dismissal would discard something the reader did. The web
 * `Dialog` keeps its `centered` and its `size` ladder (the card's width); a sheet spans the
 * screen, so native has neither, and the contract records both on its `native` field.
 *
 * `Modal` supplies the portal, the focus containment (`accessibilityViewIsModal`) and the
 * hardware Back hook. Everything the lock needs is decided here from `dismissible`, in one
 * place: `onRequestClose` is Android Back, the scrim `Pressable` is the backdrop tap, and the
 * handle's responder is the swipe — all three consult the same flag.
 *
 * MOTION. The `Modal` itself does not animate (`animationType="none"`): a `slide` modal moves
 * its whole window, scrim included, so the grey rose up from the bottom with the panel. Here
 * the scrim FADES and only the panel SLIDES, both from one `progress` value, and the exit runs
 * on every close path because every close path is `open` going false — the modal stays
 * presented until the exit finishes, and what exits is what was on screen (the children are
 * held while leaving, so a caller that clears its content on close does not blank the panel
 * mid-slide). Under reduce motion the panel does not travel; it fades with the scrim.
 *
 * DRAG-TO-DISMISS carries the web's tuning unchanged: a 100px threshold, a square-root
 * resistance curve past it, and an ignored drag-up branch. `translateY`, on the native
 * driver — the `translate`-not-`transform` rule from `docs/guidelines/swipe-to-close.md`
 * is a CSS concern that does not apply here, but the threshold and curve do. The scrim does
 * not follow the finger; it fades on release, with the exit.
 */
export const Dialog = ({
  open,
  onOpenChange,
  onShow,
  children: liveChildren,
  title: liveTitle,
  label,
  description,
  dismissible = true,
  dismissOnOutsidePress = true,
  bottomInset = 0,
  compact = false,
  showCloseButton = false,
  closeLabel = 'Tutup',
  identity = false,
  overlay,
  style,
}: DialogProps) => {
  const token = React.useRef<Token>({}).current;
  const ancestors = React.useContext(DialogAncestry);
  const lineage = React.useMemo(() => [...ancestors, token], [ancestors, token]);

  /**
   * Whether the `Modal` is up. It turns ON in the layout phase of the commit where `open` is true
   * and no other sheet is leaving — before paint, so an opening is never a frame late — and OFF
   * only when the exit animation finishes.
   */
  const [present, setPresent] = React.useState(false);
  const isLeaving = present && !open;
  if (isLeaving) leaving.add(token);
  else leaving.delete(token);

  React.useLayoutEffect(() => {
    if (!open || present) return;
    const othersLeaving = () => {
      for (const other of leaving) if (other !== token && !ancestors.includes(other)) return true;
      return false;
    };
    if (!othersLeaving()) {
      setPresent(true);
      return;
    }
    const listener = () => {
      if (!othersLeaving()) setPresent(true);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [open, present, ancestors, token]);

  /* The leaving mark comes off when the exit is done (or the dialog unmounts mid-exit), and every
     waiting sheet re-checks. */
  React.useLayoutEffect(() => {
    if (isLeaving) return;
    leaving.delete(token);
    emit();
  }, [isLeaving, token]);
  React.useLayoutEffect(
    () => () => {
      leaving.delete(token);
      emit();
    },
    [token],
  );

  const progress = React.useRef(new Animated.Value(0)).current;
  /* The identity sheet's scrim runs on its own clock (a timing beside the panel's spring); the
     classic sheet keeps both on `progress`, as it always has. */
  const scrim = React.useRef(new Animated.Value(0)).current;
  const offset = React.useRef(new Animated.Value(0)).current;
  const current = React.useRef(0);
  const reduceMotion = useReduceMotion();

  const openRef = React.useRef(open);
  React.useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);

  /* What exits is what was on screen. Held while open, replayed while leaving. */
  const held = React.useRef({ children: liveChildren, title: liveTitle });
  if (open) held.current = { children: liveChildren, title: liveTitle };
  const { children, title } = open ? { children: liveChildren, title: liveTitle } : held.current;

  React.useEffect(() => {
    if (!present) return;
    const animation = identity
      ? identityMotion({ open, reduceMotion, progress, scrim })
      : Animated.timing(progress, {
          toValue: open ? 1 : 0,
          duration: open ? DIALOG_ENTER_MS : DIALOG_EXIT_MS,
          easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
          useNativeDriver: true,
        });
    animation.start(({ finished }) => {
      if (!finished || open) return;
      offset.setValue(0);
      setPresent(false);
    });
    return () => animation.stop();
    // `identity` and `reduceMotion` are read at the moment `open` flips, not tracked: a sheet
    // does not restart its entrance because the OS setting resolved mid-slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, present, progress, scrim, offset]);

  /**
   * The sheet is anchored to `flex-end`, so the element the system's bottom bar overlaps is
   * its LAST ACTION — a confirm button, usually. Growing the content's bottom padding lifts
   * that action without moving the panel, its handle or its title.
   *
   * `> 0`, not `!== 0`, is what keeps an unsupplied or zero inset leaving the style OBJECT
   * untouched AND what stops a negative value subtracting from the sheet's own padding.
   */
  const safeBottom = bottomInset;
  const backdropCloses = dismissible && dismissOnOutsidePress;

  /* Guarded on the live `open`: Back or a second scrim tap during the exit is not a second close. */
  const close = React.useCallback(() => {
    if (openRef.current) onOpenChange(false);
  }, [onOpenChange]);

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => dismissible,
        onMoveShouldSetPanResponder: (_e, g) => dismissible && Math.abs(g.dy) > 2,
        onPanResponderMove: (_e, g) => {
          if (g.dy <= 0) {
            current.current = 0;
            offset.setValue(0);
            return;
          }
          const resisted =
            g.dy < DISMISS_THRESHOLD ? g.dy : DISMISS_THRESHOLD + Math.sqrt(g.dy - DISMISS_THRESHOLD) * 8;
          current.current = resisted;
          offset.setValue(resisted);
        },
        onPanResponderRelease: () => {
          const settle = () => Animated.timing(offset, { toValue: 0, duration: 200, useNativeDriver: true }).start();
          if (current.current >= DISMISS_THRESHOLD) {
            close();
            /* The exit carries the panel down from where the finger left it, and resets the
               offset once it is gone. A caller that REFUSES the close (a request in flight)
               leaves the sheet open, and then the panel has to come back. */
            setTimeout(() => openRef.current && settle(), 0);
          } else {
            settle();
          }
          current.current = 0;
        },
        /* A cancelled gesture is not a decision to close. */
        onPanResponderTerminate: () => {
          current.current = 0;
          Animated.timing(offset, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        },
      }),
    [close, dismissible, offset],
  );

  const travel = reduceMotion ? 0 : Dimensions.get('window').height;
  /* Clamped so a spring's overshoot (the identity sheet's `spring.sheet` rings past 1) never
     lifts the panel off the bottom edge; a timing never leaves [0, 1], so the classic sheet is
     unchanged. */
  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [travel, 0], extrapolate: 'clamp' });

  const panel = (
  <Animated.View
    accessibilityViewIsModal={overlay === undefined}
    accessibilityRole="none"
    accessibilityLabel={title === undefined ? label : undefined}
    accessibilityHint={description}
    style={[
      DIALOG_PANEL,
      DIALOG_PRESENTATION.sheet,
      identity && DIALOG_IDENTITY_SHEET,
      reduceMotion && { opacity: progress },
      { transform: [{ translateY: Animated.add(slide, offset) }] },
      style,
    ]}
  >
    {dismissible && (
      <View {...pan.panHandlers} style={DIALOG_HANDLE}>
        <View accessibilityElementsHidden style={DIALOG_HANDLE_BAR} />
      </View>
    )}

    {title !== undefined && (
      <View style={[DIALOG_TITLE, showCloseButton && DIALOG_TITLE_BESIDE_CLOSE]}>
        {typeof title === 'string' ? (
          <Text variant="h4" weight="bold" accessibilityRole="header">
            {title}
          </Text>
        ) : (
          title
        )}
      </View>
    )}

    {/* The identity sheet's X presses like every other tappable in the identity (§7.2), on the
        host so its absolute placement stays on the element that carries the role. */}
    {showCloseButton &&
      (identity ? (
        <PressableScaleHost scale="icon" accessibilityRole="button" accessibilityLabel={closeLabel} onPress={close} style={DIALOG_CLOSE}>
          <Icon name="x" size="md" color="secondary" />
        </PressableScaleHost>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={close} style={DIALOG_CLOSE}>
          <Icon name="x" size="md" color="secondary" />
        </Pressable>
      ))}

    <View
      style={{
        /**
         * `flexShrink: 1` is what makes a tall sheet SCROLLABLE rather than clipped.
         *
         * The panel is capped at 88% of the screen. Without this the content box lays out
         * at its full natural height, overflows the cap, and the excess is simply clipped —
         * and a `ScrollView` inside it never scrolls, because a scroller whose parent does
         * not bound its height believes it already has room for everything. The cap was
         * acting as a crop.
         *
         * Reported on "Tingkatkan Gambar", whose last field could not be reached. That
         * panel had a `ScrollView` all along; it was the box around it that never shrank.
         * A child that scrolls also needs `flexShrink: 1` of its own — RN defaults flex
         * children to `flexShrink: 0`, so one unshrinking wrapper anywhere in the chain
         * restores the bug. `overlay-scroll.test.tsx` pins the chain rather than this line.
         */
        flexShrink: 1,
        padding: compact ? tokens.spacing.xs : tokens.spacing.xl,
        /* The SIDES are the design system's mobile page margin (16), not the 24 the other
           edges keep: a sheet spans the phone's width, and at 24 a 360dp phone lost 48dp to
           gutters — cards clipped at the edge and text wrapped early. `DIALOG_TITLE` uses the
           same value, so the heading and the body share one left edge. */
        paddingHorizontal: tokens.margin.mobile,
        paddingTop: title !== undefined ? tokens.spacing.sm : compact ? tokens.spacing.xs : tokens.spacing.xl,
        ...(safeBottom > 0 && { paddingBottom: (compact ? tokens.spacing.xs : tokens.spacing.xl) + safeBottom }),
      }}
    >
      <DialogAncestry.Provider value={lineage}>{children}</DialogAncestry.Provider>
    </View>
  </Animated.View>
  );

  return (
    <Modal
      visible={present}
      transparent
      /* The window does not move; the scrim fades and the panel slides inside it. */
      animationType="none"
      statusBarTranslucent
      /* The pair, not one of them (UMK-1001). A `Modal` is its own native window, and on an
         edge-to-edge app RN runs that window edge-to-edge ONLY when the navigation bar is
         translucent too — with just the status half it falls back to a non-edge-to-edge window
         carrying the status-bar inset hack, the combination that has long defeated Android's
         keyboard resize inside modals. Expo's edge-to-edge guidance names both flags together. */
      navigationBarTranslucent
      onShow={onShow}
      /* Android Back. Dismisses a sheet; does NOTHING on a locked one, per UMK-1075. */
      onRequestClose={dismissible ? close : () => {}}
    >
      {/* `react-native-keyboard-controller`'s avoiding view is the modal's root, so the keyboard
          pads the WHOLE scene from the bottom (UMK-1001): a sheet anchored to `flex-end` rides up
          with it, and its 88% cap — a percentage of THIS box — shrinks with the box, which is what
          keeps a tall sheet's body scrollable above the keyboard instead of under it. Nothing
          inside the window resizes on its own: with the window edge-to-edge, `adjustResize` is
          inert, so without this a field in the lower half of any sheet is typed into blind.
          The host app supplies the `KeyboardProvider`; context crosses the Modal.

          The NEGATIVE offset gives the sheet's own safe-area padding back while the keyboard is
          up: `safeBottom` exists to clear the system bar, and the keyboard covers that bar, so
          without it the inset shows as a bare strip between the sheet and the keys. */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={-safeBottom}
        pointerEvents={open ? 'auto' : 'none'}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <AnimatedPressable
          accessibilityRole={backdropCloses ? 'button' : 'none'}
          accessibilityLabel={backdropCloses ? closeLabel : undefined}
          importantForAccessibility={backdropCloses ? 'auto' : 'no'}
          onPress={backdropCloses ? close : undefined}
          style={[OVERLAY_SCRIM, { opacity: identity ? scrim : progress }]}
        />
        {overlay === undefined ? (
          panel
        ) : (
          /* With an overlay, the MODAL boundary moves out one level to hold the panel AND the
             overlay: a screen reader confines itself to the `accessibilityViewIsModal` element, so
             on the panel alone it would never reach a toast drawn beside it. Same flex box as the
             avoiding view, so the panel lands where it always does and still rides the keyboard. */
          <View accessibilityViewIsModal pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end' }}>
            {panel}
            <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
              {overlay}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The identity sheet's motion (§7.2 "Sheet", §7.3), every value from `tokens.motion`.
 *
 * IN: the panel springs up on `spring.sheet` while the scrim fades in over `duration.base` with
 * `easing.standard`. OUT: shorter than in, both on `easing.exit` — the panel over `duration.base`
 * (the spring's travel runs well past that) and the scrim over `duration.fast`. The exit finishes
 * when the panel does, which is when the modal unmounts.
 *
 * REDUCED MOTION (§7.3 rule 5): no spring and no travel — the panel already only fades under it
 * (see `travel`), and the entrance becomes a plain `duration.fast` fade.
 */
const identityMotion = ({
  open,
  reduceMotion,
  progress,
  scrim,
}: {
  open: boolean;
  reduceMotion: boolean;
  progress: Animated.Value;
  scrim: Animated.Value;
}): Animated.CompositeAnimation => {
  if (open) {
    return Animated.parallel([
      reduceMotion
        ? Animated.timing(progress, { toValue: 1, duration: MOTION.duration.fast, easing: EASING.standard, useNativeDriver: true })
        : Animated.spring(progress, { toValue: 1, ...MOTION.spring.sheet, useNativeDriver: true }),
      Animated.timing(scrim, {
        toValue: 1,
        duration: reduceMotion ? MOTION.duration.fast : MOTION.duration.base,
        easing: EASING.standard,
        useNativeDriver: true,
      }),
    ]);
  }
  return Animated.parallel([
    Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotion ? MOTION.duration.fast : MOTION.duration.base,
      easing: EASING.exit,
      useNativeDriver: true,
    }),
    Animated.timing(scrim, { toValue: 0, duration: MOTION.duration.fast, easing: EASING.exit, useNativeDriver: true }),
  ]);
};

Dialog.displayName = 'Dialog';
