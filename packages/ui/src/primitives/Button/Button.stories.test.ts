import { describe, expect, it } from 'vitest';
import * as ButtonStories from './Button.stories';
import { contract, storyTitle } from '../../contract';

/**
 * BUTTON IS IN NO FAMILY, so no guard imported its stories — and `tsconfig` excludes every
 * stories file, which means nothing in the package type-checked this one. A story added here
 * with an unresolved identifier compiled fine and would only have failed in the Storybook
 * build, at the far end of the pipeline. Importing the module is what pulls it into the
 * program; the precedent is `Icon.stories.test.ts`.
 */
describe('the Button stories are real stories', () => {
  it('titles the set for Storybook', () => {
    expect(ButtonStories.default.title).toBe(storyTitle('Button'));
  });

  it('renders the icon-only grid from the contract rather than a literal', () => {
    const rendered = ButtonStories.IconOnly.render!({} as never, {} as never) as unknown as {
      props: { children: readonly unknown[] };
    };
    expect(rendered.props.children).toHaveLength(contract.Button.axes.size.length);
  });

  it('has the unstyled and asChild stories', () => {
    expect(ButtonStories.Unstyled).toBeDefined();
    expect(ButtonStories.AsChild).toBeDefined();
  });
});
