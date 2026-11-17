import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { A2UI_DISCLOSURE, A2UI_DISCLOSURE_PANEL, A2UI_DISCLOSURE_SUMMARY } from '../a2ui-classes';
import { DISCLOSURE_BASE, DISCLOSURE_PANEL, DISCLOSURE_SUMMARY } from '../content-classes';

type Axes = typeof contract.Disclosure.axes;

export interface DisclosureProps
  extends Omit<React.DetailsHTMLAttributes<HTMLDetailsElement>, 'title'> {
  /** The always-visible label. */
  title: React.ReactNode;
  /** Start expanded. Folded is the default, which is what a disclosure is for. */
  defaultOpen?: boolean;
  /** `a2ui` is the agent surface's pre-library disclosure (UMK-1307); only its adapter passes it. */
  appearance?: Axes['appearance'][number];
  children: React.ReactNode;
}

/**
 * A fold-out panel, on native `<details>` / `<summary>`.
 *
 * NATIVE ON PURPOSE. Keyboard operation, the open/closed state and its announcement all
 * arrive from the element — a hand-rolled toggle has to reimplement each one, and the third
 * is the one that is always missing. The guard asserts the element names rather than the
 * behaviour, because that is the part that would silently change.
 *
 * THE PROP NAMES ARE OURS. The a2ui renderer covering the same ground takes `summary` and
 * `child`, both pinned by the upstream A2UI spec and by `umkmall.catalog.json`, so it stays
 * an adapter whatever this does — copying its vocabulary would import a constraint from a
 * schema this package has no relationship with. `title` matches how the rest of the package
 * names a visible heading.
 */
export const Disclosure = React.forwardRef<HTMLDetailsElement, DisclosureProps>(
  ({ title, defaultOpen = false, appearance = 'default', children, className, ...props }, ref) => (
    <details
      ref={ref}
      open={defaultOpen}
      className={cn(appearance === 'a2ui' ? A2UI_DISCLOSURE : DISCLOSURE_BASE, className)}
      {...props}
    >
      <summary className={appearance === 'a2ui' ? A2UI_DISCLOSURE_SUMMARY : DISCLOSURE_SUMMARY}>{title}</summary>
      <div className={appearance === 'a2ui' ? A2UI_DISCLOSURE_PANEL : DISCLOSURE_PANEL}>{children}</div>
    </details>
  ),
);

Disclosure.displayName = 'Disclosure';
