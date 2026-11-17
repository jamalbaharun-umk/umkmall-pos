import React from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as ListGroupStories from './ListGroup/ListGroup.stories';
import { ListGroup } from './ListGroup';
import { ListRow } from './ListRow';
import { LIST_GROUP_CONTAINER, LIST_GROUP_STACK } from './list-group-classes';
import { contract, storyTitle } from '../contract';

/**
 * The web list group's behaviour guard (UMK-1840). `ListGroup` declares no contract `family`, so
 * `unfamilied-coverage.test.ts` names this file and its purge sibling as the web half of its coverage.
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

const mount = (ui: React.ReactElement): HTMLElement => {
  cleanup();
  return render(ui).baseElement as HTMLElement;
};

describe('the list group stories', () => {
  it('titles the story set for Storybook', () => {
    expect((ListGroupStories as unknown as { default: { title: string } }).default.title).toBe(storyTitle('ListGroup'));
  });

  it('draws every declared variant, each as one labelled group of rows', () => {
    const mod = ListGroupStories as unknown as AnyModule;
    const drawn = new Set<string>();
    for (const [, story] of stories(mod)) {
      const group = mount(element(mod, story as AnyStory)).querySelector('[role="group"]') as HTMLElement;
      expect(group).not.toBeNull();
      expect(group.querySelectorAll('[data-list-row]').length).toBeGreaterThan(0);
      drawn.add(group.getAttribute('data-list-group') ?? '');
    }
    expect([...drawn].sort()).toEqual([...contract.ListGroup.axes.variant].sort());
  });
});

describe('a group', () => {
  it('names itself by its heading', () => {
    const root = mount(
      <ListGroup variant="plain" label="Teman AI">
        <ListRow variant="plain" label="Pengaturan Profile" />
      </ListGroup>,
    );
    const group = root.querySelector('[role="group"]') as HTMLElement;
    const heading = root.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toBe('Teman AI');
    expect(group.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('puts an outlined group on the card, and a plain group on the page', () => {
    const rowsOf = (variant: 'plain' | 'outlined') =>
      mount(
        <ListGroup variant={variant} label="L">
          <ListRow label="Row" />
        </ListGroup>,
      ).querySelector('[data-list-group-rows]') as HTMLElement;
    for (const c of LIST_GROUP_CONTAINER.split(' ')) expect(rowsOf('outlined').className).toContain(c);
    /* Every card class, read from the table: a literal here would keep passing after the card's tokens change. */
    const plain = rowsOf('plain').className.split(' ');
    for (const c of LIST_GROUP_CONTAINER.split(' ')) expect(plain).not.toContain(c);
    const stack = mount(<ListGroup variant="plain">{null}</ListGroup>).querySelector('[role="group"]') as HTMLElement;
    for (const c of LIST_GROUP_STACK.plain.split(' ')) expect(stack.className).toContain(c);
  });

  it('is an unnamed group with no heading when it has no label', () => {
    const group = mount(<ListGroup>{null}</ListGroup>).querySelector('[role="group"]') as HTMLElement;
    expect(group.hasAttribute('aria-labelledby')).toBe(false);
    expect(group.querySelector('h2')).toBeNull();
  });
});
