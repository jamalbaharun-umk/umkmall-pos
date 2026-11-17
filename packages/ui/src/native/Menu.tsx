import React from 'react';
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { Dialog } from './Dialog';
import { FeatureTile, type FeatureTileIcon, type FeatureTileTone } from './FeatureTile';
import { Icon } from './Icon';
import { contract } from '../contract';
import { EnterList, MOTION } from './motion';
import {
  MENU_CONTENT,
  MENU_FLUSH_CONTENT,
  MENU_FLUSH_ITEM,
  MENU_FLUSH_SCROLL,
  MENU_HEADER,
  MENU_ITEM,
  MENU_ITEM_CHECKED,
  MENU_ITEM_DANGER_PRESSED,
  MENU_ITEM_PRESSED,
  MENU_SEPARATOR,
  MENU_VARIANT_CONTENT,
  MENU_VARIANT_ITEM,
} from './overlay-styles';
import { Text } from './Text';

/**
 * One row. `checked` PRESENT is what forks the semantics: present makes the row a checkbox
 * carrying its state, absent leaves it a plain item — an unchecked checkbox row still has to
 * announce itself as one.
 *
 * A row is not gated by `disabled` alone: a tool the user is not entitled to is hidden by
 * NOT PASSING THE ROW, as both web call sites do.
 */
export interface MenuItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  checked?: boolean;
  /**
   * Child rows. PRESENT makes this row open a second level instead of selecting — the web's
   * submenu trigger (UMK-963), mirrored in UMK-1371. On a sheet the second level REPLACES the
   * list, behind a back row; see the component docblock. `onSelect` and `checked` are ignored
   * on such a row, as on the web: a row that opens a list does not also fire or announce one.
   */
  items?: readonly MenuItem[];
  /**
   * Fires with `true` when this row's second level opens and `false` when it is left — by the
   * back row, by a selection inside it, or by the sheet closing, whoever closes it: a dismissal
   * or a controlled host setting `open` to false. Only meaningful with `items`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * The web's switch between a flyout and an in-place second level. ACCEPTED AND NOT READ: a
   * sheet has nowhere to fly a panel out to, so in-place is the only form here and every row
   * with `items` takes it. The field exists so a web call site ports without an edit.
   */
  drillIn?: boolean;
  /** The back row's text while this row's second level is showing. Defaults to "Kembali". */
  backLabel?: string;
  /** Renders a rule between groups and ignores every other field — pass `label: ''`. */
  separator?: boolean;
  /** A destructive row: error ink, and the error tint while pressed. */
  danger?: boolean;
  /**
   * React Native's own `Pressable` escape hatch, forwarded per row (UMK-914).
   *
   * Every other pressable in this library reaches it for free — `ButtonProps`,
   * `ChipProps`, `CheckBoxProps` and `RadioProps` all extend `PressableProps`, so a
   * playbook specimen can already be held open in its pressed treatment. A menu row is
   * built HERE from a plain object, so without this field the one pressed treatment on
   * this surface (`MENU_ITEM_PRESSED`) could never be shown to anybody.
   *
   * It keeps RN's `testOnly_` prefix on purpose: that prefix is the ecosystem's marker for
   * "not product API", and a row that ships with this set is a bug rather than a feature.
   * It is an existing interface gaining a field, NOT a new export — the enumerated
   * 27-component contract in `__tests__/exports.test.ts` is untouched.
   */
  testOnly_pressed?: boolean;
  /**
   * Draw this row as an identity feature tile in its `row` layout (identity §4.2, §5.3: "rows are
   * feature tiles in their row form") — the composer's Alat and Lampiran sheets. The row keeps the
   * menu's contract: a press CLOSES the sheet before `onSelect` fires, and `checked` PRESENT makes
   * it a toggle (the tile's `selected`, with its check circle and checkbox semantics).
   *
   * The tile needs a STRING `label` for its title; a node label falls back to the plain row.
   * `price` is the tile's price slot — a `CoinChip` the caller read from the live price book, or
   * absent when no honest price is known.
   */
  tile?: { tone: FeatureTileTone; icon: FeatureTileIcon; description?: string; price?: React.ReactNode };
}

type Axes = typeof contract.Menu.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface MenuProps {
  /**
   * Which of the two shipped treatments this menu renders. `pill` is the composer's tools
   * menu and the default; `boxed` is the settings popover's bordered card.
   *
   * The axis carries over even though the container does not: native `Menu` is a bottom
   * sheet (UMK-913) rather than a dropdown, but `variant` describes the ROWS and the panel
   * chrome, both of which a sheet draws too. Only the anchoring was platform-specific.
   */
  variant?: Of<'variant'>;
  /**
   * The control that opens the menu. Rendered AS the trigger: its `onPress` is composed
   * with the open, the way the web's `asChild` composes the Radix trigger.
   */
  trigger: React.ReactElement<{ onPress?: () => void }>;
  items: readonly MenuItem[];
  /** Accessible name for the menu surface itself. */
  label?: string;
  /**
   * The sheet's visible header (identity doc §5.3): a title at 18 Bold. Omit it for a bare sheet
   * of rows, as every menu was before native-ui-v2.
   */
  title?: string;
  /**
   * A node at the header's right edge — the coin chip, on the composer's Alat sheet. Drawn only
   * beside a `title`: a trailing node with no heading has nothing to sit beside.
   */
  headerTrailing?: React.ReactNode;
  /** Controlled open state. Omit both for the uncontrolled form. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  style?: StyleProp<ViewStyle>;
  /**
   * Safe-area padding for the sheet's bottom edge, in points, forwarded to `Dialog`.
   *
   * `Menu` IS a bottom sheet (see below), so it inherits the sheet's safe-area problem
   * exactly: anchored to `flex-end`, its last row lands under the home indicator on gesture
   * navigation. The value is read above the `Modal` and handed down for the same reason it is
   * on `Dialog` — a `Modal` is its own window, and a provider nested inside one re-measures
   * and can disagree. It defaults to `0`, so a call site that forgets is the shipped bug and
   * nothing errors: `apps/mobile/src/__tests__/overlay-safe-area.test.tsx` enumerates the call
   * sites, and `__tests__/menu-inset.test.ts` pins the forwarding on this side of the package
   * boundary, because turbo caches the app's tests and would replay a pass over a change here.
   */
  bottomInset?: number;
  /** Forwarded to `Dialog`: a sheet of a few short rows, with less white above and below. See `Dialog`'s `compact`. */
  compact?: boolean;
  /**
   * Draw the native-ui-v2 identity sheet (mobile-design-identity.md §5.3, §7.2): `Dialog`'s
   * `identity` look, and the rows staggering in once the sheet has landed. OFF by default: not every
   * call site draws the identity sheet (the image ⋮ menu, `ImageActionsMenu`, does not), so a call
   * site opts in.
   */
  identity?: boolean;
  /**
   * Draw the plain rows as the Final Design's sheet rows (UMK-1890): square, edge to edge across the
   * sheet, 16 on every side and 12 between icon and label — the composer's Alat and Lampiran
   * sheets. OFF by default, so every other menu keeps its pill rows.
   */
  flushRows?: boolean;
}

/**
 * A BOTTOM SHEET, NOT A DROPDOWN — the UMK-913 decision, recorded here.
 *
 * Positioning, a focus trap and outside-click have no shared implementation between web
 * and native, and the native answer to a web dropdown is usually a sheet: reachable by a
 * thumb, dismissible by the platform gesture, and announced as a modal. So this reuses
 * `Dialog`'s sheet form rather than porting Radix's popover geometry, and the native side
 * never builds a dropdown.
 *
 * A SECOND LEVEL REPLACES THE LIST (UMK-1371). A row carrying `items` swaps the sheet's rows
 * for a back row followed by its children — the form the web calls `drillIn` and uses on a
 * surface too narrow for a flyout, which a sheet always is. One step only: a child row's own
 * `items` are not opened, so "back" is always a single step, as on the web. ANY dismissal
 * closes the whole sheet — `Dialog` reports one close for the scrim, the swipe and the
 * hardware back, so "step out one level" (the web's Escape) cannot be told from "close". The
 * level is forgotten when the sheet next OPENS rather than when it closes, so the rows do not
 * change under the exit animation.
 *
 * THE PROP SHAPES DIVERGED IN UMK-963, and native deliberately did not follow. The web row
 * has two things this one does not:
 *
 * - `href` / `external`, making a row a real anchor. There is no anchor here; a native row
 *   that navigates calls the navigator in its `onSelect`, and there is nothing for a URL to
 *   be copied out of or middle-clicked into.
 * - `onSelect` carrying the DOM Event so a web row can cancel the close. There is no such
 *   event here and no cancellable close to hang off it, so this stays `() => void`.
 *
 * `variant` AND `items` ARE NOT ON THAT LIST. `variant` carried over in UMK-986 — it describes
 * the rows and the panel chrome, both of which a sheet draws — and `items` in UMK-1371, above.
 * The two that remain are row-shape divergences, not a blanket "native ignores what 963 did".
 *
 * NOTHING COMPILES THE TWO SIGNATURES AGAINST EACH OTHER, so this paragraph and the parity
 * table in `docs/features/mobile/native-design-system.md` are the whole record. A screen
 * port is still call-site-compatible for every row shape this file DOES support — but that
 * is now a subset, not the whole of `MenuProps`.
 *
 * A row selection CLOSES the sheet before `onSelect` fires, matching a dropdown's
 * close-on-select.
 *
 * THE NATIVE-UI-V2 SHEET (docs/guidelines/mobile-design-identity.md §5.3, §7.2). With `identity`,
 * a menu is drawn as the identity sheet — `Dialog`'s `identity`: `radius.3xl` top corners, `shadow.float`,
 * the panel sliding up on `spring.sheet` while the scrim fades over `duration.base`, and a
 * shorter `easing.exit` exit. The rows then STAGGER IN once the sheet has landed: an `EnterList`
 * delayed by `duration.base`, the span in which `spring.sheet` covers most of its travel, so a
 * row never rises while the panel under it is still moving. The handle is `Dialog`'s own.
 */
/** The identity sheet's row entrance: staggered in after `spring.sheet` has covered most of its travel. */
const IdentityRows = ({ children }: { children?: React.ReactNode }) => <EnterList delay={MOTION.duration.base}>{children}</EnterList>;

export const Menu = ({
  trigger,
  items,
  label,
  title,
  headerTrailing,
  variant = 'pill',
  open,
  onOpenChange,
  style,
  bottomInset,
  compact,
  flushRows = false,
  identity = false,
}: MenuProps) => {
  /* The same rows either way; only whether each one is wrapped in an entrance. */
  const Rows = identity ? IdentityRows : React.Fragment;
  const [internal, setInternal] = React.useState(false);
  const isOpen = open ?? internal;
  /* The ID of the row whose second level is showing, or null for the menu's own list. An id and
     not the row: the row is resolved from `items` on every render, so a host that re-renders with
     new rows while the level is showing gets its new children, back label and `onOpenChange`
     rather than a snapshot of the old ones. A row that is gone, or no longer opens a level, falls
     back to the menu's own list. */
  const [drilledId, setDrilledId] = React.useState<string | null>(null);
  const drilled = drilledId === null ? null : (items.find((item) => item.id === drilledId && item.items !== undefined) ?? null);

  /* Forgotten on OPEN, not on close — see "A SECOND LEVEL REPLACES THE LIST". Derived during
     render so a reopened sheet's first frame is already the parent list. */
  const [wasOpen, setWasOpen] = React.useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen && drilledId !== null) setDrilledId(null);
  }

  /*
   * A level is LEFT in one place: here, after the render in which it stopped showing.
   *
   * `setOpen` used to report it, and `setOpen` only runs for a close this component starts — a
   * dismissal or a selection. A CONTROLLED host can close the sheet itself, flipping `open` to
   * false while a level is showing, and that reached nobody: the row was never told `false`, and
   * the next open forgot the level in silence, so a host tracking it through the row's
   * `onOpenChange` went on believing it was open. Keyed on what is SHOWING instead — sheet open
   * and a row drilled — every way out is the same event: the back row, a selection, a dismissal,
   * the host's own `open={false}`, and the row disappearing from `items`.
   *
   * `told` is the row that has heard `true` and not yet `false`, refreshed while the level shows
   * so the `false` goes to the row's CURRENT callback. Clearing it before the call is what keeps
   * a second run of this effect (StrictMode, or any later render) from reporting twice.
   */
  const showing = isOpen ? drilled : null;
  const told = React.useRef<MenuItem | null>(null);
  React.useEffect(() => {
    if (showing !== null) {
      told.current = showing;
      return;
    }
    const left = told.current;
    if (left === null) return;
    told.current = null;
    left.onOpenChange?.(false);
  });

  const setOpen = (next: boolean) => {
    if (open === undefined) setInternal(next);
    onOpenChange?.(next);
  };

  const drillTo = (item: MenuItem | null) => {
    item?.onOpenChange?.(true);
    setDrilledId(item === null ? null : item.id);
  };

  const triggerWithOpen = React.cloneElement(trigger, {
    onPress: () => {
      trigger.props.onPress?.();
      setOpen(true);
    },
  });

  const rows = drilled === null ? items : (drilled.items ?? []);

  return (
    <>
      {triggerWithOpen}
      <Dialog open={isOpen} onOpenChange={setOpen} label={label}
        title={title === undefined ? undefined : <MenuHeader title={title} trailing={headerTrailing} />}
        identity={identity}
        style={style}
        bottomInset={bottomInset}
        compact={compact}
      >
        {/* A bounded scroller around the rows, so a menu longer than the sheet's 88% cap scrolls
            instead of clipping its last rows. `flexShrink: 1` is the half that makes it bounded
            (the content box around it shrinks; this has to as well), and `bounces={false}` is
            the half that keeps a short menu looking exactly as it did — it has nothing to
            scroll, and a rubber-band on a four-row sheet reads as a bug. */}
        {/* The flush overhang as an object LITERAL: `overlay-scroll.test.tsx` proves this scroller still
            shrinks by reading its style, and an imported table is opaque to it. */}
        <ScrollView style={[{ flexShrink: 1 }, flushRows && { marginHorizontal: MENU_FLUSH_SCROLL.marginHorizontal }]} bounces={false} keyboardShouldPersistTaps="handled">
          <View accessibilityRole="menu" accessibilityLabel={label} style={[MENU_CONTENT, MENU_VARIANT_CONTENT[variant], flushRows && MENU_FLUSH_CONTENT]}>
            <Rows>
            {drilled !== null && (
              <Pressable
                key={`${drilled.id}-back`}
                accessibilityRole="menuitem"
                onPress={() => drillTo(null)}
                style={({ pressed }) => [MENU_ITEM, MENU_VARIANT_ITEM[variant], pressed && MENU_ITEM_PRESSED]}
              >
                <View accessibilityElementsHidden>
                  <Icon name="chevron-left" size="md" color="primary" />
                </View>
                <Text variant="paragraph" weight="medium" style={{ flex: 1 }}>
                  {drilled.backLabel ?? 'Kembali'}
                </Text>
              </Pressable>
            )}
            {rows.map((item) => {
              const { id, label: itemLabel, icon, trailing, onSelect, disabled, checked, separator, danger, testOnly_pressed } = item;
              if (separator === true) return <View key={id} accessibilityElementsHidden style={MENU_SEPARATOR[variant]} />;
              /* Only a row of the menu's OWN list opens a level: one step, so back is one step. */
              /* A tile row (native-ui-v2): the Alat and Lampiran sheets draw their rows as feature
                 tiles. It selects and closes like any row, and never opens a level. */
              if (item.tile && typeof itemLabel === 'string') {
                return (
                  <FeatureTile
                    key={id}
                    testID={`menu-tile-${id}`}
                    layout="row"
                    tone={item.tile.tone}
                    icon={item.tile.icon}
                    title={itemLabel}
                    description={item.tile.description}
                    price={item.tile.price}
                    selected={checked}
                    disabled={disabled}
                    onPress={() => {
                      setOpen(false);
                      onSelect?.();
                    }}
                  />
                );
              }
              const opens = item.items !== undefined && drilled === null;
              const checkable = checked !== undefined && !opens;
              return (
                <Pressable
                  key={id}
                  testOnly_pressed={testOnly_pressed}
                  accessibilityRole={checkable ? 'checkbox' : 'menuitem'}
                  accessibilityState={{
                    disabled: Boolean(disabled),
                    ...(checkable ? { checked } : {}),
                    ...(opens ? { expanded: false } : {}),
                  }}
                  disabled={disabled}
                  onPress={() => {
                    if (opens) return drillTo(item);
                    setOpen(false);
                    onSelect?.();
                  }}
                  style={({ pressed }) => [
                    MENU_ITEM,
                    MENU_VARIANT_ITEM[variant],
                    flushRows && MENU_FLUSH_ITEM,
                    checkable && checked && MENU_ITEM_CHECKED,
                    pressed && !disabled && (danger ? MENU_ITEM_DANGER_PRESSED : MENU_ITEM_PRESSED),
                    disabled && { opacity: 0.5 },
                  ]}
                >
                  {icon !== undefined && <View accessibilityElementsHidden>{icon}</View>}
                  {typeof itemLabel === 'string' ? (
                    <Text
                      variant="paragraph"
                      weight="medium"
                      color={danger ? 'error' : checkable && checked ? 'brand' : 'primary'}
                      style={{ flex: 1 }}
                    >
                      {itemLabel}
                    </Text>
                  ) : (
                    <View style={{ flex: 1 }}>{itemLabel}</View>
                  )}
                  {trailing !== undefined ? (
                    <View>{trailing}</View>
                  ) : checkable && checked ? (
                    <Icon name="check" size="md" color="brand" />
                  ) : null}
                </Pressable>
              );
            })}
            </Rows>
          </View>
        </ScrollView>
      </Dialog>
    </>
  );
};

Menu.displayName = 'Menu';

/** The identity sheet's header row: the title, and the trailing node beside it. */
const MenuHeader = ({ title, trailing }: { title: string; trailing?: React.ReactNode }) => (
  <View style={MENU_HEADER}>
    <Text variant="h5" weight="bold" accessibilityRole="header" style={{ flexShrink: 1 }}>
      {title}
    </Text>
    {trailing !== undefined && trailing !== null && <View>{trailing}</View>}
  </View>
);
