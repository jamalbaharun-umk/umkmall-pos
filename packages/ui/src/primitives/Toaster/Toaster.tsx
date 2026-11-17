'use client';

import React from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast, type ExternalToast } from 'sonner';
import { Alert, type AlertSize, type AlertVariant } from '../Alert';
import { Icon } from '../Icon';
import { DISMISS_BUTTON, TOASTER_WIDTH } from '../feedback-classes';

/**
 * The toast host.
 *
 * `ErrorToast` in the app is a static red banner with no `role` and no `aria-live` — a
 * toast that cannot announce. Stacking, timing, the queue cap and the live region are all
 * things a hand-written provider gets wrong quietly, so this wraps `sonner` and the library
 * owns the host: a consumer gets ONE import rather than a dependency plus a convention.
 *
 * EXACTLY ONE LIVE REGION, and sonner owns it. Its container is already
 * `<section aria-live="polite">`, and `role="alert"` is an ASSERTIVE live region — nesting
 * one inside the other is handled inconsistently across screen readers, producing either a
 * double announcement or a swallowed one. So the toast path renders `Alert` with its role
 * suppressed. That is invisible to a test asserting a role is present, because it passes
 * whichever layer supplies it; `feedback.test.tsx` counts regions instead.
 */
export interface ToasterProps {
  /** Queue cap. Anything beyond this waits rather than stacking without limit. */
  visibleToasts?: number;
  /** Auto-dismiss, in ms. Per-toast `duration` overrides it. */
  duration?: number;
  position?: React.ComponentProps<typeof SonnerToaster>['position'];
}

export const Toaster = ({ visibleToasts = 3, duration = 4000, position = 'top-center' }: ToasterProps) => (
  <SonnerToaster
    position={position}
    visibleToasts={visibleToasts}
    duration={duration}
    className={TOASTER_WIDTH}
    /* The token, not a literal. sonner's own stylesheet sets `z-index: 999999999` on
       `[data-sonner-toaster]` — a class would tie it on specificity and lose on order, so
       this rides the inline style, which the library spreads onto the same element.

       The `var()` FALLBACK is load-bearing. A consumer that mounts this without
       `tokens.css` loaded gets an invalid-at-computed-value-time declaration, and the
       property does NOT fall back to sonner's stylesheet — it resolves to `auto`, which
       puts the toast behind everything.

       `+ 1` because the overlays (Dialog, Modal) sit ON the same token and portal into the body
       after this host mounts: at a tie the later portal wins, and a toast raised from inside a
       modal (the delete-account error) painted UNDER the modal's scrim. */
    style={{ zIndex: 'calc(var(--elevation-overlay, 99999) + 1)' } as React.CSSProperties}
    /* Our Alert IS the visual. Without `unstyled` sonner paints its own card underneath
       it and the toast renders as a white box with a coloured box inside. */
    toastOptions={{ unstyled: true, classNames: { toast: 'w-full' } }}
  />
);

export interface ToastOptions extends Omit<ExternalToast, 'className' | 'style' | 'unstyled'> {
  /** The severity, same vocabulary and same prop name as `Alert`. */
  variant?: AlertVariant;
  size?: AlertSize;
}

/**
 * Raise a toast. Renders the `Alert` visual at `type="toast"`, so the two are one component
 * rather than two that resemble each other and drift.
 *
 * `toast.custom` is a supported sonner pattern rather than a fight with the library, and it
 * injects its own base CSS at runtime — no stylesheet import at any call site.
 *
 * TWO OF THE DECISIONS HERE ARE HOST-WIDE, not per-toast. `TOASTER_WIDTH` sits on sonner's
 * container, so EVERY variant is a 1140px banner on desktop, and `medium` is the default at
 * EVERY viewport — it used to drop to `small` below 768 and a phone toast read smaller than the
 * banner it replaced (14/20 down to 12/18). Pass `size` to override.
 */
export const toast = (message: React.ReactNode, options: ToastOptions = {}) => {
  const { variant: fn = 'info', size = 'medium', ...data } = options;
  return sonnerToast.custom(
    (id) => (
      <Alert
        type="toast"
        variant={fn}
        size={size}
        action={
          <button
            type="button"
            aria-label="Tutup notifikasi"
            onClick={() => sonnerToast.dismiss(id)}
            className={DISMISS_BUTTON}
          >
            {/* 20px beside the Medium box, 18px beside the Small one — Figma's two Close
                instances, and the only place the glyph does not follow `Alert`'s own size. */}
            <Icon name="x" className={size === 'small' ? 'h-[18px] w-[18px]' : 'h-5 w-5'} />
          </button>
        }
      >
        {message}
      </Alert>
    ),
    data,
  );
};

/** Dismiss one toast by id, or all of them with no argument. */
toast.dismiss = sonnerToast.dismiss;
