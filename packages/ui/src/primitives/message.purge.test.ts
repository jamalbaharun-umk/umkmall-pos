import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as MESSAGE_CLASSES from './message-classes';
import { contract } from '../contract';

const {
  MESSAGE_BLOCK,
  MESSAGE_BUBBLE_BASE,
  MESSAGE_BUBBLE_GHOST,
  MESSAGE_BUBBLE_SENDER,
  MESSAGE_BUBBLE_WIDTH,
  MESSAGE_AUTHOR,
  MESSAGE_CONTENT_GAP,
  MESSAGE_GROUP_END,
  MESSAGE_GROUP_START,
  MESSAGE_INSET,
  MESSAGE_LIST_CONTENT,
  MESSAGE_LIST_DENSITY_GAP,
  MESSAGE_LIST_GAP,
  MESSAGE_LIST_PAD,
  MESSAGE_LIST_ROOT,
  MESSAGE_LIST_SENTINEL,
  MESSAGE_LIST_SPACER,
  MESSAGE_META_DIRECTION,
  MESSAGE_META_ROOT,
  MESSAGE_META_STATUS,
  MESSAGE_AVATAR,
  MESSAGE_NAME,
  MESSAGE_ROOT,
  MESSAGE_SCROLL_BUTTON,
  MESSAGE_TTS_BUTTON,
  MESSAGE_TTS_GLYPH,
  MESSAGE_SCROLL_BUTTON_BADGE,
  MESSAGE_SCROLL_BUTTON_SHAPE,
  MESSAGE_THREAD_PILL_SLOT,
  MESSAGE_THREAD_ROOT,
  MESSAGE_THREAD_SCROLLER,
  MESSAGE_AUTHOR_PULL,
  MESSAGE_META_PULL,
} = MESSAGE_CLASSES;

/**
 * THE CHAT MESSAGE FAMILY's purge guard — the transcript half of the `Chat` category.
 *
 * A SECOND FAMILY IN ONE CATEGORY, NOT A SECOND TABLE IN THE COMPOSER'S GUARD. The purge guards
 * here derive their expectations from their own class module's exports, so folding two disjoint
 * tables under one guard would make that derivation a lie about both: every composer class would
 * report as required by the message family and the reconciliation below could name neither set.
 *
 * WHAT IT IS FOR: a purged class renders unstyled against a green suite. The behaviour sibling can
 * see that a ghost bubble keeps an inset and that a grouped run tucks the right corner; it cannot
 * see that either rule still EXISTS in the emitted stylesheet. A transcript whose padding, radius
 * and fill were all purged is a column of unstyled text with every class name still on every
 * element — and nothing over there moves.
 *
 * Same siting and mechanics as `composer.purge.test.ts`: in this package, because turbo's `test`
 * hash covers a package's own files and not its workspace dependencies' (UMK-852), and the preset
 * is loaded by RELATIVE path because the bare specifier resolves through a node_modules symlink
 * that is a different copy inside a git worktree.
 *
 * PROVED RED, one injection per assertion, each written from what the assertion is FOR rather
 * than read off its matcher — and each run against a plain `vitest run` in this package, which
 * has no cache layer between the edit and the result at all. Two do not isolate, and the reason
 * is the data model rather than a weak test (UMK-958), so it is recorded rather than dressed up:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | A table names a radius rung the scale does not publish | 1 — the emitted-rule sweep |
 * | An entry stops claiming the family, table left standing | **3** — this reconciliation, the
 *   stories one, and `unfamilied-coverage`, because the family key is what all three read |
 * | The two density tables merged into one padding entry | **2** — the two-axis check, plus the
 *   behaviour guard's ghost alignment, which is the thing the merge actually breaks |
 * | The ghost back to a zeroing override | 1 — the substitution check |
 * | The width override without its cap reset | 3 — here, the stories demo and the behaviour guard |
 * | A grouped corner spelled physically | 1 — the logical-corner check |
 * | The system notice folded onto the assistant fill | 1 — the per-sender fill rows |
 * | The column stops pinning its inline minimum | 1 — the column-shape check |
 *   | The author header written as a column | 1 — the column-shape check |
 *   | The inset hard-coded into the header table | 1 — the column-shape check |
 * | A slot pull sized to the whole column gap | 1 — the pull check |
 * | A pull left fixed while the gap it comes off moves | 1 — the pull check |
 * | A pull flipped to the other edge, pushing instead of pulling | 1 — the pull check |
 * | The space inside a message back to one constant | **2** — the density-reach check and
 *   the behaviour guard's rendered gap, which is the same defect one layer down |
 * | A message no further from its neighbour than from its own parts | 1 — the density-reach check |
 * | A responsive prefix added to the bubble | 1 — the breakpoint ban |
 * | A raw palette step written into a table | 1 — the token check |
 * | A table declared in a shape the flattener walks past | 1 — the completeness check |
 * | Two senders sharing one alignment | 1 — the alignment check |
 * | The bubble stops breaking words | 1 — the bubble shape check |
 * | The scan widened to sweep test files | 1 — the source-only check |
 * | A settled status given a colour of its own | 1 — the status paint check |
 * | The moving status stripped of its reduced-motion variant | 2 — here and the behaviour guard |
 * | The metadata reversal expressed twice | 1 — the direction-alone check |
 * | The metadata row hard-coding a direction | 1 — the direction-alone check |
 * | The metadata entry stops claiming the family | **3** — same three as the bubble's, above |
 * | The list density's padding and gap written into one entry | 2 — here and the behaviour guard |
 * | The list's inner element hard-coding a gap | 2 — here and the behaviour guard |
 * | A gap rung carrying a padding with it | 1 — the gap-rung check |
 * | Two gap rungs drawing the same spacing | 1 — the gap-rung check |
 * | The log region claiming a scroller of its own | 1 — the scroller/sentinel check |
 * | The sentinel hidden, so nothing can observe it | 1 — the scroller/sentinel check |
 * | The list entry stops claiming the family | **4** — the three above plus the axis-sweep roster |
 * | The frame stops scrolling | 2 — here and the shell-composition check |
 * | The overscroll allowed to reach the page | 1 — the overflow check |
 * | The pill strip stops letting taps through | 1 — the pointer check |
 * | The frame stops being a positioning context | 1 — the pointer check |
 * | The pill's two geometries collapsed onto one | 1 — the shape check |
 * | The pill's reduced-motion variant dropped | 2 — here and the behaviour guard |
 * | The frame's entry stops claiming the family | **4** — the three above plus the barrel roster |
 *
 * AND IT SCANS SOURCE ONLY. A glob that swept this file in would make these class names their own
 * content, and every one would report as emitted whether or not any component uses it.
 */
const require_ = createRequire(import.meta.url);
const PACKAGE = resolve(__dirname, '../..');

const componentFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? componentFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.(?:test|test-d|stories)\./.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

const compile = async (): Promise<string> => {
  const preset = require_(resolve(PACKAGE, 'tailwind.preset.js'));
  const processed = await postcss([
    tailwind({ presets: [preset], content: componentFiles(resolve(PACKAGE, 'src')) }),
  ]).process('@tailwind utilities;', { from: undefined });
  return processed.css;
};

/** Derived from ONE namespace import, for the reason the composer's copy gives at length. */
const flatten = (module_: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(module_).flatMap(([name, value]) =>
      typeof value === 'string'
        ? [[name, value] as const]
        : Object.entries(value as Record<string, string>).map(
            ([step, v]) => [`${name}.${step}`, v] as const,
          ),
    ),
  );

/** A table is a class string, or a record of them. Anything else is not one — see below. */
const isTable = (value: unknown): boolean =>
  typeof value === 'string' ||
  (typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string'));

const TABLES = flatten(MESSAGE_CLASSES as unknown as Record<string, unknown>);

const REQUIRED = Object.values(TABLES)
  .flatMap((v) => v.split(' '))
  /* Arbitrary values cannot be falsified: Tailwind's JIT generates them from the very line the
     expectation is read off, so the rule always exists and the check always passes. */
  .filter((c) => !c.includes('['))
  /* Mirror Tailwind's own escape rule rather than enumerating characters — the emitted selector
     for a variant class carries a literal backslash, and escaping a chosen subset builds a
     selector the stylesheet never contains. */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

/** An inline (side) padding, a block (vertical) padding — kept apart, because the split IS the rule. */
const INLINE_PADDING = /(?:^|\s)p[xsel]?-\S+/;
const BLOCK_PADDING = /(?:^|\s)p[yb]?-\S+/;

describe('the message classes survive the purge', () => {
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the message family relies on', () => {
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  /**
   * THE FAMILY IS RECONCILED AGAINST THE CONTRACT, not against a number. A component added to the
   * contract without a class table, or a table deleted while its entry stays, is what this
   * catches. A count would survive either — the list would simply be one shorter and still equal
   * its own number.
   */
  it('covers every component the contract puts in this family', () => {
    const members = Object.entries(contract)
      .filter(([, e]) => (e as { family?: string }).family === 'message')
      .map(([name]) => name)
      .sort();
    expect(members).toEqual([
      'ChatMessage',
      'ChatMessageBubble',
      'ChatMessageList',
      'ChatMessageMetadata',
      'ChatMessageTTSButton',
      'ChatScrollButton',
      'ChatThread',
    ]);
  });

  /**
   * THE DENSITY PADDING IS TWO TABLES AND THE SPLIT IS THE ALIGNMENT MECHANISM, so this asserts
   * the split rather than the values.
   *
   * The inline half is what a ghost bubble and both slots keep; the block half is the only half a
   * ghost zeroes. Merge them into one padding entry — the obvious tidy-up — and a ghost can no
   * longer drop the vertical padding without dropping the inset that makes a media grid line up
   * with bubble text. Asserted as each table naming ONE of the two axes and not the other, which
   * is the property a merge destroys.
   */
  it('keys the density padding on two axes, so a ghost can drop one and keep the other', () => {
    expect(Object.keys(MESSAGE_INSET).sort(), 'the two density tables disagree about their keys').toEqual(
      Object.keys(MESSAGE_BLOCK).sort(),
    );
    for (const [density, value] of Object.entries(MESSAGE_INSET)) {
      expect(value, `inset ${density} names no side padding`).toMatch(INLINE_PADDING);
      expect(value, `inset ${density} also names a vertical padding, so a ghost cannot keep it`).not.toMatch(
        BLOCK_PADDING,
      );
    }
    for (const [density, value] of Object.entries(MESSAGE_BLOCK)) {
      expect(value, `block ${density} names no vertical padding`).toMatch(BLOCK_PADDING);
      expect(value, `block ${density} also names a side padding, so a ghost would drop the inset`).not.toMatch(
        INLINE_PADDING,
      );
    }
    /* And the three densities are three DIFFERENT insets. A table where two shared a value would
       satisfy every line above and give a caller a density prop that draws nothing. */
    expect(new Set(Object.values(MESSAGE_INSET)).size).toBe(Object.keys(MESSAGE_INSET).length);
    expect(new Set(Object.values(MESSAGE_BLOCK)).size).toBe(Object.keys(MESSAGE_BLOCK).length);
  });

  /**
   * THE GHOST SUBSTITUTES FOR THE FILL-AND-BLOCK PAIR, IT DOES NOT OVERRIDE IT.
   *
   * This shipped for one run as a zeroing entry appended after the pair — the obvious shape, and
   * silently inert. The class merger resolves conflicts from a map of Tailwind's OWN utility
   * values, and the design system's named rungs are not in it, so two vertical paddings on one
   * element are not a conflict it can see: both survive, neither wins by being later, and the
   * emitted stylesheet's order decides which paints. Every class name on the element was correct.
   *
   * So the assertion is that this entry names NO padding on either axis. An entry that zeroes one
   * is an entry trying to override again, which is the failure by another spelling.
   */
  it('gives the ghost a substitute treatment rather than a zeroing override', () => {
    expect(
      MESSAGE_BUBBLE_GHOST,
      'the ghost zeroes a vertical padding — the merger cannot make that win, so it must substitute',
    ).not.toMatch(BLOCK_PADDING);
    expect(MESSAGE_BUBBLE_GHOST, 'the ghost names the inset it is supposed to leave alone').not.toMatch(
      INLINE_PADDING,
    );
    /* And it stops painting, or it is a bubble with no padding rather than no bubble. */
    expect(MESSAGE_BUBBLE_GHOST, 'the ghost still paints a fill').toMatch(/(?:^|\s)bg-transparent(?:$|\s)/);
  });

  /**
   * THE WIDTH OVERRIDE CLEARS THE CAP IN THE SAME ENTRY.
   *
   * Asserted as BOTH halves, because either alone passes over the bug: a width with no reset
   * leaves the cap winning, so the prop appears inert on a wide viewport and functional on a
   * narrow one — a layout accident nobody attributes to this table. And the default has to
   * actually cap, or there is nothing for the override to escape.
   */
  it('caps the default width and clears that cap in the override itself', () => {
    expect(MESSAGE_BUBBLE_WIDTH.auto, 'the default names no width cap').toMatch(/(?:^|\s)max-w-/);
    expect(MESSAGE_BUBBLE_WIDTH.full, 'the override names no width').toMatch(/(?:^|\s)w-\S+/);
    expect(MESSAGE_BUBBLE_WIDTH.full, 'the override sets a width but leaves the cap winning').toMatch(
      /(?:^|\s)max-w-none(?:$|\s)/,
    );
  });

  /**
   * GROUPED RADII ARE LOGICAL, AND THE TWO TABLES DISAGREE PER POSITION.
   *
   * Physical corners compile, render, and put every user bubble's tuck on the wrong side in a
   * right-to-left locale — which nothing in this package can see, because happy-dom computes no
   * layout and has no writing direction. So the ban is on the physical spellings and the
   * requirement is the logical ones.
   *
   * The DISAGREEMENT is the second half and the one a "consolidation" would undo: one shared table
   * would satisfy every logical-corner check above while tucking both senders toward the same
   * edge, which makes a grouped user run read as the assistant's.
   */
  it('tucks grouped corners with logical properties, and to opposite edges per sender', () => {
    expect(Object.keys(MESSAGE_GROUP_START).sort()).toEqual(Object.keys(MESSAGE_GROUP_END).sort());
    for (const [table, name] of [
      [MESSAGE_GROUP_START, 'start'],
      [MESSAGE_GROUP_END, 'end'],
    ] as const) {
      for (const [position, value] of Object.entries(table)) {
        if (position === 'none') {
          expect(value, 'the standalone position tightens a corner').toBe('');
          continue;
        }
        expect(value, `${name}/${position} tightens no corner`).toMatch(/(?:^|\s)rounded-(?:ss|se|es|ee)-/);
        expect(
          value,
          `${name}/${position} names a physical corner, which flips to the wrong side in a right-to-left locale`,
        ).not.toMatch(/(?:^|\s)rounded-(?:tl|tr|bl|br|t|r|b|l)-/);
      }
      /* Each position tightens a DIFFERENT pair, or the axis has values that draw the same thing. */
      const drawn = Object.entries(table).filter(([p]) => p !== 'none').map(([, v]) => v);
      expect(new Set(drawn).size, `${name} repeats a corner pair across positions`).toBe(drawn.length);
    }
    for (const position of Object.keys(MESSAGE_GROUP_START)) {
      if (position === 'none') continue;
      expect(
        MESSAGE_GROUP_START[position as keyof typeof MESSAGE_GROUP_START],
        `both senders tuck the same way at ${position}`,
      ).not.toBe(MESSAGE_GROUP_END[position as keyof typeof MESSAGE_GROUP_END]);
    }
  });

  /**
   * EVERY SENDER HAS AN ENTRY, AND THE TWO TURNS BEING EQUAL IS DELIBERATE.
   *
   * This deliberately does NOT assert that the assistant and user fills differ — they hold the
   * same published surface today, which is the colour the app already draws. What it asserts is
   * that each sender has its OWN row: a shared constant would have to be split before a theme
   * could tint one side, and splitting a constant two components read is the edit most likely to
   * move both. `system` is required to disagree, because it is not a turn.
   */
  it('gives every sender its own fill row, and keeps the system notice off both voices', () => {
    expect(Object.keys(MESSAGE_BUBBLE_SENDER).sort()).toEqual([...contract.ChatMessage.axes.sender].sort());
    for (const [sender, value] of Object.entries(MESSAGE_BUBBLE_SENDER)) {
      expect(value, `${sender} names no fill`).toMatch(/(?:^|\s)bg-\S+/);
      expect(value, `${sender} names no text colour`).toMatch(/(?:^|\s)text-\S+/);
    }
    expect(MESSAGE_BUBBLE_SENDER.system).not.toBe(MESSAGE_BUBBLE_SENDER.assistant);
    expect(MESSAGE_BUBBLE_SENDER.system).not.toBe(MESSAGE_BUBBLE_SENDER.user);
  });

  /**
   * THE ARTICLE IS THE COLUMN AND THE AUTHOR HEADER IS THE ONE ROW INSIDE IT.
   *
   * Both halves are silent when wrong. An unpinned inline minimum lets one unbroken token — a URL,
   * a hash — push the message wider than the transcript and scroll the whole region sideways, on a
   * page where every class still resolves. An author header laid out as a column stacks the face
   * above the name, which reads as a spacing preference rather than as the wrong direction.
   */
  it('lays the message out as a column that pins its minimum, and the author on one row', () => {
    expect(MESSAGE_ROOT, 'the message is not a column').toMatch(/(?:^|\s)flex-col(?:$|\s)/);
    expect(MESSAGE_ROOT, 'the message leaves its inline minimum unpinned').toMatch(
      /(?:^|\s)min-w-0(?:$|\s)/,
    );
    expect(MESSAGE_AUTHOR, 'the author header stacks the face above the name').not.toMatch(
      /(?:^|\s)flex-col(?:$|\s)/,
    );
    expect(MESSAGE_AUTHOR, 'the author header names no gap between the face and the name').toMatch(
      /(?:^|\s)gap-\S+/,
    );
    /* And it hard-codes no inset, because the component hands it the density one — the same
       arrangement the metadata row has. An inset written here would not move with `density`. */
    expect(MESSAGE_AUTHOR, 'the author header hard-codes an inset the density table owns').not.toMatch(
      INLINE_PADDING,
    );
  });

  /**
   * THE SLOT PULLS ARE SIZED AGAINST THE COLUMN GAP, AND BOTH ARE NEGATIVE.
   *
   * The two slots are siblings of the bubble rather than children of a box around it, so each sits
   * a full column gap away from the bubble it belongs to. A pull written positive, or omitted,
   * renders three correctly-styled rows that read as three unrelated messages — which looks like a
   * spacing preference rather than a bug.
   *
   * PULLED BACK, NOT CANCELLED: a pull equal to the gap butts the timestamp against the bubble's
   * edge, so the pull has to be strictly smaller than the gap it is pulling from.
   */
  it('pulls both slots back toward the bubble by less than the column gap, at every density', () => {
    const rung: Record<string, number> = {
      'ds-null': 0,
      'ds-5xs': 2,
      'ds-4xs': 4,
      'ds-3xs': 6,
      'ds-2xs': 8,
      'ds-xs': 10,
      'ds-sm': 12,
      'ds-md': 16,
      'ds-lg': 20,
      'ds-xl': 24,
      'ds-2xl': 32,
    };
    /* PER DENSITY, because all three tables move now. The pull is sized against the gap it comes
       off, so a pull that stays put while the gap grows leaves a different fraction at every
       setting — and the widest one leaves a sliver bigger than the gap between two messages
       used to be, which reads as three unrelated rows again. */
    for (const density of contract.ChatMessage.axes.density) {
      const gap = rung[MESSAGE_CONTENT_GAP[density].match(/(?:^|\s)gap-(\S+)/)?.[1] ?? ''];
      expect(gap, `the ${density} column gap is off the named rungs`).toBeTypeOf('number');
      for (const [slot, table] of [
        ['author', MESSAGE_AUTHOR_PULL],
        ['metadata', MESSAGE_META_PULL],
      ] as const) {
        const value = table[density];
        const match = value.match(/(?:^|\s)-m[tb]-(\S+)(?:$|\s)/);
        expect(match, `the ${slot} pull at ${density} is not a negative block margin`).toBeTruthy();
        const pull = rung[match![1]];
        expect(pull, `the ${slot} pull at ${density} is off the named rungs`).toBeTypeOf('number');
        expect(pull, `the ${slot} pull at ${density} cancels the whole gap`).toBeLessThan(gap);
        expect(pull, `the ${slot} pull at ${density} pulls nothing back`).toBeGreaterThan(0);
      }
    }
    /* The two pull in OPPOSITE directions: a name — the author header above the turn, or a
       bubble's own label — sits above what it names and the metadata below, so one shortens its
       bottom margin and the other its top. One shared table would pull the wrong edge on one of
       them, which reads as an off-by-one gap rather than as a wrong class. */
    for (const density of contract.ChatMessage.axes.density) {
      expect(MESSAGE_AUTHOR_PULL[density], `the author pull at ${density} pulls the wrong edge`).toMatch(
        /-mb-/,
      );
      expect(MESSAGE_META_PULL[density], `the metadata pull at ${density} pulls the wrong edge`).toMatch(
        /-mt-/,
      );
    }
  });

  /**
   * DENSITY REACHES THE SPACE INSIDE A MESSAGE, NOT ONLY THE BUBBLE'S PADDING.
   *
   * `MESSAGE_CONTENT_GAP` shipped as one constant. Nothing failed: `density` still moved the
   * bubble's padding and the list's row gap, so flipping the prop visibly changed the row and the
   * prop looked honoured — while the header, the turn and the metadata stayed a fixed distance
   * apart at every setting. A constant is a well-formed table to every other check in this file,
   * which is exactly why this one names the axis instead.
   *
   * AND A MESSAGE'S OWN GAP MUST STAY UNDER THE GAP BETWEEN MESSAGES. Those two carry the whole
   * distinction between one speaker continuing and another starting; let them meet and the
   * transcript is an evenly-spaced column of lines with no turn boundaries, at every density and
   * with every class correct.
   */
  it('moves the space inside a message with the density, and keeps it under the space between', () => {
    const densities = [...contract.ChatMessage.axes.density];
    expect(Object.keys(MESSAGE_CONTENT_GAP).sort()).toEqual([...densities].sort());
    expect(
      new Set(Object.values(MESSAGE_CONTENT_GAP)).size,
      'two densities draw the same space inside a message',
    ).toBe(densities.length);

    const px = (value: string) => {
      const rungs: Record<string, number> = {
        'ds-null': 0, 'ds-5xs': 2, 'ds-4xs': 4, 'ds-3xs': 6, 'ds-2xs': 8,
        'ds-xs': 10, 'ds-sm': 12, 'ds-md': 16, 'ds-lg': 20, 'ds-xl': 24, 'ds-2xl': 32,
      };
      const rung = value.match(/(?:^|\s)gap-(\S+)/)?.[1] ?? '';
      const size = rungs[rung];
      expect(size, `${value} is off the named rungs`).toBeTypeOf('number');
      return size;
    };

    for (const density of densities) {
      expect(
        px(MESSAGE_LIST_DENSITY_GAP[density]),
        `at ${density} a message is no further from its neighbour than from its own parts`,
      ).toBeGreaterThan(px(MESSAGE_CONTENT_GAP[density]));
    }
  });

  /**
   * THE LISTEN CONTROL'S BOX CLEARS THE TARGET-SIZE FLOOR, and this is the assertion the review
   * that found it could not get from any existing guard.
   *
   * The button draws no width: its box is the glyph plus twice the padding, so the two tables are
   * one measurement and either can shrink it. It shipped at `p-ds-5xs` — 2px, the row's own GAP
   * rung and one step from the right one — which drew a 20px control where both live surfaces draw
   * 28, under WCAG 2.2 AA 2.5.8's 24px minimum, and by some distance the smallest interactive
   * thing in either chat family. Every class resolved. Every purge check passed. The button was
   * 29% smaller than the two copies it exists to replace.
   *
   * So the floor is asserted in PIXELS off the named rungs, not by pinning the class string: a
   * pinned string reds on any edit, including a correct one, and says nothing about the number
   * that actually matters. Both tables are read, because a floor over the padding alone cannot
   * see the glyph shrink underneath it.
   *
   * A FLOOR IS ONLY A FLOOR, THOUGH, which is why the parity check below is a separate assertion
   * rather than the same one written twice. Measured: dropping the glyph to `h-3` leaves 12 + 12 =
   * 24, which CLEARS this and is caught only by the parity check. Dropping the padding back to
   * `ds-5xs` reds both. Two different claims — "big enough to press" and "the same as what it
   * replaces" — and neither implies the other.
   */
  it('draws the listen control at least as large as the minimum target size', () => {
    const RUNGS: Record<string, number> = {
      'ds-null': 0, 'ds-5xs': 2, 'ds-4xs': 4, 'ds-3xs': 6, 'ds-2xs': 8,
      'ds-xs': 10, 'ds-sm': 12, 'ds-md': 16, 'ds-lg': 20, 'ds-xl': 24, 'ds-2xl': 32,
    };
    const pad = MESSAGE_TTS_BUTTON.match(/(?:^|\s)p-(\S+)/)?.[1] ?? '';
    const padPx = RUNGS[pad];
    expect(padPx, `the listen button's padding (${pad}) is off the named rungs`).toBeTypeOf('number');

    /* Tailwind's own scale, where 1 unit is 4px — the glyph is sized in it rather than in `ds-`. */
    const glyph = MESSAGE_TTS_GLYPH.match(/(?:^|\s)h-(\d+(?:\.\d+)?)/)?.[1];
    expect(glyph, 'the listen glyph names no height').toBeTypeOf('string');
    const glyphPx = Number(glyph) * 4;

    /* WCAG 2.2 AA 2.5.8. The web control has no hit-slop equivalent, so the drawn box IS the
       target — unlike the native sibling, which also carries one. */
    expect(
      glyphPx + padPx * 2,
      'the listen control is smaller than the 24px minimum target size',
    ).toBeGreaterThanOrEqual(24);
  });

  /**
   * AND IT MATCHES THE CONTROLS IT REPLACES. The floor above is a floor; this is the parity claim
   * the contract entry rests on, since the entry records the COLOUR moving at adoption and says
   * nothing about the geometry — which means the geometry must not move.
   */
  it('draws the listen control the same size as the two copies it de-duplicates', () => {
    expect(MESSAGE_TTS_BUTTON).toContain('p-ds-3xs');
    expect(MESSAGE_TTS_GLYPH).toContain('h-4');
  });

  /**
   * NO BREAKPOINT PREFIX ANYWHERE. The transcript has ONE presentation and its roominess is the
   * `density` axis rather than a viewport band — a responsive prefix would mean a width at which
   * the density prop silently stops deciding, and no assertion in this package can see a layout
   * band.
   */
  it('names no breakpoint prefix, because density is a prop rather than a viewport band', () => {
    for (const value of Object.values(TABLES))
      expect(/(?:^|\s)(?:sm|md|lg|xl|2xl):/.test(value)).toBe(false);
  });

  /**
   * A STATED TEST SCENARIO: no raw palette step and no literal hex anywhere in the tables. A
   * colour written literally survives every purge check in this file — it is emitted, it renders,
   * and it silently opts the component out of theming. The bubble this replaces hardcodes its fill
   * as a hex, which is the drift this family exists to end.
   */
  it('names only semantic tokens, never a palette step or a literal colour', () => {
    const all = Object.values(TABLES).join(' ');
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(all).not.toMatch(
      /(?:^|\s|:)(?:bg|text|border|ring|from|via|to|shadow|divide|outline)-[a-z]+-\d{2,3}(?![-\w])/,
    );
  });

  /**
   * THE DERIVATION'S OWN COMPLETENESS CHECK. Deriving from the module removes the drift between
   * two hand-written registrations; it does not by itself prove the module was fully read. A table
   * declared in a shape `flatten` cannot walk — an array, a nested record — would be skipped in
   * silence, which is the same hole one register lower down. The nested record is the live risk
   * here: the grouped radii are per sender AND per position, and writing them as one two-level
   * record is the first thing anyone reaches for.
   */
  it('reads every export of the class module, in a shape it can flatten', () => {
    const exports_ = Object.entries(MESSAGE_CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(exports_.filter(([, v]) => !isTable(v)).map(([name]) => name)).toEqual([]);
    for (const [name] of exports_)
      expect(Object.keys(TABLES).some((k) => k === name || k.startsWith(`${name}.`))).toBe(true);
  });

  /**
   * Every sender has an alignment, keyed off the contract rather than restated — and the alignment
   * is now the WHOLE of the user-side flip, so two senders sharing one entry means the transcript
   * draws every turn down one edge with nothing else to give it away.
   */
  it('gives every declared sender its own alignment', () => {
    expect(Object.keys(MESSAGE_CLASSES.MESSAGE_CONTENT_ALIGN).sort()).toEqual(
      [...contract.ChatMessage.axes.sender].sort(),
    );
    expect(MESSAGE_CLASSES.MESSAGE_CONTENT_ALIGN.assistant).not.toBe(
      MESSAGE_CLASSES.MESSAGE_CONTENT_ALIGN.user,
    );
  });

  /** L23: the author header matches the live agent chat — a framed 28px face and a strong name. */
  it('draws the avatar frame and a strong author name, and emits them', () => {
    for (const c of ['h-7', 'w-7', 'rounded-full', 'border', 'border-default-primary', 'bg-default-primary', 'shadow-sm'])
      expect(MESSAGE_AVATAR.split(' '), `the avatar frame lacks ${c}`).toContain(c);
    expect(MESSAGE_AUTHOR.split(' ')).toContain('gap-2');
    for (const c of ['text-ds-paragraph-mobile', 'font-semibold', 'text-default-primary'])
      expect(MESSAGE_NAME.split(' '), `the name lacks ${c}`).toContain(c);
    expect(css).toMatch(/\.h-7\b/);
    expect(css).toMatch(/\.font-semibold\b/);
  });

  /** The bubble names its own radius and breaks long tokens; the name slot names only type. */
  it('rounds the bubble and lets it break an unbroken token', () => {
    expect(MESSAGE_BUBBLE_BASE, 'the bubble names no radius').toMatch(/(?:^|\s)rounded-\S+/);
    expect(MESSAGE_BUBBLE_BASE, 'the bubble will not break a pasted URL').toMatch(
      /(?:^|\s)break-words(?:$|\s)/,
    );
    expect(MESSAGE_NAME, 'the name slot hard-codes an inset it sits outside of').not.toMatch(
      INLINE_PADDING,
    );
  });

  /**
   * TWO OF FIVE STATUSES PAINT, AND THE OTHER THREE MUST NOT.
   *
   * Asserted as a COUNT OF THE QUIET ONES rather than as "each status has a treatment", because
   * the usual shape of that assertion is exactly backwards here: giving the three settled states
   * their own colours turns a timestamp line into a traffic light, and every "each value differs"
   * check would call that an improvement.
   *
   * The moving one carries its reduced-motion variant WITH the animation. This package expresses
   * reduced motion as a class a guard can read, never as a runtime media query — the test
   * environment has no media engine, so a runtime check would ship unproved.
   */
  it('paints only the failing and the moving status, and stops the motion on request', () => {
    expect(Object.keys(MESSAGE_META_STATUS).sort()).toEqual(
      [...contract.ChatMessageMetadata.axes.status].sort(),
    );
    const quiet = Object.entries(MESSAGE_META_STATUS).filter(([, v]) => v === '').map(([k]) => k);
    expect(quiet.sort(), 'a settled status paints something, which makes the row a traffic light').toEqual(
      ['delivered', 'read', 'sent'],
    );
    expect(MESSAGE_META_STATUS.error, 'the failing status takes no colour of its own').toMatch(
      /(?:^|\s)text-\S+/,
    );
    expect(MESSAGE_META_STATUS.sending, 'the sending status does not move').toMatch(
      /(?:^|\s)animate-\S+/,
    );
    expect(
      MESSAGE_META_STATUS.sending,
      'the sending status keeps moving for a reader who asked it not to',
    ).toMatch(/(?:^|\s)motion-reduce:animate-none(?:$|\s)/);
  });

  /**
   * THE METADATA REVERSAL IS THE FLEX DIRECTION AND NOTHING ELSE, so the authored order can stay
   * the same on both sides. A table that also flipped an alignment or a text direction would be
   * expressing the reversal twice, and the second expression is the one nobody updates.
   */
  it('reverses the metadata row by direction alone, keeping one authored order', () => {
    expect(Object.keys(MESSAGE_META_DIRECTION).sort()).toEqual(
      [...contract.ChatMessage.axes.sender].sort(),
    );
    for (const [sender, value] of Object.entries(MESSAGE_META_DIRECTION)) {
      expect(value, `metadata direction ${sender} names something other than a flex direction`).toMatch(
        /^flex-(?:row|row-reverse)$/,
      );
    }
    expect(MESSAGE_META_DIRECTION.assistant).not.toBe(MESSAGE_META_DIRECTION.user);
    /* And the row itself hard-codes no direction, or the table above cannot win. */
    expect(MESSAGE_META_ROOT, 'the metadata row hard-codes a direction the table cannot override')
      .not.toMatch(/(?:^|\s)flex-row(?:-reverse)?(?:$|\s)/);
  });

  /**
   * THE LIST'S PADDING AND ITS GAP ARE TWO TABLES, and it is the same rule the bubble's density
   * follows for the same reason. A caller's `gap` replaces the gap and must leave the padding
   * where the density put it; one combined entry plus an appended override is the obvious shape
   * and is silently inert, because the class merger cannot see two of the named rungs as a
   * conflict. Asserted as each table naming ONE of the two, which is what a merge destroys.
   */
  it('keys the list spacing on two tables, so a gap override leaves the padding alone', () => {
    expect(Object.keys(MESSAGE_LIST_PAD).sort()).toEqual(Object.keys(MESSAGE_LIST_DENSITY_GAP).sort());
    for (const [density, value] of Object.entries(MESSAGE_LIST_PAD)) {
      expect(value, `list padding ${density} names no padding`).toMatch(/(?:^|\s)p-\S+/);
      expect(value, `list padding ${density} also names a gap, so an override would move it`).not.toMatch(
        /(?:^|\s)gap-\S+/,
      );
    }
    for (const [density, value] of Object.entries(MESSAGE_LIST_DENSITY_GAP)) {
      expect(value, `list gap ${density} names no gap`).toMatch(/(?:^|\s)gap-\S+/);
      expect(value, `list gap ${density} also names a padding an override would take with it`).not.toMatch(
        /(?:^|\s)p-\S+/,
      );
    }
    /* And the inner element hard-codes neither, or the two tables cannot decide anything. */
    expect(MESSAGE_LIST_CONTENT).not.toMatch(/(?:^|\s)(?:p-|gap-)\S+/);
  });

  /**
   * THE GAP OVERRIDE COVERS THE DECLARED AXIS AND NAMES ONLY GAPS. A rung that also carried a
   * padding would silently move the density's padding whenever a caller set a spacing by hand,
   * which is the one thing the split above exists to prevent.
   */
  it('gives every declared gap rung a gap and nothing else', () => {
    expect(Object.keys(MESSAGE_LIST_GAP).sort()).toEqual([...contract.ChatMessageList.axes.gap].sort());
    for (const [rung, value] of Object.entries(MESSAGE_LIST_GAP)) {
      expect(value, `gap rung ${rung} names no gap`).toMatch(/(?:^|\s)gap-\S+/);
      expect(value, `gap rung ${rung} carries a padding with it`).not.toMatch(/(?:^|\s)p-\S+/);
    }
    expect(new Set(Object.values(MESSAGE_LIST_GAP)).size, 'two gap rungs draw the same spacing').toBe(
      Object.keys(MESSAGE_LIST_GAP).length,
    );
  });

  /**
   * THE ROOT DOES NOT SCROLL AND THE SENTINEL IS NOT HIDDEN.
   *
   * Both are the kind of edit a tidy-up makes. An overflow on the log region gives the transcript
   * two scrollers, so the frame's follow scrolls one box while the reader is looking at another —
   * and every class name stays correct. A sentinel with no height is not observable at all, so
   * the load-older action becomes unreachable with nothing failing.
   */
  it('leaves the scroller to the frame and gives the sentinel a height to be seen at', () => {
    expect(MESSAGE_LIST_ROOT, 'the log region claims a scroller the frame already owns').not.toMatch(
      /(?:^|\s)overflow-(?:y-)?(?:auto|scroll)(?:$|\s)/,
    );
    expect(MESSAGE_LIST_ROOT, 'the log region leaves its block minimum unpinned').toMatch(
      /(?:^|\s)min-h-0(?:$|\s)/,
    );
    expect(MESSAGE_LIST_SENTINEL, 'the sentinel names no height, so nothing can observe it').toMatch(
      /(?:^|\s)h-\S+/,
    );
    expect(MESSAGE_LIST_SENTINEL, 'the sentinel is hidden, which makes it unobservable').not.toMatch(
      /(?:^|\s)hidden(?:$|\s)/,
    );
    /* The spacer grows and carries nothing else — it is geometry, not chrome. */
    expect(MESSAGE_LIST_SPACER).toBe('flex-1');
  });

  /**
   * THE FRAME OWNS THE SCROLLER AND THE LIST DOES NOT — asserted as a DISAGREEMENT between the two
   * tables, so moving the overflow to the wrong one cannot satisfy it.
   *
   * Two scrollers in a transcript is the failure this prevents, and it is invisible here: the
   * follow scrolls one box while the reader is looking at another, and every class name on both
   * stays correct. Containing the overscroll belongs with the overflow for the same reason — a
   * transcript at its end otherwise hands the gesture to the page, which on a phone is a
   * pull-to-refresh nobody asked for.
   */
  it('puts the overflow on the frame, contains it there, and nowhere else', () => {
    expect(MESSAGE_THREAD_SCROLLER, 'the frame names no scroller').toMatch(
      /(?:^|\s)overflow-y-(?:auto|scroll)(?:$|\s)/,
    );
    expect(MESSAGE_THREAD_SCROLLER, 'the scroller lets its overscroll reach the page').toMatch(
      /(?:^|\s)overscroll-contain(?:$|\s)/,
    );
    expect(MESSAGE_THREAD_SCROLLER, 'the scroller leaves its block minimum unpinned').toMatch(
      /(?:^|\s)min-h-0(?:$|\s)/,
    );
    /* The premise, and the half a "consolidation" breaks: the list must NOT also scroll. */
    expect(MESSAGE_LIST_ROOT, 'the log region scrolls too, so the transcript has two scrollers').not.toMatch(
      /(?:^|\s)overflow-(?:y-)?(?:auto|scroll)(?:$|\s)/,
    );
  });

  /**
   * THE PILL SLOT IS A STRIP ACROSS THE FOOT, AND IT MUST NOT SWALLOW TAPS.
   *
   * It spans the full width so the pill can centre, which puts an invisible band over the last
   * message. Without the pointer rule that band eats every tap meant for the newest reply — the
   * transcript renders perfectly and simply stops responding along one edge. The pill takes the
   * events back, so both halves are asserted: one alone is the bug or the no-op.
   */
  it('lets taps through the pill strip and back into the pill', () => {
    expect(MESSAGE_THREAD_PILL_SLOT, 'the pill strip is not positioned inside the frame').toMatch(
      /(?:^|\s)absolute(?:$|\s)/,
    );
    expect(MESSAGE_THREAD_ROOT, 'the frame is not a positioning context, so the strip escapes it').toMatch(
      /(?:^|\s)relative(?:$|\s)/,
    );
    expect(MESSAGE_THREAD_PILL_SLOT, 'the strip swallows taps meant for the last message').toMatch(
      /(?:^|\s)pointer-events-none(?:$|\s)/,
    );
    expect(MESSAGE_SCROLL_BUTTON, 'the pill cannot be pressed through its own strip').toMatch(
      /(?:^|\s)pointer-events-auto(?:$|\s)/,
    );
  });

  /**
   * TWO SHAPES FOR ONE CONTROL, and they must differ. A single padded geometry leaves the
   * icon-only form a wide lozenge with a glyph floating in it — which is what every hand-built
   * version of this control in the product currently draws.
   *
   * The transition carries the reduced-motion variant, the same Tailwind-variant idiom the pulsing
   * delivery status uses rather than a runtime media query.
   */
  it('gives the pill two shapes and stops its transition on request', () => {
    expect(MESSAGE_SCROLL_BUTTON_SHAPE.icon, 'the icon-only pill names no width').toMatch(
      /(?:^|\s)w-\S+/,
    );
    expect(MESSAGE_SCROLL_BUTTON_SHAPE.labelled, 'the labelled pill names no inline padding').toMatch(
      /(?:^|\s)px-\S+/,
    );
    expect(MESSAGE_SCROLL_BUTTON_SHAPE.icon).not.toBe(MESSAGE_SCROLL_BUTTON_SHAPE.labelled);
    /* A fixed width on the labelled shape would clip the words it exists to show. */
    expect(MESSAGE_SCROLL_BUTTON_SHAPE.labelled, 'the labelled pill is pinned to a width').not.toMatch(
      /(?:^|\s)w-\d/,
    );
    expect(MESSAGE_SCROLL_BUTTON, 'the pill names no transition').toMatch(/(?:^|\s)transition-\S+/);
    expect(MESSAGE_SCROLL_BUTTON, 'the pill keeps moving for a reader who asked it not to').toMatch(
      /(?:^|\s)motion-reduce:transition-none(?:$|\s)/,
    );
    /* The mark is a dot: a size and a fill, and no room for text by construction. */
    expect(MESSAGE_SCROLL_BUTTON_BADGE).toMatch(/(?:^|\s)h-\S+/);
    expect(MESSAGE_SCROLL_BUTTON_BADGE).toMatch(/(?:^|\s)bg-\S+/);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('message.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('ChatMessage.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('message-classes.ts'))).toBe(true);
  });
});
