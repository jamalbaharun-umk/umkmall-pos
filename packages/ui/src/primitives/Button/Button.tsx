'use client';

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { contract } from '../../contract';
import { Spinner } from '../Spinner';
import { cn } from '../../utils';

type Axes = typeof contract.Button.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * Figma's General set is `Type` x `Colors` x `Size` x `State`, and this used to collapse the
 * first two into one `variant` prop (`primary|secondary|outline|ghost|danger`) — which made
 * "outlined danger" unsayable and "primary" mean two different things at once.
 *
 * `Type` decides the SHAPE (filled / outlined / bare) and `Colors` decides the HUE. They
 * compose, so the class table is a small cross-product rather than one flat list.
 *
 * `disabled` is a boolean, not a `Colors` value (contract divergence 1): it changes
 * interaction, not just palette, and has to compose with every colour.
 */
/**
 * DESIGN-SYSTEM TOKENS, not the app's legacy palette (UMK-1091). These tables named `z-*` and
 * `state-*` keys, which the app still defines for its own pages — so the migration was
 * invisible to every gate in this repo: a legacy class resolves perfectly well, it just is not
 * what Figma publishes.
 *
 * TRANSCRIBED FROM THE PUBLISHED MATRIX, cell by cell: `General` 120:202, 3 types x 4 colours
 * x 3 states, read 2026-09-18. It is written out below because no test in this repo can see a
 * colour, so this table is the only durable record of what each cell is supposed to be.
 *
 * | | Filled | Ghost | Text |
 * | -- | -- | -- | -- |
 * | **Brand** | `#0074E7` / ink `#FFFFFF` | 1px `#0074E7`, ink `#0074E7` | ink `#0074E7` |
 * | hover | `#0051A2` / ink `#F6F6F6` | fill `#F0F7FF`, 1px `#0051A2` | fill `#F0F7FF`, ink `#0051A2` |
 * | disable | `#96C6F5` | 1px `#96C6F5`, ink `#96C6F5` | ink `#96C6F5` |
 * | **Light** | `#FFFFFF` + 1px `#F0F0F0` / ink `#042648` | 1px `#F0F0F0`, ink `#042648` | ink `#042648` |
 * | hover | `#F0F7FF` + 1px `#C3CBD3` / ink `#03203D` | fill `#F0F7FF`, 1px `#C3CBD3` | fill `#F0F7FF`, ink `#03203D` |
 * | disable | `#F0F0F0` / ink `#C3CBD3` | 1px `#C3CBD3`, ink `#C3CBD3` | ink `#C3CBD3` |
 * | **Danger** | `#E70000` / ink `#FFFFFF` | 1px `#E70000`, ink `#E70000` | ink `#E70000` |
 * | hover | `#A20000` / ink `#F6F6F6` | fill `#FFF3F3`, 1px `#A20000` | fill `#FFF3F3`, ink `#A20000` |
 * | disable | `#F59696` / ink `#F6F6F6` | 1px `#F59696`, ink `#F59696` | ink `#F59696` |
 * | **Dark** | `#000000` + **2px** `#F0F0F0` / ink `#FFFFFF` | **2px** `#F0F0F0`, ink `#FFFFFF` | ink `#FFFFFF` |
 * | hover | `#021629` + 2px `#C3CBD3` | fill `#021629`, 2px `#C3CBD3` | fill `#021629`, ink `#F6F6F6` |
 * | disable | `#03203D` + 2px `#314D69` / ink `#314D69` | 2px `#314D69`, ink `#314D69` | ink `#314D69` |
 *
 * **`dark` IS A BUTTON FOR DARK CHROME, not "dark ink on light".** That is the trap this table
 * exists to stop, and it was got wrong once: its ink is WHITE at every type and state, its
 * hover fill is near-black, and its stroke is a LIGHT `#F0F0F0`. Reading the legacy palette's
 * meaning across (`text-z-text-primary`, a navy ink) gives a ghost and text button that are
 * invisible on the surface they are drawn for, and every class still resolves.
 *
 * Two smaller things the same read settled: **Filled Light and Filled Dark carry a stroke**,
 * which no other filled cell does; and the disabled INK moves per colour, so it is written on
 * each cell rather than inherited.
 *
 * EACH CELL CARRIES ITS OWN DISABLED ARM. The base used to fade everything with one
 * `disabled:opacity-50`, which is not a colour Figma publishes and which makes four disabled
 * colours look like one.
 */
const FILLED: Record<Of<'color'>, string> = {
  primary:
    'bg-default-brand text-default-invert hover:bg-hover-brand hover:text-hover-invert disabled:bg-disable-brand disabled:text-default-invert',
  light:
    'bg-default-primary text-default-primary ring-1 ring-default-primary hover:bg-weak-brand hover:text-hover-primary hover:ring-hover-primary disabled:bg-disable-primary disabled:text-disable-primary disabled:ring-disable-primary',
  danger:
    'bg-default-error text-default-invert hover:bg-hover-error hover:text-hover-invert disabled:bg-disable-error disabled:text-hover-invert',
  dark: 'bg-default-invert text-default-invert ring-2 ring-default-primary hover:bg-hover-invert hover:ring-hover-primary disabled:bg-disable-invert disabled:text-disable-invert disabled:ring-disable-invert',
};

/**
 * A 1px stroke, matching Figma — it was 2px, which is R9. `dark` is the one exception: its
 * published stroke really is 2px at every state, so following Figma here means NOT flattening
 * the four to one width.
 *
 * Every ghost cell also takes a hover FILL, which the legacy tables approximated with a `/10`
 * tint of their own colour. Figma publishes a real surface for each.
 */
const OUTLINED: Record<Of<'color'>, string> = {
  primary:
    'bg-transparent text-default-brand ring-1 ring-default-brand hover:bg-weak-brand hover:text-hover-brand hover:ring-hover-brand disabled:ring-disable-brand disabled:text-disable-brand',
  light:
    'bg-transparent text-default-primary ring-1 ring-default-primary hover:bg-weak-brand hover:text-hover-primary hover:ring-hover-primary disabled:ring-disable-primary disabled:text-disable-primary',
  danger:
    'bg-transparent text-default-error ring-1 ring-default-error hover:bg-weak-error hover:text-hover-error hover:ring-hover-error disabled:ring-disable-error disabled:text-disable-error',
  dark: 'bg-transparent text-default-invert ring-2 ring-default-primary hover:bg-hover-invert hover:ring-hover-primary disabled:ring-disable-invert disabled:text-disable-invert',
};

/**
 * OUTLINE (UMK-1548): the ghost's colours on a SOLID fill with a real `border` instead of a
 * `ring-*` box-shadow. A ring takes no space in layout, a border does (1px each side), which is
 * what the T3b "Salin" mockup draws: white fill, 1px `#0074E7` border, `#0074E7` ink. Ours, no
 * Figma cell. `dark` is the one cell that does not take the white fill: its ink is white, so a
 * white fill would paint it invisible, and it keeps the filled-dark surface instead.
 */
const OUTLINE: Record<Of<'color'>, string> = {
  primary:
    'bg-default-primary text-default-brand border border-default-brand hover:bg-weak-brand hover:text-hover-brand hover:border-hover-brand disabled:border-disable-brand disabled:text-disable-brand',
  light:
    'bg-default-primary text-default-primary border border-default-primary hover:bg-weak-brand hover:text-hover-primary hover:border-hover-primary disabled:border-disable-primary disabled:text-disable-primary',
  danger:
    'bg-default-primary text-default-error border border-default-error hover:bg-weak-error hover:text-hover-error hover:border-hover-error disabled:border-disable-error disabled:text-disable-error',
  dark: 'bg-default-invert text-default-invert border-2 border-default-primary hover:bg-hover-invert hover:border-hover-primary disabled:border-disable-invert disabled:text-disable-invert',
};

/** No stroke and no resting fill; the hover fill and the ink are the whole treatment. */
const BARE: Record<Of<'color'>, string> = {
  primary:
    'bg-transparent text-default-brand hover:bg-weak-brand hover:text-hover-brand disabled:text-disable-brand',
  light:
    'bg-transparent text-default-primary hover:bg-weak-brand hover:text-hover-primary disabled:text-disable-primary',
  danger:
    'bg-transparent text-default-error hover:bg-weak-error hover:text-hover-error disabled:text-disable-error',
  dark: 'bg-transparent text-default-invert hover:bg-hover-invert hover:text-hover-invert disabled:text-disable-invert',
};

/** `Type` x `Colors`, flattened into cva's compound-variant shape. */
const TYPE_COLOR = (['primary', 'ghost', 'outline', 'text'] as const).flatMap((type) =>
  (Object.keys(FILLED) as Of<'color'>[]).map((color) => ({
    type,
    color,
    class: { primary: FILLED, ghost: OUTLINED, outline: OUTLINE, text: BARE }[type][color],
  })),
);

/**
 * The square steps an icon-only button needs.
 *
 * Every step of the `size` scale above carries HORIZONTAL padding, so an icon-only caller
 * today has to override `px-*`/`py-*` through `className` AND pass `width="auto"`, because the
 * width default is `full`. Both of those are a call site reaching past the axis rather than
 * choosing a value on it, and there are between 74 and 96 of them in the chat surface alone.
 *
 * The vertical step is kept and mirrored onto both sides, so an icon-only button lines up with
 * a text button of the same size instead of being a separate scale to keep in sync.
 */
const ICON_ONLY_SIZE: Record<Of<'size'>, string> = {
  large: 'p-4 text-ds-h6-desktop',
  medium: 'p-3 text-ds-paragraph-desktop',
  small: 'p-2.5 text-ds-paragraph-mobile',
  micro: 'p-1.5 text-ds-legacy-xs',
  compact: 'p-ds-3xs text-ds-body-lg-mobile',
};

const buttonVariants = cva(
  /**
   * No `hover:scale-105` any more. Figma's `State` axis is Default and Hover, and it moves
   * COLOUR, not geometry — the scale was ours, and the a2ui adapter was already cancelling it
   * with `hover:scale-100`, which is the clearest signal it was unwanted.
   */
  'inline-flex items-center justify-center gap-2 rounded-full font-bold transition-colors duration-150 disabled:pointer-events-none',
  {
    variants: {
      type: { primary: '', ghost: '', outline: '', text: '' } satisfies Record<Of<'type'>, string>,
      color: { primary: '', light: '', danger: '', dark: '' } satisfies Record<Of<'color'>, string>,
      /**
       * Sized so real call sites do not have to override it. The a2ui adapter used to pass
       * `py-2.5` plus a size class on top of `size="sm"`; a scale every caller patches is a broken
       * scale, and patching it at the call site hides that from the slices that inherit it.
       */
      size: {
        large: 'px-10 py-4 text-ds-h6-desktop',
        medium: 'px-8 py-3 text-ds-paragraph-desktop',
        small: 'px-6 py-2.5 text-ds-paragraph-mobile',
        micro: 'px-4 py-1.5 text-ds-legacy-xs',
        /* UMK-1548: ours, no Figma rung. 12px semibold (it wins over the base `font-bold` through `cn`), 6 / 12. */
        compact: 'px-ds-sm py-ds-3xs text-ds-body-lg-mobile font-semibold',
      } satisfies Record<Of<'size'>, string>,
      width: { auto: 'w-auto', full: 'w-full' } satisfies Record<Of<'width'>, string>,
    },
    compoundVariants: TYPE_COLOR,
    defaultVariants: { type: 'primary', color: 'primary', size: 'medium', width: 'full' },
  },
);

/**
 * ICON-ONLY IS A PLAIN PROP, NOT AN AXIS VALUE.
 *
 * `contract.Button.axes.width` is pinned to exactly `['auto','full']` by an equality lock, and
 * widening it would be the wrong shape anyway: a contract axis value is a visual variant, and
 * "the label is a glyph" is a fact about the CONTENT. Figma publishes no icon-only variant on
 * the General set at all, so this is recorded as a divergence rather than passed off as read.
 *
 * IT IS A UNION so a nameless icon-only button cannot be built. A glyph is `aria-hidden` to
 * everything that matters, so an icon-only button with no `aria-label` is a control a screen
 * reader announces as nothing at all — the same failure mode the two relaxed form controls
 * have, and the same remedy.
 */
type IconOnlyProps =
  | { iconOnly: true; 'aria-label': string }
  | { iconOnly?: false; 'aria-label'?: string };

/**
 * `type` and `color` are dropped from the DOM attributes because Figma's axes claim both
 * names. The DOM `type` moves to `htmlType`; without that a form submit button would be
 * unreachable, and both call sites are non-submit today so nothing had to change.
 *
 * A type alias rather than an interface, because an interface cannot extend the union above.
 */
type StyleProps = VariantProps<typeof buttonVariants>;

type BaseProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'color' | 'aria-label'
> &
  IconOnlyProps & {
    htmlType?: 'button' | 'submit' | 'reset';
    children: React.ReactNode;
    /** Optional action handler (alias for onClick). */
    action?: () => void;
    /** Disables the button and swaps the label for a spinner. Additive; see contract divergence 3. */
    isLoading?: boolean;
    /** Render the single child element with the button's props instead of a `<button>`. Under
     *  `isLoading` the child is shown as is: no spinner is injected, but the click is blocked. */
    asChild?: boolean;
  };

/**
 * `unstyled` IS A PLAIN PROP, NOT AN AXIS (UMK-878). It renders no type/colour/size/width class,
 * so a raw chrome button can become a `Button` with the classes it already had and stay
 * pixel-identical. The style axes are refused beside it (`never`) rather than ignored, because
 * `color="danger"` that silently does nothing is the failure this union exists to stop. The HTML
 * `type` stays reachable as `htmlType`, as it is today.
 */
export type ButtonProps = BaseProps &
  (
    | (StyleProps & { unstyled?: false })
    | ({ unstyled: true } & { [K in keyof StyleProps]?: never })
  );

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className,
      type,
      color,
      size,
      width,
      action,
      onClick,
      isLoading,
      disabled,
      iconOnly,
      unstyled,
      asChild,
      htmlType = 'button',
      ...props
    },
    ref,
  ) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      action?.();
      onClick?.(e);
    };

    /* `size: null` skips cva's own step so the square one can take its place; without it
       cva falls back to the `medium` default and the horizontal padding comes right back.
       `width` is forced to `auto` rather than merely defaulted — a glyph in a full-width
       pill is the other half of what every icon-only call site was overriding.
       `unstyled` skips cva entirely, so `defaultVariants` never apply and there is no base
       class either: even the pill and the bold are a look, and a raw button had neither. */
    const classes = cn(
      unstyled
        ? undefined
        : iconOnly
          ? [buttonVariants({ type, color, size: null, width: 'auto' }), ICON_ONLY_SIZE[size ?? 'medium']]
          : buttonVariants({ type, color, size, width }),
      className,
    );

    if (asChild) {
      const child = React.Children.only(children) as React.ReactElement<
        React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> }
      >;
      const inert = disabled || isLoading;
      return React.cloneElement(child, {
        ...props,
        /* React 19 keeps the child's ref on its props: call both rather than overwrite it. */
        ref: (node: HTMLElement | null) => {
          for (const r of [ref, child.props.ref] as React.Ref<HTMLElement | null>[]) {
            if (typeof r === 'function') r(node);
            else if (r) (r as React.MutableRefObject<HTMLElement | null>).current = node;
          }
        },
        className: cn(classes, child.props.className),
        'aria-disabled': inert || undefined,
        /* Out of the tab order while inert; an anchor has no `disabled` to do it. */
        tabIndex: inert ? -1 : child.props.tabIndex,
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          /* An anchor has no `disabled`, so the guard is ours: stop the navigation and every
             handler, the child's own included. */
          if (inert) {
            e.preventDefault();
            return;
          }
          child.props.onClick?.(e);
          action?.();
          onClick?.(e as React.MouseEvent<HTMLButtonElement>);
        },
      } as unknown as React.HTMLAttributes<HTMLElement>);
    }

    return (
      <button
        ref={ref}
        type={htmlType}
        className={classes}
        onClick={handleClick}
        disabled={disabled || isLoading}
        {...props}
      >
        {/* The Spinner primitive, not a second inline <svg> — shipping a duplicate spinner
            from the slice meant to establish the foundation is exactly the drift this is for.
            `label=""` + aria-hidden keeps it decorative: Spinner's default label is "Loading..."
            and it would otherwise be concatenated into the BUTTON's accessible name, so
            "Kirim" silently becomes "Loading... Kirim" for a screen reader. The disabled
            state already conveys that the button is busy. */}
        {isLoading && <Spinner size="sm" variant="white" label="" aria-hidden />}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';

export { buttonVariants };
