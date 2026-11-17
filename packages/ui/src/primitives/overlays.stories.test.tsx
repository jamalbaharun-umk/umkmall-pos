import React from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as DialogStories from './Dialog/Dialog.stories';
import * as MenuStories from './Menu/Menu.stories';
import * as PopoverStories from './Popover/Popover.stories';
import { Dialog } from './Dialog';
import { Menu } from './Menu';
import { contract, storyTitle, type ComponentName } from '../contract';
import {
  DIALOG_HANDLE,
  DIALOG_PRESENTATION,
  DIALOG_SIZE,
  MENU_CONTENT,
  MENU_ITEM,
  MENU_SUB_CONTENT,
  MENU_SUB_TRIGGER,
  POPOVER_ALIGN,
} from './overlay-classes';

/**
 * The overlay guard.
 *
 * READS `baseElement`, NEVER `container`. This is the whole reason it can see anything: both
 * components portal, so their panels land outside the render's `container` entirely. The
 * sibling guard this borrows its shape from — `feedback.stories.test.tsx` — gets this right;
 * slice 2's `form-controls.stories.test.tsx` reads `container` and would silently miss every
 * assertion here, matching nothing and passing.
 *
 * A dialog that RENDERS is not a dialog that WORKS: the component this replaces advertised a
 * focus trap in its docblock and contained no Tab handler at all. So the probes below are
 * behavioural where happy-dom can model the behaviour — Escape, `aria-expanded`, arrow-key
 * traversal, `document.activeElement` after a close — and structural only where it cannot.
 *
 * WHAT IS DELIBERATELY NOT HERE, and why — three separate limits, not one.
 *
 * PLACEMENT. happy-dom has no layout engine, so nothing in this package can assert where an
 * overlay lands or how wide it ends up. Documented in the stories, checked by eye.
 *
 * TAB-WRAP inside the trap. Radix implements it with focus guards whose behaviour depends on
 * layout-aware focus order, so an assertion here would pass on the trap being ABSENT as
 * readily as on it working. What IS asserted instead is that opening moves focus INTO the
 * panel — which the component this replaces does not do, and which is the half a hand-rolled
 * "trap" always gets wrong.
 *
 * FOCUS RESTORE, for the DIALOG only. The menu's restore is asserted strictly, against
 * `document.activeElement`, and passes — the same shape `form-controls.test.tsx` already
 * proves works against Radix here. The dialog's cannot be: `react-remove-scroll` still has
 * the outside `aria-hidden` when the restore fires under happy-dom, so focus lands on the
 * body and a working restore would report as broken. The dialog asserts its close-focus cycle
 * RAN and leaves the landing spot to the browser gate. The two are next to each other on
 * purpose: the contrast is the evidence that the weaker one is a limit and not a shrug.
 *
 * Importing the story modules also pulls them into the typecheck program: `tsconfig` excludes
 * every stories file, so a story imported by a test is the only way one is checked at all.
 */

const MODULES = {
  Dialog: DialogStories,
  Menu: MenuStories,
  Popover: PopoverStories,

};

/**
 * THE CONTRACT DECIDES WHO BELONGS HERE, not a number this file keeps about itself.
 *
 * A count literal cannot detect an omission: add a component, forget both this guard's map and
 * the count, and the map is simply one shorter and still equals its own number. Reconciling the
 * keyset against every contract entry claiming this family is the check a count only looked
 * like — the same shape the purge sibling already uses against its class-table exports.
 */
const contractFamilyMembers = (family: string): string[] =>
  Object.entries(contract)
    .filter(([, entry]) => (entry as { family?: string }).family === family)
    .map(([name]) => name)
    .sort();


type AnyStory = {
  args?: Record<string, unknown>;
  render?: (a: never, b: never) => React.ReactElement;
};
type AnyModule = { default: { component: React.ElementType; args?: Record<string, unknown> } } & Record<
  string,
  unknown
>;

const element = (mod: AnyModule, story: AnyStory): React.ReactElement => {
  const args = { ...(mod.default.args ?? {}), ...(story.args ?? {}) };
  if (typeof story.render === 'function') return story.render(args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...args} />;
};

/**
 * Mounts every story in a module and returns everything the DOM ended up holding.
 *
 * `roots` is DEDUPED, and that matters more here than it does for the feedback guard: every
 * render shares one `baseElement` (the document body), so each root sees the portalled panels
 * of every story mounted before it. Counting them per root multiplies one dialog into six and
 * makes an id-uniqueness assertion fail on nothing.
 */
const mountAll = (mod: AnyModule) => {
  const classes = new Set<string>();
  const roots = new Set<HTMLElement>();
  for (const [name, story] of Object.entries(mod)) {
    if (name === 'default' || !story || typeof story !== 'object') continue;
    const { baseElement } = render(element(mod, story as AnyStory));
    roots.add(baseElement as HTMLElement);
    for (const el of baseElement.querySelectorAll('*')) for (const c of el.classList) classes.add(c);
  }
  return { classes, roots: [...roots] };
};

const storyCount = (mod: AnyModule) =>
  Object.entries(mod).filter(([n, s]) => n !== 'default' && s && typeof s === 'object').length;

describe('the overlay stories mount and say what they are', () => {
  /* The reconciliation its three siblings carry: the contract decides who belongs here. */
  it('covers every component the contract puts in this family', () => {
    expect(Object.keys(MODULES).sort()).toEqual(contractFamilyMembers('overlays'));
  });

  it('titles every story set for Storybook', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
      expect((mod as unknown as { default: { title: string } }).default.title).toBe(
        storyTitle(name as ComponentName),
      );
    }
  });

  /* The mount-everything assertion has to have something to mount. A module that lost its
     stories would otherwise make every loop below pass by never running — the shape of a
     guard measuring itself.

     The two NAMES are pinned rather than only a count, because the gate asks for open AND
     closed specifically and a count cannot tell which one went missing. Closed is the easy
     one to lose: it is the default render, so nothing else in this file would notice. */
  it.each(Object.entries(MODULES))('%s ships the open and closed stories the gate asks for', (_name, mod) => {
    expect(storyCount(mod as unknown as AnyModule)).toBeGreaterThan(1);
    expect(Object.keys(mod)).toContain('Open');
    expect(Object.keys(mod)).toContain('Closed');
  });

  it('shows a modal dialog with a label that resolves to real text', () => {
    const { roots } = mountAll(DialogStories as unknown as AnyModule);
    const dialogs = roots.flatMap((r) => [...r.querySelectorAll('[role="dialog"]')]);
    expect(dialogs.length).toBeGreaterThan(0);
    for (const dialog of dialogs) {
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      /* The NAME, not the attribute: `aria-labelledby` pointing at a missing or empty
         element is the failure worth catching, and it renders identically. */
      const labelledBy = dialog.getAttribute('aria-labelledby');
      const named = labelledBy
        ? (dialog.ownerDocument.getElementById(labelledBy)?.textContent?.trim().length ?? 0) > 0
        : (dialog.getAttribute('aria-label')?.trim().length ?? 0) > 0;
      expect(named, `a dialog rendered with no resolvable accessible name`).toBe(true);
    }
  });

  it('gives two mounted dialogs different title ids', () => {
    const { roots } = mountAll(DialogStories as unknown as AnyModule);
    const ids = roots
      .flatMap((r) => [...r.querySelectorAll('[role="dialog"]')])
      .map((d) => d.getAttribute('aria-labelledby'))
      .filter((id): id is string => !!id);
    expect(ids.length).toBeGreaterThan(1);
    /* `Modal.tsx`'s hardcoded `id="modal-title"` is the regression: two dialogs mounted at
       once collide on it and half the labels point at the wrong heading. */
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows a menu with reachable items and a trigger that reports its state', () => {
    const { roots } = mountAll(MenuStories as unknown as AnyModule);
    const menus = roots.flatMap((r) => [...r.querySelectorAll('[role="menu"]')]);
    expect(menus.length).toBeGreaterThan(0);
    expect(menus.some((m) => m.querySelector('[role="menuitem"]'))).toBe(true);
    expect(menus.some((m) => m.querySelector('[role="menuitemcheckbox"][aria-checked]'))).toBe(true);
    expect(roots.some((r) => r.querySelector('[aria-haspopup="menu"][aria-expanded="true"]'))).toBe(
      true,
    );
  });
});

/**
 * Axis coverage, keyed off the CONTRACT rather than off a component name.
 *
 * A component whose entry declares a non-empty `axes` gets the grid story and the
 * class-coverage assertion. One carrying only `pendingAxes` is exempt, and instead has to
 * prove it really is in that state — because the exemption is the dangerous half: an entry
 * that quietly lost its axes would otherwise skip its coverage check and stay green.
 *
 * When Agil's set lands and `Menu` gains a real axis, this switches on by itself. Nobody has
 * to remember to come back.
 */
const AXIS_EVIDENCE = {
  /* `axis` names WHICH declared axis the class list is evidence for. Two entries, two
     different axes — a hardcoded `.size` here would read `undefined` for the second one and
     compare a length against nothing. */
  Dialog: [
    { axis: 'size', classes: Object.values(DIALOG_SIZE) },
    /* `none` draws the default presentation, which every non-grid story already renders. */
    { axis: 'side', classes: [DIALOG_PRESENTATION.left, DIALOG_PRESENTATION.right, DIALOG_PRESENTATION.sheet].flatMap((v) => v.split(' ')) },
    /* `default` draws the `2xl` presentation above; `lg` (UMK-1548) is the 24px `ds-2xl` ones (the centred one is pinned in Dialog.rounded.test). */
    { axis: 'rounded', classes: [DIALOG_PRESENTATION.sheetLg, DIALOG_PRESENTATION.sheetFullHeightLg].flatMap((v) => v.split(' ')) },
  ],
  /* Per VARIANT, and every class of it: the two menu treatments differ in their corner, their
     inset and their gap, so a list holding only one of those would pass on a grid that
     rendered the right corner over the wrong padding. The submenu tables are not here — a
     nested panel is only in the document once its trigger has been activated, which a mounted
     story does not do; they are asserted in the behaviour block below instead. */
  Menu: [{ axis: 'variant', classes: [...Object.values(MENU_CONTENT), ...Object.values(MENU_ITEM)].flatMap((v) => v.split(' ')) }],
  Popover: [{ axis: 'align', classes: Object.values(POPOVER_ALIGN) }],
} as const;

const GRIDS = {
  Dialog: [DialogStories.AllSizes, { sizes: contract.Dialog.axes.size }],
  DialogSides: [DialogStories.AllSides, { sides: contract.Dialog.axes.side }],
  DialogRounded: [DialogStories.AllRounded, { values: contract.Dialog.axes.rounded }],
  Menu: [MenuStories.AllVariants, { variants: contract.Menu.axes.variant }],
  Popover: [PopoverStories.AllAligns, { aligns: contract.Popover.axes.align }],
} as const;

describe('the overlay stories cover every axis value the contract declares', () => {
  it.each(Object.keys(MODULES))('%s is either axis-bearing or honestly pending', (name) => {
    const entry = contract[name as 'Dialog' | 'Menu' | 'Popover'];
    const hasAxes = Object.keys(entry.axes).length > 0;
    if (hasAxes) {
      expect(AXIS_EVIDENCE[name as keyof typeof AXIS_EVIDENCE], `${name} declares axes but this guard has no class evidence for it`).toBeTruthy();
      expect(GRIDS[name as keyof typeof GRIDS], `${name} declares axes but ships no grid story`).toBeTruthy();
      /* Every declared axis has evidence, not just the first one. */
      expect(
        AXIS_EVIDENCE[name as keyof typeof AXIS_EVIDENCE].map((e) => e.axis).sort(),
        `${name}: an axis with no class evidence`,
      ).toEqual(Object.keys(entry.axes).sort());
    } else {
      /* Not `toEqual({})` alone: an entry with no axes AND no pending axes is a component
         claiming to have no vocabulary at all, which the structural guard already rejects
         for an implemented entry. Assert the pending half explicitly so this branch cannot
         be reached by an entry that simply lost everything. */
      expect(entry.axes).toEqual({});
      expect((entry as { pendingAxes?: readonly string[] }).pendingAxes?.length ?? 0).toBeGreaterThan(0);
      expect(AXIS_EVIDENCE[name as keyof typeof AXIS_EVIDENCE]).toBeUndefined();
    }
  });

  /* Several axes per entry (UMK-1186): each piece of evidence names its own axis. */
  it.each(
    Object.entries(AXIS_EVIDENCE).flatMap(([name, list]) => list.map((e) => [`${name}.${e.axis}`, name, e] as const)),
  )('%s renders every axis value', (_label, name, evidence) => {
    const { classes } = mountAll(MODULES[name as keyof typeof MODULES] as unknown as AnyModule);
    /* THE ANTI-VACUITY SELF-CHECK. An empty expectation list would make the filter below
       pass by having nothing to look for. It is scoped to components with real axes on
       purpose — a pending-axis component genuinely has nothing to cover, and running this
       against it is what would tempt someone to "fix" the guard by emptying the list. */
    const axes = contract[name as keyof typeof AXIS_EVIDENCE].axes as Record<string, readonly string[]>;
    const axis = axes[evidence.axis];
    expect(axis, `${name} declares no ${evidence.axis} axis for this evidence to cover`).toBeTruthy();
    expect(evidence.classes.length).toBeGreaterThanOrEqual(axis.length);
    /* ARBITRARY VALUES DROPPED for the reason the purge sibling drops them, plus one of this
       file's own: `classList` holds a shadow-with-a-colour as one token either way, so it can
       neither fail nor prove anything here. */
    expect(evidence.classes.filter((c) => !c.includes('[') && !classes.has(c))).toEqual([]);
  });

  /* WHAT THIS CANNOT SEE, stated so nobody reads more into it than it does: a hand-copied
     literal that still MATCHES the contract passes, because the comparison is on values and
     not on provenance. What it catches is DRIFT — the contract gaining or losing a value
     while the story keeps its own list — which is the failure that actually happens. */
  it('feeds each grid story from the contract rather than a literal', () => {
    for (const [name, [story, props]] of Object.entries(GRIDS)) {
      const rendered = (story as AnyStory).render!({} as never, {} as never) as unknown as {
        props: Record<string, readonly string[]>;
      };
      for (const [prop, expected] of Object.entries(props)) {
        /* Assert the axis EXISTS first: `toEqual` is happy comparing undefined to undefined,
           so an entry that lost its axis would pass by having nothing to compare. */
        expect(expected, `${name}.${prop} has no contract axis to iterate`).toBeTruthy();
        expect(rendered.props[prop], `${name}.${prop}`).toEqual(expected);
      }
    }
  });
});

/**
 * The behaviour `user-event` makes visible. Mounted directly rather than through a story,
 * because these need a spy on the state change and a trigger to press.
 */
describe('the overlays behave', () => {
  const DialogHarness = ({
    onOpenChange,
    centered,
    onCloseAutoFocus,
  }: {
    onOpenChange: (o: boolean) => void;
    centered?: boolean;
    onCloseAutoFocus?: (event: Event) => void;
  }) => {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Buka
        </button>
        <Dialog
          open={open}
          centered={centered}
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenChange={(next) => {
            setOpen(next);
            onOpenChange(next);
          }}
          title="Judul"
        >
          <button type="button">Di dalam</button>
        </Dialog>
      </>
    );
  };

  /**
   * MODALITY IS A BEHAVIOUR, AND `aria-modal` IS ONLY THE CLAIM ABOUT IT.
   *
   * `Dialog` hardcodes `aria-modal="true"`, so every assertion that reads that attribute
   * passes whether or not the page behind is actually inert. Setting `modal={false}` on the
   * Radix Root is a one-word edit that removes the scroll lock, the focus trap and the
   * background inertness while leaving the announcement in place — a dialog that goes on
   * SAYING it is modal after it stopped being modal, which is exactly the `Modal.tsx` defect
   * this slice exists to replace. Nothing else in this file could tell.
   *
   * Both consequences are observable here, so this is two assertions rather than a browser
   * gate. Read the SIDE EFFECTS, never the attribute.
   */
  it('makes the page behind a dialog genuinely inert, not just labelled modal', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<DialogHarness onOpenChange={() => {}} />);
    const outside = getByRole('button', { name: 'Buka' });
    await user.click(outside);

    expect(baseElement.querySelector('[role="dialog"]')).not.toBeNull();
    /* `react-remove-scroll` marks the body while a modal layer is mounted. */
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);
    /* And the content behind is hidden from assistive technology. Asserted on the OPENER —
       a real node outside the portal — rather than on a container, so it cannot pass by
       matching the portal itself. */
    expect(outside.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('moves focus INTO the dialog on open, and closes on Escape', async () => {
    const user = userEvent.setup();
    const changes: boolean[] = [];
    const closeFocusCycles: number[] = [];
    const { baseElement, getByRole } = render(
      <DialogHarness
        onOpenChange={(o) => changes.push(o)}
        onCloseAutoFocus={() => closeFocusCycles.push(1)}
      />,
    );
    const opener = getByRole('button', { name: 'Buka' });
    opener.focus();

    await user.click(opener);
    const panel = baseElement.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
    /* THE TRAP ENGAGED. `Modal.tsx`'s docblock advertises a focus trap and its file contains
       no Tab handler, so focus stays wherever it was and Tab walks straight out into the
       page behind. Asserting that focus MOVED INSIDE is what separates the two. */
    expect(panel!.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(changes.at(-1)).toBe(false);
    expect(baseElement.querySelector('[role="dialog"]')).toBeNull();
    /* FOCUS RESTORE, AS FAR AS THIS ENVIRONMENT CAN SEE IT. Radix runs its close-focus cycle
       — that is this event — and then focuses the previously-focused element. Under happy-dom
       the final landing spot is the body rather than the opener, because `react-remove-scroll`
       still has the outside `aria-hidden` when the restore fires; asserting `activeElement`
       here would fail on a restore that works in a browser. The menu below has no scroll lock
       and IS asserted the strict way, which is the contrast worth reading.

       WHERE FOCUS ACTUALLY LANDS IS A BROWSER CHECK. It is in the plan's browser gate for
       `AspectRatioPickerModal`, which gained this behaviour in this slice. */
    expect(closeFocusCycles.length).toBe(1);
  });

  it('renders a mobile-only drag handle on the sheet', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<DialogHarness onOpenChange={() => {}} />);
    await user.click(getByRole('button', { name: 'Buka' }));
    const handle = baseElement.querySelector('[data-dialog-handle]');
    expect(handle).not.toBeNull();
    /* Read off the real class table rather than retyped. `md:hidden` is what keeps the
       gesture off desktop without a width check in JS — the handle is the only grab area,
       so hiding it is disabling it. */
    expect(DIALOG_HANDLE).toContain('md:hidden');
    for (const c of DIALOG_HANDLE.split(' ')) expect(handle!.classList.contains(c)).toBe(true);
  });

  describe('fullHeight (UMK-1497)', () => {
    /* The classes only the full-height sheet has: the rest it shares with the plain sheet. */
    const ONLY_FULL = ['h-[var(--dialog-sheet-h,100dvh)]', 'top-[var(--dialog-sheet-top,auto)]', 'max-h-none', 'rounded-none'];
    const panelOf = (props: Partial<React.ComponentProps<typeof Dialog>>) => {
      const { baseElement } = render(
        <Dialog open onOpenChange={() => {}} title="Penuh" {...props}>
          <div>isi</div>
        </Dialog>,
      );
      return baseElement.querySelector('[role="dialog"]') as HTMLElement;
    };

    it('gives the sheet the full dynamic viewport height below md, and keeps the md card', () => {
      const panel = panelOf({ fullHeight: true });
      for (const c of ['h-[var(--dialog-sheet-h,100dvh)]', 'top-[var(--dialog-sheet-top,auto)]', 'bottom-0', 'max-h-none', 'rounded-none', 'md:h-auto', 'md:max-h-[85vh]', 'md:rounded-2xl']) {
        expect(panel.classList.contains(c), `missing ${c}`).toBe(true);
      }
      /* The sheet's own below-md cap and top radius are swapped out, not stacked. */
      expect(panel.classList.contains('max-h-[88dvh]')).toBe(false);
      expect(panel.classList.contains('rounded-t-2xl')).toBe(false);
      /* The gesture and its handle are unchanged. */
      expect(panel.querySelector('[data-dialog-handle]')).not.toBeNull();
    });

    it('differs from the plain sheet only in its below-md height and radius (the hand-copied half cannot drift)', () => {
      const set = (v: string) => new Set(v.split(' '));
      /* The three below-md classes the variant swaps, and the one md: reset it needs for the height. */
      const SWAPPED = /^(h-\[var\(--dialog-sheet-h,100dvh\)\]|top-\[var\(--dialog-sheet-top,auto\)\]|max-h-\[88dvh\]|max-h-none|rounded-none|rounded-t-2xl)$/;
      const strip = (v: string) => new Set([...set(v)].filter((c) => !SWAPPED.test(c)));
      const plain = strip(DIALOG_PRESENTATION.sheet);
      const full = strip(DIALOG_PRESENTATION.sheetFullHeight);
      full.delete('md:h-auto');
      expect([...full].sort()).toEqual([...plain].sort());
      expect(set(DIALOG_PRESENTATION.sheetFullHeight).has('md:h-auto')).toBe(true);
    });

    it('leaves the default sheet untouched', () => {
      const panel = panelOf({});
      expect(panel.classList.contains('h-[var(--dialog-sheet-h,100dvh)]')).toBe(false);
      expect(panel.classList.contains('max-h-[88dvh]')).toBe(true);
      expect(panel.classList.contains('rounded-t-2xl')).toBe(true);
    });

    it.each([
      ['centered', { centered: true }],
      ['a side drawer', { side: 'right' as const }],
    ])('has no effect on %s', (_name, props) => {
      const without = panelOf(props as Partial<React.ComponentProps<typeof Dialog>>).className;
      cleanup();
      const withFull = panelOf({ ...(props as object), fullHeight: true } as Partial<React.ComponentProps<typeof Dialog>>).className;
      expect(withFull).toBe(without);
      for (const c of ONLY_FULL) expect(withFull.split(' ')).not.toContain(c);
    });

    it('still lets dismissible={false} remove the handle', () => {
      expect(panelOf({ fullHeight: true, dismissible: false }).querySelector('[data-dialog-handle]')).toBeNull();
    });
  });

  it('removes the drag handle entirely when centered', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<DialogHarness onOpenChange={() => {}} centered />);
    await user.click(getByRole('button', { name: 'Buka' }));
    expect(baseElement.querySelector('[role="dialog"]')).not.toBeNull();
    /* THE SAFETY HALF OF THE FLAG, and the half a reader is most likely to drop: `centered`
       suppresses the gesture as well as the presentation, so a destructive confirmation
       cannot be swiped away. No handle means no grab area means no gesture. */
    expect(baseElement.querySelector('[data-dialog-handle]')).toBeNull();
  });

  describe('dismissible and closeDisabled', () => {
    const Locked = ({
      onOpenChange = () => {},
      ...rest
    }: { onOpenChange?: (o: boolean) => void } & Partial<React.ComponentProps<typeof Dialog>>) => (
      <Dialog open onOpenChange={onOpenChange} title="Terkunci" showCloseButton {...rest}>
        <button type="button">Di dalam</button>
      </Dialog>
    );

    // Radix arms its outside-press listener on a timeout, so a press fired synchronously after mount
    // is ignored whether or not the dialog is locked. Every outside-press case waits first.
    const armOutside = () => new Promise((r) => setTimeout(r, 20));

    it('an outside press closes an unlocked dialog (positive control for the refusals below)', async () => {
      const { fireEvent } = await import('@testing-library/react');
      const changes: boolean[] = [];
      const { baseElement } = render(<Locked onOpenChange={(o) => changes.push(o)} />);
      await armOutside();
      fireEvent.pointerDown(document.body);
      expect(changes).toEqual([false]);
      expect(baseElement.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('pressing a toast (outside the portal) does not close the dialog', async () => {
      const { fireEvent } = await import('@testing-library/react');
      const changes: boolean[] = [];
      render(<Locked onOpenChange={(o) => changes.push(o)} />);
      const toaster = document.createElement('section');
      toaster.setAttribute('data-sonner-toaster', '');
      const toastButton = document.createElement('button');
      toaster.appendChild(toastButton);
      document.body.appendChild(toaster);
      try {
        await armOutside();
        fireEvent.pointerDown(toastButton);
        expect(changes).toEqual([]);
      } finally {
        toaster.remove();
      }
    });

    it('closes on Escape by default (control for the cases below)', async () => {
      const user = userEvent.setup();
      const changes: boolean[] = [];
      render(<Locked onOpenChange={(o) => changes.push(o)} />);
      await user.keyboard('{Escape}');
      expect(changes).toEqual([false]);
    });

    it('dismissible={false}: Escape and the scrim leave it open, and there is no X and no handle', async () => {
      const user = userEvent.setup();
      const changes: boolean[] = [];
      const { baseElement } = render(
        <Locked dismissible={false} onOpenChange={(o) => changes.push(o)} />,
      );
      await user.keyboard('{Escape}');
      const scrim = baseElement.querySelector('[data-state="open"].fixed:not([role="dialog"])') as HTMLElement;
      expect(scrim).not.toBeNull();
      const { fireEvent } = await import('@testing-library/react');
      await armOutside();
      fireEvent.pointerDown(scrim);
      fireEvent.click(scrim);
      expect(changes).toEqual([]);
      expect(baseElement.querySelector('[role="dialog"]')).not.toBeNull();
      /* `showCloseButton` is passed and still loses: the lock outranks the request. */
      expect(baseElement.querySelector('button[aria-label="Tutup"]')).toBeNull();
      expect(baseElement.querySelector('[data-dialog-handle]')).toBeNull();
    });

    it('a locked layer prevents the Escape default itself, not only the close (per-layer guard)', async () => {
      const { fireEvent } = await import('@testing-library/react');
      const { baseElement } = render(<Locked dismissible={false} />);
      const dialog = baseElement.querySelector('[role="dialog"]') as HTMLElement;
      const notPrevented = fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(notPrevented).toBe(false);
    });

    it('dismissOnOutsidePress={false}: an outside press leaves it open, while the X, Escape and the handle stay (UMK-1498)', async () => {
      const user = userEvent.setup();
      const { fireEvent } = await import('@testing-library/react');
      const changes: boolean[] = [];
      const { baseElement } = render(
        <Locked dismissOnOutsidePress={false} onOpenChange={(o) => changes.push(o)} />,
      );
      await armOutside();
      fireEvent.pointerDown(document.body);
      const scrim = baseElement.querySelector('[data-state="open"].fixed:not([role="dialog"])') as HTMLElement;
      fireEvent.pointerDown(scrim);
      fireEvent.click(scrim);
      expect(changes).toEqual([]);
      expect(baseElement.querySelector('button[aria-label="Tutup"]')).not.toBeNull();
      expect(baseElement.querySelector('[data-dialog-handle]')).not.toBeNull();
      await user.keyboard('{Escape}');
      expect(changes).toEqual([false]);
      await user.click(baseElement.querySelector('button[aria-label="Tutup"]') as HTMLElement);
      expect(changes).toEqual([false, false]);
    });

    it('closeDisabled: the X stays but is disabled, Escape and the scrim hold, and it closes once cleared', async () => {
      const user = userEvent.setup();
      const changes: boolean[] = [];
      const { baseElement, rerender } = render(
        <Locked closeDisabled onOpenChange={(o) => changes.push(o)} />,
      );
      const x = baseElement.querySelector('button[aria-label="Tutup"]') as HTMLButtonElement;
      expect(x).not.toBeNull();
      expect(x.disabled).toBe(true);
      await user.keyboard('{Escape}');
      const scrim = baseElement.querySelector('[data-state="open"].fixed:not([role="dialog"])') as HTMLElement;
      const { fireEvent } = await import('@testing-library/react');
      await armOutside();
      fireEvent.pointerDown(scrim);
      expect(changes).toEqual([]);
      rerender(<Locked onOpenChange={(o) => changes.push(o)} />);
      expect(
        (baseElement.querySelector('button[aria-label="Tutup"]') as HTMLButtonElement).disabled,
      ).toBe(false);
      await user.keyboard('{Escape}');
      expect(changes).toEqual([false]);
    });

    it('closeDisabled: drag is blocked', async () => {
      const changes: boolean[] = [];
      const { baseElement } = render(
        <Locked closeDisabled onOpenChange={(o) => changes.push(o)} />,
      );
      const handle = baseElement.querySelector('[data-dialog-handle]') as HTMLElement;
      handle.setPointerCapture = () => {};
      handle.releasePointerCapture = () => {};
      const { fireEvent } = await import('@testing-library/react');
      fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientY: 400, pointerId: 1 });
      expect(changes).toEqual([]);
    });
  });

  it.each(['left', 'right'] as const)('renders a %s drawer with its presentation and no drag handle', async (side) => {
    const { baseElement } = render(
      <Dialog open onOpenChange={() => {}} side={side} title="Laci">
        <p>isi</p>
      </Dialog>,
    );
    const panel = baseElement.querySelector('[role="dialog"]') as HTMLElement;
    for (const c of DIALOG_PRESENTATION[side].split(' ')) expect(panel.classList.contains(c)).toBe(true);
    /* The gesture is vertical; a side drawer does not dismiss downwards. The handle is the
       ONLY grab area, so no handle is no gesture. */
    expect(baseElement.querySelector('[data-dialog-handle]')).toBeNull();
  });

  /** Opens a sheet and hands back its panel plus a grabbed handle. */
  const openAndGrab = async (onOpenChange: (o: boolean) => void = () => {}) => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<DialogHarness onOpenChange={onOpenChange} />);
    await user.click(getByRole('button', { name: 'Buka' }));
    const panel = baseElement.querySelector('[role="dialog"]') as HTMLElement;
    const handle = panel.querySelector('[data-dialog-handle]') as HTMLElement;
    /* happy-dom has no pointer capture; the component calls it unconditionally. */
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    const { fireEvent } = await import('@testing-library/react');
    return { panel, handle, fireEvent, baseElement };
  };

  it('drags the sheet with `translate`, never `transform`', async () => {
    const { panel, handle, fireEvent } = await openAndGrab();
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 60, pointerId: 1 });

    /* Radix's `animate-in` sets `animation-fill-mode: both`, which pins `transform` to the
       animation's final keyframe — an inline transform would be silently ignored, and the
       sheet would simply not move. Assert the PROPERTY NAME, not the offset. */
    expect(panel.style.translate).toBe('0 60px');
    expect(panel.style.transform).toBe('');
  });

  it('springs back and stays open when the drag is released short of the threshold', async () => {
    const changes: boolean[] = [];
    const { panel, handle, fireEvent } = await openAndGrab((o) => changes.push(o));
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 60, pointerId: 1 });

    /* The BRANCH the close test does not reach. 60px is under the ported 100px threshold, so
       the sheet returns to rest and nothing closes — a threshold accidentally lowered to zero
       would still pass every other assertion in this file. */
    expect(panel.style.translate).toBe('');
    expect(changes).toEqual([]);
  });

  it('closes when the drag passes the threshold', async () => {
    const changes: boolean[] = [];
    const { handle, fireEvent } = await openAndGrab((o) => changes.push(o));
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 400, pointerId: 1 });

    expect(changes.at(-1)).toBe(false);
  });

  it('resets a cancelled drag without closing', async () => {
    const changes: boolean[] = [];
    const { panel, handle, fireEvent } = await openAndGrab((o) => changes.push(o));
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 60, pointerId: 1 });
    /* A cancelled pointer never fires `pointerup`. Without a cancel handler the sheet stays
       frozen mid-drag — open and unresponsive — and a cancellation is not a decision to
       close, so nothing may dismiss here either. */
    fireEvent.pointerCancel(handle, { pointerId: 1 });

    expect(panel.style.translate).toBe('');
    expect(changes).toEqual([]);
  });

  /* `data-tutorial-target` is on the MENU, not on the button — that is the whole point.
     Putting it on the child made the forwarding assertion below pass with `{...dataAttributes}`
     deleted from `Menu`'s trigger, because `asChild` renders the child's own attributes either
     way: the guard was measuring the harness. The app's own call site puts the attribute on the
     child and `composer-agent-tools.test.tsx` covers that path; this one covers the prop. */
  const MenuHarness = ({ onSelect }: { onSelect: () => void }) => (
    <Menu
      label="Alat"
      side="bottom"
      data-tutorial-target="tools-trigger"
      trigger={<button type="button">Alat</button>}
      items={[
        { id: 'a', label: 'Satu', onSelect, 'data-tutorial-target': 'row-one' },
        { id: 'b', label: 'Dua' },
        { id: 'c', label: 'Tiga', disabled: true },
      ]}
    />
  );

  /**
   * THE MENU IS NON-MODAL, AND THAT IS THE SETTLED DECISION — asserted so a later edit
   * cannot quietly reverse it.
   *
   * A browser gate found that Radix's modal mode left the composer's attach menu stranding
   * `body { overflow: hidden }` and a document-wide `aria-hidden` after every dismissal:
   * page scroll dead, the whole app invisible to assistive technology, until a navigation.
   * A dropdown hanging off a toolbar button has no business freezing page scroll or hiding
   * the document behind it, so `Menu` passes `modal={false}`.
   *
   * This is the exact inverse of the dialog assertion above, and the pair is the point: the
   * two components disagree about modality ON PURPOSE, and each side is pinned.
   */
  it('leaves the page live behind an open menu — the inverse of the dialog', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<MenuHarness onSelect={() => {}} />);
    const trigger = getByRole('button', { name: 'Alat' });
    await user.click(trigger);

    expect(baseElement.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
    expect(trigger.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('opens an uncontrolled menu from its own trigger and flips aria-expanded', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<MenuHarness onSelect={() => {}} />);
    const trigger = getByRole('button', { name: 'Alat' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(baseElement.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('portals the menu outside the trigger subtree', async () => {
    const user = userEvent.setup();
    const { baseElement, container, getByRole } = render(<MenuHarness onSelect={() => {}} />);
    await user.click(getByRole('button', { name: 'Alat' }));
    /* What distinguishes this component from both call sites it replaces: their panels were
       absolutely positioned siblings inside the composer, clipped by its overflow. */
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(baseElement.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('traverses rows by arrow key and skips a disabled one', async () => {
    const user = userEvent.setup();
    const { getByRole, getAllByRole } = render(<MenuHarness onSelect={() => {}} />);
    await user.click(getByRole('button', { name: 'Alat' }));

    const items = getAllByRole('menuitem');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{ArrowUp}');
    /* WRAPS PAST THE DISABLED ROW rather than landing on it. `Tiga` is the last item and is
       disabled, so Up from the first lands on the second-to-last — both halves of the claim
       in one assertion, and neither menu this replaces had traversal at all. */
    expect(document.activeElement).toBe(items[1]);
  });

  it('closes a menu on Escape and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<MenuHarness onSelect={() => {}} />);
    const trigger = getByRole('button', { name: 'Alat' });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(baseElement.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('fires an item handler and closes', async () => {
    const user = userEvent.setup();
    let fired = 0;
    const { baseElement, getByRole } = render(<MenuHarness onSelect={() => (fired += 1)} />);
    await user.click(getByRole('button', { name: 'Alat' }));
    await user.click(getByRole('menuitem', { name: 'Satu' }));

    expect(fired).toBe(1);
    expect(baseElement.querySelector('[role="menu"]')).toBeNull();
  });

  it('forwards data-* to the trigger and to an item', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<MenuHarness onSelect={() => {}} />);
    /* THE UMK-862 COACH-MARK CONTRACT. `TutorialSpotlight` finds its anchors with
       `document.querySelector`, and a narrow item type would drop these attributes with
       nothing failing to compile — the coach-mark would land on the wrong element. */
    expect(baseElement.querySelector('[data-tutorial-target="tools-trigger"]')).not.toBeNull();
    await user.click(getByRole('button', { name: 'Alat' }));
    expect(baseElement.querySelector('[data-tutorial-target="row-one"]')).not.toBeNull();
  });

  it('runs a controlled menu from the prop alone, changing no state of its own', async () => {
    const user = userEvent.setup();
    const changes: boolean[] = [];
    const Controlled = ({ open }: { open: boolean }) => (
      <Menu
        open={open}
        onOpenChange={(next) => changes.push(next)}
        trigger={<button type="button">Alat</button>}
        items={[{ id: 'a', label: 'Satu' }]}
      />
    );
    const { baseElement, rerender, getByRole } = render(<Controlled open={false} />);
    /* Captured while it is still queryable: an open Radix menu marks the rest of the body
       `aria-hidden`, so a role query for the trigger AFTER opening finds nothing. */
    const trigger = getByRole('button', { name: 'Alat' });
    expect(baseElement.querySelector('[role="menu"]')).toBeNull();

    /* The U7 blocker, asserted here: the composer's attach menu is parent-owned, so a Menu
       that only worked uncontrolled would have looked finished and failed on that site. */
    rerender(<Controlled open />);
    expect(baseElement.querySelector('[role="menu"]')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(changes.at(-1)).toBe(false);
    /* Still open: the parent owns the state and did not change it. */
    expect(baseElement.querySelector('[role="menu"]')).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('announces a checkable row and flips it', async () => {
    const user = userEvent.setup();
    const Checkable = () => {
      const [checked, setChecked] = React.useState(false);
      return (
        <Menu
          trigger={<button type="button">Alat</button>}
          items={[{ id: 'a', label: 'Buat Gambar', checked, onSelect: () => setChecked((v) => !v) }]}
        />
      );
    };
    const { getByRole } = render(<Checkable />);
    await user.click(getByRole('button', { name: 'Alat' }));
    expect(getByRole('menuitemcheckbox').getAttribute('aria-checked')).toBe('false');

    await user.click(getByRole('menuitemcheckbox'));
    await user.click(getByRole('button', { name: 'Alat' }));
    expect(getByRole('menuitemcheckbox').getAttribute('aria-checked')).toBe('true');
  });

  /**
   * THE NESTED AND LINKED FORMS, on their own harness.
   *
   * Kept apart from `MenuHarness` on purpose: the assertions above were written against a
   * flat three-row menu, and folding a submenu into it would change what `getAllByRole`
   * returns for the traversal probe without anyone noticing which claim moved.
   */
  const NestedHarness = ({ onSelect }: { onSelect?: (event: Event) => void }) => (
    <Menu
      label="Akun"
      trigger={<button type="button">Akun</button>}
      items={[
        { id: 'plain', label: 'Satu', onSelect },
        { id: 'link', label: 'Bantuan', href: '/bantuan' },
        { id: 'ext', label: 'Kebijakan', href: 'https://umkmall.id/kebijakan', external: true },
        {
          id: 'lang',
          label: 'Bahasa',
          items: [
            { id: 'id', label: 'Indonesia' },
            { id: 'en', label: 'English' },
          ],
        },
      ]}
    />
  );

  const openNested = async () => {
    const user = userEvent.setup();
    const view = render(<NestedHarness />);
    await user.click(view.getByRole('button', { name: 'Akun' }));
    return { user, ...view };
  };

  it('renders a submenu trigger and reveals its children when it is activated', async () => {
    const { user, baseElement, getByRole } = await openNested();
    const sub = getByRole('menuitem', { name: 'Bahasa' });
    /* The announcement is what makes a nested row different from a row that merely draws a
       chevron — a screen-reader user is told there is more behind it before opening it. */
    expect(sub.getAttribute('aria-haspopup')).toBe('menu');
    expect(baseElement.querySelectorAll('[role="menu"]').length).toBe(1);

    await user.click(sub);
    expect(baseElement.querySelectorAll('[role="menu"]').length).toBe(2);
    expect(getByRole('menuitem', { name: 'Indonesia' })).not.toBeNull();
  });

  it('opens the submenu with Right, closes it with Left, and closes the whole menu on Escape', async () => {
    const { user, baseElement, getByRole } = await openNested();
    const sub = getByRole('menuitem', { name: 'Bahasa' });
    /* Reached by the keyboard rather than by calling `focus()` directly — the roving
       tabindex is the thing under test, and a direct focus call also lands React state
       updates outside `act`. `Bahasa` is the last row, so Up from the closed-highlight
       state wraps onto it. */
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(sub);

    await user.keyboard('{ArrowRight}');
    expect(baseElement.querySelectorAll('[role="menu"]').length).toBe(2);

    await user.keyboard('{ArrowLeft}');
    expect(baseElement.querySelectorAll('[role="menu"]').length).toBe(1);
    /* STRICT, against `document.activeElement`, not the loose "focus went somewhere sane"
       proxy: `Menu` is non-modal, so no scroll lock stands between the close and the
       restore, and a submenu that dropped focus on the body would leave a keyboard user
       unable to reach the row they just came back from. */
    expect(document.activeElement).toBe(sub);

    await user.keyboard('{Escape}');
    expect(baseElement.querySelector('[role="menu"]')).toBeNull();
  });

  it('fires a submenu row\'s onOpenChange once per open, by pointer and by keyboard (L18)', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <Menu
        label="Akun"
        trigger={<button type="button">Akun</button>}
        items={[
          { id: 'x', label: 'Satu' },
          { id: 'help', label: 'Bantuan', onOpenChange, items: [{ id: 'faq', label: 'FAQ' }] },
        ]}
      />,
    );
    await user.click(view.getByRole('button', { name: 'Akun' }));
    await user.keyboard('{ArrowUp}{ArrowRight}');
    expect(onOpenChange.mock.calls).toEqual([[true]]);
    await user.keyboard('{ArrowLeft}');
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    await user.click(view.getByRole('menuitem', { name: 'Bantuan' }));
    expect(onOpenChange.mock.calls).toEqual([[true], [false], [true]]);
  });

  describe('drillIn (L22)', () => {
    const DrillHarness = ({ onOpenChange }: { onOpenChange?: (o: boolean) => void }) => (
      <Menu
        label="Akun"
        trigger={<button type="button">Akun</button>}
        items={[
          { id: 'one', label: 'Satu' },
          {
            id: 'help',
            label: 'Bantuan',
            drillIn: true,
            backLabel: 'Kembali',
            onOpenChange,
            items: [
              { id: 'a', label: 'FAQ' },
              { id: 'b', label: 'Chat' },
            ],
          },
        ]}
      />
    );

    it('swaps the list for a back row plus the children, in one surface', async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      const view = render(<DrillHarness onOpenChange={onOpenChange} />);
      await user.click(view.getByRole('button', { name: 'Akun' }));
      await user.click(view.getByRole('menuitem', { name: 'Bantuan' }));

      expect(view.baseElement.querySelectorAll('[role="menu"]').length).toBe(1);
      expect(view.getByRole('menuitem', { name: 'Kembali' })).not.toBeNull();
      expect(view.getByRole('menuitem', { name: 'FAQ' })).not.toBeNull();
      expect(view.queryByRole('menuitem', { name: 'Satu' })).toBeNull();
      expect(view.queryByRole('menuitem', { name: 'Bantuan' })).toBeNull();
      expect(onOpenChange.mock.calls).toEqual([[true]]);

      await user.click(view.getByRole('menuitem', { name: 'Kembali' }));
      expect(view.getByRole('menuitem', { name: 'Satu' })).not.toBeNull();
      expect(view.queryByRole('menuitem', { name: 'FAQ' })).toBeNull();
      expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    });

    it('steps back on Escape instead of closing, and closes on the next one', async () => {
      const user = userEvent.setup();
      const view = render(<DrillHarness />);
      await user.click(view.getByRole('button', { name: 'Akun' }));
      await user.click(view.getByRole('menuitem', { name: 'Bantuan' }));
      await user.keyboard('{Escape}');
      expect(view.getByRole('menuitem', { name: 'Satu' })).not.toBeNull();
      await user.keyboard('{Escape}');
      expect(view.baseElement.querySelector('[role="menu"]')).toBeNull();
    });

    it('focuses the back row once, not again on a re-render', async () => {
      const user = userEvent.setup();
      const view = render(<DrillHarness />);
      await user.click(view.getByRole('button', { name: 'Akun' }));
      await user.click(view.getByRole('menuitem', { name: 'Bantuan' }));
      expect(document.activeElement).toBe(view.getByRole('menuitem', { name: 'Kembali' }));
      view.getByRole('menuitem', { name: 'FAQ' }).focus();
      view.rerender(<DrillHarness />);
      expect(document.activeElement).toBe(view.getByRole('menuitem', { name: 'FAQ' }));
    });

    it('reopens on the parent list', async () => {
      const user = userEvent.setup();
      const view = render(<DrillHarness />);
      await user.click(view.getByRole('button', { name: 'Akun' }));
      await user.click(view.getByRole('menuitem', { name: 'Bantuan' }));
      await user.keyboard('{Escape}{Escape}');
      await user.click(view.getByRole('button', { name: 'Akun' }));
      expect(view.getByRole('menuitem', { name: 'Satu' })).not.toBeNull();
    });
  });

  it('renders a destination row as a real anchor rather than a button', async () => {
    const { getByRole } = await openNested();
    const row = getByRole('menuitem', { name: 'Bantuan' });
    /* `AccountMenu`'s rows are navigations. A button that calls `router.push` is not the
       same thing: it has no href to copy, to open in a new tab, or to hover-preview. */
    expect(row.tagName).toBe('A');
    expect(row.getAttribute('href')).toBe('/bantuan');
  });

  it('sends an external destination to a new context without handing it an opener', async () => {
    const { getByRole } = await openNested();
    const row = getByRole('menuitem', { name: 'Kebijakan' });
    expect(row.getAttribute('target')).toBe('_blank');
    expect(row.getAttribute('rel')).toBe('noopener noreferrer');
  });

  /**
   * THE ROUTER SEAM, WHICH NOTHING RENDERED UNTIL NOW. `linkComponent` is the entire reason this
   * package can offer navigation rows without depending on a router, and it was reachable only
   * through `Menu.test-d.ts` — a component that ignored the prop and hard-rendered an anchor
   * would have typechecked and passed every assertion in this file.
   *
   * THE SUBSTITUTION MUST ALSO REACH A SUBMENU'S ROWS, which is a separate fact: the rows one
   * level down are rendered by a separate recursion that has to be handed the same component,
   * and a caller whose top-level rows route client-side while its nested ones full-page-reload
   * has a bug nothing else here can see.
   */
  it('renders a destination row through the caller-supplied link component, at both levels', async () => {
    const user = userEvent.setup();
    const Router: React.FC<{ href?: string; children?: React.ReactNode }> = ({ href, ...rest }) => (
      <a data-router-link="" href={href} {...rest} />
    );
    const view = render(
      <Menu
        label="Akun"
        trigger={<button type="button">Akun</button>}
        linkComponent={Router}
        items={[
          { id: 'link', label: 'Bantuan', href: '/bantuan' },
          { id: 'lang', label: 'Bahasa', items: [{ id: 'id', label: 'Indonesia', href: '/id' }] },
        ]}
      />,
    );
    await user.click(view.getByRole('button', { name: 'Akun' }));

    const row = view.getByRole('menuitem', { name: 'Bantuan' });
    expect(row.hasAttribute('data-router-link')).toBe(true);
    expect(row.getAttribute('href')).toBe('/bantuan');

    await user.click(view.getByRole('menuitem', { name: 'Bahasa' }));
    const nested = view.getByRole('menuitem', { name: 'Indonesia' });
    expect(nested.hasAttribute('data-router-link')).toBe(true);
    expect(nested.getAttribute('href')).toBe('/id');
  });

  /**
   * AND AN EXTERNAL ROW IGNORES IT. A router component asked to render an off-site URL either
   * swallows the navigation or prefetches a domain it does not own; the row also has to keep the
   * new-context rules the assertion above pins, which a substituted component would not apply.
   */
  it('sends an external row through a plain anchor even when a link component is supplied', async () => {
    const user = userEvent.setup();
    const Router: React.FC<{ href?: string; children?: React.ReactNode }> = ({ href, ...rest }) => (
      <a data-router-link="" href={href} {...rest} />
    );
    const view = render(
      <Menu
        label="Akun"
        trigger={<button type="button">Akun</button>}
        linkComponent={Router}
        items={[
          { id: 'ext', label: 'Kebijakan', href: 'https://umkmall.id/kebijakan', external: true },
        ]}
      />,
    );
    await user.click(view.getByRole('button', { name: 'Akun' }));

    const row = view.getByRole('menuitem', { name: 'Kebijakan' });
    expect(row.tagName).toBe('A');
    expect(row.hasAttribute('data-router-link')).toBe(false);
    expect(row.getAttribute('target')).toBe('_blank');
    expect(row.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('leaves a same-tab destination without a target or an opener rule', async () => {
    const { getByRole } = await openNested();
    const row = getByRole('menuitem', { name: 'Bantuan' });
    expect(row.getAttribute('target')).toBeNull();
    expect(row.getAttribute('rel')).toBeNull();
  });

  it('hands onSelect an event whose default can be prevented, and a prevented select leaves the menu open', async () => {
    const user = userEvent.setup();
    const seen: Event[] = [];
    const { baseElement, getByRole } = render(
      <NestedHarness
        onSelect={(event) => {
          seen.push(event);
          event.preventDefault();
        }}
      />,
    );
    await user.click(getByRole('button', { name: 'Akun' }));
    await user.click(getByRole('menuitem', { name: 'Satu' }));

    /* The whole reason the signature widened: a modified click on a link row has to be able
       to keep the menu open. A handler typed `() => void` receives the event and discards
       it, and there is no other way to reach it. */
    expect(seen).toHaveLength(1);
    expect(seen[0].defaultPrevented).toBe(true);
    expect(baseElement.querySelector('[role="menu"]')).not.toBeNull();
  });

  /* UMK-1041: the account menu needs a rule between groups and a destructive last row. */
  it('renders a separator item as a rule and a danger item with the error treatment', async () => {
    const user = userEvent.setup();
    const view = render(
      <Menu
        label="Akun"
        variant="boxed"
        trigger={<button type="button">Akun</button>}
        items={[
          { id: 'home', label: 'Beranda' },
          { id: 'sep', label: '', separator: true },
          { id: 'out', label: 'Keluar', danger: true },
        ]}
      />,
    );
    await user.click(view.getByRole('button', { name: 'Akun' }));
    expect(view.baseElement.querySelectorAll('[role="separator"]')).toHaveLength(1);
    const danger = view.getByRole('menuitem', { name: 'Keluar' });
    expect(danger.className).toContain('text-default-error');
    expect(danger.className).not.toContain('text-default-primary');
    const plain = view.getByRole('menuitem', { name: 'Beranda' });
    expect(plain.className).toContain('text-default-primary');
    expect(plain.className).not.toContain('text-default-error');
    /* The separator is not a row: no menuitem for it, and the rows around it are unchanged. */
    expect(view.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('puts the submenu panel on the same elevation as the menu and animates it in only', async () => {
    const { user, baseElement, getByRole } = await openNested();
    await user.click(getByRole('menuitem', { name: 'Bahasa' }));
    const panels = [...baseElement.querySelectorAll('[role="menu"]')];
    const panel = panels[panels.length - 1] as HTMLElement;

    for (const c of MENU_SUB_CONTENT.pill.split(' ')) expect(panel.classList.contains(c)).toBe(true);
    /* Derived from the sibling table rather than typed out, so this cannot drift into
       asserting an elevation nothing renders. */
    const elevation = MENU_CONTENT.pill.split(' ').find((c) => c.startsWith('z-'));
    expect(elevation).toBeTruthy();
    expect(MENU_SUB_CONTENT.pill.split(' ')).toContain(elevation);
    /* KTD9, at the one surface this unit adds: an exit animation strands the unmount. */
    expect(/data-\[state=closed\]:/.test(MENU_SUB_CONTENT.pill)).toBe(false);
  });

  /**
   * THE TREATMENT AXIS (UMK-963).
   *
   * Neither value has a design source — there is no published set for this component — so what
   * these assert is that each variant renders ITS OWN table, not that either table is right.
   * The one thing that would be plainly wrong is a mix: a boxed panel whose rows come back as
   * pills, which renders, works, and looks deliberate.
   */
  const VariantHarness = ({ variant }: { variant?: 'pill' | 'boxed' }) => (
    <Menu
      label="Akun"
      variant={variant}
      trigger={<button type="button">Akun</button>}
      items={[
        { id: 'plain', label: 'Satu' },
        { id: 'lang', label: 'Bahasa', items: [{ id: 'id', label: 'Indonesia' }] },
      ]}
    />
  );

  const openVariant = async (variant?: 'pill' | 'boxed') => {
    const user = userEvent.setup();
    const view = render(<VariantHarness variant={variant} />);
    await user.click(view.getByRole('button', { name: 'Akun' }));
    return { user, ...view };
  };

  it.each(['pill', 'boxed'] as const)('renders the %s panel and rows from their own tables', async (variant) => {
    const { baseElement, getByRole } = await openVariant(variant);
    const panel = baseElement.querySelector('[role="menu"]') as HTMLElement;
    for (const c of MENU_CONTENT[variant].split(' ')) expect(panel.classList.contains(c)).toBe(true);
    const row = getByRole('menuitem', { name: 'Satu' });
    for (const c of MENU_ITEM[variant].split(' ')) expect(row.classList.contains(c)).toBe(true);

    /* AND NOT THE OTHER ONE'S. Membership alone cannot see a mix, because the two tables share
       most of their classes — what separates them is the handful each holds alone. */
    const other = variant === 'pill' ? 'boxed' : 'pill';
    const onlyOther = (a: string, b: string) =>
      a.split(' ').filter((c) => !b.split(' ').includes(c));
    expect(onlyOther(MENU_CONTENT[other], MENU_CONTENT[variant]).length).toBeGreaterThan(0);
    for (const c of onlyOther(MENU_CONTENT[other], MENU_CONTENT[variant]))
      expect(panel.classList.contains(c)).toBe(false);
    expect(onlyOther(MENU_ITEM[other], MENU_ITEM[variant]).length).toBeGreaterThan(0);
    for (const c of onlyOther(MENU_ITEM[other], MENU_ITEM[variant]))
      expect(row.classList.contains(c)).toBe(false);
  });

  /* THE DEFAULT IS `pill`, AND IT IS THE NO-CHANGE ANSWER. The composer passes no variant, so
     this is the assertion standing between the live surface and a silent restyle. */
  it('defaults to the treatment the live composer already renders', async () => {
    const { baseElement, getByRole } = await openVariant(undefined);
    const panel = baseElement.querySelector('[role="menu"]') as HTMLElement;
    expect(panel.className).toBe(MENU_CONTENT.pill);
    expect(getByRole('menuitem', { name: 'Satu' }).className).toBe(MENU_ITEM.pill);
  });

  /**
   * A SUBMENU INHERITS ITS PARENT'S VARIANT. The nested rows come from a separate recursive
   * call, so a variant that stopped at the top level would leave a boxed menu with pill rows
   * one level down — visible, but nothing else here would fail.
   */
  it('renders a boxed submenu panel, its trigger and its rows in the parent variant', async () => {
    const { user, baseElement, getByRole } = await openVariant('boxed');
    const trigger = getByRole('menuitem', { name: 'Bahasa' });
    for (const c of MENU_SUB_TRIGGER.boxed.split(' ')) expect(trigger.classList.contains(c)).toBe(true);

    await user.click(trigger);
    const panels = [...baseElement.querySelectorAll('[role="menu"]')];
    const panel = panels[panels.length - 1] as HTMLElement;
    expect(panel.className).toBe(MENU_SUB_CONTENT.boxed);
    expect(getByRole('menuitem', { name: 'Indonesia' }).className).toBe(MENU_ITEM.boxed);
  });
});
