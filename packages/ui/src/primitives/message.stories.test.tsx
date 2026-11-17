import React from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as ChatMessageStories from './ChatMessage/ChatMessage.stories';
import * as ChatMessageBubbleStories from './ChatMessage/ChatMessageBubble.stories';
import * as ChatMessageListStories from './ChatMessage/ChatMessageList.stories';
import * as ChatMessageMetadataStories from './ChatMessage/ChatMessageMetadata.stories';
import * as ChatMessageTTSButtonStories from './ChatMessage/ChatMessageTTSButton.stories';
import * as ChatScrollButtonStories from './ChatMessage/ChatScrollButton.stories';
import * as ChatThreadStories from './ChatMessage/ChatThread.stories';
import { contract, storyTitle, type ComponentName } from '../contract';

/**
 * The chat MESSAGE family's stories guard.
 *
 * ONE TRIPLE FOR THE FAMILY — this file, `message.purge.test.ts` and `message.test.tsx` are the
 * whole of its coverage, the way `feedback` and `form-controls` are covered. The family key is
 * what makes that legitimate rather than a gap: the reconciliation below asserts against every
 * entry claiming `family: 'message'`, so a component added to the contract with no story set
 * reddens BY NAME. A count could not say which one went — it would simply be one shorter and
 * still equal itself.
 *
 * PROVED RED, one injection per assertion, written from what each is FOR. The axis sweeps mount
 * every story, so a break that stops a set rendering reds them too — recorded rather than left
 * for a later reader to credit to the wrong assertion (UMK-958):
 *
 * | Injection | Reds |
 * | -- | -- |
 * | A component keeps its entry and loses its story set | **2** — the reconciliation, and the
 *   sweep that had nothing left to mount for it |
 * | A story title shortened by hand | 2 — here and `story-taxonomy`, which asserts the same literal |
 * | A set emptied down to one story | **3** — the floor, and the two sweeps it starved |
 * | A story published in a state that throws | **3** — the mount check, and the two sweeps that
 *   mount the same set |
 * | The system sender story quietly retargeted | 1 — the sender sweep |
 * | The density story stops iterating its axis | 1 — the density sweep |
 * | A grouping value loses its last demonstration | 1 — the group sweep |
 * | The ghost story stops using a ghost | 1 — the ghost/width demo |
 * | The status story stops iterating its axis | 1 — the status sweep |
 * | An axis added to the contract with no sweep row | 2 — the roster check, and the contract's own
 *   axis-coverage guard, which sees the unread axis first |
 * | The arrangement stories all move off the top alignment | 1 — the align sweep |
 * | The gap story stops iterating its axis | 1 — the gap sweep |
 * | The expanded pill stories stop expanding | 1 — the shape sweep |
 *
 * IMPORTING A STORY MODULE ALSO PULLS IT INTO THE TYPECHECK PROGRAM. `tsconfig.json` excludes
 * every stories file, so a story imported by a test is the only way one is checked at all.
 */
type AnyStory = { args?: Record<string, unknown>; render?: (a: never, b: never) => React.ReactElement };
type AnyModule = {
  default: {
    component: React.ElementType;
    args?: Record<string, unknown>;
    render?: (a: never, b: never) => React.ReactElement;
  };
} & Record<string, unknown>;

/**
 * Resolve a story the way STORYBOOK does: the story's own `render`, else the META's, else the
 * component with the merged args.
 *
 * THE META FALLBACK IS NOT A DETAIL. Copies of this helper in other family guards checked only
 * `story.render`, so a meta-level `render` — the usual way a set injects a wrapper every story
 * needs — was skipped and each story was mounted as a bare component. That is a guard rendering
 * something Storybook never shows.
 */
const element = (mod: AnyModule, story: AnyStory): React.ReactElement => {
  const args = { ...(mod.default.args ?? {}), ...(story.args ?? {}) };
  const render = story.render ?? mod.default.render;
  if (typeof render === 'function') return render(args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...args} />;
};

const stories = (mod: AnyModule) =>
  Object.entries(mod).filter(([n, s]) => n !== 'default' && s && typeof s === 'object');

/** ONE STORY SET PER COMPONENT, keyed by its CONTRACT name — reconciled below. */
const MODULES = {
  ChatMessage: ChatMessageStories,
  ChatMessageBubble: ChatMessageBubbleStories,
  ChatMessageList: ChatMessageListStories,
  ChatMessageMetadata: ChatMessageMetadataStories,
  ChatMessageTTSButton: ChatMessageTTSButtonStories,
  ChatScrollButton: ChatScrollButtonStories,
  ChatThread: ChatThreadStories,
};

const contractFamilyMembers = (family: string): string[] =>
  Object.entries(contract)
    .filter(([, entry]) => (entry as { family?: string }).family === family)
    .map(([name]) => name)
    .sort();

describe('the message family is fully covered', () => {
  it('has a story set for every component the contract puts in this family', () => {
    expect(Object.keys(MODULES).sort()).toEqual(contractFamilyMembers('message'));
  });

  /**
   * FILED UNDER THE SAME `Chat` FOLDER AS THE COMPOSER, because `category` and `family` are
   * different questions: a reader looking for a message bubble looks under Chat, beside the
   * composer they will render it above.
   */
  it('files every story set under the Chat folder, named for its export', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
      expect((mod as unknown as AnyModule).default.title).toBe(storyTitle(name as ComponentName));
    }
  });

  /* The mount-everything assertion has to have something to mount: a set that lost its stories
     would otherwise make the loop below pass by never running — a guard measuring itself. */
  it('gives every component more than one story', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
      expect(stories(mod as unknown as AnyModule).length, `${name} has too few stories`).toBeGreaterThan(1);
    }
  });

  it('renders every exported story of every component without throwing', () => {
    for (const [name, module_] of Object.entries(MODULES)) {
      const mod = module_ as unknown as AnyModule;
      for (const [story, def] of stories(mod)) {
        cleanup();
        expect(() => render(element(mod, def as AnyStory)), `${name}/${story} threw`).not.toThrow();
      }
    }
  });

});

/**
 * EVERY DECLARED VALUE OF EVERY AXIS IS DEMONSTRATED SOMEWHERE IN THAT COMPONENT'S SET — by what
 * the stories RENDER, not by what they are called.
 *
 * The story count cannot do this job: deleting the story that shows the system sender leaves five
 * others and a green suite. Nor would story names work — they are prose. So each set is mounted in
 * full and the rendered data attributes are collected, which is why the components reflect their
 * axis values onto the element in the first place.
 *
 * Read PER COMPONENT rather than across the family: the bubble's stories mount rows too, so a
 * family-wide sweep would let `ChatMessage`'s own set go empty while the bubble's covered for it.
 */
const SWEPT = [
  /* SCOPED TO THE ARTICLE, and the unscoped form was a live hole. The bubble and the metadata row
     publish `data-sender` too, so `[data-sender]` had three contributors for one axis: deleting the
     attribute from the row left this sweep green and the whole suite passing. That is the
     "a guard over N redundant sources cannot see one disappear" rule, walked into by a diff that
     cites it — the log region's row was already scoped for exactly this reason. */
  ['ChatMessage', 'sender', 'article[data-sender]', 'data-sender'],
  ['ChatMessage', 'density', 'article[data-density]', 'data-density'],
  ['ChatMessageBubble', 'group', '[data-group]', 'data-group'],
  ['ChatMessageBubble', 'width', '[data-width]', 'data-width'],
  ['ChatMessageList', 'density', '[role="log"][data-density]', 'data-density'],
  ['ChatMessageList', 'align', '[data-align]', 'data-align'],
  ['ChatMessageList', 'gap', '[data-gap]', 'data-gap'],
  ['ChatMessageMetadata', 'status', '[data-status]', 'data-status'],
  ['ChatMessageTTSButton', 'state', 'button[data-state]', 'data-state'],
  ['ChatScrollButton', 'shape', '[data-shape]', 'data-shape'],
] as const;

describe('every axis in the family is swept', () => {
  /**
   * THE SWEEP'S OWN COMPLETENESS CHECK, and it is the assertion the sweeps cannot make about
   * themselves. The list above is hand-written, so an axis added to the contract with no row here
   * is simply never asked about — the suite stays green and one axis quietly stops having to be
   * demonstrated anywhere. Reconciled against the contract rather than counted, because a count
   * would be one shorter and still equal itself.
   */
  it('has a sweep row for every axis of every component in this family', () => {
    const declared = Object.entries(contract)
      .filter(([, e]) => (e as { family?: string }).family === 'message')
      .flatMap(([name, e]) => Object.keys(e.axes).map((axis) => `${name}.${axis}`))
      .sort();
    expect(SWEPT.map(([name, axis]) => `${name}.${axis}`).sort()).toEqual(declared);
  });
});

describe('the message family demonstrates what it declares', () => {
  it.each(SWEPT.map((row) => [...row]))(
    'demonstrates every %s %s somewhere in its own set',
    (name, axis, selector, attribute) => {
      const mod = MODULES[name as keyof typeof MODULES] as unknown as AnyModule;
      const seen = new Set<string>();
      for (const [, story] of stories(mod)) {
        cleanup();
        const { container } = render(element(mod, story as AnyStory));
        for (const el of container.querySelectorAll(selector)) {
          const value = el.getAttribute(attribute);
          if (value) seen.add(value);
        }
      }
      const declared = (contract[name as ComponentName].axes as Record<string, readonly string[]>)[axis];
      expect(
        declared.filter((value) => !seen.has(value)),
        `${name} never renders these ${axis} values in its own stories`,
      ).toEqual([]);
    },
  );
});

describe('the message family demonstrates what a boolean hides', () => {
  /**
   * THE GHOST IS DEMONSTRATED, and it is the one presentation a reader cannot infer from the
   * props table. `ghost` is a boolean, so the sweep above cannot see it — and an undemonstrated
   * ghost means the artifact-placement contract exists with nobody able to find it, which is the
   * failure U6's stories exist to prevent rather than a missing story.
   */
  it('demonstrates the ghost presentation and the width override in the bubble set', () => {
    const mod = ChatMessageBubbleStories as unknown as AnyModule;
    let ghost = false;
    let uncapped = false;
    for (const [, story] of stories(mod)) {
      cleanup();
      const { container } = render(element(mod, story as AnyStory));
      if (container.querySelector('[data-ghost]')) ghost = true;
      for (const el of container.querySelectorAll('[data-group]'))
        if ([...el.classList].includes('max-w-none')) uncapped = true;
    }
    expect(ghost, 'no story renders a ghost bubble').toBe(true);
    expect(uncapped, 'no story renders a bubble that escapes the width cap').toBe(true);
  });
});
