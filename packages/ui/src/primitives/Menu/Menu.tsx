'use client';

import React from 'react';
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import type { DataAttributes, MenuVariant } from '../overlay-classes';
import {
  MENU_CONTENT,
  MENU_ITEM,
  MENU_ITEM_CHECKED,
  MENU_ITEM_DANGER,
  MENU_SEPARATOR,
  MENU_SUB_CONTENT,
  MENU_SUB_TRIGGER,
} from '../overlay-classes';

export type MenuSide = 'top' | 'right' | 'bottom' | 'left';
export type MenuAlign = 'start' | 'center' | 'end';

/**
 * One row.
 *
 * `checked` is what forks the ARIA: present makes the row a `menuitemcheckbox` carrying
 * `aria-checked`, absent leaves it a plain `menuitem`. `ComposerToolsMenu`'s "Buat Gambar"
 * row is a checkbox today and losing that would be a silent a11y regression — the row would
 * still render, still fire, and stop announcing whether the next turn is armed.
 *
 * A row is not gated by `disabled` alone: both migrated call sites hide a tool the user is
 * not entitled to by NOT PASSING THE ROW, and a disabled row instead would advertise a
 * capability that is off. Keep the absent-item form as the feature gate.
 */
export interface MenuItem extends DataAttributes {
  /** Identity for React and for `onSelect`. */
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Trailing content — a check glyph, a shortcut hint. */
  trailing?: React.ReactNode;
  /**
   * TAKES THE EVENT, and that is not decoration: Radix's own `onSelect` is cancellable, and
   * `event.preventDefault()` is the ONLY way to keep the menu open past a select. A link row
   * that wants a modified click to leave the menu standing has no other lever, and a
   * signature typed `() => void` receives the event and silently discards it.
   *
   * A handler that ignores the argument still type-checks, so every existing `() => void`
   * call site compiles unchanged.
   */
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  /** Present makes this a checkable row; its value is the announced state. */
  checked?: boolean;
  /**
   * A destination. PRESENT makes the row a real anchor rather than a button, rendered
   * through `asChild` so Radix keeps owning the roving tabindex and the select.
   *
   * A row that navigates has to BE a link: a button calling `router.push` has no href to
   * copy, to middle-click into a new tab, or to open with a keyboard modifier — and
   * `AccountMenu`'s rows are navigations.
   *
   * Ignored on a row that declares `items`, along with `onSelect` and `checked`: a submenu
   * trigger opens a panel — it does not go anywhere, it does not fire a selection, and it does
   * not announce a checked state. `items` is the first fork and it wins.
   */
  href?: string;
  /**
   * Leaves the app. Adds the new-context target and, with it, `rel="noopener noreferrer"` —
   * they travel together because a `_blank` without the `rel` hands the opened document a
   * live `window.opener` back into this one.
   *
   * Also forces the plain anchor over `linkComponent`: a client-side router asked to handle
   * an off-site URL is at best a wasted round trip.
   */
  external?: boolean;
  /**
   * Child rows. PRESENT makes this a submenu trigger instead of an item — the third fork on
   * the same discriminant style as `checked`.
   */
  items?: readonly MenuItem[];
  /**
   * Fires with `true` when this submenu opens and `false` when it closes. Only meaningful on a
   * row that declares `items` — a leaf has nothing to open. Fires once per open, whether the
   * pointer or the keyboard opened it, because Radix reports the sub's state rather than the
   * trigger's click. With `drillIn`, "open" is the drilled-in view. Native mirror: UMK-1371 (UMK-1041, L18).
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * With `items`: opening this row REPLACES the menu's list, in the same surface, with a back
   * row followed by these children, instead of opening a flyout beside it. Back, or Escape,
   * returns to the parent list; Escape does not close the menu from inside the drilled view.
   * For a surface too narrow for a flyout (a drawer). Native mirror: UMK-1371 (UMK-1041, L22).
   */
  drillIn?: boolean;
  /** The back row's text while drilled in. Defaults to "Kembali". Native mirror: UMK-1371 (UMK-1041, L22). */
  backLabel?: string;
  /**
   * Renders a rule between groups and ignores every other field — pass `label: ''`. Native mirror: UMK-1371
   * (UMK-1041).
   */
  separator?: boolean;
  /** A destructive row: error ink and highlight. Native mirror: UMK-1371 (UMK-1041). */
  danger?: boolean;
  className?: string;
}

export interface MenuProps extends DataAttributes {
  /**
   * The control that opens the menu. Rendered AS the trigger, not wrapped in one.
   *
   * `ReactElement`, not `ReactNode`, for the same reason `Tooltip` narrows its own children:
   * `asChild` hands this to Radix's `Slot`, which calls `Children.only`. A string, an array
   * or `null` type-checks under the wider type and then throws at runtime, and the narrow
   * type is the only compile-time signal there is.
   */
  trigger: React.ReactElement;
  items: readonly MenuItem[];
  /** Accessible name for the menu surface itself. */
  label?: string;
  /**
   * Controlled open state. Omit BOTH this and `onOpenChange` for the uncontrolled form, in
   * which the menu owns its own state and the trigger opens it.
   *
   * Both forms are supported because the two call sites this replaces need one each:
   * `ComposerToolsMenu` owns its open state in a local `useState`, and the composer's attach
   * menu takes `open` from its parent. A component that served only one of them would look
   * finished and fail on the second site.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Preferred placement. Radix FLIPS away from it near a viewport or clipping edge. */
  side?: MenuSide;
  align?: MenuAlign;
  sideOffset?: number;
  collisionPadding?: number;
  /**
   * What a row carrying `href` renders as. Defaults to a plain anchor.
   *
   * THE LIBRARY CANNOT IMPORT THE APP'S ROUTER — `next/link` is not a dependency here and
   * must not become one — so a consumer that wants client-side navigation passes its own
   * link component once for the whole menu rather than per row. An `external` row ignores
   * this and stays a plain anchor.
   */
  linkComponent?: React.ElementType;
  /**
   * WHICH OF THE TWO SHIPPED TREATMENTS THIS MENU RENDERS. Defaults to `pill`, which is what
   * the live composer menu already renders — the default is not a taste call, it is the
   * no-change answer for the one migrated call site.
   *
   * `boxed` is the settings popover's treatment. Neither has a design source; see
   * `overlay-classes.ts`.
   */
  variant?: MenuVariant;
  className?: string;
}


/**
 * One row, recursively.
 *
 * A function rather than a component so the submenu can call it on its own children without
 * a second module-level definition, and so the four forks stay side by side in one place
 * where a reader can see that `items`, `href` and `checked` are mutually exclusive.
 */
const renderRow = (
  item: MenuItem,
  linkComponent: React.ElementType,
  /* THREADED, NOT DEFAULTED. A submenu is rendered by this same function one level down, so a
     parameter with a default here would quietly serve pill rows inside a boxed panel — which
     is the one bug this axis can grow that still renders, still works and looks deliberate. */
  variant: MenuVariant,
  /* Present only at the top level of a menu that can drill in; a drilled view's own rows never
     drill further, which is what keeps "back" a single step. */
  drill?: (item: MenuItem) => void,
): React.ReactElement => {
  const {
    id,
    label,
    icon,
    trailing,
    onSelect,
    disabled,
    checked,
    href,
    external,
    items,
    onOpenChange,
    drillIn,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- read by `Menu` for the drilled-in view; pulled out here so it never reaches the DOM
    backLabel: _backLabel,
    separator,
    danger,
    className,
    ...itemData
  } = item;

  if (separator === true) return <RadixMenu.Separator key={id} className={MENU_SEPARATOR[variant]} />;

  const body = (
    <>
      {icon !== undefined && <span className="flex h-5 w-5 shrink-0 items-center">{icon}</span>}
      <span className="flex-1 text-ds-paragraph-mobile font-medium leading-5">{label}</span>
      {trailing !== undefined && <span className="flex shrink-0 items-center">{trailing}</span>}
    </>
  );

  /* `key` is NOT in here. React 19 warns on a props object carrying `key` spread into JSX,
     on every render of every row — it is passed explicitly below instead. */
  const shared = { disabled, onSelect, ...itemData };

  /* `items` PRESENT is the first fork, and it wins: a row that opens a panel does not also
     navigate or announce a checked state. */
  if (items !== undefined && drillIn === true && drill) {
    /* A plain row that keeps the menu open and swaps the list. `preventDefault` is the only
       lever Radix gives to survive a select, and `aria-haspopup` keeps the announcement a
       submenu trigger would have made. */
    return (
      <RadixMenu.Item
        key={id}
        disabled={disabled}
        {...itemData}
        aria-haspopup="menu"
        onSelect={(event) => {
          event.preventDefault();
          drill(item);
        }}
        className={cn(MENU_ITEM[variant], MENU_SUB_TRIGGER[variant], danger && MENU_ITEM_DANGER, className)}
      >
        {body}
      </RadixMenu.Item>
    );
  }

  if (items !== undefined) {
    return (
      <RadixMenu.Sub key={id} onOpenChange={onOpenChange}>
        <RadixMenu.SubTrigger
          disabled={disabled}
          {...itemData}
          className={cn(MENU_ITEM[variant], MENU_SUB_TRIGGER[variant], danger && MENU_ITEM_DANGER, className)}
        >
          {body}
        </RadixMenu.SubTrigger>
        {/* NO `modal` PROP ANYWHERE IN THIS COMPONENT. The submenu inherits the Root's
            non-modal mode, which is the pinned decision — see the Root below. A submenu that
            "needed" modality would be reintroducing the stranded scroll lock one level down. */}
        <RadixMenu.Portal>
          <RadixMenu.SubContent
            loop
            sideOffset={4}
            collisionPadding={8}
            className={MENU_SUB_CONTENT[variant]}
          >
            {items.map((child) => renderRow(child, linkComponent, variant))}
          </RadixMenu.SubContent>
        </RadixMenu.Portal>
      </RadixMenu.Sub>
    );
  }

  /* `href` PRESENT is the second. `asChild` hands the row's behaviour to the anchor rather
     than nesting one inside a button, which is neither valid nor operable by keyboard. */
  if (href !== undefined) {
    const Link = external === true ? 'a' : linkComponent;
    return (
      <RadixMenu.Item key={id} {...shared} asChild className={cn(MENU_ITEM[variant], danger && MENU_ITEM_DANGER, className)}>
        <Link href={href} {...(external === true ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {body}
        </Link>
      </RadixMenu.Item>
    );
  }

  /* `checked` PRESENT is the third, and it is `checked` being present rather than being true
     — an unchecked checkbox row still has to announce itself as one. */
  return checked === undefined ? (
    <RadixMenu.Item key={id} {...shared} className={cn(MENU_ITEM[variant], danger && MENU_ITEM_DANGER, className)}>
      {body}
    </RadixMenu.Item>
  ) : (
    <RadixMenu.CheckboxItem
      key={id}
      {...shared}
      checked={checked}
      className={cn(MENU_ITEM[variant], checked && MENU_ITEM_CHECKED, danger && MENU_ITEM_DANGER, className)}
    >
      {body}
    </RadixMenu.CheckboxItem>
  );
};

/**
 * Wraps `@radix-ui/react-dropdown-menu`.
 *
 * Replaces two hand-rolled `role="menu"` blocks that between them had no keyboard traversal,
 * no typeahead, no portal and no collision detection — the composer's attach menu computed
 * its own up/down direction by walking overflow ancestors, which Radix does properly and
 * continuously. Roving tabindex, Escape, outside-click dismiss and the portal all arrive with
 * the library.
 *
 * FOCUS RETURN IS RADIX'S DEFAULT, DELIBERATELY: focus goes back to the trigger. Written down
 * rather than inherited silently. It is also the only defensible answer for a menu
 * specifically — the trigger is a toggle, so returning anywhere else leaves a keyboard user
 * unable to reopen what they just closed without hunting for the button again.
 *
 * A SUBMENU AND A LINK ROW ARE NOT THE WIDENING THE NEXT PARAGRAPH WARNS ABOUT, and the
 * distinction is worth stating rather than assuming. What that warning is about is VALUE
 * SEMANTICS: a `value`/`onValueChange` pair, a controlled highlight, a component that
 * reflects a selection. A submenu adds none of those — it is the same rows one level down,
 * with Radix supplying the traversal, the typeahead and the collision handling exactly as it
 * does for the flat menu. A link row adds no state at all; it changes what element a row
 * renders as. Both leave the menu a menu.
 *
 * NOT A LISTBOX, AND MUST NOT BECOME ONE. If a controlled-highlight or a no-focus-steal mode
 * starts to look necessary, what has leaked into scope is `SlashCommandMenu` — a
 * `role="listbox"` combobox popup whose arrow keys are handled by the composer because the
 * events fire on a contenteditable editor. A menu that owns roving tabindex breaks it
 * outright. Stop and reconsider rather than widening this component.
 *
 * PORTALLED, and at `z-ds-overlay` — following `Tooltip` rather than `DateTimeInput`, which
 * renders its popover inline with no z-index. That is a latent stacking bug, not a pattern.
 */
export const Menu = ({
  trigger,
  items,
  label,
  open,
  onOpenChange,
  side = 'top',
  align = 'start',
  sideOffset = 8,
  collisionPadding = 8,
  linkComponent = 'a',
  variant = 'pill',
  className,
  ...dataAttributes
}: MenuProps) => {
  /* The drilled-in row, or null for the parent list (L22). Reset on every close so a reopened
     menu never starts one level down. */
  const [drilled, setDrilled] = React.useState<MenuItem | null>(null);
  const drillTo = (item: MenuItem | null) => {
    const leaving = drilled;
    setDrilled(item);
    if (item) item.onOpenChange?.(true);
    else leaving?.onOpenChange?.(false);
  };
  const handleOpenChange = (next: boolean) => {
    if (!next && drilled) drillTo(null);
    onOpenChange?.(next);
  };
  /* Focus the back row once per drill — an inline ref callback would re-focus it on every render. */
  const backRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (drilled) backRef.current?.focus();
  }, [drilled]);
  const rows = drilled ? (drilled.items ?? []) : items;

  return (
  /* Radix Root accepts a controlled `open` and an uncontrolled absence of one on the same
     prop, so the two forms need no branch here: `undefined` IS the uncontrolled form. */
  <RadixMenu.Root
    open={open}
    onOpenChange={handleOpenChange}
    /**
     * NON-MODAL, and this is load-bearing rather than a preference.
     *
     * Radix defaults a DropdownMenu to modal, which mounts `react-remove-scroll` and
     * `aria-hidden`s every sibling of the portal for as long as the content is mounted. Both
     * are released by the content UNMOUNTING — so anything that keeps the node mounted past
     * the close leaves the page permanently scroll-locked and the whole app hidden from
     * assistive technology. The browser gate on UMK-898 caught exactly that: after one
     * open-and-dismiss of the composer's attach menu, `body` kept `overflow: hidden` and the
     * app root kept `aria-hidden="true"` until a navigation.
     *
     * Non-modal removes both side effects at the source, and it is also just the right
     * answer: a dropdown attached to a toolbar button has no business freezing page scroll
     * or hiding the document behind it. Outside-click dismissal, Escape and focus restore
     * are unaffected — they belong to the dismissable layer, not to modality.
     *
     * A `Dialog` is the opposite case and stays modal: inertness of the page behind it is
     * the point.
     *
     * NOTHING IN THE VITEST SUITE SEES THIS. happy-dom unmounts the content cleanly, so the
     * guard's "menu is gone after Escape" assertion passes either way. The evidence is a real
     * browser, which is why the plan's browser gate is not optional.
     */
    modal={false}
  >
    <RadixMenu.Trigger asChild {...dataAttributes}>
      {trigger}
    </RadixMenu.Trigger>
    <RadixMenu.Portal>
      <RadixMenu.Content
        aria-label={label}
        /* Radix defaults this OFF. Arrow keys then stop dead at the ends, which on a
           two-or-three-row menu means Up from the first row does nothing at all — the
           keyboard user's most likely first press. */
        loop
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(MENU_CONTENT[variant], className)}
        /* Escape steps back out of a drilled-in view instead of closing the menu. */
        onEscapeKeyDown={(event) => {
          if (drilled) {
            event.preventDefault();
            drillTo(null);
          }
        }}
      >
        {drilled && (
          <RadixMenu.Item
            key={`${drilled.id}-back`}
            className={cn(MENU_ITEM[variant])}
            onSelect={(event) => {
              event.preventDefault();
              drillTo(null);
            }}
            ref={backRef}
          >
            <span className="flex h-5 w-5 shrink-0 items-center">
              <Icon name="chevron-left" className="h-5 w-5" />
            </span>
            <span className="flex-1 text-ds-paragraph-mobile font-medium leading-5">
              {drilled.backLabel ?? 'Kembali'}
            </span>
          </RadixMenu.Item>
        )}
        {rows.map((item) => renderRow(item, linkComponent, variant, drilled ? undefined : drillTo))}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  </RadixMenu.Root>
  );
};

Menu.displayName = 'Menu';
