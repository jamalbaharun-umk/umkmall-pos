'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon, type IconName } from '../Icon';
import {
  COMPOSER_BUTTON_ACTIVE,
  COMPOSER_BUTTON_BADGE,
  COMPOSER_BUTTON_BADGE_ANCHOR,
  COMPOSER_BUTTON_BASE,
  COMPOSER_BUTTON_DISABLED,
  COMPOSER_BUTTON_IDLE,
  COMPOSER_BUTTON_SIZE,
  COMPOSER_GLYPH,
  COMPOSER_GLYPH_LANDING,
} from '../composer-classes';

/* All three toggling buttons declare the SAME `state` axis; one declaration reads it for each. */
type Axes = typeof contract.ChatToolsButton.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** Which active treatment a button takes. Not an exported axis — see the note below. */
type ComposerButtonKind = keyof typeof COMPOSER_BUTTON_ACTIVE;

/**
 * The props every composer button shares.
 *
 * `label` is REQUIRED and not defaulted. These buttons render a glyph and nothing else, so a
 * default would make "unlabelled" the quiet outcome on all four at once — and each button's honest
 * label depends on what the host wired it to and on its state ("Input suara" vs "Berhenti
 * merekam"), which is exactly the kind of copy a library must not choose for four surfaces.
 */
export interface ComposerButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> {
  /**
   * Engaged: recording for voice, armed or open for the rest.
   *
   * AN AXIS, NOT A BOOLEAN (UMK-900). The contract declares `state: ['default','active']` for all
   * three buttons and both platforms expressed it as `active?: boolean` — a vocabulary the
   * contract named and neither surface read, which is the drift this family was the standing
   * example of. The boolean survives INSIDE: `aria-pressed` and `accessibilityState.selected` are
   * boolean-shaped APIs, which is plausibly why both platforms reached for one.
   */
  state?: Of<'state'>;
  /** 32px in a chat, 36px on the landing hero. */
  size?: Of<'size'>;
  /** The accessible name. Required — the button has no text. */
  label: string;
}

/**
 * THE SHARED BASE, AND IT IS DELIBERATELY NOT EXPORTED.
 *
 * Every composer button is this element with a different glyph pair and a different active fill.
 * Exporting it would give callers a fifth way to render a composer button — one that takes its
 * kind as a prop, which is the exact `Type`-axis shape the four named components exist to replace.
 * The four wrappers below are the API; this is how they avoid being four copies of one button.
 */
export const ComposerButton = React.forwardRef<
  HTMLButtonElement,
  ComposerButtonProps & {
    kind: ComposerButtonKind;
    glyph: { default: IconName; active: IconName };
    /** Announce pressed state. Off for buttons that are actions rather than toggles. */
    toggle: boolean;
    /**
     * Overrides the glyph sizing rule below. Send's stop square and upload spinner are drawn at
     * their own sizes, and keying that off the glyph NAME here would put one button's states in
     * the shared base.
     */
    glyphClassName?: string;
    /** A dot at the corner, for a state the closed button must still show. */
    badge?: boolean;
  }
>(function ComposerButton(
  { kind, glyph, toggle, glyphClassName, badge, size = 'compact', state = 'default', label, className, ...props },
  ref,
) {
  const active = state === 'active';
  const glyphs = size === 'landing' ? COMPOSER_GLYPH_LANDING : COMPOSER_GLYPH;
  const name = active ? glyph.active : glyph.default;
  return (
    <button
      /* Spread first: JSX is last-wins and `ButtonHTMLAttributes` legally carries `type` and
         `aria-pressed`, so a passthrough placed after these would silently replace both. */
      {...props}
      ref={ref}
      type="button"
      aria-label={label}
      /* Announced only for the buttons that genuinely toggle. Emitting `aria-pressed="false"` on
         an action describes a switch that cannot be switched. */
      aria-pressed={toggle ? active : undefined}
      className={cn(
        COMPOSER_BUTTON_BASE,
        COMPOSER_BUTTON_SIZE[size],
        badge && COMPOSER_BUTTON_BADGE_ANCHOR,
        active ? COMPOSER_BUTTON_ACTIVE[kind] : COMPOSER_BUTTON_IDLE[kind],
        /* Its own table, not an opacity fade — a faded blue circle still reads as blue, so a
           disabled send would still look like the primary action. */
        COMPOSER_BUTTON_DISABLED[kind],
        className,
      )}
    >
      <Icon
        name={name}
        /* The active minus is drawn at 24 in the published set; everything else at 20. */
        className={
          glyphClassName ??
          (name === 'composer-minus' ? glyphs.wide : glyphs.default)
        }
      />
      {badge && (
        <span
          className={COMPOSER_BUTTON_BADGE}
          aria-hidden
          data-badge
        />
      )}
    </button>
  );
});
