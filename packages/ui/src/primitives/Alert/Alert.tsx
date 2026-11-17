'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { A2UI_ALERT, A2UI_ALERT_LOOK } from '../a2ui-classes';
import { Icon, type IconName } from '../Icon';
import {
  ALERT_BASE,
  ALERT_VARIANT_ICON,
  ALERT_VARIANT_LABEL,
  ALERT_GLYPH_INK,
  ALERT_INK,
  ALERT_SIZE,
  ALERT_SURFACE,
  ALERT_TREATMENT,
  ALERT_TREATMENT_GLYPH_INK,
} from '../feedback-classes';

type Axes = typeof contract.Alert.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type AlertType = Of<'type'>;
export type AlertVariant = Of<'function'>;
export type AlertSize = Of<'size'>;
export type AlertTreatment = Of<'treatment'>;

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> {
  /**
   * `alert` is the inline box; `toast` is the same component rendered for the toast host,
   * on a solid fill. Not a cosmetic pair — see `feedback-classes.ts`.
   */
  type?: AlertType;
  /**
   * The severity. Figma calls this axis `Function` and the contract keeps that word as the
   * vocabulary, but the PROP is `variant` — this package's standard name for a component's
   * primary semantic axis, following `Text`. `function` is a reserved word, so it could
   * never be destructured or shorthanded, and `function="danger"` reads as nothing.
   *
   * The VALUES are Figma's, and `danger` — not `error` — is the breaking half of the
   * rebuild. The contract has recorded that since slice 1.
   */
  variant?: AlertVariant;
  size?: AlertSize;
  /**
   * How much of the box the severity paints — a flat tint, a left accent, a full coaching
   * border, or the gradient banner.
   *
   * IGNORED ON A TOAST, and that is not an oversight: a toast is a solid fill owned by the
   * host, which is what `type` already forks on. A left accent on a floating solid panel
   * would be a second, disagreeing answer to the same question.
   *
   * Defaults to `full`, whose classes are DERIVED from the pre-existing surface and ink
   * tables — so a call site that passes no treatment renders exactly what it did before this
   * axis existed.
   */
  treatment?: AlertTreatment;
  /** `a2ui` is the agent surface's pre-library note box (UMK-1307); only its adapter passes it. */
  appearance?: Of<'appearance'>;
  /**
   * The glyph. Defaults per `function`; pass a node to override, or `null` to drop it.
   *
   * Typed and nullable rather than a `showIcon` boolean beside an `icon` slot — absence is
   * already expressible, and two props make "no icon, but here is the icon" representable.
   * It also has to accept a bare string: `NewCheckoutForm` passes `icon="i"` with no
   * variant at all, which is the call site that kept this prop from being dropped.
   */
  icon?: React.ReactNode;
  /**
   * The live-region role, overridable so the toast host can SUPPRESS it.
   *
   * sonner's own container is already `<section aria-live="polite">`. Nesting `role="alert"`
   * — an assertive live region — inside it is handled inconsistently across screen readers,
   * producing either a double announcement or a swallowed one. So a toast renders with no
   * role of its own and lets the host announce; an inline alert carries its own.
   *
   * A test asserting "the role is present" passes whichever layer supplies it, so
   * `feedback.test.tsx` counts live regions instead.
   */
  role?: React.AriaRole;
  /**
   * A trailing slot OUTSIDE the message — the toast host puts its close button here.
   *
   * Not a `dismissible` boolean on the Alert: an inline alert has nothing to dismiss it
   * from, because the surface rendering it decides whether it can go away. Only the host
   * that owns the queue and the timer can also own the close.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * One Alert for all 24 Figma variants — `type` × `function` × `size`.
 *
 * Replaces two components that disagreed: the primitive (a four-value `variant` axis, a
 * raw Tailwind palette and a `[key: string]: any` prop hole that defeated prop typing) and
 * the composition, which had zero consumers and was the only one of the two that announced
 * itself. That announcement is the behaviour that had to survive its deletion.
 */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      type = 'alert',
      variant: fn = 'info',
      size = 'medium',
      treatment = 'full',
      appearance = 'default',
      icon,
      role,
      action,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const { box, glyph } = ALERT_SIZE[size];
    /* The a2ui look covers the six treatment/function pairs the Callout adapter sends; any other pair falls back
       to the default look rather than rendering with no surface at all. */
    const a2uiLook =
      appearance === 'a2ui' && type === 'alert'
        ? (A2UI_ALERT_LOOK as Record<string, string | undefined>)[`${treatment}-${fn}`]
        : undefined;
    const painted =
      type === 'toast'
        ? { surface: `${ALERT_SURFACE.toast[fn]} ${ALERT_INK.toast[fn]}`, ink: ALERT_GLYPH_INK.toast[fn] }
        : { surface: ALERT_TREATMENT[treatment][fn], ink: ALERT_TREATMENT_GLYPH_INK[treatment][fn] };
    /* `undefined` means "not passed" and falls back to the function's glyph; `null` means
       "no glyph", which is a caller's real choice and must not be overridden by it. */
    /* The ONE place a type draws a different glyph from its function's default: Figma's success
       toast is the filled check — a white disc with the tick knocked out so the green reads
       through it — while the inline alert keeps lucide's outline on a tint. Two drawings for two
       jobs, and the registry says neither name may be repointed at the other. A second fork turns
       this into a table; one does not. */
    const name: IconName =
      type === 'toast' && fn === 'success' ? 'check-circle-filled' : ALERT_VARIANT_ICON[fn];
    const content =
      icon === undefined ? <Icon name={name} className={cn(glyph, 'shrink-0')} /> : icon;

    return (
      <div
        ref={ref}
        role={role ?? (type === 'alert' ? 'alert' : undefined)}
        className={
          a2uiLook
            ? cn(A2UI_ALERT, a2uiLook, className)
            : cn(ALERT_BASE, box, painted.surface, className)
        }
        {...props}
      >
        {content !== null && (
          <span aria-hidden className={cn('flex shrink-0 items-center', painted.ink)}>
            {content}
          </span>
        )}
        {/* Colour is the only other thing carrying the severity, and it is not a channel
            every reader has. The word is visually hidden because the tint and the glyph
            already say it to everyone who can see them. */}
        <span className="sr-only">{ALERT_VARIANT_LABEL[fn]}:</span>
        <span className="min-w-0 flex-1">{children}</span>
        {action}
      </div>
    );
  },
);

Alert.displayName = 'Alert';
