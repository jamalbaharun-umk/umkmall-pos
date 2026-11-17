'use client';

import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { contract } from '../../contract';
import { useVisualViewport } from '../../hooks';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import type { DataAttributes } from '../overlay-classes';
import {
  DIALOG_CLOSE,
  DIALOG_HANDLE,
  DIALOG_HANDLE_BAR,
  DIALOG_PANEL,
  DIALOG_PRESENTATION,
  DIALOG_SIZE,
  OVERLAY_SCRIM,
} from '../overlay-classes';

type Axes = typeof contract.Dialog.axes;

export type DialogSize = Axes['size'][number];
export type DialogSide = Axes['side'][number];
export type DialogRounded = Axes['rounded'][number];

export interface DialogProps extends DataAttributes {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /**
   * The heading, rendered inside the panel and wired to `aria-labelledby` with a GENERATED
   * id. `Modal.tsx`'s hardcoded `id="modal-title"` collides the moment two dialogs are
   * mounted at once, which points half the labels at one heading.
   */
  title?: React.ReactNode;
  /**
   * OPT-IN class hook for the visible title (UMK-1579). When set it REPLACES the default title
   * class string (no merge), so the caller owns the heading's spacing and type. Left off, the
   * title renders byte-identically to before. Web only; ignored when there is no `title`.
   */
  titleClassName?: string;
  /**
   * The accessible name when there is no visible heading. Exactly one of `title` and `label`
   * is needed; supplying `label` is not a lesser option, it is what a dialog whose heading is
   * its own content already does.
   */
  label?: string;
  /** Visually-hidden description, wired to `aria-describedby`. */
  description?: string;
  size?: DialogSize;
  /**
   * Force the centred card at EVERY width, instead of a bottom sheet below `md`.
   *
   * This flag is not only presentation. It also suppresses drag-to-dismiss and removes the
   * handle, which is what a confirmation dialog for a destructive action relies on: a sheet
   * that swipes away invites a dismissal the user did not mean. Both halves ride one flag so
   * a later edit cannot keep the look and drop the safety.
   */
  centered?: boolean;
  /**
   * A drawer from the left or right edge, at every width (UMK-1186). No drag handle and no
   * gesture: the gesture is vertical, and a side drawer does not dismiss downwards.
   */
  side?: DialogSide;
  /**
   * The bottom sheet takes the full dynamic viewport height (`100dvh`, no top radius) instead of
   * its 88dvh cap; the caller's content scrolls inside it (give the body `flex-1 overflow-y-auto`).
   *
   * It changes ONLY the sheet presentation below `md`. It has no effect on the centred card from
   * `md` up, on `centered` (a centred card is never a sheet), or on a `side` drawer, which is
   * already full height. The swipe-to-dismiss gesture and its handle are unchanged, and
   * `dismissible={false}` still disables them.
   */
  fullHeight?: boolean;
  /**
   * OPT-IN, default false: lift a (non-full-height) bottom sheet above the on-screen keyboard and cap it to the visible
   * height, so a field or button inside it is not covered. With no keyboard open it changes NOTHING (no style; the same computed
   * position and cap, since the vars fall back to the plain sheet's values). Below `md` only; the centred card from `md` up never reads it. Ignored with `fullHeight`, which
   * already follows the visible viewport, and on a `centered` card or a `side` drawer.
   */
  keyboardAware?: boolean;
  /**
   * OPT-IN corner radius of the sheet (top corners below `md`) and the centred card: `lg` is the 24px `ds-2xl` token
   * (UMK-1548), `default` the long-standing `2xl`. It selects one radius token and adds no treatment. No effect on a `side` drawer, which has no rounded edge to choose.
   */
  rounded?: DialogRounded;
  showCloseButton?: boolean;
  /**
   * `false` makes the dialog a lock the user cannot leave by gesture: no close X (it outranks
   * `showCloseButton`), no drag handle, and Escape and an outside press are blocked on THIS
   * layer only (Radix's per-layer `preventDefault`, not a document listener), so a nested
   * popup above it still closes on its own Escape. The caller closes it by state.
   */
  dismissible?: boolean;
  /**
   * `false` blocks ONLY the outside press (a scrim or backdrop tap); the X, Escape and the sheet's
   * swipe-down still close it. Default `true`, so no existing caller changes. Not `dismissible`:
   * that one removes the X, Escape and the swipe together, which is the wrong tool for a popup the
   * reader must still be able to leave on purpose (UMK-1498).
   */
  dismissOnOutsidePress?: boolean;
  /**
   * A busy close: the X stays visible but disabled, and Escape, an outside press and drag are
   * blocked until the prop clears. Distinct from `dismissible={false}`, which hides the X.
   */
  closeDisabled?: boolean;
  /** Accessible name for the close button. Indonesian default, matching the surfaces here. */
  closeLabel?: string;
  className?: string;
  /**
   * Where focus lands when the dialog closes. Radix returns it to the trigger by default and
   * that default is KEPT — see the docblock on the component.
   */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * `centered` and `side` are EXCLUSIVE, in the type rather than at runtime: a centred card has
 * no edge to slide from, so `<Dialog centered side="right">` does not compile. Kept apart from
 * `DialogProps` (which declares both loosely) because the design reference generator reads the
 * required props off that INTERFACE, and a union-typed alias left it reading none.
 */
export type DialogPlacement =
  | { centered?: boolean; side?: 'none' }
  | { centered?: false; side: Exclude<DialogSide, 'none'> };

/**
 * Wraps `@radix-ui/react-dialog`.
 *
 * Replaces seven overlay implementations across 21 call sites, of which exactly one had a
 * working focus trap — and it lived in a file called `FormPanel.tsx`, while the component
 * whose docblock advertised a trap (`Modal.tsx`) contained no Tab handler at all. Trap,
 * focus restore, Escape, scrim click, scroll lock, `aria-modal` and the portal all arrive
 * with the library; hand-rolling them is what produced that split.
 *
 * FOCUS RETURN IS RADIX'S DEFAULT, DELIBERATELY: focus goes back to the element that opened
 * the dialog. Written down rather than inherited silently, because it is a real choice — the
 * alternative is returning to a stable landmark, which reads better when a dialog's own
 * action navigates away and worse in every other case, and every dialog here is opened from
 * a control that still exists when it closes. A caller with the navigating case passes
 * `onCloseAutoFocus` and moves focus itself.
 *
 * PRESENTATION IS FIXED, NOT A PROP LADDER: a bottom sheet below `md`, a centred card from
 * `md` up, and `centered` forces centred everywhere. That is `Modal.tsx`'s existing contract,
 * the most-used of the seven.
 *
 * DRAG-TO-DISMISS LIVES HERE (R3), ported from `apps/main-website/hooks/useSwipeToDismiss.ts`
 * with its 100px threshold, square-root resistance curve, pointer capture and drag-up-ignored
 * branch intact. It is inside the primitive rather than offered to consumers because three
 * separate app-side implementations each had to get the `translate`-not-`transform` rule
 * right on their own, and a fourth would eventually not.
 */
export const Dialog = ({
  open,
  onOpenChange,
  children,
  title,
  titleClassName,
  label,
  description,
  size = 'medium',
  centered = false,
  side = 'none',
  fullHeight = false,
  keyboardAware = false,
  rounded = 'default',
  showCloseButton = false,
  dismissible = true,
  dismissOnOutsidePress = true,
  closeDisabled = false,
  closeLabel = 'Tutup',
  className,
  onCloseAutoFocus,
  ...dataAttributes
}: DialogProps & DialogPlacement) => {
  /* The bottom sheet is the only presentation with a handle and a gesture: a centred card and a
     side drawer both have neither, and one name keeps the two sites from disagreeing. */
  const isSheet = !centered && side === 'none';
  const locked = !dismissible || closeDisabled;
  /* Keyboard-aware sheets: `100dvh` and a bottom-anchored sheet do not move for the on-screen keyboard, so a composer or a
     field would sit under it. With a keyboard actually open, a `fullHeight` sheet gets the `--dialog-sheet-*` vars and a
     lifted (`keyboardAware`, non-full-height) sheet gets the `--dialog-kb-*` vars; nothing else gets any. */
  const lifted = keyboardAware && !fullHeight && isSheet;
  const viewport = useVisualViewport(open && isSheet && (fullHeight || lifted));
  const keyboardOpen = viewport !== null && viewport.inset > 0;
  const drag = useDragToDismiss({
    enabled: open && isSheet && !locked,
    onDismiss: () => onOpenChange(false),
  });

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        onOpenChange(next);
      }}
    >
      {/* Portal is INTERNAL. Nothing Radix leaks from this module's exports; a consumer that
          needs the panel somewhere other than the body is describing a different component. */}
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={OVERLAY_SCRIM}
          /* The scrim fades WITH the drag, so a half-pulled sheet reads as half-dismissed
             rather than as a sheet sliding under an unchanged backdrop. */
          style={drag.offset > 0 ? { opacity: Math.max(0, 1 - drag.offset / 300) } : undefined}
        />
        <RadixDialog.Content
          {...dataAttributes}
          /* SET BY US, not by Radix. Radix renders `role="dialog"` and traps focus but emits
             no `aria-modal`, so a screen reader is never told the page behind is inert — the
             trap is real and unannounced. Hardcoded rather than exposed: this component has
             no non-modal form, and a caller that wants one is describing a popover. */
          aria-modal="true"
          /* Radix points `aria-describedby` at its own Description by default and warns when
             there is none. Passing the prop as an explicit `undefined` is how it is told
             there is deliberately no description — spread rather than written inline,
             because writing `aria-describedby={undefined}` unconditionally would also
             disconnect a description that IS there. */
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={locked ? (e) => e.preventDefault() : undefined}
          onInteractOutside={(e) => {
            // A toast is rendered by the app-root <Toaster/>, outside this portal, so pressing it
            // reads as an outside press. It must never close the dialog it reports on.
            const target = e.target as Element | null;
            if (locked || !dismissOnOutsidePress || target?.closest?.('[data-sonner-toaster]')) e.preventDefault();
          }}
          className={cn(
            DIALOG_PANEL,
            side !== 'none'
              ? DIALOG_PRESENTATION[side]
              : centered
                ? DIALOG_PRESENTATION[rounded === 'lg' ? 'centeredLg' : 'centered']
                : fullHeight
                  ? DIALOG_PRESENTATION[rounded === 'lg' ? 'sheetFullHeightLg' : 'sheetFullHeight']
                  : DIALOG_PRESENTATION[rounded === 'lg' ? 'sheetLg' : 'sheet'],
            DIALOG_SIZE[size],
            /* `keyboardAware`: the sheet rides the keyboard through two vars that exist only while one is open, so the
               fallbacks keep the closed state identical to the plain sheet. */
            lifted && 'bottom-[var(--dialog-kb-inset,0px)] max-h-[min(88dvh,var(--dialog-kb-h,88dvh))]',
            className,
          )}
          style={{
            ...(keyboardOpen && fullHeight
              ? ({
                  '--dialog-sheet-h': `${viewport.height}px`,
                  '--dialog-sheet-top': `${viewport.offsetTop}px`,
                } as React.CSSProperties)
              : null),
            ...(keyboardOpen && lifted
              ? ({
                  '--dialog-kb-inset': `${viewport.inset}px`,
                  '--dialog-kb-h': `${viewport.height}px`,
                } as React.CSSProperties)
              : null),
            /* `translate`, NOT `transform`. Radix's `animate-in` sets
               `animation-fill-mode: both`, which pins `transform` to the animation's final
               keyframe and makes an inline transform silently ignored — and the centred
               branch uses `-translate-x-1/2` for its own centring, which an inline transform
               would overwrite outright. See docs/guidelines/swipe-to-close.md. */
            translate: drag.offset > 0 ? `0 ${drag.offset}px` : undefined,
            transition: drag.isDragging ? 'none' : 'translate 200ms ease-out',
          }}
        >
          {/* ONE labelling mechanism, always a real element. A dialog with no visible
              heading gets a visually-hidden Title carrying `label` rather than a bare
              `aria-label` attribute: Radix requires a Title in the tree regardless, so the
              attribute form would leave the element there and unused, and two ways to name
              the same dialog is how a label ends up on neither.

              `AspectRatioPickerModal` names itself this way today and migrates with no
              visual change — the id is Radix's own, generated per instance, which is the
              fix for `Modal.tsx`'s hardcoded `id="modal-title"` colliding between two
              mounted dialogs. */}
          {title === undefined ? (
            <RadixDialog.Title className="sr-only">{label}</RadixDialog.Title>
          ) : null}

          {isSheet && dismissible && (
            <div {...drag.handleProps} data-dialog-handle className={DIALOG_HANDLE}>
              <span className={DIALOG_HANDLE_BAR} aria-hidden />
            </div>
          )}

          {title !== undefined && (
            <RadixDialog.Title
              className={
                titleClassName ??
                'px-6 pt-4 text-ds-h5-desktop font-bold text-default-primary md:pt-6'
              }
            >
              {title}
            </RadixDialog.Title>
          )}
          {description !== undefined && (
            <RadixDialog.Description className="sr-only">
              {description}
            </RadixDialog.Description>
          )}

          {showCloseButton && dismissible && (
            /* A real glyph. `components/dialog/dialog.tsx` ships an `sr-only` span with its
               icon commented out, which is an invisible-yet-focusable button in every dialog
               that consumes it. */
            <RadixDialog.Close
              aria-label={closeLabel}
              disabled={closeDisabled}
              className={cn(DIALOG_CLOSE, 'disabled:cursor-not-allowed disabled:opacity-50')}
            >
              <Icon name="x" className="h-5 w-5" />
            </RadixDialog.Close>
          )}

          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};

Dialog.displayName = 'Dialog';

/**
 * The sheet gesture, ported from `apps/main-website/hooks/useSwipeToDismiss.ts`.
 *
 * The tuning is the point and is carried across unchanged: a 100px threshold, a square-root
 * resistance curve past it so the sheet stops tracking the finger one-to-one, pointer capture
 * so move and up still fire once the pointer leaves the handle, and an ignored drag-up branch
 * so pulling the sheet ABOVE its resting position does nothing rather than lifting it off the
 * screen edge.
 *
 * Not exported. A consumer reaching for the gesture directly is the failure this unit exists
 * to prevent; the app-side hook was removed in UMK-959.
 */
const DISMISS_THRESHOLD = 100;

const useDragToDismiss = ({ enabled, onDismiss }: { enabled: boolean; onDismiss: () => void }) => {
  const [offset, setOffset] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const startY = React.useRef(0);
  const currentOffset = React.useRef(0);
  const draggingRef = React.useRef(false);

  /* Reset when the gesture is switched ON, not off — a sheet dismissed mid-drag would
     otherwise reopen still holding its last offset.

     ON, because `enabled` is `open && !centered`: a dismissal flips it false IMMEDIATELY,
     while Radix's exit animation is still running. Resetting there snaps the sheet back to
     its resting position and only THEN animates it out — the bounce the 300ms hold in
     `onPointerUp` exists to prevent, reintroduced from the other side. Resetting on the way
     in gets the same guarantee with no race: a reopened sheet always starts at zero. */
  React.useEffect(() => {
    if (enabled) {
      draggingRef.current = false;
      currentOffset.current = 0;
      setOffset(0);
      setIsDragging(false);
    }
  }, [enabled]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    currentOffset.current = 0;
    draggingRef.current = true;
    setIsDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!enabled || !draggingRef.current) return;
    const deltaY = e.clientY - startY.current;
    if (deltaY <= 0) {
      currentOffset.current = 0;
      setOffset(0);
      return;
    }
    const resisted =
      deltaY < DISMISS_THRESHOLD
        ? deltaY
        : DISMISS_THRESHOLD + Math.sqrt(deltaY - DISMISS_THRESHOLD) * 8;
    currentOffset.current = resisted;
    setOffset(resisted);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!enabled || !draggingRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    draggingRef.current = false;
    setIsDragging(false);
    if (currentOffset.current >= DISMISS_THRESHOLD) {
      onDismiss();
      /* Held until the close animation is done. Resetting immediately snaps the sheet back
         to its resting position and THEN animates it out, which reads as a bounce. */
      setTimeout(() => setOffset(0), 300);
    } else {
      setOffset(0);
    }
    currentOffset.current = 0;
  };

  /* A cancelled pointer never fires `pointerup`. Without this the sheet stays frozen at its
     last offset with `draggingRef` still true — open, mid-drag and unresponsive — and the
     browser cancels for ordinary reasons: an incoming call, a system gesture, the pointer
     type changing. Resets like a release below the threshold, and deliberately does NOT
     dismiss: a cancellation is not a decision to close. */
  const onPointerCancel = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    setOffset(0);
    currentOffset.current = 0;
  };

  return {
    offset,
    isDragging,
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
};
