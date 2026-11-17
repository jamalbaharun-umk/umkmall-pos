import React from 'react';
import { cn } from '../../utils';
import { LIST_BULLET, LIST_BULLET_ITEM, LIST_DIRECTION, LIST_GAP, LIST_GAP_LG, LIST_GAP_MD, LIST_MARKER, LIST_SPACE } from '../content-classes';

export type ListDirection = keyof typeof LIST_DIRECTION;
export type ListGap = keyof typeof LIST_GAP;
/** A rung, or one rung per breakpoint (`base` is required). Flex lists only: a marked list spaces with `space-y` at one rung. */
export type ListGapProp = ListGap | { base: ListGap; md?: ListGap; lg?: ListGap };
export type ListMarker = keyof typeof LIST_MARKER;

export interface ListProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * `vertical` stacks, `horizontal` wraps, `bullet` stacks with a drawn marker.
   *
   * NOT a contract axis. A direction is a layout choice rather than a design variant, and the
   * contract entry carries `pendingAxes` precisely because no set has been published to read
   * a real vocabulary from.
   */
  direction?: ListDirection;
  /**
   * The element the list renders (UMK-960). `div` by default, so a2ui does not change. `ul` and
   * `ol` give real list semantics and wrap each child in an `<li>`. Structural, not a design
   * axis, for the same reason `direction` is not one.
   */
  as?: 'div' | 'ul' | 'ol';
  /** The row spacing, one rung of the spacing scale, selected in place of the direction's own. */
  gap?: ListGapProp;
  /**
   * Native list markers. An `ol` in the default direction takes `decimal`; a `ul` takes `disc` only
   * when asked. A marked list is a block, not a flex column — see `LIST_MARKER`.
   */
  marker?: ListMarker;
  /** With `as="ul|ol"`: the caller supplies its own `<li>`s (react-markdown does), so nothing is wrapped. */
  itemless?: boolean;
  children?: React.ReactNode;
}

/**
 * A stack of items, optionally bulleted.
 *
 * IT RENDERS A `<div>` BY DEFAULT, NOT A `<ul>`, and that is a decision rather than an
 * oversight. The a2ui renderer this covers is a `<div>` deliberately: its items author their
 * own `**label:** detail` prose, so each one is a paragraph rather than a list item, and
 * dropping a semantic `<ul>` around them would announce a list of one-line paragraphs while the
 * real structure lives in the prose. A caller with genuinely list-shaped items passes
 * `as="ul"` or `as="ol"` (UMK-960). The guard asserts the default tag name so a later change to
 * it has to be a decision rather than a drift.
 *
 * `bullet` draws its own dot for the same reason: a native list marker sits at the wrong
 * baseline against bold-prefixed prose, which is why the a2ui version draws one too.
 */
export const List = React.forwardRef<HTMLElement, ListProps>(
  ({ direction = 'vertical', as = 'div', itemless = false, gap, marker: markerProp, children, className, ...props }, ref) => {
    const gapBase = typeof gap === 'object' ? gap.base : gap;
    const gapMd = typeof gap === 'object' ? gap.md : undefined;
    const gapLg = typeof gap === 'object' ? gap.lg : undefined;
    const marker = markerProp ?? (as === 'ol' && direction === 'vertical' ? 'decimal' : undefined);
    const Tag = as as 'div';
    const semantic = as !== 'div';
    const bullet = (child: React.ReactNode) => (
      <div className={LIST_BULLET_ITEM}>
        <span aria-hidden className={LIST_BULLET} />
        <div className="min-w-0 flex-1">{child}</div>
      </div>
    );
    /* react-markdown puts `\n` text nodes between items; wrapping one makes an empty bullet. */
    const blank = (child: React.ReactNode) => typeof child === 'string' && child.trim() === '';
    const wrapped = () =>
      React.Children.map(children, (child) => {
        if (semantic && blank(child)) return null;
        if (semantic && React.isValidElement(child) && child.type === 'li') return child;
        const inner = direction === 'bullet' ? bullet(child) : child;
        return semantic ? <li>{inner}</li> : inner;
      });
    const body = semantic && itemless ? children : semantic || direction === 'bullet' ? wrapped() : children;
    return (
      <Tag
        ref={ref as React.Ref<HTMLDivElement>}
        /* Preflight strips the marker and the flex column blockifies each li, so Safari/VoiceOver
           would drop the list role. Stated, and overridable by a caller's own `role`. */
        role={semantic ? 'list' : undefined}
        className={cn(
          marker
            ? cn(LIST_MARKER[marker], gapBase ? LIST_SPACE[gapBase] : LIST_SPACE['4xs'])
            : gapBase
              ? cn(
                  LIST_DIRECTION[direction].replace(/gap-ds-[\w-]+/, LIST_GAP[gapBase]),
                  gapMd && LIST_GAP_MD[gapMd],
                  gapLg && LIST_GAP_LG[gapLg],
                )
              : LIST_DIRECTION[direction],
          className,
        )}
        {...props}
      >
        {body}
      </Tag>
    );
  },
);

List.displayName = 'List';
