'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  A2UI_TAB_LIST,
  A2UI_TAB_PANEL,
  A2UI_TAB_STATE,
  A2UI_TAB_TRIGGER,
} from '../../primitives/a2ui-classes';
import {
  ICON_SLOT,
  TAB_LIST,
  TAB_NOTIF,
  TAB_NOTIF_SIZE,
  TAB_NOTIF_STATE,
  TAB_SIZE,
  TAB_STATE,
  TAB_TRIGGER,
} from '../../primitives/content-classes';

type Axes = typeof contract.Tabs.axes;

export type TabSize = Axes['size'][number];
export type TabState = Axes['state'][number];
export type TabAppearance = Axes['appearance'][number];

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  size: TabSize;
  appearance: TabAppearance;
  /** Namespaces the generated ids so two mounted tab sets cannot collide. */
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

const useTabsContext = () => {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs component');
  }
  return context;
};

const tabId = (baseId: string, value: string) => `${baseId}-tab-${value}`;
const panelId = (baseId: string, value: string) => `${baseId}-panel-${value}`;

export interface TabsProps {
  /** The active tab. Optional — omit it and the component owns the state. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** The initially-active tab when the component is uncontrolled. */
  defaultValue?: string;
  size?: TabSize;
  /**
   * `a2ui` is the agent surface's pre-library tab bar (UMK-1290); only its adapter passes it. It
   * also leaves the triggers and the active panel in the page's tab order, as that bar always did —
   * the roving tabindex is the default look's behaviour, not the a2ui one's.
   */
  appearance?: TabAppearance;
  children: React.ReactNode;
  className?: string;
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Names the tablist. Without one a screen reader announces a list of tabs for nothing. */
  label?: string;
  children: React.ReactNode;
}

interface TabsTriggerBase extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  value: string;
  /** Figma's `Show Icon Left` slot. Decorative — the title carries the name. */
  iconLeft?: React.ReactNode;
  /**
   * Figma's `Show Notif` badge, as the COUNT it displays rather than a boolean.
   *
   * The published set toggles a pill carrying a number; a bare boolean can say the badge is
   * there but not what it reads, so the count is the prop and its presence is the toggle. The
   * contract keeps `showNotif` as the published vocabulary and records the divergence.
   *
   * It is announced, not decorative — a number nobody can hear is a number half the users do
   * not get — so give `notifLabel` the noun it counts.
   */
  notif?: number;
  /** Names what `notif` counts, for screen readers. Defaults to a bare count. */
  notifLabel?: (count: number) => string;
  children: React.ReactNode;
}

/**
 * Figma's `Show Title`, as a UNION rather than a plain boolean.
 *
 * Hiding the title makes an icon-only tab, which has no accessible name left of its own — so
 * `aria-label` stops being optional. Encoding that in the type is the difference between a
 * rule and a comment: `<TabsTrigger showTitle={false}>` is a compile error rather than an
 * unlabelled control nobody notices until an audit.
 */
export type TabsTriggerProps = TabsTriggerBase &
  ({ showTitle?: true } | { showTitle: false; 'aria-label': string });

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  children: React.ReactNode;
}

/**
 * A tabbed interface, with the ARIA wiring the component this replaces never had.
 *
 * IT SET `role="tab"` AND `aria-selected` AND NOTHING ELSE — no `id`, no `aria-controls`, no
 * `aria-labelledby`, no keyboard traversal. Tabs that announce themselves as tabs and connect
 * to no panel are worse than plain buttons, because they promise a relationship assistive
 * technology then cannot follow.
 *
 * EVERY PANEL STAYS MOUNTED, and that is the load-bearing change. `TabsContent` used to
 * return `null` for every inactive value, so only one panel existed in the document — and an
 * `aria-controls` on any unselected tab would then point at nothing. Adding the attribute
 * without changing the render produces a reference that can never resolve and an assertion
 * that can never pass. Inactive panels carry `hidden`, which is what the ARIA tabs pattern
 * expects anyway.
 *
 * The `variant: default | outlined` this shipped with is gone rather than contracted: it has
 * no Figma counterpart, and contracting an invented vocabulary is exactly what `Tab`'s
 * slice-1 note existed to prevent. The size axis (`large | small`) replaces it, read from the
 * published set. `state` stays a contract axis but never a prop — which tab is active is a
 * property of the SET, and a per-trigger flag makes two active tabs representable.
 *
 * The component works controlled or uncontrolled. It was controlled-only with both props
 * required, so a story could not render it without inventing state around it.
 */
export const Tabs = ({
  value,
  onValueChange,
  defaultValue,
  size = 'large',
  appearance = 'default',
  children,
  className,
}: TabsProps) => {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? '');
  const controlled = value !== undefined;
  const active = controlled ? value : uncontrolled;
  const baseId = React.useId();

  const handleChange = React.useCallback(
    (next: string) => {
      if (!controlled) setUncontrolled(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );

  return (
    <TabsContext.Provider value={{ value: active, onValueChange: handleChange, size, appearance, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
};

export const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, label, children, onKeyDown, ...props }, ref) => {
    /**
     * TRAVERSAL IS OWNED BY THE LIST, not by each trigger. A trigger only knows itself, so
     * per-trigger handlers cannot wrap from the last tab to the first — which is the half a
     * hand-rolled version always drops. Reading the rendered tabs off the DOM also keeps this
     * correct when triggers are conditional, which a children-index scheme is not.
     */
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
      if (!keys.includes(event.key)) return;

      /* `:not(:disabled)` is load-bearing. `.focus()` and `.click()` are BOTH silent no-ops on
         a disabled button, so landing on one strands the keyboard there — every further arrow
         press recomputes from a `current` of -1 and returns early, and the only escape is the
         mouse. Skipping disabled triggers is also what the ARIA tabs pattern asks for. */
      const tabs = [
        ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
      ];
      if (tabs.length === 0) return;
      const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (current === -1) return;

      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      /* Focus MOVES the selection, per the ARIA automatic-activation pattern the click path
         already follows — a focused tab whose panel does not follow reads as a dead key. */
      tabs[next].focus();
      tabs[next].click();
    };

    const { appearance } = useTabsContext();

    return (
      <div
        /* Spread first — same reason as the trigger and the panel. */
        {...props}
        ref={ref}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className={cn(appearance === 'a2ui' ? A2UI_TAB_LIST : TAB_LIST, className)}
      >
        {children}
      </div>
    );
  },
);

TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  (
    { className, value, iconLeft, notif, notifLabel, showTitle = true, children, onClick, ...props },
    ref,
  ) => {
    const { value: activeValue, onValueChange, size, appearance, baseId } = useTabsContext();
    const a2ui = appearance === 'a2ui';
    const state: TabState = activeValue === value ? 'active' : 'default';

    return (
      <button
        /* THE SPREAD COMES FIRST, and the order is the point. JSX is last-wins, so a spread
           placed after these attributes lets a caller's stray `id` or `aria-selected` silently
           replace the wiring this component exists to guarantee — and nothing would fail to
           compile, because `ButtonHTMLAttributes` legally carries every one of them. Computed
           a11y wins; the passthrough fills in around it. */
        {...props}
        ref={ref}
        type="button"
        role="tab"
        id={tabId(baseId, value)}
        aria-selected={state === 'active'}
        aria-controls={panelId(baseId, value)}
        /* ROVING TABINDEX. One stop for the whole tablist, and arrow keys move within it —
           without this, Tab walks through every trigger one at a time, which is the pattern
           a tablist exists to avoid. */
        tabIndex={a2ui ? undefined : state === 'active' ? 0 : -1}
        className={cn(
          a2ui ? [A2UI_TAB_TRIGGER, A2UI_TAB_STATE[state]] : [TAB_TRIGGER, TAB_SIZE[size], TAB_STATE[state]],
          className,
        )}
        onClick={(e) => {
          onValueChange(value);
          onClick?.(e);
        }}
      >
        {iconLeft ? (
          <span aria-hidden className={ICON_SLOT}>
            {iconLeft}
          </span>
        ) : null}
        {showTitle ? children : null}
        {notif !== undefined ? (
          <span className={cn(TAB_NOTIF, TAB_NOTIF_SIZE[size], TAB_NOTIF_STATE[state])}>
            <span aria-hidden>{notif}</span>
            <span className="sr-only">{notifLabel ? notifLabel(notif) : `${notif}`}</span>
          </span>
        ) : null}
      </button>
    );
  },
);

TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, children, ...props }, ref) => {
    const { value: activeValue, appearance, baseId } = useTabsContext();
    const a2ui = appearance === 'a2ui';

    return (
      <div
        /* Spread first — same reason as the trigger: computed a11y must win over a
           passthrough that could legally carry `id`, `hidden` or `aria-labelledby`. */
        {...props}
        ref={ref}
        role="tabpanel"
        id={panelId(baseId, value)}
        aria-labelledby={tabId(baseId, value)}
        /* MOUNTED EITHER WAY — see the component docblock. `hidden` is the whole difference
           between an inactive panel and an absent one, and an absent one takes its tab's
           `aria-controls` reference down with it. */
        hidden={activeValue !== value}
        tabIndex={!a2ui && activeValue === value ? 0 : undefined}
        className={cn(a2ui ? A2UI_TAB_PANEL : undefined, className)}
      >
        {children}
      </div>
    );
  },
);

TabsContent.displayName = 'TabsContent';
