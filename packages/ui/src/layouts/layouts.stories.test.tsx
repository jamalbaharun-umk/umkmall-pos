import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import * as AppShellStories from './AppShell.stories';
import { AppShell } from './AppShell';
import { SHELL_BOTTOM, SHELL_MAIN } from './layout-classes';
import { storyTitle } from '../contract';

/**
 * The app shell behaviour guard.
 *
 * IT EXISTS BECAUSE THE FAMILY GUARDS CANNOT SEE THIS COMPONENT. `AppShell` declares no
 * contract `family` — the same answer `Button`, `Text`, `Icon`, `Label`, `Sidebar` and `Header`
 * give — and each family pair reconciles its module map against the entries that claim that
 * family. An unfamilied component is never expected by any of them, so without this file it
 * would ship with zero behaviour coverage against a fully green suite.
 *
 * READS `baseElement`, NEVER `container`. Nothing here portals today, but slice 2's
 * `form-controls` guard is the recorded example of a guard that reads `container`, matches
 * nothing and passes.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED. happy-dom has no layout engine, so nothing here can check
 * that the frame fills the viewport, that the content scrolls while the frame does not, or that
 * exactly one navigation is visible at a given width. Those are the CLASSES' job and
 * `layouts.purge.test.ts` checks the classes survive; where they land is a browser question
 * this ticket does not open. The scroll geometry below is therefore DEFINED rather than
 * measured — which is the honest form, because the thing under test is the shell's decision
 * about that geometry, not the engine's calculation of it.
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
 * ONE MOUNT AT A TIME. Every render in a file shares one `baseElement` — the body — so a second
 * render inside a test leaves the first one's nodes in front of it, and a query for the frame
 * happily returns the previous one's.
 */
const mount = (ui: React.ReactElement) => {
  cleanup();
  const view = render(ui);
  return { root: view.baseElement as HTMLElement, rerender: view.rerender, unmount: view.unmount };
};

const slot = (root: HTMLElement, name: string) =>
  root.querySelector(`[data-app-shell-slot="${name}"]`);

/**
 * A scroller with geometry, since the engine has none to give. `overflow` is the caller's
 * concern; what the shell branches on is the relationship between the two heights and the
 * offset, so that is what is defined here.
 */
const scroller = (root: HTMLElement, { content = 400, visible = 100, top = 0 } = {}) => {
  const el = root.querySelector('[data-scroller]') as HTMLElement;
  Object.defineProperty(el, 'scrollHeight', { value: content, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: visible, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: top, writable: true, configurable: true });
  return el;
};

const Spy: React.FC<{ seen: { scrolled: boolean } }> = () => null;

/* React batches a state update triggered from outside its own event system, so a bare dispatch
   leaves the render that proves the flag moved still queued. */
const scroll = (el: HTMLElement) => act(() => void el.dispatchEvent(new Event('scroll')));

const withScroller = (props: Partial<React.ComponentProps<typeof AppShell>> = {}) => {
  const seen: { scrolled: boolean }[] = [];
  const ui = (routeKey?: string) => (
    <AppShell
      {...props}
      routeKey={routeKey}
      header={({ scrolled }) => {
        seen.push({ scrolled });
        return <Spy seen={{ scrolled }} />;
      }}
    >
      <div data-scroller="">content</div>
    </AppShell>
  );
  return { seen, ui, latest: () => seen[seen.length - 1]!.scrolled };
};

describe('the app shell stories mount and say what they are', () => {
  it('titles the story set for Storybook', () => {
    /* It moved out of `Layouts/` and into `Components/Shell/` (UMK-979). This file's story
       source is the one that writes its title in DOUBLE quotes — the only one that does — so
       a sweep keyed on `title: '` skips it silently and this assertion is the thing that
       notices. */
    expect((AppShellStories as unknown as { default: { title: string } }).default.title).toBe(
      storyTitle('AppShell'),
    );
  });

  /* PINNED BY NAME rather than counted — a count cannot tell which one went missing, and the
     narrow-viewport story is the easy one to lose because no other story renders its slot. */
  it('ships the default, collapsed and drawer stories', () => {
    for (const name of ['Default', 'CollapsedSidebar', 'MobileDrawer'])
      expect(Object.keys(AppShellStories)).toContain(name);
  });

  /**
   * AND THEY COMPOSE THE REAL COMPONENTS. A story with placeholder boxes in the slots renders
   * fine while the actual composition is broken, so the markers the real `Sidebar` and `Header`
   * write are what is asserted — nothing else in this package emits them.
   */
  it('mounts every story, composing the real sidebar and header', () => {
    const mod = AppShellStories as unknown as AnyModule;
    expect(stories(mod).length).toBeGreaterThan(2);
    let withNav = 0;
    for (const [, story] of stories(mod)) {
      const { root } = mount(element(mod, story as AnyStory));
      expect(root.querySelector('[data-app-shell]')).not.toBeNull();
      expect(root.querySelector('[data-header]')).not.toBeNull();
      if (root.querySelector('[data-sidebar-rail]')) withNav += 1;
    }
    expect(withNav).toBeGreaterThan(1);
  });
});

describe('the slots', () => {
  it('renders each slot it is given', () => {
    const { root } = mount(
      <AppShell header={<b>H</b>} sidebar={<b>S</b>} mobileSidebar={<b>M</b>}>
        <b>C</b>
      </AppShell>,
    );
    expect(slot(root, 'header')?.textContent).toBe('H');
    expect(slot(root, 'sidebar')?.textContent).toBe('S');
    expect(slot(root, 'mobileSidebar')?.textContent).toBe('M');
    expect(slot(root, 'main')?.textContent).toBe('C');
  });

  it('lays the header over the content below the breakpoint only when asked (UMK-1041)', () => {
    const header = (root: HTMLElement) => root.querySelector('[data-app-shell-slot="header"]') as HTMLElement;
    const { root: plain } = mount(<AppShell header={<b>H</b>}>x</AppShell>);
    expect(header(plain).className).not.toContain('absolute');
    expect(plain.querySelector('[data-app-shell]')!.className).not.toContain('relative');
    const { root: over } = mount(<AppShell overlayHeader header={<b>H</b>}>x</AppShell>);
    expect(header(over).className).toContain('absolute');
    expect(header(over).className).toContain('md:static');
    expect(over.querySelector('[data-app-shell]')!.className).toContain('relative');
  });

  it('keeps the mobile navigation slot in the layout at every width (UMK-1041)', () => {
    const { root } = mount(<AppShell mobileSidebar={<b>M</b>}>x</AppShell>);
    const cls = slot(root, 'mobileSidebar')!.className;
    expect(cls).toContain('contents');
    expect(cls).not.toContain('md:hidden');
  });

  /* An omitted slot renders NOTHING, not an empty box — invisible in a screenshot, and still a
     gap in the frame that the content does not get back. */
  it('renders nothing at all for an omitted slot', () => {
    const { root } = mount(<AppShell>x</AppShell>);
    for (const name of ['header', 'sidebar', 'mobileSidebar', 'bottomBar']) expect(slot(root, name)).toBeNull();
  });

  /* The bottom bar is a ROW AFTER THE BODY (UMK-1757), not inside the content region: that is what
     ends the caller's scroller above it. Inside `main` it would overlay the last rows instead. */
  it('puts the bottom bar after the body, outside the content region, and only below the breakpoint', () => {
    const { root } = mount(<AppShell bottomBar={<b>T</b>}>x</AppShell>);
    const bar = slot(root, 'bottomBar') as HTMLElement;
    expect(bar.textContent).toBe('T');
    expect(slot(root, 'main')!.contains(bar)).toBe(false);
    expect(bar.parentElement).toBe(root.querySelector('[data-app-shell]'));
    expect(bar.previousElementSibling!.contains(slot(root, 'main'))).toBe(true);
    for (const c of SHELL_BOTTOM.split(' ')) expect(bar.className).toContain(c);
  });

  /**
   * The content region carries the whole overflow chain it is given, so the caller's scroller
   * has something to scroll inside. Read off the table rather than retyped: a link that changes
   * changes its assertion with it.
   */
  it('gives the content region the frame class set, unclipped', () => {
    const { root } = mount(<AppShell>x</AppShell>);
    const main = slot(root, 'main') as HTMLElement;
    expect(main.tagName).toBe('MAIN');
    for (const c of SHELL_MAIN.split(' ')) expect(main.className).toContain(c);
  });
});

describe('the capture-phase scroll spy', () => {
  /**
   * THE ONE THING THE SHELL OWNS. Scroll events do not bubble, so a listener on the frame only
   * sees a scroll in the caller's content by capturing it on the way down. This assertion is
   * the difference between a shell that reacts and one that never does.
   */
  it('sees a scroll in a scrolling child it did not render', () => {
    const { seen, ui, latest } = withScroller();
    const { root } = mount(ui());
    expect(latest()).toBe(false);
    const el = scroller(root, { top: 40 });
    scroll(el);
    expect(latest()).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
  });

  /**
   * AND IGNORES A TARGET THAT DOES NOT SCROLL. Capture sees every scroller in the subtree,
   * including a horizontal rail whose vertical offset is always zero. Reacting to those clears
   * the flag mid-gesture, which is a header flickering back to its unscrolled treatment while
   * the reader is half way down the page.
   */
  it('ignores a scroll event from a target with nothing to scroll vertically', () => {
    const { ui, latest } = withScroller();
    const { root } = mount(ui());
    const el = scroller(root, { top: 40 });
    scroll(el);
    expect(latest()).toBe(true);

    /* Same node, now the shape of a horizontal rail: nothing to scroll down, offset zero. */
    scroller(root, { content: 100, visible: 100, top: 0 });
    scroll(el);
    expect(latest()).toBe(true);
  });

  /**
   * AND IGNORES A GENUINE VERTICAL SCROLLER THAT IS NOT THE CONTENT. This is the case the
   * geometry test above cannot reach: `Sidebar` gives its list slot its own vertical scroller, so
   * a long navigation passes every height check and answers for the page at its OWN offset zero —
   * the header's shadow disappears while the reader is half way down. Both halves are asserted
   * because they are the same event shape landing in two regions (UMK-956): a guard that only
   * proved the navigation is ignored would also pass on a spy that reacts to nothing at all.
   */
  it('answers for the content region and not for a scroller in the navigation', () => {
    const seen: boolean[] = [];
    cleanup();
    const view = render(
      <AppShell
        sidebar={
          <div data-nav-scroller="">
            <b>nav</b>
          </div>
        }
        header={({ scrolled }) => {
          seen.push(scrolled);
          return <Spy seen={{ scrolled }} />;
        }}
      >
        <div data-scroller="">content</div>
      </AppShell>,
    );
    const root = view.baseElement as HTMLElement;
    const latest = () => seen[seen.length - 1]!;

    const content = scroller(root, { top: 40 });
    scroll(content);
    expect(latest()).toBe(true);

    /* The navigation's own list: really scrollable, really at the top, really not the page. */
    const nav = root.querySelector('[data-nav-scroller]') as HTMLElement;
    Object.defineProperty(nav, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(nav, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(nav, 'scrollTop', { value: 0, writable: true, configurable: true });
    scroll(nav);
    expect(latest()).toBe(true);
  });

  /**
   * ONE NOTIFICATION PER TRANSITION, PROVEN UNDER STRICT MODE. React may double-invoke a state
   * updater in development, and it invokes one during render — so a `notify` call made from
   * inside the updater fires twice per transition, or outside the commit phase, and the caller
   * re-runs whatever it hangs off this. Rendering under `StrictMode` is what makes the double
   * invocation actually happen rather than merely be reasoned about.
   */
  it('tells the caller exactly once per transition, under strict mode', () => {
    const onScrolledChange = vi.fn();
    cleanup();
    const view = render(
      <React.StrictMode>
        <AppShell onScrolledChange={onScrolledChange}>
          <div data-scroller="">content</div>
        </AppShell>
      </React.StrictMode>,
    );
    const root = view.baseElement as HTMLElement;

    const el = scroller(root, { top: 40 });
    scroll(el);
    expect(onScrolledChange.mock.calls).toEqual([[true]]);

    scroller(root, { top: 0 });
    scroll(el);
    expect(onScrolledChange.mock.calls).toEqual([[true], [false]]);
  });

  it('holds the flag below the threshold and raises it above', () => {
    const { ui, latest } = withScroller();
    const { root } = mount(ui());
    const el = scroller(root, { top: 4 });
    scroll(el);
    expect(latest()).toBe(false);
    scroller(root, { top: 400 });
    scroll(el);
    expect(latest()).toBe(true);
  });

  it('tells a caller that does not render the header', () => {
    const onScrolledChange = vi.fn();
    const { ui } = withScroller({ onScrolledChange });
    const { root } = mount(ui());
    const el = scroller(root, { top: 40 });
    scroll(el);
    expect(onScrolledChange).toHaveBeenCalledWith(true);
    /* Only on a CHANGE — a callback fired on every scroll event is a re-render per frame of a
       gesture, in whatever the caller does with it. */
    onScrolledChange.mockClear();
    scroll(el);
    expect(onScrolledChange).not.toHaveBeenCalled();
  });

  /**
   * RESET IS THE CALLER'S SIGNAL, not an inference. A shell that wraps several routes does not
   * remount when you move between them, so a surface that auto-scrolls raises the flag and the
   * next route — which starts at the top by definition — wears a shadow it never earned.
   */
  it('clears the flag when the caller signals a route change, and not otherwise', () => {
    const { ui, latest } = withScroller();
    const { root, rerender } = mount(ui('/a'));
    const el = scroller(root, { top: 40 });
    scroll(el);
    expect(latest()).toBe(true);

    rerender(ui('/a'));
    expect(latest()).toBe(true);

    rerender(ui('/b'));
    expect(latest()).toBe(false);
  });

  /**
   * THE LISTENER DETACHES. Asserted on the registration itself rather than by dispatching after
   * unmount, which proves nothing: a detached node would not reach a stale listener anyway, so
   * that check passes whether or not the cleanup exists.
   */
  it('removes the listener it added, with the same handler and the same phase', () => {
    const added: unknown[][] = [];
    const removed: unknown[][] = [];
    const add = vi
      .spyOn(HTMLElement.prototype, 'addEventListener')
      .mockImplementation(function (this: HTMLElement, ...args: unknown[]) {
        /* React's own delegation puts a scroll listener on the render container too, so the
           registrations are attributed to their node rather than counted in aggregate. */
        if (args[0] === 'scroll' && this.hasAttribute('data-app-shell')) added.push(args);
        return undefined as never;
      });
    const remove = vi
      .spyOn(HTMLElement.prototype, 'removeEventListener')
      .mockImplementation(function (this: HTMLElement, ...args: unknown[]) {
        if (args[0] === 'scroll' && this.hasAttribute('data-app-shell')) removed.push(args);
        return undefined as never;
      });
    try {
      const { unmount } = mount(<AppShell>x</AppShell>);
      expect(added).toHaveLength(1);
      expect(added[0]![2]).toBe(true);
      unmount();
      expect(removed).toHaveLength(1);
      expect(removed[0]![1]).toBe(added[0]![1]);
      expect(removed[0]![2]).toBe(added[0]![2]);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});

/**
 * R14, ON THE IMPORT GRAPH RATHER THAN ON INTENT. A shell is exactly the component that grows a
 * router, a session store or a feature gate, because in every app it has one directly above it —
 * and each of those would make this package unusable by the second app that wanted a frame. A
 * ban on bare specifiers other than react needs no maintenance and is the actual requirement; a
 * deny-list of names would be walked straight through by the first one nobody thought to list.
 * Same shape as the contract's own neutrality guard.
 */
describe('the shell reaches for nothing app-shaped', () => {
  const HERE = resolve(__dirname);
  const SPECIFIER_FORMS = [
    /\bimport\s[^'"()]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s[^'"()]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  const ALLOWED = new Set(['react']);
  const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

  it('imports react and its own siblings, and nothing else', () => {
    const offenders = ['AppShell.tsx', 'layout-classes.ts', 'index.ts'].flatMap((name) => {
      /* Comments stripped FIRST. These files carry usage examples in their docblocks, and a
         specifier scan that reads prose reports the package's own name as a dependency of
         itself — a failure that says nothing about the import graph. */
      const source = readFileSync(resolve(HERE, name), 'utf8').replace(COMMENTS, ' ');
      return SPECIFIER_FORMS.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]!))
        .filter((spec) => !spec.startsWith('.') && !ALLOWED.has(spec))
        .map((spec) => `${name}: ${spec}`);
    });
    expect(offenders).toEqual([]);
  });

  /* A vacuity floor per FILE, not in aggregate (UMK-956): a total that stays healthy while one
     file stops being read proves nothing about that file. */
  it('actually read each of the three files', () => {
    for (const name of ['AppShell.tsx', 'layout-classes.ts', 'index.ts'])
      expect(readFileSync(resolve(HERE, name), 'utf8').length).toBeGreaterThan(200);
  });
});
