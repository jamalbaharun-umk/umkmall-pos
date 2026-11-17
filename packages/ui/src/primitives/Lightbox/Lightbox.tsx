'use client';

import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon, type IconName } from '../Icon';
import type { DataAttributes } from '../overlay-classes';
import {
  LIGHTBOX_ACTION,
  LIGHTBOX_ACTIONS,
  LIGHTBOX_BAR,
  LIGHTBOX_BODY,
  LIGHTBOX_BAR_ACTION,
  LIGHTBOX_CLOSE,
  LIGHTBOX_CLOSE_ROUND,
  LIGHTBOX_IMAGE,
  LIGHTBOX_MEDIA,
  LIGHTBOX_PANEL,
  LIGHTBOX_SCRIM,
  LIGHTBOX_SCRIM_LIGHT,
} from '../lightbox-classes';

type Axes = typeof contract.Lightbox.axes;
export type LightboxScrim = Axes['scrim'][number];

/** One labelled action in the bar (UMK-1690). An `href` renders through `linkAs`; otherwise a button calls `onSelect`. */
export interface LightboxAction {
  key: string;
  icon: IconName;
  label: string;
  href?: string;
  onSelect?: () => void;
}

export interface LightboxProps extends DataAttributes {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The image to show. Any src the browser accepts — see the docblock on the image below. Omitted when
   * `media` supplies the body instead.
   */
  src?: string;
  /**
   * A body the app owns, in place of the image (UMK-1690): the gallery's video player, which lives in the app.
   * Bounded like the image. Supply this OR `src`.
   */
  media?: React.ReactNode;
  /**
   * The backdrop (UMK-1690). `default` is the dense one every chat caller has; `light` is the viewer over a light
   * page (Figma `15055:57360`), and it brings the 48px round close with it, because the two are one visual decision.
   */
  scrim?: LightboxScrim;
  /**
   * A labelled action bar under the body: a white pill, the icon above each label (UMK-1690). Absent, there is no
   * bar, so the callbacks below are untouched. The caller decides which actions an item can do: hidden, not broken.
   */
  actions?: readonly LightboxAction[];
  /**
   * What renders an action with an `href`: `next/link` from the app, so this package never imports `next`
   * (the render-slot rule `Image`'s `as` follows). A plain anchor by default.
   */
  linkAs?: React.ElementType;
  alt?: string;
  /**
   * The accessible name. There is no visible heading here, so this is carried by a
   * visually-hidden Title element rather than by a naming attribute — the same rule `Dialog`
   * follows, and for the same reason.
   */
  label?: string;
  /** Supply one to get the affordance. Absent callback, absent control. */
  onDownload?: () => void;
  onShare?: () => void;
  downloadLabel?: string;
  shareLabel?: string;
  closeLabel?: string;
  className?: string;
  /** Where focus lands on close. Radix returns it to the trigger by default, and that is kept. */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * A full-bleed image viewer.
 *
 * COMPOSES RADIX DIALOG DIRECTLY RATHER THAN WIDENING `Dialog` (KTD4). `Dialog`'s docblock
 * says its presentation is fixed and not a prop ladder, and it hardcodes its modality claim
 * because it has no non-modal form. Adding a full-bleed presentation to it would reverse both
 * of those written-down decisions to serve one component; a separate primitive leaves them
 * intact. What the two share is the class-table siting, the labelling rule and the no-exit-
 * animation rule — not their chrome.
 *
 * IT IS MODAL, so the scroll lock, the focus trap, the background inertness and the
 * `aria-modal` announcement all travel together. Turning the Radix root non-modal is a
 * one-word edit that drops the first three and leaves the fourth — a viewer that goes on
 * SAYING it is modal after it stopped being modal. If this ever becomes non-modal, the
 * announcement goes in the SAME edit. `lightbox.stories.test.tsx` reads the side effects
 * rather than the attribute, because the attribute could not tell.
 *
 * NO ZOOM, NO PAN, NO GALLERY. The component this replaces has none of them, and inventing
 * them here would ship an interaction surface with no consumer to validate it against.
 *
 * NO SWIPE-TO-DISMISS (KTD10). Drag-to-dismiss lives inside `Dialog` and is module-private
 * precisely because three app-side implementations each had to get the `translate`-not-
 * `transform` rule right alone. A fourth belongs in a shared module with `Dialog` moved onto
 * it in the same change, or nowhere — and nothing needs it here.
 */
export const Lightbox = ({
  open,
  onOpenChange,
  src,
  alt = '',
  label = 'Pratinjau gambar',
  media,
  scrim = 'default',
  actions,
  linkAs: LinkAs = 'a',
  onDownload,
  onShare,
  downloadLabel = 'Unduh',
  shareLabel = 'Bagikan',
  closeLabel = 'Tutup',
  className,
  onCloseAutoFocus,
  ...dataAttributes
}: LightboxProps) => {
  /* Where the PRESS started. A `click` targets the common ancestor of its mousedown and its
     mouseup, so a drag that begins on the image and ends on the panel reports the panel as
     the target — and dismissing on that closes the viewer on every slipped press and every
     text selection that ends outside. Deciding on pointerdown is what Radix's own
     outside-press does, and for this reason. */
  const pressedPanel = React.useRef(false);
  const hasBar = !!actions && actions.length > 0;

  return (
  <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    {/* Portal is INTERNAL, as it is on `Dialog`: nothing Radix leaks from this module. */}
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={scrim === 'light' ? LIGHTBOX_SCRIM_LIGHT : LIGHTBOX_SCRIM} />
      <RadixDialog.Content
        {...dataAttributes}
        data-lightbox
        /* SET BY US. Radix renders the dialog role and traps focus but emits no `aria-modal`,
           so a screen reader is never told the page behind is inert. See the docblock: this
           attribute and the modality it claims are one edit, never two. */
        aria-modal="true"
        /* There is deliberately no description — an image viewer's content is the image. */
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(LIGHTBOX_PANEL, className)}
        /* The panel IS the full-bleed surface, so Radix's outside-press never fires: there is
           no outside. Clicking the backdrop is the dismissal every viewer has, so it is
           handled here, and only when the press landed on the panel itself rather than on the
           image or a control. */
        onPointerDown={(event) => {
          pressedPanel.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          const dismiss = pressedPanel.current && event.target === event.currentTarget;
          /* Reset unconditionally: a press that began on the image must not leak into the
             next interaction, which is exactly what a reset on the dismissing branch alone
             would let it do. */
          pressedPanel.current = false;
          if (dismiss) onOpenChange(false);
        }}
      >
        {/* ONE labelling mechanism, always a real element — `Dialog`'s rule. Radix requires a
            Title in the tree regardless, so a naming attribute would leave this element here
            and unused, and two ways to name one dialog is how a label ends up on neither. */}
        <RadixDialog.Title className="sr-only">{label}</RadixDialog.Title>

        {(onDownload || onShare) && (
          <div className={LIGHTBOX_ACTIONS}>
            {onDownload && (
              <button
                type="button"
                data-lightbox-download
                onClick={onDownload}
                className={LIGHTBOX_ACTION}
              >
                <Icon name="download" className="h-4 w-4" />
                <span>{downloadLabel}</span>
              </button>
            )}
            {onShare && (
              <button type="button" data-lightbox-share onClick={onShare} className={LIGHTBOX_ACTION}>
                <Icon name="share" className="h-4 w-4" />
                <span>{shareLabel}</span>
              </button>
            )}
          </div>
        )}

        <RadixDialog.Close
          data-lightbox-close
          aria-label={closeLabel}
          className={scrim === 'light' ? LIGHTBOX_CLOSE_ROUND : LIGHTBOX_CLOSE}
        >
          <Icon name="x" className={scrim === 'light' ? 'h-6 w-6' : 'h-5 w-5'} />
        </RadixDialog.Close>

        {/* A PLAIN `img`, NOT THE `Image` PRIMITIVE, AND THAT IS DELIBERATE (KTD15).
            `Image` renders its placeholder and NO image element at all for any src that is
            not a remote https one — an SSRF control that is right where a src comes from
            content. This viewer is handed base64 payloads and object URLs by the chat
            surfaces, so routing it through `Image` would blank every generated preview with
            nothing failing to compile and nothing failing at runtime. The guard pins a
            base64 src rendering a real element. */}
        {hasBar || media !== undefined ? (
          <div data-lightbox-body className={LIGHTBOX_BODY}>
            {media !== undefined ? (
              <div data-lightbox-media className={LIGHTBOX_MEDIA}>
                {media}
              </div>
            ) : (
              <img src={src} alt={alt} className={LIGHTBOX_IMAGE} />
            )}
          </div>
        ) : (
          <img src={src} alt={alt} className={LIGHTBOX_IMAGE} />
        )}

        {hasBar && (
          <div data-lightbox-bar className={LIGHTBOX_BAR}>
            {actions.map(({ key, icon, label: actionLabel, href, onSelect }) => {
              const body = (
                <>
                  <Icon name={icon} className="h-6 w-6" />
                  <span>{actionLabel}</span>
                </>
              );
              return href ? (
                <LinkAs key={key} href={href} onClick={onSelect} data-lightbox-action={key} className={LIGHTBOX_BAR_ACTION}>
                  {body}
                </LinkAs>
              ) : (
                <button key={key} type="button" onClick={onSelect} data-lightbox-action={key} className={LIGHTBOX_BAR_ACTION}>
                  {body}
                </button>
              );
            })}
          </div>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>
  );
};

Lightbox.displayName = 'Lightbox';
