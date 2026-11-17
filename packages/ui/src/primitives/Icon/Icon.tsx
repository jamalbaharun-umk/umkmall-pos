import React from 'react';
import { contract } from '../../contract';
import { cn, TEXT_COLOR_CLASSES, type TextColor } from '../../utils';
import { ICON_REGISTRY, type IconName, type RegistryEntry } from './registry';

type Axes = typeof contract.Icon.axes;

export type { IconName };

export type IconSize = Axes['size'][number];

/**
 * Optional convenience for new code. Existing call sites size through `className`.
 *
 * PINNED TO THE CONTRACT rather than the other way round (UMK-900): the type used to be
 * `keyof typeof SIZES`, so this table WAS the vocabulary and a step added here would have
 * been a variant native could never mirror.
 */
const SIZES = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
  xl: 'h-8 w-8',
} as const satisfies Record<IconSize, string>;
export type IconColor = TextColor;

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'color' | 'ref'> {
  name: IconName;
  /**
   * Optional. Sizing in this repo is Tailwind `h-*`/`w-*` on `className` at every one of the
   * ~96 existing call sites, so this is a convenience for new code and never a requirement.
   */
  size?: IconSize;
  /** Optional, same reasoning as `size`. Ignored by fixed-palette glyphs. */
  color?: IconColor;
  ref?: React.Ref<SVGSVGElement>;
}

/**
 * One component for every icon in the design system.
 *
 * THE API IS DICTATED BY WHAT CALL SITES ALREADY DO, not by what would be tidy. Across the
 * ~96 lucide JSX sites in the chat surface: `className` appears on 100% of them,
 * `strokeWidth` on 15, `fill` on one, and `size`/`color` on ZERO. Colour is a Tailwind text
 * class frequently built by interpolation or a ternary over the whole string. So `className`
 * is a non-negotiable pass-through and a token-enum-only API could not express these sites.
 *
 * `strokeWidth` and `fill` matter more than they look: `ChatInputArea` combines
 * `strokeWidth={0}` with `fill-white` to turn lucide's `Square` OUTLINE into the solid stop
 * button. Drop either prop and that button silently becomes an outline.
 *
 * Accessibility (R11): decorative by default. That matches reality — zero lucide icons in
 * scope carry an `aria-label`, ~70 wrapping buttons do, and 14 of the 15 hand-rolled SVGs
 * with an explicit attribute set `aria-hidden`. Passing `aria-label` opts into
 * `role='img'`, the same contract `a2ui/components/Icon.tsx` already implements and
 * `a2ui/components/accessibility.test.tsx` already locks.
 */
export const Icon = ({
  name,
  size,
  color,
  className,
  ref,
  ...props
}: IconProps) => {
  const entry: RegistryEntry | undefined = ICON_REGISTRY[name];
  /**
   * The `IconName` union catches this at compile time for TS callers. This is for the rest:
   * a name arriving from JSON, a config table, or a `as IconName` cast. Rendering nothing
   * would leave a hole in the layout that looks like a CSS problem.
   */
  if (!entry) throw new Error(`Icon: unknown name '${name}'`);

  const Glyph = entry.component;
  const label = props['aria-label'];

  /**
   * The a11y attributes are spread AFTER `props`, deliberately. `IconProps` extends
   * `SVGProps`, so a caller can legally pass `aria-hidden={false}` with no label; spread
   * before, that would win and expose an unlabelled icon to the accessibility tree. The
   * `aria-label` still reaches the DOM from `props` either way — only the decorative-vs-
   * labelled decision is the component's to make. The labelled branch clears `aria-hidden`
   * rather than leaving it: a caller who passed one gets it dropped, not merged with the
   * `role="img"` it contradicts.
   */
  return (
    <Glyph
      ref={ref}
      className={cn(size && SIZES[size], color && !entry.fixedPalette && TEXT_COLOR_CLASSES[color], className)}
      {...props}
      {...(label ? { role: 'img', 'aria-hidden': undefined } : { 'aria-hidden': true })}
    />
  );
};

Icon.displayName = 'Icon';
