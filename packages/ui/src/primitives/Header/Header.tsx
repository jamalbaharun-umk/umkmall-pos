'use client';

import React from 'react';
import { cn, isSlotFilled } from '../../utils';
import {
  HEADER_ACTIONS,
  HEADER_BACK,
  HEADER_BAR,
  HEADER_BAR_CENTERED,
  HEADER_BASE,
  HEADER_SCROLL,
  HEADER_TABS,
  HEADER_TITLE,
  HEADER_TRANSPARENT,
  HEADER_TYPE,
  HEADER_TYPES,
  type HeaderType,
} from '../header-classes';

/**
 * The app shell's header, mirroring the published `Navbar` set — all seven `Type` values.
 *
 * MIRRORED WHOLE, ON PURPOSE. Only one of the seven has a consumer in this repo today, and
 * shipping the other six unconsumed is a recorded, accepted cost: mirroring is what keeps the
 * library from diverging from the design file, and when the axis is split the library follows
 * rather than re-deriving. Two things about that axis are recorded on the contract entry
 * instead of being fixed here — it conflates an authentication state, a product surface and a
 * page kind in one enum, and its published names carry three different separators. Do not
 * quietly repair either; the divergence is the artefact design needs in order to fix the axis.
 *
 * NO SIZE PROP. The published set publishes `Size: Mobile | Desktop`; that is one bar at two
 * widths, not two components, so it is a breakpoint here and the divergence is recorded. A
 * `size` prop added later would compile everywhere and give the package a second way to say
 * the same thing — one that cannot follow the viewport.
 *
 * THE BACK CONTROL IS THE CALLER'S. This package may not import a router or a link library, so
 * `back` takes an element or a render function and receives the props the header would have
 * put on its own control — the marker, the class set and the accessible name. Omit it and the
 * default is a plain button that calls `onBack`.
 *
 * WHAT IS IMPOSED AND WHAT COMPOSES. For an ELEMENT override the marker (`data-header-back`)
 * and the accessible name (`aria-label`) are imposed — an override that forgets either is not
 * an override that silently half-worked — while `className` COMPOSES: the header's set is put
 * in front of whatever the caller already had, so a caller's own class survives. A FUNCTION
 * override receives the same props and decides for itself; it owns the composition.
 *
 * `Menu.linkComponent` dodges the same import, but NOT in the same shape, and the two should
 * not be unified on the assumption that they are one idiom. `linkComponent` takes a component
 * TYPE the row instantiates itself; `back` takes an ELEMENT or a builder that receives the
 * header's own props, because the header has to put its marker and accessible name onto
 * whatever the caller supplied. A caller passing a component type here would have nowhere to
 * receive those.
 */
export interface HeaderBackProps {
  'data-header-back': string;
  'aria-label': string;
  className: string;
  onClick?: React.MouseEventHandler;
}

export interface HeaderProps {
  /** Figma `Type`. Seven values; see the contract entry's divergence about what they mix. */
  type?: HeaderType;
  /** Figma `Title Page`. Rendered only when `showTextLeft` — the published boolean. */
  title?: string;
  showTextLeft?: boolean;
  showBack?: boolean;
  /** Accessible name for the back control, whoever renders it. */
  backLabel?: string;
  /** Used only by the DEFAULT back control; a caller-supplied one carries its own behaviour. */
  onBack?: React.MouseEventHandler;
  back?: React.ReactElement | ((props: HeaderBackProps) => React.ReactNode);
  showTab?: boolean;
  tabs?: React.ReactNode;
  actions?: React.ReactNode;
  /** The scroll-shadow state. The caller owns the listener; this is only the presentation. */
  scrolled?: boolean;
  /** The left cluster's first element, before back and title (a menu button). Web-only (UMK-1041). */
  leading?: React.ReactNode;
  /**
   * A slot centred in the bar (a logo mark). When filled the bar becomes three columns so it is
   * truly centred. Web-only (UMK-1041).
   */
  center?: React.ReactNode;
  /** While not `scrolled`, drop the type's ground for a transparent one. Web-only (UMK-1041). */
  transparentAtTop?: boolean;
  className?: string;
}

export const Header: React.FC<HeaderProps> = ({
  type = 'nonLogin',
  title,
  showTextLeft = false,
  showBack = false,
  backLabel = 'Back',
  onBack,
  back,
  showTab = false,
  tabs,
  actions,
  scrolled = false,
  leading,
  center,
  transparentAtTop = false,
  className,
}) => {
  const centred = isSlotFilled(center);
  /* SUBSTITUTED, not stacked: two ground classes on one element are not a conflict the merger resolves. */
  const typeClass =
    transparentAtTop && !scrolled
      ? `${HEADER_TYPE[type].split(' ').filter((c) => !c.startsWith('bg-')).join(' ')} ${HEADER_TRANSPARENT}`
      : HEADER_TYPE[type];
  const backProps: HeaderBackProps = {
    'data-header-back': '',
    'aria-label': backLabel,
    className: HEADER_BACK,
  };

  const backControl = () => {
    if (typeof back === 'function') return back(backProps);
    /* Marker and accessible name are imposed; the class set is composed with the caller's own
       rather than replacing it. */
    if (React.isValidElement(back)) {
      const own = (back.props as { className?: string }).className;
      return React.cloneElement(back, {
        ...backProps,
        className: cn(HEADER_BACK, own),
      } as never);
    }
    return (
      <button type="button" {...backProps} onClick={onBack}>
        <span aria-hidden="true">←</span>
      </button>
    );
  };

  return (
    <header
      data-header={type}
      className={cn(
        HEADER_BASE,
        typeClass,
        scrolled ? HEADER_SCROLL.scrolled : HEADER_SCROLL.idle,
        className,
      )}
    >
      <div className={centred ? HEADER_BAR_CENTERED : HEADER_BAR}>
        <div className={cn('flex min-w-0 items-center gap-3', centred && 'justify-self-start')}>
          {leading}
          {showBack && backControl()}
          {showTextLeft && title !== undefined && (
            <span data-header-title="" className={HEADER_TITLE}>
              {title}
            </span>
          )}
        </div>
        {centred && <div data-header-center="">{center}</div>}
        {/* An omitted slot renders NOTHING — see `isSlotFilled`. */}
        {isSlotFilled(actions) && (
          <div data-header-actions="" className={cn(HEADER_ACTIONS, centred && 'justify-self-end')}>
            {actions}
          </div>
        )}
      </div>
      {showTab && isSlotFilled(tabs) && (
        <div data-header-tabs="" className={HEADER_TABS}>
          {tabs}
        </div>
      )}
    </header>
  );
};

export { HEADER_TYPES, type HeaderType };
