import React from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as TableStories from './Table/Table.stories';
import { storyTitle } from '../contract';

/**
 * The table stories guard.
 *
 * `Table` declares no contract `family`, so none of the family pairs can see it; this file,
 * `datatable.test.tsx` and `table.purge.test.ts` are the whole of its coverage. The behaviour is
 * proven in `datatable.test.tsx`; this proves every state the ticket asks for has a story, by
 * NAME — a count cannot say which one went missing.
 *
 * Importing the story module also pulls it into the typecheck program: `tsconfig` excludes every
 * stories file, so a story imported by a test is the only way one is checked at all.
 */

type AnyStory = { render?: (a: never, b: never) => React.ReactElement };
const mod = TableStories as unknown as { default: { title: string } } & Record<string, unknown>;
const stories = Object.entries(mod).filter(([n, s]) => n !== 'default' && s && typeof s === 'object');

const mount = (ui: React.ReactElement): HTMLElement => {
  cleanup();
  return render(ui).baseElement as HTMLElement;
};

describe('the table stories', () => {
  it('titles the story set for Storybook', () => {
    expect(mod.default.title).toBe(storyTitle('Table'));
  });

  it('ships a story for every state the ticket names', () => {
    expect(Object.keys(mod)).toEqual(
      expect.arrayContaining([
        'Plain',
        'ClientSide',
        'ServerSide',
        'Loading',
        'Empty',
        'RowSelection',
        'StickyColumns',
        'HandWritten',
        'ClientToolbar',
        'ClickableRows',
        'ScrollingBody',
      ]),
    );
  });

  it('mounts every story into a real table', () => {
    for (const [name, story] of stories) {
      const root = mount((story as AnyStory).render!({} as never, {} as never));
      expect(root.querySelector('table'), name).not.toBeNull();
    }
  });
});
