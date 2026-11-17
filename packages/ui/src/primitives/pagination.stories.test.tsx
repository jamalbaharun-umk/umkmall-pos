import React from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as PaginationStories from './Pagination/Pagination.stories';
import { contract, storyTitle } from '../contract';

/**
 * The pagination stories guard.
 *
 * `Pagination` declares no contract `family`, so none of the family pairs can see it; this file,
 * `Pagination/Pagination.test.tsx` and `table.purge.test.ts` are the whole of its coverage.
 *
 * Importing the story module also pulls it into the typecheck program: `tsconfig` excludes every
 * stories file, so a story imported by a test is the only way one is checked at all.
 */

type AnyStory = { args?: Record<string, unknown>; render?: (a: never, b: never) => React.ReactElement };
type AnyModule = { default: { component: React.ElementType; args?: Record<string, unknown> } } & Record<
  string,
  unknown
>;

const mod = PaginationStories as unknown as AnyModule;

const element = (story: AnyStory): React.ReactElement => {
  const args = { ...(mod.default.args ?? {}), ...(story.args ?? {}) };
  if (typeof story.render === 'function') return story.render(args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...args} />;
};

const stories = Object.entries(mod).filter(([n, s]) => n !== 'default' && s && typeof s === 'object');

const mount = (ui: React.ReactElement): HTMLElement => {
  cleanup();
  return render(ui).baseElement as HTMLElement;
};

describe('the pagination stories', () => {
  it('titles the story set for Storybook', () => {
    expect(mod.default.title).toBe(storyTitle('Pagination'));
  });

  it('mounts every story without throwing', () => {
    expect(stories.length).toBeGreaterThan(3);
    for (const [, story] of stories) expect(mount(element(story as AnyStory))).toBeTruthy();
  });

  /* By VALUE, off the contract: a size added to the axis and missing from the grid reds here. */
  it('renders every contract size in the Sizes grid', () => {
    const root = mount(element(mod.Sizes as AnyStory));
    for (const size of contract.Pagination.axes.size)
      expect(root.querySelector(`nav[data-size="${size}"]`), size).not.toBeNull();
  });

  /* Same for the density axis: a value the Densities grid does not render reds by name. */
  it('renders every contract density in the Densities grid', () => {
    const root = mount(element(mod.Densities as AnyStory));
    for (const density of contract.Pagination.axes.density)
      expect(root.querySelector(`nav[data-density="${density}"]`), density).not.toBeNull();
  });
});
