import { describe, expect, it } from 'vitest';
import * as IconStories from './Icon.stories';
import * as TextStories from '../Text/Text.stories';
import { TEXT_ROLES, storyTitle } from '../../contract';
import { ICON_NAMES } from './registry';

// Storybook is where a designer checks the set, so "the story grid shows everything" is a
// real requirement and not a formality. Both grids render from the source list rather than a
// hand-written one; these assert that they still do, because swapping either for a literal
// array is the change that would quietly stop showing new entries.
describe('the story sets cover their whole axis', () => {
  it('renders the Icon grid from the registry itself', () => {
    const render = IconStories.AllIcons.render!;
    const grid = render({} as never, {} as never) as { props: { names: readonly string[] } };
    expect(grid.props.names).toEqual(ICON_NAMES);
    expect(ICON_NAMES.length).toBeGreaterThan(60);
  });

  it('renders the Text scale from the role list itself', () => {
    const render = TextStories.AllRoles.render!;
    const scale = render({} as never, {} as never) as { props: { roles: readonly string[] } };
    expect(scale.props.roles).toEqual(TEXT_ROLES);
    expect(TEXT_ROLES.length).toBe(11);
  });

  it('gives both components a default export Storybook can title', () => {
    expect(IconStories.default.title).toBe(storyTitle('Icon'));
    expect(TextStories.default.title).toBe(storyTitle('Text'));
  });
});
