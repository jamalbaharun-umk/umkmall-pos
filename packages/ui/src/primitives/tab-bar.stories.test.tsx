import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import * as TabBarStories from './TabBar/TabBar.stories';
import { TabBar, TabBarItem } from './TabBar';
import { TAB_BAR, TAB_BAR_INDICATOR, TAB_BAR_ITEM_INK } from './tab-bar-classes';
import { storyTitle } from '../contract';

/**
 * The web tab bar's behaviour guard (UMK-1757).
 *
 * IT EXISTS BECAUSE NO FAMILY GUARD CAN SEE THIS COMPONENT: `TabBar` declares no contract
 * `family`, so `unfamilied-coverage.test.ts` names this file and its purge sibling as the web
 * half of its coverage.
 *
 * happy-dom has no layout engine, so nothing here checks the bar sits on the bottom edge or that it
 * is hidden from `md` up; the purge sibling checks those classes survive.
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

/* One mount at a time: every render shares one body, so a second render would leave the first one's
   nodes in front of the query (the sidebar guard records the same hazard). */
const mount = (ui: React.ReactElement): HTMLElement => {
  cleanup();
  return render(ui).baseElement as HTMLElement;
};

describe('the tab bar stories mount and say what they are', () => {
  it('titles the story set for Storybook', () => {
    expect((TabBarStories as unknown as { default: { title: string } }).default.title).toBe(storyTitle('TabBar'));
  });

  it('mounts every story as one labelled navigation', () => {
    const mod = TabBarStories as unknown as AnyModule;
    expect(stories(mod).length).toBeGreaterThan(1);
    for (const [, story] of stories(mod)) {
      const nav = mount(element(mod, story as AnyStory)).querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Menu utama Teman AI');
    }
  });
});

describe('the bar', () => {
  /* The two values the purge guard cannot falsify (arbitrary or breakpoint-gated), pinned on the
     element instead. */
  it('pays the bottom safe area and hides from md up', () => {
    const nav = mount(<TabBar label="Nav" />).querySelector('nav') as HTMLElement;
    expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(nav.className).toContain('md:hidden');
    for (const c of TAB_BAR.split(' ')) expect(nav.className).toContain(c);
  });
});

describe('an item', () => {
  it('is a link when it has a destination, and says it is the current page only when active', () => {
    const root = mount(
      <TabBar label="Nav">
        <TabBarItem label="AI Chat" icon="nav-chat" href="/temanai" active />
        <TabBarItem label="Jalur" icon="nav-jalur" href="/temanai/journey" />
      </TabBar>,
    );
    const [chat, jalur] = Array.from(root.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(chat.getAttribute('href')).toBe('/temanai');
    expect(chat.getAttribute('aria-current')).toBe('page');
    expect(jalur.hasAttribute('aria-current')).toBe(false);
    expect(chat.textContent).toBe('AI Chat');
  });

  it('is a button when it has no destination', () => {
    const onClick = vi.fn();
    const button = mount(<TabBarItem label="Profil" icon="nav-profil" onClick={onClick} />).querySelector(
      'button',
    ) as HTMLButtonElement;
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('draws the brand ink and the top line only while active', () => {
    const active = mount(<TabBarItem label="AI Chat" icon="nav-chat" active />).querySelector('button') as HTMLElement;
    for (const c of TAB_BAR_ITEM_INK.active.split(' ')) expect(active.className).toContain(c);
    const line = active.querySelector('[data-tab-bar-indicator]') as HTMLElement;
    expect(line).not.toBeNull();
    for (const c of TAB_BAR_INDICATOR.split(' ')) expect(line.className).toContain(c);

    const idle = mount(<TabBarItem label="Jalur" icon="nav-jalur" />).querySelector('button') as HTMLElement;
    for (const c of TAB_BAR_ITEM_INK.inactive.split(' ')) expect(idle.className).toContain(c);
    expect(idle.className).not.toContain(TAB_BAR_ITEM_INK.active);
    expect(idle.querySelector('[data-tab-bar-indicator]')).toBeNull();
  });

  it('swaps to the filled glyph while active', () => {
    const glyphOf = (ui: React.ReactElement) => mount(ui).querySelector('svg')?.outerHTML;
    const outline = glyphOf(<TabBarItem label="AI Chat" icon="nav-chat" activeIcon="nav-chat-active" />);
    const filled = glyphOf(<TabBarItem label="AI Chat" icon="nav-chat" activeIcon="nav-chat-active" active />);
    expect(outline).toBeDefined();
    expect(filled).not.toBe(outline);
  });

  /* A menu's `asChild` hands its trigger a ref and its handlers; an item that dropped either
     would mount a Profil tab that never opens its menu. */
  it('forwards its ref and the props a menu trigger merges onto it', () => {
    const ref = React.createRef<HTMLElement>();
    const root = mount(
      <TabBarItem ref={ref} label="Profil" icon="nav-profil" aria-haspopup="menu" data-state="closed" />,
    );
    const button = root.querySelector('button') as HTMLButtonElement;
    expect(ref.current).toBe(button);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('data-state')).toBe('closed');
  });

  it('renders through the caller link component, so routing stays the caller business', () => {
    const Link = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(
      function Link(props, ref) {
        return <a ref={ref} data-router-link="" {...props} />;
      },
    );
    const a = mount(<TabBarItem label="Jalur" icon="nav-jalur" href="/temanai/journey" linkComponent={Link} />)
      .querySelector('a') as HTMLAnchorElement;
    expect(a.hasAttribute('data-router-link')).toBe(true);
    expect(a.getAttribute('href')).toBe('/temanai/journey');
  });
});
