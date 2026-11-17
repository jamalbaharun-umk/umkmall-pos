import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as HeaderStories from './Header/Header.stories';
import { Header, HEADER_TYPES } from './Header';
import { HEADER_SCROLL, HEADER_TYPE } from './header-classes';
import { storyTitle } from '../contract';

/**
 * The header behaviour guard.
 *
 * IT EXISTS BECAUSE THE FAMILY GUARDS CANNOT SEE THIS COMPONENT — `Header` declares no
 * contract `family`, the same answer `Button`, `Text`, `Icon`, `Label` and `Sidebar` give,
 * and each family pair reconciles only against the entries that claim its family.
 *
 * READS `baseElement`, NEVER `container` (KTD18a). Nothing here portals today, but slice 2's
 * `form-controls` guard is the recorded example of a guard that read `container`, matched
 * nothing, and passed.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED. happy-dom has no layout engine, so nothing here can see
 * that the bar is shorter on a phone than on a desktop, or that the shadow is visible. The
 * reflow is a CLASS fact and `header.purge.test.ts` checks those classes survive; where they
 * land is a browser question this ticket does not open.
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

/* ONE MOUNT AT A TIME. Every render in a file shares one `baseElement`, so a second render
   leaves the first one's nodes in front of it and a query happily returns the wrong bar. */
const mount = (ui: React.ReactElement): HTMLElement => {
  cleanup();
  return render(ui).baseElement as HTMLElement;
};

const bar = (root: HTMLElement) => root.querySelector('[data-header]') as HTMLElement;

describe('the header stories mount and say what they are', () => {
  it('titles the story set for Storybook', () => {
    expect((HeaderStories as unknown as { default: { title: string } }).default.title).toBe(
      storyTitle('Header'),
    );
  });

  /* The grid story is the one place all seven published treatments are seen side by side,
     which is the only way a designer can tell that two of them collapsed onto one look. */
  it('ships a grid story that renders every type', () => {
    expect(Object.keys(HeaderStories)).toContain('AllTypes');
    const mod = HeaderStories as unknown as AnyModule;
    const story = (mod as Record<string, unknown>).AllTypes as AnyStory;
    const root = mount(element(mod, story));
    expect(root.querySelectorAll('[data-header]').length).toBe(HEADER_TYPES.length);
  });

  it('mounts every story without throwing', () => {
    const mod = HeaderStories as unknown as AnyModule;
    expect(stories(mod).length).toBeGreaterThan(2);
    for (const [, story] of stories(mod))
      expect(mount(element(mod, story as AnyStory)).querySelectorAll('[data-header]').length).toBeGreaterThan(0);
  });
});

describe('the type axis', () => {
  /* All seven ship (KTD2), and each renders ITS OWN set — a type whose classes silently fall
     back to another's is a published treatment the library claims and does not have. */
  it('renders each of the seven published types with its own class set', () => {
    expect(HEADER_TYPES.length).toBe(7);
    for (const type of HEADER_TYPES) {
      const el = bar(mount(<Header type={type} title="T" />));
      for (const c of HEADER_TYPE[type].split(' ')) expect(el.className).toContain(c);
      expect(el.getAttribute('data-header')).toBe(type);
    }
  });

  it('toggles the scroll-shadow classes rather than only reporting the state', () => {
    const idle = bar(mount(<Header title="T" />));
    for (const c of HEADER_SCROLL.idle.split(' ')) expect(idle.className).toContain(c);

    const scrolled = bar(mount(<Header title="T" scrolled />));
    for (const c of HEADER_SCROLL.scrolled.split(' ')) expect(scrolled.className).toContain(c);
    expect(scrolled.className).not.toContain(HEADER_SCROLL.idle);
  });

  /* UMK-1041: a centred slot, a leading slot, and a transparent ground at the top. */
  it('centres a slot on a three-column bar, and leaves the flex bar alone without one', () => {
    const plain = mount(<Header title="T" showTextLeft actions={<b>A</b>} />);
    expect(plain.querySelector('[data-header-center]')).toBeNull();
    const centred = mount(<Header leading={<i>L</i>} center={<u>C</u>} actions={<b>A</b>} />);
    expect(centred.querySelector('[data-header-center]')!.textContent).toBe('C');
    expect(centred.querySelector('i')!.textContent).toBe('L');
    expect(centred.querySelector('[data-header-center]')!.parentElement!.className).toContain('grid-cols-');
  });

  it('swaps the type ground for a transparent one only at the top', () => {
    const top = bar(mount(<Header type="temanAiChat" transparentAtTop />));
    expect(top.className).toContain('bg-transparent');
    expect(top.className).not.toContain('bg-default-primary');
    const scrolled = bar(mount(<Header type="temanAiChat" transparentAtTop scrolled />));
    expect(scrolled.className).toContain('bg-default-primary');
    expect(scrolled.className).not.toContain('bg-transparent');
    const off = bar(mount(<Header type="temanAiChat" />));
    expect(off.className).toContain('bg-default-primary');
  });

  /**
   * THE SECOND DIVERGENCE, ASSERTED. Figma publishes `Size: Mobile | Desktop`; one component
   * reflows instead. A `size` prop added later would compile everywhere and quietly give the
   * package two ways to say the same thing, one of which cannot follow the viewport.
   */
  it('exposes no mobile/desktop prop, because the one bar reflows', () => {
    const el = bar(mount(<Header title="T" {...({ size: 'Mobile' } as object)} />));
    expect(el.getAttribute('size')).toBeNull();
    expect(el.className).toMatch(/(?:^|\s)md:/);
  });
});

describe('the back affordance', () => {
  it('renders no back control unless asked, and an accessibly named one when asked', () => {
    expect(mount(<Header title="T" />).querySelector('[data-header-back]')).toBeNull();
    const el = mount(<Header title="T" showBack backLabel="Kembali" />).querySelector(
      '[data-header-back]',
    ) as HTMLElement;
    expect(el).not.toBeNull();
    /* An unnamed glyph is an unlabelled control, whichever way the name is supplied. */
    expect(el.getAttribute('aria-label') ?? el.textContent).toContain('Kembali');
  });

  it('reaches and operates the default back control by keyboard alone', async () => {
    const onBack = vi.fn();
    const root = mount(<Header title="T" showBack onBack={onBack} />);
    const control = root.querySelector('[data-header-back]') as HTMLElement;
    await userEvent.tab();
    /* Focus REACHING it is half the check — a div with a click handler passes the click
       assertion and fails this one. */
    expect(document.activeElement).toBe(control);
    await userEvent.keyboard('{Enter}');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  /**
   * THE CALLER SUPPLIES THE CONTROL, because this package may not import a router or a link
   * library. Both accepted forms must receive the props the header would have put on its own
   * control — an override that silently drops the marker and the accessible name is an
   * override that looks like it worked.
   */
  it('hands its props to a caller-supplied element', () => {
    const root = mount(
      <Header title="T" showBack backLabel="Kembali" back={<a href="/x">←</a>} />,
    );
    const el = root.querySelector('[data-header-back]') as HTMLElement;
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/x');
    expect(el.getAttribute('aria-label')).toBe('Kembali');
    expect(el.className).not.toBe('');
  });

  it('hands its props to a caller-supplied render function', () => {
    const seen: Record<string, unknown>[] = [];
    const root = mount(
      <Header
        title="T"
        showBack
        backLabel="Kembali"
        back={(props) => {
          seen.push(props as unknown as Record<string, unknown>);
          return <a {...props} href="/y" />;
        }}
      />,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]['aria-label']).toBe('Kembali');
    expect((root.querySelector('[data-header-back]') as HTMLElement).getAttribute('href')).toBe('/y');
  });
});

describe('the slots', () => {
  it('renders arbitrary actions content, and nothing at all when none is passed', () => {
    expect(mount(<Header title="T" />).querySelector('[data-header-actions]')).toBeNull();
    const el = mount(<Header title="T" actions={<button type="button">Go</button>} />).querySelector(
      '[data-header-actions]',
    ) as HTMLElement;
    expect(el.querySelector('button')?.textContent).toBe('Go');
  });

  it('shows the title and the tab strip only when asked for them', () => {
    const bare = mount(<Header title="Judul" tabs={<span>Tab</span>} />);
    expect(bare.querySelector('[data-header-title]')).toBeNull();
    expect(bare.querySelector('[data-header-tabs]')).toBeNull();

    const full = mount(<Header title="Judul" showTextLeft showTab tabs={<span>Tab</span>} />);
    expect((full.querySelector('[data-header-title]') as HTMLElement).textContent).toBe('Judul');
    expect((full.querySelector('[data-header-tabs]') as HTMLElement).textContent).toBe('Tab');
  });
});
