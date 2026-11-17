import React from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as SidebarStories from './Sidebar/Sidebar.stories';
import { Sidebar, SidebarMenuItem } from './Sidebar';
import { SIDEBAR_ASIDE, SIDEBAR_DRAWER_STATE, SIDEBAR_WIDTH } from './sidebar-classes';
import { storyTitle } from '../contract';

/**
 * The sidebar behaviour guard.
 *
 * IT EXISTS BECAUSE THE FAMILY GUARDS CANNOT SEE THIS COMPONENT. `Sidebar` declares no
 * contract `family` — the same answer `Button`, `Text`, `Icon` and `Label` give — and each
 * family pair reconciles its module map against the entries that claim that family. An
 * unfamilied component is never expected by any of them, so without this file it would ship
 * with zero behaviour coverage against a fully green suite.
 *
 * READS `baseElement`, NEVER `container`. Nothing here portals today, but the drawer is the
 * kind of surface that grows a portal, and slice 2's `form-controls` guard is the recorded
 * example of a guard that reads `container`, matches nothing and passes.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED. happy-dom has no layout engine, so nothing here can
 * check that the rail is narrower than the expanded aside, that the drawer is off-screen while
 * closed, or that only one of the two navigations is visible at a given width. Those are the
 * CLASSES' job and `sidebar.purge.test.ts` checks the classes survive; where they land is a
 * browser question this ticket does not open.
 *
 * Importing the story module also pulls it into the typecheck program: `tsconfig` excludes
 * every stories file, so a story imported by a test is the only way one is checked at all.
 */

type AnyStory = { args?: Record<string, unknown>; render?: (a: never, b: never) => React.ReactElement };
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

const stories = (mod: AnyModule) =>
  Object.entries(mod).filter(([n, s]) => n !== 'default' && s && typeof s === 'object');

/**
 * ONE MOUNT AT A TIME, and this is not tidiness.
 *
 * Every render in a file shares one `baseElement` — the body — so a second render inside a
 * test leaves the first one's nodes in front of it, and a query for the collapsed rail
 * happily returns the expanded one. The overlay guard records the same hazard from the other
 * side, where a shared root multiplies one panel into six. Clearing first is what makes each
 * assertion about the thing it just rendered.
 */
const mount = (ui: React.ReactElement): HTMLElement => {
  cleanup();
  return render(ui).baseElement as HTMLElement;
};

const drawer = (root: HTMLElement) => root.querySelector('[data-sidebar-drawer]');
const rail = (root: HTMLElement) => root.querySelector('[data-sidebar-rail]');

describe('the sidebar stories mount and say what they are', () => {
  it('titles the story set for Storybook', () => {
    expect((SidebarStories as unknown as { default: { title: string } }).default.title).toBe(
      storyTitle('Sidebar'),
    );
  });

  /* The three states the unit asks for, PINNED BY NAME rather than counted. A count cannot
     tell which one went missing, and the drawer is the easy one to lose — it is the only
     story whose surface the desktop stories never render. */
  it('ships the collapsed, expanded and drawer stories', () => {
    for (const name of ['Collapsed', 'Expanded', 'Drawer'])
      expect(Object.keys(SidebarStories)).toContain(name);
  });

  it('mounts every story without throwing', () => {
    const mod = SidebarStories as unknown as AnyModule;
    expect(stories(mod).length).toBeGreaterThan(2);
    for (const [, story] of stories(mod)) {
      expect(mount(element(mod, story as AnyStory)).querySelectorAll('nav').length).toBeGreaterThan(0);
    }
  });
});

describe('the collapse rail', () => {
  const transition = SIDEBAR_ASIDE.split(' ').find((c) => c.startsWith('transition'));

  it('renders the rail width collapsed and the full width expanded, and animates between them', () => {
    expect(transition).toBeDefined();
    const small = rail(mount(<Sidebar label="Nav" collapsed>x</Sidebar>)) as HTMLElement;
    const large = rail(mount(<Sidebar label="Nav">y</Sidebar>)) as HTMLElement;

    /* Read off the table rather than retyped, so a width step that changes changes its
       assertion with it. */
    for (const c of SIDEBAR_WIDTH.small.split(' ')) expect(small.className).toContain(c);
    for (const c of SIDEBAR_WIDTH.large.split(' ')) expect(large.className).toContain(c);
    expect(small.className).not.toContain(SIDEBAR_WIDTH.large);
    /* The transition has to be on BOTH: it lives on the shared base, and a width swap with
       no transition on one side is a jump in one direction only. */
    expect(small.className).toContain(transition);
    expect(large.className).toContain(transition);
  });

  /**
   * COUNTED, NOT FOUND. Both trees are mounted at once, so the shared body used to render this
   * control twice — once in the rail and once in the mobile drawer, where there is no rail on
   * screen to collapse. `querySelector` returns the first match and cannot tell one from two,
   * which is exactly how that shipped. Count, and say which tree holds it.
   */
  it('offers exactly one collapse control, in the rail, and only when the caller can act on it', () => {
    expect(
      mount(<Sidebar label="Nav" />).querySelectorAll('[data-sidebar-collapse]').length,
    ).toBe(0);

    const baseElement = mount(<Sidebar label="Nav" onCollapsedChange={() => {}} />);
    expect(baseElement.querySelectorAll('[data-sidebar-collapse]').length).toBe(1);
    expect(
      (rail(baseElement) as HTMLElement).querySelectorAll('[data-sidebar-collapse]').length,
    ).toBe(1);
    expect(
      (drawer(baseElement) as HTMLElement).querySelectorAll('[data-sidebar-collapse]').length,
    ).toBe(0);
  });

  it('reaches and operates the collapse control by keyboard alone', async () => {
    const onCollapsedChange = vi.fn();
    const baseElement = mount(<Sidebar label="Nav" onCollapsedChange={onCollapsedChange} />);
    const control = baseElement.querySelector('[data-sidebar-collapse]') as HTMLElement;

    await userEvent.tab();
    /* Focus REACHING it is half the check — a div with a click handler passes an assertion
       about the click and fails this one. */
    expect(document.activeElement).toBe(control);
    await userEvent.keyboard('{Enter}');
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    /* And it says which way it will go, rather than relying on a glyph. */
    expect(control.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('the slots', () => {
  it('renders each slot it is given', () => {
    const railEl = rail(
      mount(
        <Sidebar label="Nav" header={<b>H</b>} footer={<b>F</b>}>
          <b>L</b>
        </Sidebar>,
      ),
    ) as HTMLElement;
    expect(railEl.querySelector('[data-sidebar-slot="header"]')?.textContent).toBe('H');
    expect(railEl.querySelector('[data-sidebar-slot="list"]')?.textContent).toBe('L');
    expect(railEl.querySelector('[data-sidebar-slot="footer"]')?.textContent).toBe('F');
  });

  /* An omitted slot renders NOTHING, not an empty box — an empty padded div is invisible in a
     screenshot and is still a gap in the layout and a landmark with no content in it. */
  it('renders nothing at all for an omitted slot', () => {
    const baseElement = mount(<Sidebar label="Nav" />);
    for (const slot of ['header', 'list', 'footer'])
      expect(baseElement.querySelector(`[data-sidebar-slot="${slot}"]`)).toBeNull();
  });
});

describe('the drawer', () => {
  it('exposes its content while open', () => {
    const el = drawer(mount(<Sidebar label="Nav" open header={<b>H</b>} />)) as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBeNull();
    expect(el.hasAttribute('inert')).toBe(false);
    expect(el.textContent).toContain('H');
    for (const c of SIDEBAR_DRAWER_STATE.open.split(' ')) expect(el.className).toContain(c);
  });

  /**
   * THE ASSERTION NOTHING IN THIS REPO MAKES TODAY. On web both trees are mounted at once, so
   * a drawer that merely translates off-screen is still read out — a screen reader user hears
   * the whole navigation twice, once from a surface they cannot reach. Hiding it is not
   * cosmetic and it is not implied by the transform.
   */
  it('is absent from the accessibility tree while closed, and untouchable with it', () => {
    const el = drawer(mount(<Sidebar label="Nav" header={<b>H</b>} />)) as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('inert')).toBe(true);
    expect(el.className).toContain('pointer-events-none');
  });

  /* A menu portalled out of the drawer still bubbles its keydown through the React tree. Its Escape
     belongs to the menu; closing the drawer on it would shut both at once. */
  it('closes on Escape pressed inside, not on one that bubbles from a portalled menu', () => {
    const onOpenChange = vi.fn();
    const root = mount(
      <Sidebar
        label="Nav"
        open
        onOpenChange={onOpenChange}
        footer={({ drawer: isDrawer }) =>
          isDrawer ? (
            <>
              <button type="button">dalam</button>
              {createPortal(<button type="button">luar</button>, document.body)}
            </>
          ) : null
        }
      />,
    );
    fireEvent.keyDown(within(root).getByRole('button', { name: 'luar' }), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.keyDown(within(root).getByRole('button', { name: 'dalam' }), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows a scrim only while open', () => {
    expect(
      mount(<Sidebar label="Nav" onOpenChange={() => {}} />).querySelector('[data-sidebar-scrim]'),
    ).toBeNull();
    expect(
      mount(<Sidebar label="Nav" open onOpenChange={() => {}} />).querySelector(
        '[data-sidebar-scrim]',
      ),
    ).not.toBeNull();
  });

  /**
   * THE OTHER HALF OF THE TRADE. The closed drawer is hidden from the accessibility tree by
   * hand, which reads as though the problem was handled — but hiding it says nothing about
   * where focus goes when it opens. Without this, focus stays behind the scrim on a surface
   * the user cannot see.
   */
  it('moves focus into the drawer on open and returns it on close', async () => {
    const Harness = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Buka
          </button>
          <Sidebar label="Nav" open={open} onOpenChange={setOpen} header={<b>H</b>} />
        </>
      );
    };
    cleanup();
    const { baseElement, getByRole } = render(<Harness />);
    const opener = getByRole('button', { name: 'Buka' });
    await userEvent.click(opener);

    const el = drawer(baseElement as HTMLElement) as HTMLElement;
    expect(el.contains(document.activeElement)).toBe(true);

    /* And the return leg, which is the one a hand-rolled version drops. Closed through the
       SCRIM rather than through Escape, so this test breaks on the focus work alone and the
       Escape test below breaks on Escape alone. */
    fireEvent.click(baseElement.querySelector('[data-sidebar-scrim]') as HTMLElement);
    expect(document.activeElement).toBe(opener);
  });

  /* Dispatched at the drawer rather than typed, so a regression in the focus move above
     cannot redden this one too — each assertion breaks on its own production change. */
  it('closes on Escape', () => {
    const onOpenChange = vi.fn();
    const el = drawer(
      mount(<Sidebar label="Nav" open onOpenChange={onOpenChange} header={<b>H</b>} />),
    ) as HTMLElement;
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * AN OPEN DRAWER ALWAYS HAS A BACKDROP, even when the caller wired no dismissal. Gating the
   * scrim on the callback left an open drawer floating over live page content with nothing
   * behind it — the drawer still cannot dismiss itself there, which the docblock says, but
   * that is a caller mistake and not a reason to drop the backdrop too.
   */
  it('renders a scrim for an open drawer with no dismissal wired, and clicking it is inert', () => {
    const scrim = mount(<Sidebar label="Nav" open />).querySelector(
      '[data-sidebar-scrim]',
    ) as HTMLElement;
    expect(scrim).not.toBeNull();
    expect(() => fireEvent.click(scrim)).not.toThrow();
  });

  /* KTD9. The drawer is always mounted so Radix's Presence mechanism never applies to it —
     this is consistency with every other surface in the package, asserted as a class fact
     because that is the part a test can see. */
  it('carries no exit animation', () => {
    const el = drawer(mount(<Sidebar label="Nav" open />)) as HTMLElement;
    expect(el.className).not.toContain('data-[state=closed]:');
    expect(Object.values(SIDEBAR_DRAWER_STATE).join(' ')).not.toContain('animate-out');
  });
});

describe('a sidebar menu item', () => {
  it('renders a disclosure affordance in the submenu state and none in the menu state', () => {
    const sub = mount(<SidebarMenuItem label="A" state="submenu" />);
    expect(sub.querySelector('[data-sidebar-disclosure]')).not.toBeNull();
    /* Present is not enough: a decorative chevron tells assistive technology nothing about
       whether the panel below is open. */
    expect(
      (sub.querySelector('[data-sidebar-item]') as HTMLElement).getAttribute('aria-expanded'),
    ).toBe('false');

    const plain = mount(<SidebarMenuItem label="B" />);
    expect(plain.querySelector('[data-sidebar-disclosure]')).toBeNull();
    expect(
      (plain.querySelector('[data-sidebar-item]') as HTMLElement).getAttribute('aria-expanded'),
    ).toBeNull();
  });

  /* COLOUR IS NOT AN ANNOUNCEMENT. The active row is the one the user is on, and a class is
     invisible to everyone who is not looking at it. */
  it('exposes the active row as current rather than only tinting it', () => {
    const active = mount(<SidebarMenuItem label="A" active />);
    expect((active.querySelector('[data-sidebar-item]') as HTMLElement).getAttribute('aria-current')).toBe('page');
    const idle = mount(<SidebarMenuItem label="B" />);
    expect(
      (idle.querySelector('[data-sidebar-item]') as HTMLElement).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('is a real anchor when it is given a destination and a button otherwise', () => {
    const link = mount(<SidebarMenuItem label="A" href="/x" />);
    expect((link.querySelector('[data-sidebar-item]') as HTMLElement).tagName).toBe('A');
    const button = mount(<SidebarMenuItem label="B" onClick={() => {}} />);
    expect((button.querySelector('[data-sidebar-item]') as HTMLElement).tagName).toBe('BUTTON');
  });

  /**
   * DISABLED HAS TO HOLD ON THE LINK BRANCH TOO, and this is where it did not. `disabled` was
   * spread onto the button only: an anchor has no such attribute, never matches the `disabled:`
   * utilities in the row's class table, and so stayed clickable, tabbable and undimmed. Every
   * fact is asserted separately because each fails on its own — a row that is announced as
   * disabled and still navigates is worse than one that is neither.
   */
  it('makes a disabled destination row unreachable, inert and announced', () => {
    const onClick = vi.fn();
    const el = mount(
      <SidebarMenuItem label="A" href="/x" disabled onClick={onClick} />,
    ).querySelector('[data-sidebar-item]') as HTMLElement;

    expect(el.tagName).toBe('A');
    /* Not a link target, so it is not navigable and drops out of the tab order on its own. */
    expect(el.hasAttribute('href')).toBe(false);
    /* And not reachable by an explicit index either. */
    expect(el.getAttribute('tabindex')).toBe('-1');
    /* Announced rather than merely inert — an unreachable row that says nothing is a mystery. */
    expect(el.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });

  /* The enabled row is the control: the assertions above must be about `disabled` and not
     about the link branch having no destination at all. */
  it('leaves an enabled destination row navigable and tabbable', () => {
    const el = mount(<SidebarMenuItem label="A" href="/x" />).querySelector(
      '[data-sidebar-item]',
    ) as HTMLElement;
    expect(el.getAttribute('href')).toBe('/x');
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.hasAttribute('aria-disabled')).toBe(false);
  });

  /**
   * THE ROUTER SEAM, WHICH NOTHING RENDERED UNTIL NOW. `linkComponent` is the entire reason this
   * package can stay router-free, and it was reachable only through a type test — a component
   * that ignored the prop and hard-rendered an anchor would have typechecked and passed.
   */
  it('renders a destination row through the caller-supplied link component', () => {
    const Router: React.FC<{ href?: string; children?: React.ReactNode }> = ({ href, ...rest }) => (
      <a data-router-link="" href={href} {...rest} />
    );
    const el = mount(
      <SidebarMenuItem label="A" href="/x" linkComponent={Router} />,
    ).querySelector('[data-sidebar-item]') as HTMLElement;
    expect(el.hasAttribute('data-router-link')).toBe(true);
    expect(el.getAttribute('href')).toBe('/x');
  });

  /* Collapsed, the label is gone from the surface but must not be gone from the row: an
     icon with no accessible name is an unlabelled control. */
  it('keeps an accessible name when the rail hides the label', () => {
    const el = mount(<SidebarMenuItem label="Riwayat" collapsed onClick={() => {}} />).querySelector(
      '[data-sidebar-item]',
    ) as HTMLElement;
    expect(el.textContent).not.toContain('Riwayat');
    expect(el.getAttribute('aria-label')).toBe('Riwayat');
  });

  /* UMK-1041. A session row carries a date line and a delete control. */
  it('renders a description under the label, and drops it while collapsed', () => {
    const open = mount(<SidebarMenuItem label="Chat" description="9 Okt" onClick={() => {}} />);
    expect(open.querySelector('[data-sidebar-item]')!.textContent).toContain('9 Okt');
    cleanup();
    const rail = mount(<SidebarMenuItem label="Chat" description="9 Okt" collapsed onClick={() => {}} />);
    expect(rail.querySelector('[data-sidebar-item]')!.textContent).not.toContain('9 Okt');
  });

  it('renders trailing beside the row, never inside it, and drops it while collapsed', () => {
    const open = mount(
      <SidebarMenuItem label="Chat" href="/c/1" trailing={<button type="button">Hapus</button>} />,
    );
    const row = open.querySelector('[data-sidebar-item]')!;
    const control = open.querySelector('button')!;
    expect(control.textContent).toBe('Hapus');
    expect(row.contains(control), 'an interactive control nested inside the row').toBe(false);
    expect(row.parentElement!.contains(control)).toBe(true);
    cleanup();
    const rail = mount(
      <SidebarMenuItem label="Chat" collapsed onClick={() => {}} trailing={<button type="button">Hapus</button>} />,
    );
    expect(rail.textContent).not.toContain('Hapus');
  });

  it('renders exactly today\'s element when neither is given', () => {
    const el = mount(<SidebarMenuItem label="Chat" onClick={() => {}} />);
    const row = el.querySelector('[data-sidebar-item]')!;
    expect(row.tagName).toBe('BUTTON');
    expect(row.parentElement!.className, 'a wrapper rendered with no trailing').not.toContain('group');
    expect(row.querySelectorAll('span span')).toHaveLength(0);
    expect(row.className).not.toContain('pr-10');
  });
});

/* UMK-1041: slots that know which surface they are drawn into, and a drawer with no body while closed. */
describe('surface-aware slots', () => {
  const Probe = ({ drawer }: { drawer: boolean }) => <span data-probe={String(drawer)}>isi</span>;
  const probes = (root: HTMLElement) => [...root.querySelectorAll('[data-probe]')].map((n) => n.getAttribute('data-probe'));

  it('hands a function slot drawer:false in the rail and drawer:true in the drawer', () => {
    const root = mount(
      <Sidebar label="Nav" open onOpenChange={() => {}}>
        {({ drawer }) => <Probe drawer={drawer} />}
      </Sidebar>,
    );
    expect(probes(rail(root) as HTMLElement)).toEqual(['false']);
    expect(probes(drawer(root) as HTMLElement)).toEqual(['true']);
  });

  it('keeps the body in a closed drawer, hidden, so exactly one Keluar is accessible (L21)', () => {
    const root = mount(
      <Sidebar label="Nav" footer={<button type="button">Keluar</button>}>
        <span>baris</span>
      </Sidebar>,
    );
    expect(drawer(root)!.textContent).toContain('Keluar');
    expect(drawer(root)!.hasAttribute('inert')).toBe(true);
    expect(drawer(root)!.getAttribute('aria-hidden')).toBe('true');
    expect(within(root).getAllByRole('button', { name: 'Keluar' })).toHaveLength(1);
  });

  it('slides: closed to open swaps the translate classes and keeps the content after close (L20)', () => {
    const { rerender, container } = render(
      <Sidebar label="Nav" open onOpenChange={() => {}} footer={<span>Keluar</span>} />,
    );
    const el = drawer(container) as HTMLElement;
    expect(el.className).toContain('translate-x-0');
    expect(el.className).not.toContain('-translate-x-full');
    for (const c of ['transition-transform', 'duration-300', 'ease-in-out', 'motion-reduce:transition-none'])
      expect(el.className).toContain(c);
    expect(el.className).not.toContain('animate-in');
    rerender(<Sidebar label="Nav" onOpenChange={() => {}} footer={<span>Keluar</span>} />);
    expect(el.className).toContain('-translate-x-full');
    expect(el.textContent).toContain('Keluar');
  });

  it('renders the drawer body while open', () => {
    const root = mount(
      <Sidebar label="Nav" open onOpenChange={() => {}} footer={<span>Keluar</span>} />,
    );
    expect(drawer(root)!.textContent).toContain('Keluar');
  });

  it('renders plain-node slots as before', () => {
    const root = mount(
      <Sidebar label="Nav" header={<b>kepala</b>} footer={<i>kaki</i>}>
        <u>isi</u>
      </Sidebar>,
    );
    const r = rail(root) as HTMLElement;
    expect(r.querySelector('b')!.textContent).toBe('kepala');
    expect(r.querySelector('u')!.textContent).toBe('isi');
    expect(r.querySelector('i')!.textContent).toBe('kaki');
  });
});
