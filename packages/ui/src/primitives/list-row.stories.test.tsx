import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import * as ListRowStories from './ListRow/ListRow.stories';
import { ListRow } from './ListRow';
import { LIST_ROW_BOX, LIST_ROW_GLYPH_INK, LIST_ROW_PLAIN_GLYPH, LIST_ROW_TINT } from './list-row-classes';
import { contract, storyTitle } from '../contract';

/**
 * The web list row's behaviour guard (UMK-1840).
 *
 * IT EXISTS BECAUSE NO FAMILY GUARD CAN SEE THIS COMPONENT: `ListRow` declares no contract `family`, so
 * `unfamilied-coverage.test.ts` names this file and its purge sibling as the web half of its coverage.
 * happy-dom has no layout engine, so nothing here measures the row; the purge sibling checks its classes
 * survive.
 */

type AnyStory = { args?: Record<string, unknown>; render?: (a: never, b: never) => React.ReactElement };
type AnyModule = { default: { component: React.ElementType; args?: Record<string, unknown> } } & Record<string, unknown>;

const element = (mod: AnyModule, story: AnyStory): React.ReactElement => {
  const args = { ...(mod.default.args ?? {}), ...(story.args ?? {}) };
  if (typeof story.render === 'function') return story.render(args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...args} />;
};

const stories = (mod: AnyModule) => Object.entries(mod).filter(([n, s]) => n !== 'default' && s && typeof s === 'object');

/* One mount at a time: every render shares one body (the tab bar guard records the same hazard). */
const mount = (ui: React.ReactElement): HTMLElement => {
  cleanup();
  return render(ui).baseElement as HTMLElement;
};

describe('the list row stories', () => {
  it('titles the story set for Storybook', () => {
    expect((ListRowStories as unknown as { default: { title: string } }).default.title).toBe(storyTitle('ListRow'));
  });

  it('mounts every story with at least one row', () => {
    const mod = ListRowStories as unknown as AnyModule;
    expect(stories(mod).length).toBeGreaterThan(1);
    for (const [, story] of stories(mod)) {
      expect(mount(element(mod, story as AnyStory)).querySelectorAll('[data-list-row]').length).toBeGreaterThan(0);
    }
  });

  /* The stories are where every axis value is looked at (UMK-978: a class can resolve to the wrong colour). */
  it('draws every declared axis value somewhere in the stories', () => {
    const mod = ListRowStories as unknown as AnyModule;
    const html = stories(mod)
      .map(([, story]) => mount(element(mod, story as AnyStory)).innerHTML)
      .join('');
    for (const variant of contract.ListRow.axes.variant) expect(html).toContain(`data-list-row="${variant}"`);
    for (const trailing of contract.ListRow.axes.trailing.filter((t) => t !== 'none'))
      expect(html).toContain(`data-list-row-trailing="${trailing}"`);
    for (const tone of contract.ListRow.axes.valueTone) expect(html).toContain(`data-list-row-value="${tone}"`);
  });
});

describe('a row', () => {
  it('is a link when it has a destination, and says it is current only when active', () => {
    const root = mount(
      <>
        <ListRow label="Profil" href="/temanai/profil" active />
        <ListRow label="Jalur" href="/temanai/journey" />
      </>,
    );
    const [current, other] = Array.from(root.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(current.getAttribute('href')).toBe('/temanai/profil');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(other.hasAttribute('aria-current')).toBe(false);
    for (const c of LIST_ROW_TINT.active.split(' ')) expect(current.className).toContain(c);
    for (const c of LIST_ROW_TINT.interactive.split(' ')) expect(other.className).toContain(c);
  });

  it('is a button when it has no destination, and fires its click', () => {
    const onClick = vi.fn();
    const button = mount(<ListRow label="Perkenalan Teman AI" onClick={onClick} />).querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('opens an external row in a new tab with the opener cut, on a plain anchor even with a link component', () => {
    const Link = vi.fn((props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a data-router-link="" {...props} />);
    const a = mount(<ListRow label="Pusat Bantuan" href="https://wa.me/6285287431359" external linkComponent={Link} />).querySelector(
      'a',
    ) as HTMLAnchorElement;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.hasAttribute('data-router-link')).toBe(false);
    expect(Link).not.toHaveBeenCalled();
  });

  it('renders an in-product link through the caller link component', () => {
    const Link = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(function Link(props, ref) {
      return <a ref={ref} data-router-link="" {...props} />;
    });
    const a = mount(<ListRow label="Kebijakan Privasi" href="/kebijakan-privasi" linkComponent={Link} />).querySelector('a') as HTMLAnchorElement;
    expect(a.hasAttribute('data-router-link')).toBe(true);
    expect(a.hasAttribute('target')).toBe(false);
  });

  it('cannot be followed or pressed while disabled, and greys its glyph', () => {
    const onClick = vi.fn();
    const root = mount(<ListRow label="Install Aplikasi" icon="menu-install" variant="plain" href="/x" disabled onClick={onClick} />);
    expect(root.querySelector('a')).toBeNull();
    const button = root.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.className).toContain(LIST_ROW_TINT.disabled);
    expect(button.querySelector('svg')?.getAttribute('class')).toContain(LIST_ROW_GLYPH_INK.disabled);
  });

  it('greys a disabled tile row its leading glyph too, inside the brand tile', () => {
    const button = mount(<ListRow label="Analisis" icon="book-open" disabled />).querySelector('button') as HTMLButtonElement;
    expect(button.querySelector('[data-list-row-tile] svg')?.getAttribute('class')).toContain(LIST_ROW_GLYPH_INK.disabled);
    const enabled = mount(<ListRow label="Analisis" icon="book-open" />).querySelector('[data-list-row-tile] svg');
    expect(enabled?.getAttribute('class')).not.toContain(LIST_ROW_GLYPH_INK.disabled);
  });

  it('boxes each variant as the class table says, and draws the plain glyphs at 18', () => {
    const plain = mount(<ListRow label="Paket Teman AI" icon="diamond" variant="plain" trailing="chevron" />).querySelector(
      'button',
    ) as HTMLElement;
    for (const c of LIST_ROW_BOX.plain.split(' ')) expect(plain.className).toContain(c);
    const glyphs = Array.from(plain.querySelectorAll('svg'));
    expect(glyphs).toHaveLength(2);
    for (const svg of glyphs) expect(svg.getAttribute('class')).toContain(LIST_ROW_PLAIN_GLYPH);
    const tile = mount(<ListRow label="Analisis" icon="book-open" />).querySelector('button') as HTMLElement;
    for (const c of LIST_ROW_BOX.tile.split(' ')) expect(tile.className).toContain(c);
    expect(tile.querySelector('[data-list-row-tile]')).not.toBeNull();
  });

  it('draws the trailing glyph for chevron and external, and none for none', () => {
    const glyphOf = (trailing: 'chevron' | 'external' | 'none') =>
      mount(<ListRow label="Row" trailing={trailing} />).querySelector('[data-list-row-trailing]')?.getAttribute('data-list-row-trailing');
    expect(glyphOf('chevron')).toBe('chevron');
    expect(glyphOf('external')).toBe('external');
    expect(glyphOf('none')).toBeUndefined();
  });

  it('inks the trailing value muted by default and brand when asked', () => {
    const valueOf = (tone?: 'muted' | 'brand') =>
      mount(<ListRow label="Paket Teman AI" value="Basic" valueTone={tone} />).querySelector('[data-list-row-value]') as HTMLElement;
    expect(valueOf().className).toContain('text-default-muted');
    expect(valueOf('brand').className).toContain('text-default-brand');
    expect(valueOf('brand').textContent).toBe('Basic');
  });

  it('draws a badge after the label', () => {
    const root = mount(<ListRow label="Perkenalan Teman AI" badge={<span data-testid="dot" role="status" aria-label="Baru" />} />);
    expect(root.querySelector('[data-testid="dot"]')).not.toBeNull();
  });

  it('forwards its ref', () => {
    const ref = React.createRef<HTMLElement>();
    const button = mount(<ListRow ref={ref} label="Row" />).querySelector('button');
    expect(ref.current).toBe(button);
  });
});
