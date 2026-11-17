import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatScrollButton,
  ChatThread,
  MESSAGE_MARKER,
  useChatStreamScroll,
} from './ChatMessage';
import { AppShell } from '../layouts';
import { MESSAGE_INSET } from './message-classes';
import { contract } from '../contract';

/**
 * The chat MESSAGE family's behaviour guard — the third file of the family's triple, holding
 * every component's behaviour assertions the way `feedback.test.tsx` and `form-controls.test.tsx`
 * do for theirs.
 *
 * WEIGHTED TOWARD WHAT ASSISTIVE TECHNOLOGY RECEIVES, because the characteristic failure of a
 * transcript is a silent one. A row that renders and announces nothing is a landmark with no
 * name; a user-side flip built by reordering markup renders identically and puts the message body
 * before the speaker in the accessibility tree. Neither is visible in a screenshot, and neither
 * is visible to the purge guard next door, which can only see that a class table still names a
 * rule.
 *
 * PROVED RED, one injection per assertion, each written from the failure the assertion describes
 * rather than from the assertion's own shape. That distinction earned its keep here: the
 * standalone-default check first compared CLASS LISTS, and the injection that moves the default
 * onto the user side left them identical — the two turns hold the same fill — so it passed over
 * exactly the edit it existed to catch. The component now reflects its resolved sender, and the
 * assertion reads that. See its own note.
 *
 * | Injection | Reds |
 * | -- | -- |
 * | The row stops using the name slot for its accessible name | 1 |
 * | The sender fallback dropped, leaving an unnamed landmark | 1 |
 * | The marker attribute dropped | 1 |
 * | One of the three system suppression branches forgotten | 1 |
 * | The author header moved after the turn, flipping by reorder | 1 |
 * | The author header rendered when nothing fills it | 1 |
 * | The standalone default moved off the assistant side | 1 |
 * | The bubble stops reading the row it sits in | **2** — the row-sender check and the grouped
 *   tuck, which is downstream of the same read |
 * | One grouping table serving both senders | 1 |
 * | The width prop stops reaching its table | 2 — here and the stories demo |
 * | The alignment inset applied to the bubble but not the slot | 1 |
 * | The author header left flush, an inset away from its own words | 1 |
 * | The author header's inset fixed rather than read from the density | 1 |
 * | The row's gap read from a fixed density instead of the resolved one | 1 |
 * | The row stops publishing its density | **2** — the density flow and the ghost alignment,
 *   which measures the same table at two densities |
 * | The metadata's empty branch removed | 1 |
 * | The status accessible label dropped | **5** — the label check is per status, by design |
 * | The accessible name stops being the visible word lower-cased | **5** — same, per status |
 * | The separator attached to a piece instead of the gap | 1 |
 * | The metadata row stops reading the sender it sits under | 1 |
 * | The status treatment stops reaching the element | 1 |
 * | The host's attributes stop reaching the root | 1 |
 * | The unmount cancel removed, leaving a spring running | 1 — review found this GREEN; no
 *   scenario unmounted with a queued frame until now |
 * | The scroller taken as a ref again, so a late arrival wires nothing | 4 — the late-attach test
 *   plus three that depend on the listener existing |
 * | The frame publishing a ref, so the sentinel roots on the viewport | 1 — this came back GREEN
 *   first: the fake recorded the `root` all along and nothing read it |
 * | The list rooting its sentinel on nothing | 1 — the same assertion |
 * | The reset stops re-engaging, so a new conversation opens scrolled up | 1 |
 * | The reset stops restoring the one-shot, so the new history springs | 1 |
 * | The proximity arm removed, so a shrink strands a released reader | 2 |
 * | The busy attribute bound to the boolean | 1 |
 * | The region stops announcing | 1 |
 * | The empty state stops checking whether there are messages | 1 |
 * | The spacer stops being gated on the alignment | 1 |
 * | The gap override stacked after the density gap rather than replacing it | 1 |
 * | The list stops publishing its density | 1 |
 * | The observer constructed and never pointed at anything | **2** — both load-older assertions,
 *   which is correct: neither can reach the callback once nothing is observed |
 * | The in-flight guard removed | 1 |
 * | The sentinel rendered unconditionally | 1 |
 * | The in-flight flag back inside the effect closure, effect keyed on the callback's identity | 1 |
 *
 * | Injection (the code-review fixes) | Reds |
 * | -- | -- |
 * | The follow loop stops reading the lock | 1 — the outrun test's position assertion |
 * | The proximity re-engage removed, leaving `engage()` no non-manual caller | 1 |
 * | The proximity test ordered before the release | 1 |
 * | The first-fill one-shot spent unconditionally | 1 |
 * | The cancel moved inside the non-instant branch | **3** — the instant-over-spring check, the
 *   first-fill check, and the live-loop count, all of which depend on that one cancel |
 * | The host call back in the promise's argument position | 1 |
 * | The cleanup stops clearing the spinner | 1 |
 * | The row stops publishing its sender | 1 — the SCOPED sweep; the unscoped one could not see it |
 * | The anchoring cleanup removed | 1 |
 *
 * TWO OF THOSE PINS WERE ALSO WRITTEN TWICE, and both first versions were unfalsifiable — the
 * third time this file has had to re-aim an assertion, which is worth reading as a pattern rather
 * than three accidents. The branch-order pin first scrolled away while the lock was still
 * ENGAGED, where the proximity branch's own guard stops it regardless of order; and the anchoring
 * cleanup had no assertion at all until its injection came back green. Each carries the account in
 * its own note.
 * | The first fill springs instead of jumping | **6** — the first fill is the precondition for
 *   almost every scroll assertion, so nothing lands at the bottom for any of them to read |
 * | Every change jumps instead of following | 2 — the follow, and the one-live-loop count |
 * | The landed-at-the-bottom arm removed | 1 |
 * | The position comparison removed entirely | **7** — nothing releases, so every assertion past
 *   the release reads a locked transcript |
 * | The hook stops recording its own writes | 1 |
 * | The bottom test reads the offset height | 1 |
 * | The settled-scroll listener removed | 1 |
 * | Growth follows whether or not the lock is engaged | 1 |
 * | The new-message flag keyed on the height moving | 1 |
 * | The pill scrolls without re-engaging | 1 |
 * | The reduced-motion substitution dropped | 1 |
 * | A new follow no longer cancels the running one | 1 |
 * | The anchoring suppression written onto the element's property | 1 |
 * | The hook removed from the family barrel | **12** — the whole scroll suite, which is the point:
 *   it is the only coverage the hook has, and no contract guard can see it go |
 *
 * TWO OF THOSE ASSERTIONS WERE WRITTEN TWICE, and both first versions were unfalsifiable in the
 * same way: neither scenario moved the scroll position DOWN, so the comparison the assertion was
 * about never ran at all. One is fixed with a clamp (the viewport grows, the maximum offset
 * shrinks below the reader, the browser moves them to it); the other with a move smaller than the
 * offset height's border-plus-scrollbar allowance, which is the only size that tells the two
 * properties apart. Each carries the account in its own note.
 *
 * | Injection (the frame and the pill) | Reds |
 * | -- | -- |
 * | The frame never publishes its seam | **4** — every frame assertion, which is the point: with
 *   nothing registered the follow is inert and the pill never appears |
 * | The registered content never reaches the scroll owner | **4** — same set, same reason |
 * | The pill rendered unconditionally | 1 |
 * | The default pill drawn without its handler | 1 |
 * | The new-message flag not passed down | 1 |
 * | The pill's label drawn unconditionally | 1 |
 * | The pill's accessible name removed | 1 |
 * | The pill stops reading its own base table | 1 |
 * | The shell's content region given a scroller of its own | 2 — the composition check, and the
 *   shell's own purge guard, which owns that class |
 *
 * The reversal check is the second one this file has had to re-aim. Its first cut selected on the
 * sender and the direction class, which the ARTICLE carries too — so it found the row's own
 * reversal and passed while the metadata underneath had stopped reading its sender at all. Same
 * lesson as the standalone-default check above: an assertion pointed at the wrong element is not a
 * weak assertion, it is a different one.
 *
 * WHAT THE PURGE GUARD CANNOT SEE, and therefore what lives here: which class table a component
 * actually reaches for, in which order, under which context — and whether the marker the scroll
 * machinery depends on is on the element at all.
 */
afterEach(cleanup);

/**
 * THE OBSERVER HARNESS, and it has to exist before any of the three units below can assert
 * anything at all.
 *
 * `happy-dom` PUBLISHES BOTH OBSERVERS AND NEVER CALLS THEIR CALLBACKS. The constructors resolve,
 * `observe()` returns, and nothing ever fires — so a component whose whole behaviour lives in an
 * observer callback renders correctly, does nothing, and passes every assertion written against
 * its markup. That is the failure shape this family is most exposed to: the load-older action, the
 * follow-on-growth and the new-message flag are all callback-driven, and all three would ship
 * inert against a fully green suite.
 *
 * It also measures EVERY element as zero on every dimension, having no layout engine. A scroll
 * assertion read off real geometry would compare 0 against 0 and pass whatever the component did.
 *
 * So both observers are replaced with fakes a test can FIRE by hand, and the scroll geometry is
 * stubbed per element. No component in this package used either observer before this family, so
 * there was nothing to copy — which is why this sits at the top of the file rather than beside the
 * first test that needs it.
 */
type FakeObserver = {
  callback: (entries: unknown[]) => void;
  targets: Element[];
  disconnected: boolean;
  options: { root?: Element | null } | undefined;
};

const observers: { intersection: FakeObserver[]; resize: FakeObserver[] } = {
  intersection: [],
  resize: [],
};

const makeFake = (bucket: FakeObserver[]) =>
  class {
    private readonly record: FakeObserver;
    constructor(callback: (entries: unknown[]) => void, options?: { root?: Element | null }) {
      this.record = { callback, targets: [], disconnected: false, options };
      bucket.push(this.record);
    }
    observe(target: Element) {
      this.record.targets.push(target);
    }
    unobserve(target: Element) {
      this.record.targets = this.record.targets.filter((t) => t !== target);
    }
    disconnect() {
      this.record.disconnected = true;
    }
    takeRecords() {
      return [];
    }
  };

/**
 * Fire the observers watching THIS ELEMENT, as the browser would when it comes into view.
 *
 * KEYED ON THE TARGET, AND THAT IS NOT TIDINESS. A first cut fired every live observer regardless
 * of what it was watching, and the injection that deletes the `observe()` call — the canonical
 * browser failure, a component that constructs an observer and never points it at anything — came
 * back GREEN. The fake was supplying the one thing the component had stopped doing. Requiring the
 * target to be registered is what makes the absence visible.
 */
const observing = (kind: 'intersection' | 'resize', target: Element) =>
  observers[kind].filter((o) => !o.disconnected && o.targets.includes(target));

const fireIntersection = (target: Element) => {
  const live = observing('intersection', target);
  expect(
    live.length,
    'nothing is observing that element — the observer was constructed but never pointed at it',
  ).toBeGreaterThan(0);
  act(() => {
    for (const observer of live) observer.callback([{ isIntersecting: true, target }]);
  });
};


/**
 * FIRING A RESIZE, for the scroll owner's growth path. Same target rule as the intersection one.
 */
const fireResize = (target: Element) => {
  const live = observing('resize', target);
  expect(
    live.length,
    'nothing is observing that element — the observer was constructed but never pointed at it',
  ).toBeGreaterThan(0);
  act(() => {
    for (const observer of live) observer.callback([{ target }]);
  });
};

/**
 * SCROLL GEOMETRY, STUBBED PER ELEMENT, because the environment has no layout engine and measures
 * everything as zero. A scroll assertion read off the real numbers would compare 0 against 0 and
 * pass whatever the component did.
 *
 * `clientHeight` AND `offsetHeight` ARE GIVEN DIFFERENT VALUES ON PURPOSE. The hook is required to
 * read the client one, and a stub that made them equal could not tell the two apart — the
 * assertion about the resize clamp would pass against a hook reading either.
 */
const withGeometry = (
  el: HTMLElement,
  geometry: { scrollTop: number; scrollHeight: number; clientHeight: number },
) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, writable: true, value: geometry.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, writable: true, value: geometry.clientHeight });
  /* Deliberately WIDER than the client height — a border plus a horizontal scrollbar. A hook
     reading this instead believes there is more room than there is. */
  Object.defineProperty(el, 'offsetHeight', {
    configurable: true,
    writable: true,
    value: geometry.clientHeight + 20,
  });
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: geometry.scrollTop });
};

/**
 * ANIMATION FRAMES, DRIVEN BY HAND. The follow is a frame loop, so a test that cannot step frames
 * can only assert that nothing happened yet.
 */
const frames: { queue: Map<number, FrameRequestCallback>; next: number } = { queue: new Map(), next: 1 };

const stepFrames = (count = 1) => {
  for (let i = 0; i < count; i += 1) {
    const pending = [...frames.queue.entries()];
    frames.queue.clear();
    act(() => {
      for (const [, callback] of pending) callback(0);
    });
  }
};

/** How many frame callbacks are queued — the count the "at most one live loop" claim reads. */
const liveFrames = () => frames.queue.size;

const setReducedMotion = (reduce: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

beforeEach(() => {
  observers.intersection = [];
  observers.resize = [];
  vi.stubGlobal('IntersectionObserver', makeFake(observers.intersection));
  vi.stubGlobal('ResizeObserver', makeFake(observers.resize));
  frames.queue = new Map();
  frames.next = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const handle = frames.next++;
    frames.queue.set(handle, callback);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    frames.queue.delete(handle);
  });
  setReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const article = () => screen.getByRole('article');
const bubble = (root: HTMLElement) => root.querySelector('[data-group]') as HTMLElement;
const classesOf = (el: Element) => [...el.classList];
const paddingOf = (el: Element) => classesOf(el).filter((c) => /^p[xy]?-/.test(c));

describe('a message row announces itself', () => {
  /**
   * THE ACCESSIBLE NAME, and the FALLBACK is the half that matters. A transcript of unnamed
   * articles is a list of identical landmarks; a reader tabbing through them learns nothing about
   * who is speaking. Both halves are asserted because either alone passes over the other.
   */
  it('takes its accessible name from the name slot', () => {
    render(
      <ChatMessage sender="assistant" name="Temanai">
        <ChatMessageBubble>Halo</ChatMessageBubble>
      </ChatMessage>,
    );
    expect(screen.getByRole('article', { name: 'Temanai' })).toBeTruthy();
  });

  it('falls back to a sender-derived name when no name slot is given', () => {
    render(
      <ChatMessage sender="user">
        <ChatMessageBubble>Halo</ChatMessageBubble>
      </ChatMessage>,
    );
    expect(screen.getByRole('article', { name: 'user' })).toBeTruthy();
  });

  /**
   * THE MARKER THE SCROLL MACHINERY FINDS THE LAST MESSAGE BY.
   *
   * The transcript frame reads it to tell a NEW message arriving from the current one growing.
   * Remove it and the scroll-to-bottom pill and its new-message flag go permanently inert — the
   * frame renders, the transcript scrolls, and nothing anywhere fails. So it is asserted here
   * rather than trusted to the component that reads it.
   */
  it('carries the stable marker the transcript finds its last message by', () => {
    render(<ChatMessage sender="assistant">Halo</ChatMessage>);
    expect(article().hasAttribute(MESSAGE_MARKER)).toBe(true);
  });

  /**
   * `system` IS NOT A THIRD SPEAKER. Asserted with all three slots PASSED, because the failure
   * being guarded is a branch that forgets one of them — and a test that omits the props passes
   * over exactly that.
   */
  it('suppresses the avatar, the name and the metadata on a system message', () => {
    render(
      <ChatMessage
        sender="system"
        avatar={<span data-testid="face" />}
        name="Sistem"
        metadata={<span data-testid="meta" />}
      >
        <ChatMessageBubble>Percakapan dilanjutkan.</ChatMessageBubble>
      </ChatMessage>,
    );
    expect(screen.queryByTestId('face')).toBeNull();
    expect(screen.queryByTestId('meta')).toBeNull();
    expect(screen.queryByText('Sistem')).toBeNull();
  });

  /**
   * THE USER FLIP IS THE COLUMN'S ALIGNMENT, NOT A REORDERED CHILD LIST.
   *
   * Both halves are asserted and neither is sufficient alone: the alignment proves the turn draws
   * against the other edge, and the DOM order proves it did NOT get there by moving the speaker
   * after the words. A reordered implementation satisfies a screenshot and nothing else — a screen
   * reader on that version meets the message before it learns who said it.
   */
  it('aligns the user turn to the other edge with the speaker still announced first', () => {
    render(
      <ChatMessage sender="user" avatar={<span data-testid="face" />} name="Andi">
        <ChatMessageBubble>Halo</ChatMessageBubble>
      </ChatMessage>,
    );
    expect(classesOf(article())).toContain('items-end');
    expect(article().firstElementChild!.contains(screen.getByTestId('face'))).toBe(true);
  });

  /**
   * THE AUTHOR HEADER IS RENDERED ONLY WHEN SOMETHING FILLS IT, and the empty case is the common
   * one: neither shipped surface gives the user a face or a name. An unconditional header spaces
   * every nameless row one column gap differently from its neighbours, which looks like a
   * transcript with uneven rhythm rather than like a bug.
   */
  it('renders no author header when neither the avatar nor the name is filled', () => {
    const { container } = render(<ChatMessage sender="user">Halo</ChatMessage>);
    expect(container.querySelector('[class*="items-center"]')).toBeNull();
    cleanup();
    const named = render(<ChatMessage sender="assistant" name="Temanai">Halo</ChatMessage>);
    expect(named.container.querySelector('[class*="items-center"]')).toBeTruthy();
  });
});

describe('a bubble reads its sender from the row it sits in', () => {
  /**
   * THE STANDALONE DEFAULT. A bubble on a docs page or in a hand-built row still has to draw.
   *
   * ASSERTED ON THE REFLECTED SENDER, NOT ON THE CLASS LIST, and the first cut of this made
   * exactly that mistake: it compared a standalone bubble's classes against one inside an
   * assistant row, and the two turns hold the SAME fill today — so moving the standalone default
   * onto the user side changed nothing anyone could see and the assertion passed over it. An
   * assertion whose subject is invisible is not a weaker assertion, it is no assertion.
   */
  it('draws as the assistant side when it stands alone', () => {
    /* Read BEFORE the unmount: `cleanup()` detaches the tree, so an element captured after it is
       null and the assertion never runs. */
    const { container } = render(<ChatMessageBubble>Halo</ChatMessageBubble>);
    const alone = bubble(container);
    expect(alone.getAttribute('data-sender')).toBe('assistant');
    const aloneClasses = classesOf(alone);
    cleanup();
    const inRow = render(
      <ChatMessage sender="assistant">
        <ChatMessageBubble>Halo</ChatMessageBubble>
      </ChatMessage>,
    );
    expect(aloneClasses).toEqual(classesOf(bubble(inRow.container)));
    /* The premise: `assistant` is a real sender and not merely the first thing the table holds. */
    expect(contract.ChatMessage.axes.sender).toContain('assistant');
  });

  /** And inside a row it takes that row's sender rather than the standalone one. */
  it('takes the row\'s sender when it sits in one', () => {
    const { container } = render(
      <ChatMessage sender="user">
        <ChatMessageBubble>Halo</ChatMessageBubble>
      </ChatMessage>,
    );
    expect(bubble(container).getAttribute('data-sender')).toBe('user');
  });

  /**
   * GROUPED CORNERS TUCK TO OPPOSITE EDGES PER SENDER, asserted through the RENDERED bubble rather
   * than off the table — the table's own split is the purge guard's assertion, and this is the
   * half that proves the component picks the right one of the two.
   */
  it('tucks a grouped run toward the sender edge, and the other way for a user', () => {
    const drawn = (sender: 'assistant' | 'user', group: 'first' | 'middle' | 'last') => {
      cleanup();
      const { container } = render(
        <ChatMessage sender={sender}>
          <ChatMessageBubble group={group}>Halo</ChatMessageBubble>
        </ChatMessage>,
      );
      return classesOf(bubble(container)).filter((c) => c.startsWith('rounded-')).sort().join(' ');
    };
    const positions = ['first', 'middle', 'last'] as const;
    /* Each position tightens a DIFFERENT pair on one side… */
    const assistant = positions.map((p) => drawn('assistant', p));
    expect(new Set(assistant).size, 'two grouped positions draw the same corners').toBe(positions.length);
    /* …and the opposite pair on the other. A shared table satisfies the line above and makes a
       grouped user run read as the assistant's. */
    for (const position of positions) {
      expect(drawn('user', position), `both senders tuck the same way at ${position}`).not.toBe(
        drawn('assistant', position),
      );
    }
  });

  /**
   * THE WIDTH OVERRIDE CLEARS THE CAP. Both arms are asserted because the failure is a cap that
   * survives: the prop then appears inert on a wide viewport and functional on a narrow one, which
   * nobody attributes to this class table.
   */
  it('clears the width cap only when a width is set', () => {
    const { container } = render(<ChatMessageBubble width="full">Halo</ChatMessageBubble>);
    expect(classesOf(bubble(container))).toContain('max-w-none');
    cleanup();
    const capped = render(<ChatMessageBubble>Halo</ChatMessageBubble>);
    expect(classesOf(bubble(capped.container))).not.toContain('max-w-none');
    expect(classesOf(bubble(capped.container)).some((c) => c.startsWith('max-w-'))).toBe(true);
  });

  /**
   * THE GHOST IS AN ALIGNMENT MECHANISM, AND THIS IS THE ASSERTION THAT SAYS SO.
   *
   * The author header, a ghost bubble and the metadata slot all share the inline padding; a RAW
   * child of the same row shares none of it — that contrast is the whole claim, and asserting only
   * the first half would pass over a ghost that kept a padding nothing else has. The shared value
   * MOVES with the density, which is what proves they are reading one table rather than agreeing
   * by accident.
   *
   * THE REFERENCE IS THE METADATA SLOT, NOT THE NAME. It was the name until the speaker moved into
   * a header above the turn, where it sits flush with the message edge and carries no inset at all
   * — so the shared value became the empty intersection of two lists and the assertion could only
   * fail. The metadata slot is the one that still reads the inline table.
   */
  it('puts the author header, the ghost bubble and the metadata on one left edge', () => {
    const mount = (density: 'compact' | 'balanced') => {
      cleanup();
      const { container } = render(
        <ChatMessage sender="assistant" density={density} name="Temanai" metadata={<span>09:41</span>}>
          <ChatMessageBubble ghost>
            <span data-testid="art" />
          </ChatMessageBubble>
          <div data-testid="raw" />
        </ChatMessage>,
      );
      return {
        author: paddingOf(screen.getByText('Temanai').parentElement!),
        meta: paddingOf(screen.getByText('09:41').parentElement!),
        ghost: paddingOf(bubble(container)),
        raw: paddingOf(screen.getByTestId('raw')),
      };
    };

    const balanced = mount('balanced');
    const shared = balanced.meta.filter((c) => balanced.ghost.includes(c));
    expect(shared.length, 'the ghost bubble and the metadata slot share no padding').toBeGreaterThan(0);
    expect(shared).toContain(MESSAGE_INSET.balanced);
    /* AND THE AUTHOR HEADER IS ON THAT SAME EDGE. It shipped flush for one run, which put the
       face an inset to the left of the words beneath it — two left edges in one column, and a
       ghost bubble makes it plainest because its padding has no fill to explain it. */
    expect(balanced.author, 'the author header sits on a different left edge from the turn').toContain(
      MESSAGE_INSET.balanced,
    );
    expect(balanced.raw, 'a raw child is not flush with the row edge').toEqual([]);

    const compact = mount('compact');
    expect(compact.ghost, 'the shared inset does not move with the density').not.toEqual(balanced.ghost);
    expect(compact.meta.filter((c) => compact.ghost.includes(c))).toContain(MESSAGE_INSET.compact);
    expect(compact.author, 'the author header does not move with the density').toContain(
      MESSAGE_INSET.compact,
    );

    /* And the ghost dropped the BLOCK padding it exists to drop — otherwise the two tables could
       be one and every line above would still hold. */
    expect(balanced.ghost).not.toContain('py-ds-2xs');
  });

  /** Density flows through context rather than being restated per part. */
  it('flows the row density to a nested bubble', () => {
    const { container } = render(
      <ChatMessage sender="assistant" density="spacious">
        <ChatMessageBubble>Halo</ChatMessageBubble>
      </ChatMessage>,
    );
    expect(classesOf(bubble(container))).toContain(MESSAGE_INSET.spacious);
  });

  /**
   * AND IT REACHES THE SPACE BETWEEN THE PARTS, NOT ONLY THE PADDING INSIDE THEM.
   *
   * This is the assertion that was missing while the content gap was a constant. `density` moved
   * the bubble's padding and the list's row gap, so a story flipping the prop visibly changed and
   * the prop read as honoured — while the author header, the turn and the metadata stayed a fixed
   * distance apart at every setting. Two thirds of a prop.
   *
   * ASSERTED AS "THE THREE DIFFER" RATHER THAN AGAINST THE THREE VALUES, so it cannot be
   * satisfied by a table that happens to carry today's classes. A constant fails it whatever the
   * constant is, which is the shape of the failure it exists for.
   */
  it('moves the space between a message\'s own parts with the density', () => {
    const gapOf = (density: 'compact' | 'balanced' | 'spacious') => {
      cleanup();
      const { container } = render(
        <ChatMessage sender="assistant" density={density} name="Temanai" metadata={<span>09:41</span>}>
          <ChatMessageBubble>Halo</ChatMessageBubble>
        </ChatMessage>,
      );
      return classesOf(container.firstElementChild!).filter((c) => c.startsWith('gap-'));
    };

    const seen = (['compact', 'balanced', 'spacious'] as const).map(gapOf);
    for (const gap of seen) expect(gap, 'the row names no gap at all').toHaveLength(1);
    expect(
      new Set(seen.map((g) => g[0])).size,
      'two densities leave a message\'s parts the same distance apart',
    ).toBe(3);
  });
});

describe('the metadata row says only what it has', () => {
  /**
   * NOTHING IN, NOTHING OUT — a real branch, not a nicety. A caller mounts this under every row
   * and most rows have nothing to say, so an always-present element would add a gap to the
   * transcript's commonest state. Asserted against the CONTAINER being empty rather than against
   * a query missing, because an element rendered with no text also fails a text query.
   */
  it('renders nothing at all when every slot is empty', () => {
    const { container } = render(<ChatMessageMetadata />);
    expect(container.innerHTML).toBe('');
  });

  /**
   * EVERY STATUS IS REACHABLE BY ITS LABEL. Iterated off the CONTRACT rather than a list written
   * here: a value added to the axis with no drawing behind it would otherwise pass by never being
   * asked about.
   */
  it.each([...contract.ChatMessageMetadata.axes.status])(
    'makes the %s status findable by its accessible label',
    (status) => {
      const { container } = render(<ChatMessageMetadata status={status} />);
      const el = container.querySelector(`[data-status="${status}"]`)!;
      const label = el.getAttribute('aria-label');
      expect(label, `${status} has no accessible label`).toBeTruthy();
      expect(screen.getByLabelText(label!)).toBe(el);
      /* THE SAME WORD, THREE WAYS — visible text, hover title, and the accessible name lower-cased.
         That composition is the contract, and the lower-casing is the half a "cleanup" removes:
         the row is announced as one phrase, so a capitalised fragment inside it reads as a new
         sentence. */
      expect(el.getAttribute('title'), `${status} has no hover title`).toBeTruthy();
      expect(label).toBe(el.getAttribute('title')!.toLowerCase());
      expect(el.textContent).toContain(el.getAttribute('title'));
    },
  );

  /**
   * THE SEPARATOR IS EMITTED FROM THE GAP, NOT FROM A PIECE. Both arms are asserted: a dot
   * attached to the timestamp leaves a dangling mark on a row carrying only a time, which is most
   * rows — and that failure renders, reads as a styling choice, and breaks nothing.
   */
  it('separates only between two present pieces', () => {
    const dots = (ui: React.ReactElement) => {
      cleanup();
      const { container } = render(ui);
      return [...container.querySelectorAll('span')].filter((el) => el.textContent === '·').length;
    };
    expect(dots(<ChatMessageMetadata timestamp="09:41" />), 'a lone timestamp draws a dot').toBe(0);
    expect(dots(<ChatMessageMetadata status="sent" />), 'a lone status draws a dot').toBe(0);
    expect(dots(<ChatMessageMetadata timestamp="09:41" status="sent" />)).toBe(1);
    expect(dots(<ChatMessageMetadata timestamp="09:41" footer="Gemini" status="sent" />)).toBe(2);
  });

  /**
   * THE USER REVERSAL IS THE DIRECTION ALONE. Same rule as the row above it, and the same reason:
   * the authored order stays timestamp-first, so both sides of the transcript are announced as one
   * sentence. A reordering implementation looks identical and reads differently.
   */
  it('reverses under a user message without reordering what is announced', () => {
    const { container } = render(
      <ChatMessage sender="user">
        <ChatMessageBubble metadata={<ChatMessageMetadata timestamp="09:41" status="sent" />}>
          Halo
        </ChatMessageBubble>
      </ChatMessage>,
    );
    /* REACHED THROUGH THE STATUS, NOT THROUGH THE SENDER. A selector keyed on the sender and the
       direction class matches the ARTICLE too — it carries both — so the first cut of this
       assertion was measuring the row's own reversal and passed while the metadata underneath it
       had stopped reading its sender entirely. */
    const row = container.querySelector('[data-status="sent"]')!.parentElement!;
    expect(row.getAttribute('data-sender'), 'the metadata row is not the element found').toBe('user');
    expect(classesOf(row), 'the metadata row does not reverse under a user message').toContain(
      'flex-row-reverse',
    );
    expect(row.textContent!.indexOf('09:41')).toBeLessThan(row.textContent!.indexOf('Terkirim'));
  });

  /**
   * ONE STATUS MOVES AND FOUR DO NOT, and the four are the half that matters: a reduced-motion
   * variant sprayed across every status would satisfy a "the moving one stops" check while telling
   * a reader that four still states are animations.
   */
  it('carries the reduced-motion variant on the moving status and on no other', () => {
    const moving = (status: 'sending' | 'sent' | 'delivered' | 'read' | 'error') => {
      cleanup();
      const { container } = render(<ChatMessageMetadata status={status} />);
      return [...container.querySelector(`[data-status="${status}"]`)!.classList];
    };
    expect(moving('sending')).toContain('motion-reduce:animate-none');
    for (const status of ['sent', 'delivered', 'read', 'error'] as const) {
      expect(
        moving(status).some((c) => c.startsWith('motion-reduce:')),
        `${status} is still, but claims a reduced-motion treatment`,
      ).toBe(false);
    }
  });

  /** A host's own attributes reach the root, so a surface can address the row it rendered. */
  it('passes an id and a data attribute through to its root', () => {
    const { container } = render(
      <ChatMessageMetadata id="meta-1" data-testid="row" timestamp="09:41" />,
    );
    expect(container.firstElementChild!.id).toBe('meta-1');
    expect(container.firstElementChild!.getAttribute('data-testid')).toBe('row');
  });
});

describe('the transcript log region announces, spaces and aligns', () => {
  const region = () => screen.getByRole('log');
  const inner = () => region().firstElementChild as HTMLElement;

  /**
   * THE BUSY STATE IS ABSENT RATHER THAN FALSE, and the absent case is the assertion that matters.
   * `aria-busy={streaming}` renders the string "false" on every settled turn — a claim rather
   * than a silence — and a test that only checked the streaming case would call that correct.
   */
  it('announces busy only while a reply is arriving', () => {
    render(<ChatMessageList label="Percakapan">{null}</ChatMessageList>);
    expect(region().hasAttribute('aria-busy'), 'a settled region claims a busy state').toBe(false);
    cleanup();
    render(
      <ChatMessageList label="Percakapan" streaming>
        {null}
      </ChatMessageList>,
    );
    expect(region().getAttribute('aria-busy')).toBe('true');
  });

  it('announces politely and takes a name', () => {
    render(<ChatMessageList label="Percakapan">{null}</ChatMessageList>);
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('log', { name: 'Percakapan' })).toBeTruthy();
  });

  it('shows the empty state only when it holds nothing', () => {
    render(<ChatMessageList emptyState={<span>Belum ada percakapan</span>}>{[]}</ChatMessageList>);
    expect(screen.getByText('Belum ada percakapan')).toBeTruthy();
    cleanup();
    render(
      <ChatMessageList emptyState={<span>Belum ada percakapan</span>}>
        <ChatMessage sender="assistant">Halo</ChatMessage>
      </ChatMessageList>,
    );
    expect(screen.queryByText('Belum ada percakapan')).toBeNull();
  });

  /**
   * ONE SPACER AT THE BOTTOM ALIGNMENT AND NONE AT THE TOP, counted with NO load-older action set
   * so the sentinel — the other zero-ink element in there — cannot be mistaken for it.
   */
  it('seats a short conversation with exactly one spacer, and only at the bottom alignment', () => {
    const spacers = (align: 'top' | 'bottom') => {
      cleanup();
      const { container } = render(
        <ChatMessageList align={align}>
          <ChatMessage sender="assistant">Halo</ChatMessage>
        </ChatMessageList>,
      );
      return container.querySelectorAll('[data-spacer]').length;
    };
    expect(spacers('bottom')).toBe(1);
    expect(spacers('top')).toBe(0);
  });

  /**
   * THE GAP OVERRIDE LEAVES THE PADDING WHERE THE DENSITY PUT IT. Both halves are asserted: the
   * padding staying put is the claim, and the gap actually changing is what makes the first half
   * mean something.
   */
  it('changes the gap and keeps the density padding', () => {
    const spacing = (props: { density?: 'compact' | 'spacious'; gap?: 'none' | 'lg' }) => {
      cleanup();
      render(
        <ChatMessageList {...props}>
          <ChatMessage sender="assistant">Halo</ChatMessage>
        </ChatMessageList>,
      );
      const classes = [...inner().classList];
      return {
        pad: classes.filter((c) => /^p-/.test(c)),
        gap: classes.filter((c) => /^gap-/.test(c)),
      };
    };
    const plain = spacing({ density: 'spacious' });
    const overridden = spacing({ density: 'spacious', gap: 'none' });
    expect(overridden.pad, 'the gap override moved the density padding').toEqual(plain.pad);
    expect(overridden.gap, 'the gap override changed nothing').not.toEqual(plain.gap);
    /* EXACTLY ONE GAP SURVIVES. Two would both ship — the class merger cannot see the named rungs
       as a conflict — and the emitted stylesheet's order, not this component, would decide. */
    expect(overridden.gap.length, 'two gaps are on the element at once').toBe(1);
  });

  it('reflects the density and flows it to a nested bubble', () => {
    const { container } = render(
      <ChatMessageList density="compact">
        <ChatMessage sender="assistant">
          <ChatMessageBubble>Halo</ChatMessageBubble>
        </ChatMessage>
      </ChatMessageList>,
    );
    expect(region().getAttribute('data-density')).toBe('compact');
    expect([...bubble(container).classList]).toContain(MESSAGE_INSET.compact);
  });

  /**
   * THE LOAD-OLDER ACTION, WHICH ONLY AN OBSERVER FAKE CAN REACH AT ALL. The environment's own
   * observer never calls its callback, so without the harness above this component would render
   * correctly, do nothing, and pass every markup assertion in this file.
   */
  it('loads older messages when the sentinel comes into view, and shows it is working', async () => {
    let settle = () => {};
    const action = vi.fn(() => new Promise<void>((resolve) => {
      settle = resolve;
    }));
    const { container } = render(
      <ChatMessageList scrollToTopAction={action}>
        <ChatMessage sender="assistant">Halo</ChatMessage>
      </ChatMessageList>,
    );
    const sentinel = container.querySelector('[data-sentinel]')!;
    expect(container.querySelector('[data-pending]'), 'the pending row shows before anything fires').toBeNull();

    fireIntersection(sentinel);
    expect(action).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-pending]'), 'nothing shows while the action is unresolved').toBeTruthy();

    await act(async () => {
      settle();
    });
    expect(container.querySelector('[data-pending]')).toBeNull();
  });

  /**
   * AND IT FIRES ONCE PER ARRIVAL, NOT ONCE PER INTERSECTION.
   *
   * The pending row renders BELOW the sentinel, so showing it pushes content down without
   * un-intersecting the sentinel — a real browser fires again while the first call is still
   * unresolved, and a host that appends per call loads the same page twice. Nothing about that is
   * visible in the markup, which is why it is asserted here.
   */
  it('does not fire again while the previous load is still unresolved', () => {
    const action = vi.fn(() => new Promise<void>(() => {}));
    const { container } = render(
      <ChatMessageList scrollToTopAction={action}>
        <ChatMessage sender="assistant">Halo</ChatMessage>
      </ChatMessageList>,
    );
    const sentinel = container.querySelector('[data-sentinel]')!;
    fireIntersection(sentinel);
    fireIntersection(sentinel);
    fireIntersection(sentinel);
    expect(action).toHaveBeenCalledTimes(1);
  });

  /**
   * AND ONCE PER ARRIVAL EVEN WHEN THE HOST PASSES A NEW CALLBACK EVERY RENDER.
   *
   * This is the assertion the first version of the in-flight guard passed and should not have.
   * The flag was a local inside the observer effect, so it was as short-lived as the effect — and
   * an inline callback, which is the natural way for a host to write one, changes identity on
   * every render. The effect re-ran, built a fresh observer and reset the flag; a newly observed
   * target that is still intersecting fires immediately, and the action ran twice. A test that
   * passes a stable mock cannot see any of that, which is exactly why this one does not.
   */
  it('fires once when the host passes a new callback on every render', () => {
    const calls: number[] = [];
    function Host() {
      const [, bump] = React.useState(0);
      return (
        <ChatMessageList
          scrollToTopAction={() => {
            calls.push(1);
            bump((n) => n + 1);
            return new Promise<void>(() => {});
          }}
        >
          <ChatMessage sender="assistant">Halo</ChatMessage>
        </ChatMessageList>
      );
    }
    const { container } = render(<Host />);
    const sentinel = container.querySelector('[data-sentinel]')!;
    fireIntersection(sentinel);
    fireIntersection(sentinel);
    expect(calls.length, 'an inline callback let the same page load twice').toBe(1);
    /* And the observer was built ONCE. Depending on the callback's identity rebuilt it on every
       render, which is the same defect read as waste rather than as a double load. */
    expect(observers.intersection.length, 'the observer is rebuilt on every render').toBe(1);
  });

  /**
   * A HOST FAILURE MUST NOT LATCH THE GUARD.
   *
   * The call used to sit in `Promise.resolve`'s ARGUMENT position, so a synchronous throw escaped
   * before `.finally` was attached: the flag and the spinner stayed set for the component's life
   * and load-older was dead until unmount. Asserted through a SECOND arrival, because "the spinner
   * cleared" alone would pass over a flag that never reset.
   */
  it('recovers when the host action throws synchronously', async () => {
    let calls = 0;
    const { container } = render(
      <ChatMessageList
        scrollToTopAction={() => {
          calls += 1;
          throw new Error('the host blew up');
        }}
      >
        <ChatMessage sender="assistant">Halo</ChatMessage>
      </ChatMessageList>,
    );
    const sentinel = container.querySelector('[data-sentinel]')!;

    fireIntersection(sentinel);
    await act(async () => {});
    expect(calls).toBe(1);
    expect(container.querySelector('[data-pending]'), 'the spinner latched on a host throw').toBeNull();

    fireIntersection(sentinel);
    await act(async () => {});
    expect(calls, 'the in-flight guard latched, so load-older is dead').toBe(2);
  });

  /** Same for a rejected promise, which took the cleanup path but left the rejection unhandled. */
  it('recovers when the host action rejects', async () => {
    let calls = 0;
    const { container } = render(
      <ChatMessageList
        scrollToTopAction={() => {
          calls += 1;
          return Promise.reject(new Error('the host blew up'));
        }}
      >
        <ChatMessage sender="assistant">Halo</ChatMessage>
      </ChatMessageList>,
    );
    const sentinel = container.querySelector('[data-sentinel]')!;

    fireIntersection(sentinel);
    await act(async () => {});
    expect(container.querySelector('[data-pending]')).toBeNull();
    fireIntersection(sentinel);
    await act(async () => {});
    expect(calls).toBe(2);
  });

  /**
   * DROPPING THE ACTION MID-FLIGHT CLEARS THE SPINNER.
   *
   * Dropping `scrollToTopAction` is how a host says "no older pages left". Doing it while a load
   * was unresolved used to strand the pending row forever: the settling promise saw the effect's
   * cancelled flag and skipped the reset, while the row's own render is gated on that state alone.
   */
  it('clears the pending row when the host withdraws the action mid-flight', () => {
    const action = () => new Promise<void>(() => {});
    const view = render(
      <ChatMessageList scrollToTopAction={action}>
        <ChatMessage sender="assistant">Halo</ChatMessage>
      </ChatMessageList>,
    );
    fireIntersection(view.container.querySelector('[data-sentinel]')!);
    expect(view.container.querySelector('[data-pending]')).toBeTruthy();

    view.rerender(
      <ChatMessageList>
        <ChatMessage sender="assistant">Halo</ChatMessage>
      </ChatMessageList>,
    );
    expect(
      view.container.querySelector('[data-pending]'),
      'the pending row outlived the action that raised it',
    ).toBeNull();
  });

  /** No action, no sentinel — a list that cannot load older messages grows no observer target. */
  it('renders no sentinel when there is nothing to load', () => {
    const { container } = render(
      <ChatMessageList>
        <ChatMessage sender="assistant">Halo</ChatMessage>
      </ChatMessageList>,
    );
    expect(container.querySelector('[data-sentinel]')).toBeNull();
  });
});

describe('the transcript follows a streaming reply, and lets go when the reader does', () => {
  /**
   * The whole seam under test, assembled by hand rather than through the frame: this unit ships
   * before the frame does, and wiring it here keeps the hook's own failures attributable to the
   * hook.
   */
  const mount = (geometry = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }, followResize = false) => {
    const scroller = document.createElement('div');
    const content = document.createElement('div');
    scroller.appendChild(content);
    document.body.appendChild(scroller);
    withGeometry(scroller, geometry);
    /* THE ELEMENT, NOT A REF WRAPPER. The hook took a `RefObject` for one run, and this harness
       handing it `{ current: scroller }` was part of why the defect was invisible: the wrapper was
       populated before the hook ever ran, which is the one case a ref gets right. */
    const view = renderHook(({ container }: { container: HTMLElement | null }) =>
      useChatStreamScroll({ container, content, followResize }),
    { initialProps: { container: scroller as HTMLElement | null } });
    return { scroller, content, ...view };
  };

  /** Append a message row carrying the marker the scroll owner finds the last one by. */
  const appendMessage = (content: HTMLElement) => {
    const article = document.createElement('article');
    article.setAttribute(MESSAGE_MARKER, '');
    content.appendChild(article);
    return article;
  };

  const scrollTo = (scroller: HTMLElement, top: number) => {
    scroller.scrollTop = top;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
  };

  /**
   * THE FIRST FILL JUMPS IN ONE FRAME. Springing from the top of a restored conversation is a
   * scroll animation nobody asked for, and it is long: a thousand pixels at a fifth of the
   * remaining distance per frame takes dozens.
   */
  it('jumps to the bottom on the first fill rather than springing from the top', () => {
    const { scroller, content } = mount();
    appendMessage(content);
    fireResize(content);
    expect(scroller.scrollTop, 'the first fill did not land at the bottom in one step').toBe(600);
    expect(liveFrames(), 'the first fill started an animation').toBe(0);
  });

  /**
   * THE ONE-SHOT SURVIVES A MOUNT WITH NOTHING TO SCROLL.
   *
   * The observer delivers an initial observation, and the content element is never zero-height
   * even when empty — density padding plus the alignment spacer. So an unconditional spend burned
   * the jump at mount and the real first fill then SPRANG from the top, on the commonest mount
   * order there is: an empty transcript that loads its history.
   */
  it('keeps the first-fill jump when it mounts before its history', () => {
    const { scroller, content } = mount({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 });
    appendMessage(content);
    fireResize(content);
    expect(scroller.scrollTop, 'there was nowhere to scroll yet').toBe(0);

    scroller.scrollHeight = 1000;
    appendMessage(content);
    fireResize(content);
    expect(scroller.scrollTop, 'the real first fill sprang instead of jumping').toBe(600);
    expect(liveFrames(), 'the real first fill started an animation').toBe(0);
  });

  /**
   * AN INSTANT JUMP CANCELS A RUNNING SPRING. The unconditional cancel at the top of the shared
   * entry point is what makes this true, and nothing exercised the instant-over-spring direction
   * before — only spring over spring.
   */
  it('cancels a running spring when an instant jump arrives', () => {
    const { scroller, content } = mount();
    appendMessage(content);
    fireResize(content);

    scroller.scrollHeight = 4000;
    appendMessage(content);
    fireResize(content);
    stepFrames();
    expect(liveFrames(), 'no spring is running, so there is nothing to cancel').toBe(1);

    setReducedMotion(true);
    scroller.scrollHeight = 5000;
    fireResize(content);
    expect(scroller.scrollTop, 'the instant jump did not land').toBe(4600);
    expect(liveFrames(), 'the spring survived an instant jump').toBe(0);
  });

  it('follows later growth rather than jumping', () => {
    const { scroller, content } = mount();
    appendMessage(content);
    fireResize(content);

    scroller.scrollHeight = 2000;
    appendMessage(content);
    fireResize(content);
    expect(scroller.scrollTop, 'later growth jumped instead of following').toBe(600);
    stepFrames();
    expect(scroller.scrollTop, 'the follow did not move').toBeGreaterThan(600);
    expect(scroller.scrollTop, 'the follow arrived in one frame, which is a jump').toBeLessThan(1600);
  });

  /**
   * THE SCROLLER SHRINKING (an on-screen keyboard under a sheet): a reader at the bottom is re-pinned, so the newest
   * message is not left below the new, shorter edge; a reader who scrolled up does not move; the observer is released.
   */
  describe('when the scroller itself is resized (followResize on)', () => {
    it('re-pins a reader who was at the bottom when it shrinks', () => {
      const { scroller, content } = mount(undefined, true);
      appendMessage(content);
      fireResize(content);
      expect(scroller.scrollTop).toBe(600);
      scroller.clientHeight = 100;
      fireResize(scroller);
      expect(scroller.scrollTop, 'the newest message was left below the shrunk edge').toBe(900);
    });

    it('leaves a reader who had scrolled up where they are', () => {
      const { scroller, content, result } = mount(undefined, true);
      appendMessage(content);
      fireResize(content);
      scrollTo(scroller, 200);
      expect(result.current.isScrolledUp).toBe(true);
      scroller.clientHeight = 100;
      fireResize(scroller);
      expect(scroller.scrollTop, 'a reader who moved away was dragged to the bottom').toBe(200);
    });

    it('measures the reader against the height BEFORE the resize (a shrink alone does not make them "away")', () => {
      const { scroller, content } = mount(undefined, true);
      appendMessage(content);
      fireResize(content);
      // The reader was 50px up before the shrink: not at the bottom, so not re-pinned.
      scroller.scrollTop = 550;
      scroller.clientHeight = 100;
      fireResize(scroller);
      expect(scroller.scrollTop).toBe(550);
    });

    it('stops observing the scroller on unmount', () => {
      const { scroller, content, unmount } = mount(undefined, true);
      appendMessage(content);
      expect(observing('resize', scroller).length).toBeGreaterThan(0);
      unmount();
      expect(observing('resize', scroller), 'the scroller observer outlived the hook').toHaveLength(0);
    });
  });

  it('with followResize off (the default) no observer watches the scroller and a shrink moves nothing', () => {
    const { scroller, content } = mount();
    appendMessage(content);
    fireResize(content);
    expect(scroller.scrollTop).toBe(600);
    expect(observing('resize', scroller), 'an observer watches the scroller although the flag is off').toHaveLength(0);
    scroller.clientHeight = 100;
    act(() => {
      for (const o of observers.resize.filter((x) => !x.disconnected)) o.callback([{ target: scroller }]);
    });
    expect(scroller.scrollTop, 'a shrink moved a surface that did not opt in').toBe(600);
  });

  /** The release itself: the reader moves away, the transcript stops following. */
  it('releases the lock on a scroll away from the bottom', () => {
    const { scroller, content, result } = mount();
    appendMessage(content);
    fireResize(content);
    expect(result.current.isScrolledUp).toBe(false);

    scrollTo(scroller, 200);
    expect(result.current.isScrolledUp, 'scrolling away did not release the lock').toBe(true);
  });

  /**
   * THE ARM THAT MUST NOT RELEASE, AND IT ONLY EXISTS BECAUSE A CLAMP MOVES THE POSITION DOWN.
   *
   * This assertion was written twice. The first version scrolled to the bottom and expected no
   * release — which no branch can fail, because the position never DECREASED and the comparison
   * never ran at all. The injection that deletes the landed-at-the-bottom arm came back green
   * over it.
   *
   * The real case is a clamp: the viewport grows, the maximum scroll offset shrinks below where
   * the reader is, and the browser moves them down to it. That arrives as an ordinary scroll event
   * at a LOWER offset with the element still at its end — and without the arm it reads as the
   * reader deliberately moving up, so the follow stops mid-reply.
   */
  it('does not release when a clamp moves the position down while still at the bottom', () => {
    const { scroller, content, result } = mount();
    appendMessage(content);
    fireResize(content);
    expect(scroller.scrollTop).toBe(600);

    scroller.clientHeight = 600;
    scroller.offsetHeight = 620;
    scrollTo(scroller, 400);
    expect(result.current.isScrolledUp, 'a clamp was read as the reader moving away').toBe(false);
  });

  /**
   * THE FRAME THAT OUTRUNS THE READER — the property the hook's own write-recording exists for,
   * and the one a "simplify" removes first because the line looks redundant.
   *
   * A reader scrolls up mid-follow. The next follow frame then moves the scroller DOWN past where
   * they left it. If the comparison reads a position the hook never updated, the reader's move
   * looks like an increase and the release never fires.
   */
  it('still releases when the next follow frame outruns the reader', () => {
    const { scroller, content, result } = mount();
    appendMessage(content);
    fireResize(content);

    scroller.scrollHeight = 4000;
    appendMessage(content);
    fireResize(content);
    stepFrames();
    const followed = scroller.scrollTop;
    expect(followed, 'the follow never moved, so there is nothing to outrun').toBeGreaterThan(600);

    scrollTo(scroller, followed - 100);
    expect(result.current.isScrolledUp, 'a reader scroll mid-follow went undetected').toBe(true);

    /**
     * AND THE FOLLOW STOPS, which is the half this assertion was missing.
     *
     * It checked the flag and stopped with a frame still queued, so it passed while the live loop
     * carried on dragging the reader to the bottom — the pill appearing to say "you are away"
     * while the transcript scrolled away from them. Stepping frames after the release is the only
     * way to see it. Measured against the old code: 1100 -> 2780 over five frames.
     */
    const held = scroller.scrollTop;
    stepFrames(5);
    expect(scroller.scrollTop, 'the follow kept running after the reader was released').toBe(held);
  });

  /**
   * THE CLIENT HEIGHT, AND WHICH WAY READING THE OFFSET ONE ACTUALLY FAILS.
   *
   * The offset height includes the border and a horizontal scrollbar, so it is LARGER — which
   * makes the bottom test more generous, not less. The failure is therefore not a false release
   * but a missed one: a reader nudging up by less than the border-plus-scrollbar allowance is
   * still "at the bottom" as far as the hook can tell, so the follow keeps dragging them back
   * down. A small deliberate move is exactly the one a reader makes to re-read the line above.
   *
   * Asserted with a move SMALLER than that allowance, which is the only size that tells the two
   * properties apart. The harness gives them different values for this reason.
   */
  it('detects a small move away that the offset height would hide', () => {
    const { scroller, content, result } = mount();
    appendMessage(content);
    fireResize(content);
    expect(scroller.scrollTop).toBe(600);

    /* 15px up: past the bottom threshold, inside the offset height's extra 20. */
    scrollTo(scroller, 585);
    expect(result.current.isScrolledUp, 'a small deliberate move up went undetected').toBe(true);
  });

  /**
   * RE-ENGAGE WITHOUT `scrollend`, WHICH IS THE POINT.
   *
   * This rode a hand-dispatched `scrollend` for one run, and that event is the one WebKit did not
   * ship until Safari 18.2 — so on anything older `engage()` had no non-manual caller and a reader
   * who came back never resumed following, while this test passed because the harness supplied the
   * platform behaviour the browser would not. It now dispatches only `scroll`, and asserts no
   * `scrollend` listener is relied on by never firing one.
   */
  it('re-engages from position alone, with no scrollend event', () => {
    const { scroller, content, result } = mount();
    appendMessage(content);
    fireResize(content);
    scrollTo(scroller, 200);
    expect(result.current.isScrolledUp).toBe(true);

    scrollTo(scroller, 590);
    expect(result.current.isScrolledUp, 'coming back to the bottom did not resume following').toBe(
      false,
    );
  });

  /**
   * A MOVE AWAY WINS OVER THE PROXIMITY TEST, AND ONLY ONE SCENARIO CAN SHOW IT.
   *
   * This assertion was written twice. The first version scrolled away from the bottom while the
   * lock was still ENGAGED — where the proximity branch's own `!locked.current` guard stops it
   * regardless of order, so swapping the two branches changed nothing and the injection came back
   * green. The order decides exactly one case: the reader is ALREADY released and nudges further
   * away while still inside the re-lock threshold. Proximity-first re-engages there and drags them
   * back; release-first leaves them where they are.
   */
  it('does not re-engage on a further move away inside the re-lock threshold', () => {
    const { scroller, content, result } = mount();
    appendMessage(content);
    fireResize(content);

    /* Release, landing just inside the threshold (distance 10 of 32). */
    scrollTo(scroller, 590);
    expect(result.current.isScrolledUp, 'the first move did not release').toBe(true);

    /* Nudge further away, still inside the threshold (distance 15). */
    scrollTo(scroller, 585);
    expect(result.current.isScrolledUp, 'moving further away was read as a return').toBe(true);
  });

  /**
   * THE NEW-MESSAGE FLAG IS RAISED BY A NEW MESSAGE, not by the height moving. A streaming reply
   * grows continuously, so a height-keyed flag announces a new message on every token while the
   * reader is reading something else.
   */
  it('holds position while released, and flags only an actual new message', () => {
    const { scroller, content, result } = mount();
    const first = appendMessage(content);
    fireResize(content);
    scrollTo(scroller, 200);

    scroller.scrollHeight = 1400;
    first.textContent = 'the same message, longer';
    fireResize(content);
    expect(scroller.scrollTop, 'growth while released moved the reader').toBe(200);
    expect(result.current.hasNewMessages, 'the current message growing was announced as a new one').toBe(
      false,
    );

    appendMessage(content);
    fireResize(content);
    expect(result.current.hasNewMessages, 'a new message arrived unannounced').toBe(true);
  });

  it('returns to the bottom and clears the flag when asked', () => {
    const { scroller, content, result } = mount();
    appendMessage(content);
    fireResize(content);
    scrollTo(scroller, 200);
    appendMessage(content);
    fireResize(content);
    expect(result.current.hasNewMessages).toBe(true);

    act(() => {
      result.current.scrollToBottom();
    });
    expect(result.current.hasNewMessages).toBe(false);
    expect(result.current.isScrolledUp).toBe(false);
    stepFrames(60);
    expect(scroller.scrollTop).toBe(600);
  });

  /**
   * REDUCED MOTION SUBSTITUTES AN INSTANT JUMP ON EVERY ENTRY POINT — including the GROWTH path,
   * which is the one that gets forgotten. It is the only caller that is not a user action, so it
   * is the only one nobody thinks to try with motion turned off.
   */
  it('jumps instantly on every path when the reader has asked for reduced motion', () => {
    setReducedMotion(true);
    const { scroller, content, result } = mount();
    appendMessage(content);
    fireResize(content);

    scroller.scrollHeight = 2000;
    appendMessage(content);
    fireResize(content);
    expect(scroller.scrollTop, 'the growth path still animated under reduced motion').toBe(1600);
    expect(liveFrames(), 'the growth path queued a frame under reduced motion').toBe(0);

    scrollTo(scroller, 200);
    act(() => {
      result.current.scrollToBottom();
    });
    expect(scroller.scrollTop, 'the pill still animated under reduced motion').toBe(1600);
    expect(liveFrames(), 'the pill queued a frame under reduced motion').toBe(0);
  });

  /**
   * AT MOST ONE LIVE LOOP. A second loop started over a running one does not replace it — both
   * assign the scroll position every frame, and the older one wins on the next tick, so the newer
   * intent appears to do nothing at all.
   */
  it('leaves at most one live animation loop, whatever arrives while one is running', () => {
    const { scroller, content } = mount();
    appendMessage(content);
    fireResize(content);

    scroller.scrollHeight = 4000;
    appendMessage(content);
    fireResize(content);
    expect(liveFrames()).toBe(1);
    fireResize(content);
    fireResize(content);
    expect(liveFrames(), 'a second follow loop is running over the first').toBe(1);
  });

  /**
   * THE ANCHORING SUPPRESSION IS AN ATTRIBUTE, AND THE ELEMENT'S OWN PROPERTY IS NEVER TOUCHED.
   * Writing it would mean owning a value the consumer may have set, and "restoring" it later
   * restores whatever this code happened to read — which is not the same as leaving it alone.
   */
  it('suppresses anchoring by attribute while following, and never writes the property', () => {
    const { scroller, content } = mount();
    appendMessage(content);
    fireResize(content);
    expect(scroller.hasAttribute('data-chat-stream-scroll')).toBe(true);
    expect(scroller.style.overflowAnchor, 'the element\'s own anchoring property was written').toBe('');

    scrollTo(scroller, 200);
    expect(scroller.hasAttribute('data-chat-stream-scroll'), 'anchoring stayed suppressed after release').toBe(
      false,
    );
    expect(scroller.style.overflowAnchor).toBe('');
  });

  /**
   * AND IT IS HANDED BACK ON UNMOUNT. The scroller is the frame's own element today, so it leaves
   * with the attribute either way — but a host that passes a ref to an element it owns and outlives
   * would keep the suppression forever, and nothing asserted the cleanup existed.
   */
  it('hands anchoring back when the hook unmounts', () => {
    const { scroller, content, unmount } = mount();
    appendMessage(content);
    fireResize(content);
    expect(scroller.hasAttribute('data-chat-stream-scroll')).toBe(true);

    unmount();
    expect(
      scroller.hasAttribute('data-chat-stream-scroll'),
      'the suppression outlived the hook that set it',
    ).toBe(false);
  });

  /**
   * AND IT STOPS A SPRING THAT IS STILL RUNNING, which nothing measured.
   *
   * Review found this by deleting the unmount cancel and watching the whole suite stay green: no
   * scenario unmounted with a QUEUED frame. The one that unmounts does so after an instant first
   * fill, where there is nothing live to cancel — so the assertion was about an empty queue either
   * way. In the frame the ref is nulled on unmount and the loop's own null arm covers for it after
   * one more frame, which is exactly why the gap was invisible: the leak needs a host that keeps
   * the element, and the frame is not one.
   *
   * The anti-vacuity line matters as much as the assertion: without proving a frame was live
   * BEFORE the unmount, an empty queue afterwards proves nothing.
   */
  /**
   * A CONTENT SHRINK RESUMES FOLLOWING FOR A READER WHO NEVER MOVED, ON PURPOSE.
   *
   * A streaming placeholder replaced by a shorter message clamps the position down, which arrives
   * as a move away that LANDED at the bottom: the release arm refuses it and the proximity arm
   * re-engages. Review flagged it as undocumented and untested, which is the real problem with it
   * — the behaviour is defensible (they are at the bottom now, and it mirrors the resize clamp the
   * release already ignores) but an unpinned deliberate choice reads as an accident to whoever
   * meets it next, and a later "fix" would look like a tidy-up.
   */
  it('resumes following when the content shrinks the reader to the bottom', () => {
    const { scroller, content, result } = mount();
    appendMessage(content);
    fireResize(content);

    scrollTo(scroller, 400);
    expect(result.current.isScrolledUp, 'the move away did not release').toBe(true);

    /* The reply lands shorter than its placeholder: the scroller shrinks and the browser clamps
       the position to the new maximum, which is now where the reader already is. */
    withGeometry(scroller, { scrollTop: 400, scrollHeight: 800, clientHeight: 400 });
    scrollTo(scroller, 400);
    expect(
      result.current.isScrolledUp,
      'a shrink that left the reader at the bottom did not resume following',
    ).toBe(false);
  });

  /**
   * A NEW CONVERSATION JUMPS RATHER THAN SPRINGING THROUGH THE ONE BEFORE IT.
   *
   * The one-shot and the last-message reference are per-mount, so a host that swaps its children
   * without remounting used to re-enter the GROWTH path: the new transcript animated from wherever
   * the old one sat. `resetKey` restores the mount state, and both halves are asserted — the jump
   * is instant (no live frame) and the lock is re-engaged, because carrying a released state over
   * would open a brand-new conversation scrolled up behind a pill.
   */
  it('treats a reset key change as a fresh conversation', () => {
    const scroller = document.createElement('div');
    const content = document.createElement('div');
    scroller.appendChild(content);
    document.body.appendChild(scroller);
    withGeometry(scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });

    const { result, rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) => useChatStreamScroll({ container: scroller, content, resetKey }),
      { initialProps: { resetKey: 'session-a' } },
    );
    appendMessage(content);
    fireResize(content);
    /* Spend the one-shot and release, which is the state a reader leaves a conversation in. */
    appendMessage(content);
    fireResize(content);
    scrollTo(scroller, 200);
    expect(result.current.isScrolledUp, 'the reader never released on the old conversation').toBe(true);

    rerender({ resetKey: 'session-b' });
    expect(result.current.isScrolledUp, 'a new conversation opened scrolled up').toBe(false);
    expect(liveFrames(), 'a stale spring survived the switch').toBe(0);

    appendMessage(content);
    fireResize(content);
    expect(liveFrames(), 'the new conversation sprang through its history instead of jumping').toBe(0);
  });

  it('cancels a running spring when the hook unmounts', () => {
    const { content, unmount } = mount();
    appendMessage(content);
    fireResize(content);
    /* Spend the one-shot, then grow again so the second change springs rather than jumping. */
    appendMessage(content);
    fireResize(content);
    expect(liveFrames(), 'no spring was running, so the unmount has nothing to cancel').toBe(1);

    unmount();
    expect(liveFrames(), 'the spring outlived the hook that started it').toBe(0);
  });

  /**
   * A SCROLLER THAT ARRIVES AFTER THE FIRST COMMIT IS STILL WIRED.
   *
   * The hook took a `RefObject` for one run, and both effects early-return on a null scroller.
   * A ref object's identity never changes, so nothing re-ran when the element was filled in later
   * — a host rendering its scroller behind a loading branch, a `Suspense` boundary or a collapsed
   * panel got a hook that wired NOTHING: the follow never released, the pill never appeared, the
   * reader was pinned to the bottom for the component's life, and nothing threw.
   *
   * ASSERTED ON A RELEASE, NOT ON THE ATTRIBUTE. The attribute is written by the effect whose
   * absence is the bug, so reading it back is reading the same effect twice. A release proves the
   * SCROLL LISTENER was installed — the behaviour the host actually lost. Under the ref version
   * the listener is never installed at all, so no gesture can release.
   */
  it('wires a scroller that only appears after the first render', () => {
    const scroller = document.createElement('div');
    const content = document.createElement('div');
    scroller.appendChild(content);
    document.body.appendChild(scroller);
    withGeometry(scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });

    /* Mounted with NOTHING, which is the state a host renders in behind a loading branch. */
    const { result, rerender } = renderHook(
      ({ container }: { container: HTMLElement | null }) => useChatStreamScroll({ container, content }),
      { initialProps: { container: null as HTMLElement | null } },
    );
    expect(result.current.isScrolledUp, 'a hook with no scroller started out released').toBe(false);

    rerender({ container: scroller });
    /* Land at the bottom first so the hook's own position reference is current, then move away —
       the ordinary gesture, which the unwired version cannot see. */
    scrollTo(scroller, 600);
    scrollTo(scroller, 500);
    expect(
      result.current.isScrolledUp,
      'a scroller attached after the first render was never listened to',
    ).toBe(true);
  });

  /**
   * THE BARREL'S NON-COMPONENT EXPORTS, ENUMERATED.
   *
   * The hook has no contract entry — the contract is component-keyed, and an entry would demand a
   * story file for a thing with nothing to show — so it is invisible to all six contract guards.
   * That is the same shape as the unfamilied-component hole: deleting its coverage would leave the
   * suite green and merely shorter. Enumerated rather than counted, because a count cannot say
   * which one went.
   */
  it('publishes exactly the non-component exports the family means to publish', async () => {
    const barrel = await import('./ChatMessage');
    const components = Object.entries(contract)
      .filter(([, e]) => (e as { family?: string }).family === 'message')
      .map(([name]) => name);
    const other = Object.keys(barrel).filter((name) => !components.includes(name));
    expect(other.sort()).toEqual([
      'MESSAGE_MARKER',
      'STANDALONE_DENSITY',
      'STANDALONE_SENDER',
      'useChatStreamScroll',
    ]);
  });
});

describe('the transcript frame owns the scroller and offers the way back', () => {
  const scroller = (root: HTMLElement) => root.querySelector('[data-thread-scroller]') as HTMLElement;
  const content = (root: HTMLElement) => scroller(root).querySelector('[role="log"]')!.firstElementChild as HTMLElement;

  const mountThread = (children: React.ReactNode) => {
    const view = render(<ChatThread>{children}</ChatThread>);
    const box = scroller(view.container);
    withGeometry(box, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
    return { ...view, box };
  };

  const transcript = (count: number) =>
    Array.from({ length: count }, (_, at) => (
      <ChatMessage key={at} sender="assistant">
        <ChatMessageBubble>pesan {at}</ChatMessageBubble>
      </ChatMessage>
    ));

  /**
   * `resetKey` REACHES THE SCROLL FOLLOW (UMK-1041). A host that swaps its children from one
   * conversation to another without remounting must open the new one at the bottom, not behind the
   * pill the old one left up — and the prop must not leak onto the DOM as an attribute.
   */
  it('forwards resetKey, so a new conversation is not opened scrolled up', () => {
    const frame = (resetKey: string) => (
      <ChatThread resetKey={resetKey}>
        <ChatMessageList label="Percakapan">{transcript(2)}</ChatMessageList>
      </ChatThread>
    );
    const view = render(frame('session-a'));
    const box = scroller(view.container);
    withGeometry(box, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
    const inner = content(view.container);
    const append = () => {
      const row = document.createElement('article');
      row.setAttribute(MESSAGE_MARKER, '');
      inner.appendChild(row);
    };
    append();
    fireResize(inner);
    append();
    fireResize(inner);
    box.scrollTop = 200;
    act(() => {
      box.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByRole('button', { name: 'Ke pesan terbaru' }), 'the reader never released').not.toBeNull();

    view.rerender(frame('session-b'));
    expect(screen.queryByRole('button', { name: 'Ke pesan terbaru' }), 'the new conversation opened behind the pill').toBeNull();
    expect(view.container.firstElementChild!.hasAttribute('resetkey')).toBe(false);
  });

  /**
   * THE WIRING, ASSERTED — and it is the assertion this seam most needs.
   *
   * The context is absent-tolerant by design, so a list outside a frame registers nothing and
   * still works. That means a frame that never published its scroller, or a list that never
   * registered, is a SUCCESSFUL read of the default rather than a crash or a blank screen: the
   * transcript renders, scrolls by hand, and simply never follows. Every layer's own tests stay
   * green because each is correct in isolation. So the wiring is what gets guarded.
   */
  it('publishes its scroller and collects the list\'s inner element', () => {
    const { container, box } = mountThread(
      <ChatMessageList label="Percakapan">{transcript(2)}</ChatMessageList>,
    );
    expect(box, 'the frame renders no scroll container').toBeTruthy();
    /* The registration is only observable through its effect: the scroll owner observes the
       element the list handed over, so something must be watching it. */
    expect(
      observing('resize', content(container)).length,
      'the list\'s inner element was never registered with the frame',
    ).toBeGreaterThan(0);
  });

  /**
   * AND THE LIST'S SENTINEL IS ROOTED ON THAT SCROLLER, WHICH NOTHING MEASURED.
   *
   * The frame published its scroller as a REF for one run and the list read `.current` once. A ref
   * object's identity never changes, so the observer effect never re-ran — a frame whose scroller
   * appeared after first commit left the sentinel rooted on the VIEWPORT for the component's life,
   * firing load-older whenever the sentinel entered the WINDOW rather than the transcript.
   *
   * The injection for the fix came back GREEN, which is why this exists: the fake recorded the
   * `root` option all along and no assertion read it. Rule 18 of
   * `a-guard-test-can-pass-by-measuring-itself` — name the value the assertion reads, and when it
   * cannot differ, change the subject rather than the break. The subject here is the root the
   * component actually passed.
   */
  it('roots the list\'s load-older sentinel on the frame\'s own scroller', () => {
    const { container, box } = mountThread(
      <ChatMessageList label="Percakapan" scrollToTopAction={() => {}}>
        {transcript(2)}
      </ChatMessageList>,
    );
    const sentinel = container.querySelector('[data-sentinel]')!;
    const watching = observing('intersection', sentinel);
    expect(watching.length, 'nothing is observing the sentinel at all').toBeGreaterThan(0);
    expect(
      watching.map((o) => o.options?.root),
      'the sentinel is rooted on the viewport rather than on the transcript it belongs to',
    ).toContain(box);
  });

  it('follows a height increase while locked, and holds while released', () => {
    const { container, box } = mountThread(
      <ChatMessageList label="Percakapan">{transcript(2)}</ChatMessageList>,
    );
    fireResize(content(container));
    expect(box.scrollTop, 'the frame did not follow the first fill').toBe(600);

    box.scrollTop = 200;
    act(() => {
      box.dispatchEvent(new Event('scroll'));
    });
    box.scrollHeight = 2000;
    fireResize(content(container));
    stepFrames(60);
    expect(box.scrollTop, 'the frame dragged a reading user away from where they were').toBe(200);
  });

  /**
   * THE PILL APPEARS ONLY WHEN THE READER IS AWAY, and pressing it brings them back and clears the
   * mark. Asserted through the rendered control rather than the hook, because the frame deciding
   * when to render it is the part the hook cannot see.
   */
  it('offers the pill only while the reader is away, and returns them when pressed', () => {
    const { container, box } = mountThread(
      <ChatMessageList label="Percakapan">{transcript(2)}</ChatMessageList>,
    );
    fireResize(content(container));
    expect(screen.queryByRole('button'), 'the pill shows while the reader is at the bottom').toBeNull();

    box.scrollTop = 200;
    act(() => {
      box.dispatchEvent(new Event('scroll'));
    });
    const pill = screen.getByRole('button');
    expect(pill).toBeTruthy();

    act(() => {
      pill.click();
    });
    stepFrames(60);
    expect(box.scrollTop, 'pressing the pill did not return the reader').toBe(600);
    expect(screen.queryByRole('button'), 'the pill stayed after the reader came back').toBeNull();
  });

  it('marks the pill when a message arrives while the reader is away', () => {
    const { container, box } = mountThread(
      <ChatMessageList label="Percakapan">{transcript(2)}</ChatMessageList>,
    );
    fireResize(content(container));
    box.scrollTop = 200;
    act(() => {
      box.dispatchEvent(new Event('scroll'));
    });
    expect(screen.getByRole('button').hasAttribute('data-new-messages')).toBe(false);

    const arrival = document.createElement('article');
    arrival.setAttribute(MESSAGE_MARKER, '');
    content(container).appendChild(arrival);
    fireResize(content(container));
    expect(
      screen.getByRole('button').hasAttribute('data-new-messages'),
      'a message arrived off-screen and the pill said nothing',
    ).toBe(true);
  });

  /**
   * THE ICON-ONLY PILL HAS EMPTY TEXT CONTENT, and that is the whole assertion. A translated label
   * drawn unconditionally inside a 36px circle clips — it renders, it reads as a styling bug, and
   * an accessible-name check would pass over it because the name is correct either way.
   */
  it('draws no text at all on the icon-only pill, and the label on the expanded one', () => {
    const { container } = render(<ChatScrollButton label="Ke pesan terbaru" />);
    expect(container.textContent, 'the icon-only pill draws text that has nowhere to go').toBe('');
    expect(screen.getByRole('button', { name: 'Ke pesan terbaru' }), 'the pill is unannounceable').toBeTruthy();

    cleanup();
    const expanded = render(<ChatScrollButton label="Ke pesan terbaru" shape="labelled" />);
    expect(expanded.container.textContent).toBe('Ke pesan terbaru');
  });

  it('carries the reduced-motion variant on the pill\'s transition', () => {
    render(<ChatScrollButton label="Ke pesan terbaru" />);
    expect([...screen.getByRole('button').classList]).toContain('motion-reduce:transition-none');
  });

  /**
   * INSIDE THE APP SHELL, THE FRAME IS THE ELEMENT THAT SCROLLS AND THE SHELL'S CONTENT REGION IS
   * NOT.
   *
   * ASSERTED AS STRUCTURE RATHER THAN GEOMETRY, deliberately: this environment computes no layout,
   * so comparing scroll positions here would pass vacuously whatever either element did. What can
   * be checked is that the overflow rule is on the frame's scroller and the shell's region still
   * refuses to grow — which is the arrangement that makes the nesting work.
   */
  it('scrolls its own region inside the app shell, leaving the shell\'s content region put', () => {
    const { container } = render(
      <AppShell>
        <ChatThread>
          <ChatMessageList label="Percakapan">{transcript(2)}</ChatMessageList>
        </ChatThread>
      </AppShell>,
    );
    const main = container.querySelector('main')!;
    const box = scroller(container);
    expect(main.contains(box), 'the frame is not inside the shell\'s content region').toBe(true);
    expect([...box.classList].some((c) => c.startsWith('overflow-y-')), 'the frame does not scroll').toBe(
      true,
    );
    expect(
      [...main.classList].some((c) => /^overflow-(?:y-)?(?:auto|scroll)$/.test(c)),
      'the shell\'s content region scrolls too, so the transcript has two scrollers',
    ).toBe(false);
    expect([...main.classList], 'the shell\'s region can be pushed taller by its content').toContain(
      'min-h-0',
    );
  });
});
