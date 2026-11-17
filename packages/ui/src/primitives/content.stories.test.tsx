import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import userEvent from '@testing-library/user-event';
import * as BadgeStories from './Badge/Badge.stories';
import * as CodeBlockStories from './CodeBlock/CodeBlock.stories';
import * as ChipStories from './Chip/Chip.stories';
import * as DisclosureStories from './Disclosure/Disclosure.stories';
import * as DividerStories from './Divider/Divider.stories';
import * as ImageStories from './Image/Image.stories';
import * as ListStories from './List/List.stories';
import * as StepperStories from './Stepper/Stepper.stories';
import * as CardStories from '../compositions/Card/Card.stories';
import * as TabsStories from '../compositions/Tabs/Tabs.stories';
import { Badge } from './Badge';
import { Card } from '../compositions/Card';
import { Divider } from './Divider';
import {
  A2UI_BADGE,
  A2UI_CARD_HERO,
  A2UI_BADGE_COLOR,
  A2UI_CHIP,
  A2UI_CHIP_STATE,
  A2UI_CODE_BLOCK,
  A2UI_DISCLOSURE,
  A2UI_DIVIDER,
  A2UI_DIVIDER_RULE,
  A2UI_IMAGE,
  A2UI_IMAGE_PLACEHOLDER,
} from './a2ui-classes';
import { Chip } from './Chip';
import { Disclosure } from './Disclosure';
import { CodeBlock } from './CodeBlock';
import { Image } from './Image';
import { List } from './List';
import { Stepper } from './Stepper';
import { Icon } from './Icon';
import { ICON_REGISTRY } from './Icon/registry';
import { GlyphCheckCircleFilled } from './Icon/glyphs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../compositions/Tabs';
import { contract, storyTitle, type ComponentName } from '../contract';
import {
  BADGE_COLOR,
  BADGE_SIZE,
  CODE_BLOCK_SIZE,
  CARD_PADDING,
  CARD_VARIANT,
  CHIP_SIZE,
  CHIP_STATE,
  DIVIDER_ORIENTATION,
  DIVIDER_RULE,
  DIVIDER_VARIANT,
  hasLegacyBrandToken,
  IMAGE_SIZE,
  IMAGE_TYPE,
  STEPPER_CONNECTOR,
  STEPPER_CONNECTOR_STATE,
  STEPPER_MARK,
  STEPPER_LABEL_STATE,
  STEPPER_MARK_STATE,
  STEPPER_ORIENTATION,
  TAB_SIZE,
  TAB_STATE,
} from './content-classes';
import { NAMES_A_BACKGROUND, NAMES_A_BORDER_COLOUR, NAMES_A_BORDER_COLOUR_OR_HAND_KEPT, NAMES_A_TEXT_COLOUR } from '../purge-support';

/**
 * The content guard, covering all eight components of this slice.
 *
 * READS `container`, not `baseElement` — the inverse of the overlay guard, and deliberately.
 * Nothing here portals: every one of the eight renders in place. Reading `baseElement` would
 * also work but would sweep in the panels of every story mounted before it, and the
 * uniqueness assertions below would then be counting other stories' output.
 *
 * WHAT IT ASSERTS BEYOND "IT RENDERED", because four of these eight are rewrites of live
 * components and a rewrite's whole risk is silently changing what its call sites render:
 *
 * - Every axis value renders a class taken FROM the class table itself rather than retyped,
 *   so a table that gains a step gains its check with it.
 * - The axis-coverage requirement is keyed off the CONTRACT, not off a name list — an entry
 *   that gains a real axis starts demanding a grid story and class evidence on its own, and
 *   an entry that quietly LOST its axes cannot slip into the exempt branch.
 * - The semantic probes that actually distinguish these components: a Chip is a button and a
 *   Badge is not, a Disclosure is a real `<details>`, an unselected Tab's `aria-controls`
 *   resolves to a real panel, and a non-https Image renders no `<img>` at all.
 *
 * Importing the story modules also pulls them into the typecheck program: `tsconfig` excludes
 * every stories file, so a story imported by a test is the only checking one ever gets.
 */

const MODULES = {
  Badge: BadgeStories,
  Chip: ChipStories,
  Card: CardStories,
  Divider: DividerStories,
  Tabs: TabsStories,
  List: ListStories,
  Disclosure: DisclosureStories,
  Image: ImageStories,
  CodeBlock: CodeBlockStories,
  Stepper: StepperStories,
};

/*
 * There used to be a CONTRACT_NAME map here, existing solely to bridge the story set `Tabs`
 * to the contract key `Tab`. UMK-979 renamed that entry to `Tabs`, so the map became an
 * identity map and is deleted rather than kept as one: every module name below IS its
 * contract key, and a bridge with nothing to bridge is a place for a future mismatch to hide
 * quietly. Its docblock recorded the mismatch as deliberate, so overturning it is said out
 * loud here. The correspondence it asserted is not lost — it is the first line of the
 * coverage test below, which now compares MODULES directly against the contract family.
 */

type AnyStory = {
  args?: Record<string, unknown>;
  render?: (a: never, b: never) => React.ReactElement;
};
type AnyModule = {
  default: { component: React.ElementType; title: string; args?: Record<string, unknown> };
} & Record<string, unknown>;

const element = (mod: AnyModule, story: AnyStory): React.ReactElement => {
  const args = { ...(mod.default.args ?? {}), ...(story.args ?? {}) };
  if (typeof story.render === 'function') return story.render(args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...args} />;
};

const stories = (mod: AnyModule): [string, AnyStory][] =>
  Object.entries(mod).filter(
    ([n, s]) => n !== 'default' && !!s && typeof s === 'object',
  ) as [string, AnyStory][];

/** Mounts every story in a module and returns every class the render produced. */
const mountAll = (mod: AnyModule) => {
  const classes = new Set<string>();
  const containers: HTMLElement[] = [];
  for (const [, story] of stories(mod)) {
    const { container } = render(element(mod, story));
    containers.push(container);
    for (const el of container.querySelectorAll('*')) for (const c of el.classList) classes.add(c);
  }
  return { classes, containers };
};


/**
 * THE CONTRACT DECIDES WHO BELONGS HERE, not a number this file keeps about itself.
 *
 * A count literal cannot detect an omission: add a component, forget both this guard's map and
 * the count, and the map is simply one shorter and still equals its own number. Reconciling the
 * keyset against every contract entry claiming this family is the check a count only looked
 * like — the same shape the purge sibling already uses against its class-table exports.
 */
const contractFamilyMembers = (family: string): string[] =>
  Object.entries(contract)
    .filter(([, entry]) => (entry as { family?: string }).family === family)
    .map(([name]) => name)
    .sort();

describe('the content stories mount and say what they are', () => {
  it('titles every story set for Storybook', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
      expect((mod as unknown as AnyModule).default.title).toBe(storyTitle(name as ComponentName));
    }
  });

  /* The mount-everything assertions have to have something to mount. A module that lost its
     stories would otherwise make every loop below pass by never running — a guard measuring
     itself. Eight modules is also asserted, so a whole component dropping out of MODULES is
     not a silent narrowing of scope. */
  it('covers every component the contract puts in this family, each with more than one story', () => {
    /* Both directions in one comparison, now that a module's name IS its contract key: a
       contract entry with no story module and a story module with no contract entry each
       fail here. */
    expect(Object.keys(MODULES).sort()).toEqual(contractFamilyMembers('content'));
    for (const [name, mod] of Object.entries(MODULES)) {
      expect(stories(mod as unknown as AnyModule).length, `${name} has too few stories`).toBeGreaterThan(1);
    }
  });

  it('gives every meta the default args its render-less stories need', () => {
    /* Slice 3 shipped this bug and fixed it in a follow-up: the mount helper above falls
       through to `<Component {...meta.args} {...story.args} />`, so a meta with no args
       mounts a component missing its required props. `Divider` legitimately needs none, so
       the assertion is that `args` EXISTS rather than that it is non-empty. */
    for (const [name, mod] of Object.entries(MODULES)) {
      expect((mod as unknown as AnyModule).default.args, `${name} meta has no args`).toBeDefined();
    }
  });

  it('mounts every story in every module without throwing', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
      const { containers } = mountAll(mod as unknown as AnyModule);
      expect(containers.length, `${name} mounted nothing`).toBeGreaterThan(1);
    }
  });
});

/**
 * Axis coverage, keyed off the CONTRACT rather than off a component name.
 *
 * An entry declaring non-empty `axes` owes class evidence and a grid story. One carrying only
 * `pendingAxes` is exempt and has to prove it really is in that state — the exemption is the
 * dangerous half, because an entry that quietly lost its axes would otherwise skip its
 * coverage check and stay green.
 *
 * `List` and `Disclosure` take the pending branch today. When a set is published for either,
 * this switches on by itself and nobody has to remember to come back.
 */
/**
 * KEYED BY AXIS NAME, and holding the TABLE rather than a flattened list of its values.
 *
 * A flat list cannot tell a complete table from a damaged one. Emptying a single colour's
 * class keeps the list the same LENGTH, so a length-based anti-vacuity check passes and the
 * missing-class filter finds nothing to look for — the badge renders with no colour at all
 * against a green suite. That gap was real here until the injection proof found it.
 *
 * Holding the table lets the assertion compare its KEYS against the contract axis and require
 * each VALUE to be non-empty, which catches an emptied class, a missing step and a step the
 * contract never declared.
 */
const AXIS_EVIDENCE = {
  Badge: { color: BADGE_COLOR, size: BADGE_SIZE },
  Chip: { state: CHIP_STATE, size: CHIP_SIZE },
  Card: { variant: CARD_VARIANT, padding: CARD_PADDING },
  Divider: { variant: DIVIDER_VARIANT, orientation: DIVIDER_ORIENTATION },
  Tabs: { size: TAB_SIZE, state: TAB_STATE },
  Image: { type: IMAGE_TYPE, size: IMAGE_SIZE },
  CodeBlock: { size: CODE_BLOCK_SIZE },
  /* `appearance` is structural (see STRUCTURAL_AXES), so there is no class table to hold here. */
  Disclosure: {},
  /* `position` has no table of its own: it decides whether a connector element EXISTS rather
     than which classes it takes, so its evidence is the connector table plus the DOM check
     below. Listing an empty table here to satisfy the loop would be the vacuity this file
     warns about. */
  Stepper: {
    state: STEPPER_MARK_STATE,
    orientation: STEPPER_ORIENTATION,
  },
} as const satisfies Record<string, Record<string, Readonly<Record<string, string>>>>;

/**
 * The ONE axis value that legitimately maps to no class: "no padding" is the absence of a
 * class rather than a class. Enumerated rather than allowed generally, so a second empty
 * value has to be argued for here instead of quietly joining it.
 */
const DELIBERATELY_EMPTY = new Set(['Card.padding.none', 'Card.variant.plain']);

/**
 * AXES WHOSE EVIDENCE IS STRUCTURAL RATHER THAN A CLASS TABLE.
 *
 * `Stepper.position` decides whether the connector element EXISTS — the first step has no leg
 * behind it, and that is the absence of an element rather than a class that hides one. There
 * is no table to compare, so the class-coverage loop would have to be handed an empty or a
 * fabricated one, which is the vacuity the rest of this file exists to prevent.
 *
 * Enumerated by name, like `DELIBERATELY_EMPTY` above, so a second one has to be argued for
 * here rather than quietly joining it — and every entry OWES a real assertion of its own
 * further down. `Stepper.position`'s is `gives only the non-first steps a connector`.
 */
const STRUCTURAL_AXES = new Set([
  'Stepper.position',
  /* UMK-1307. `appearance` is one named look per component (the agent surface's pre-library one), written in
     `a2ui-classes.ts` rather than a family table because its hex has no token. Each owes the assertion
     `renders the a2ui appearance as its own class set` below. */
  'Badge.appearance',
  'Chip.appearance',
  'Divider.appearance',
  'Image.appearance',
  'CodeBlock.appearance',
  'Disclosure.appearance',
  /* UMK-1290. Tabs' look is asserted in `a2ui-appearance.test.tsx` (its root carries no class). */
  'Card.appearance',
  'Tabs.appearance',
]);

/**
 * What each axis's classes must STRUCTURALLY carry, independent of which token they name.
 *
 * THIS IS THE ONE CHECK THAT IS NOT DERIVED FROM THE TABLES. Everything else here compares a
 * component's render against the same table it renders from, so the tables are their own
 * oracle: they prove a component faithfully echoes whatever the table says, never that the
 * table says the right thing. Emptying a value is caught (see above), but TRUNCATING one is
 * not — drop `text-default-brand` from `BADGE_COLOR.primary` and both guards shrink with it,
 * leaving a badge with a background and invisible text against a green suite.
 *
 * A hand-copied expected string per value would catch it and would also be the
 * hand-copied-constant anti-pattern this repo has already written up. So the pin is the SHAPE
 * instead: a badge colour is a surface plus a text colour, a chip state adds a border, a size
 * step is padding plus a type step. Those are the real invariants, they do not need updating
 * when a token is repointed, and no truncation can satisfy them.
 */
type ShapeRule = readonly RegExp[] | Record<string, readonly RegExp[]>;

const AXIS_SHAPE: Record<string, Record<string, ShapeRule>> = {
  Disclosure: {},
  /* `color` is PER VALUE because the gradient value is painted by a different property than
     its five siblings. A single `bg-` alternation is satisfied by `bg-gradient-to-r` alone —
     which is exactly how a gradient truncated to one stop stays green, the same shape that
     split `Card.variant` below. */
  Badge: {
    color: {
      primary: [NAMES_A_BACKGROUND, NAMES_A_TEXT_COLOUR],
      warning: [NAMES_A_BACKGROUND, NAMES_A_TEXT_COLOUR],
      success: [NAMES_A_BACKGROUND, NAMES_A_TEXT_COLOUR],
      danger: [NAMES_A_BACKGROUND, NAMES_A_TEXT_COLOUR],
      light: [NAMES_A_BACKGROUND, NAMES_A_TEXT_COLOUR],
      bestseller: [NAMES_A_BACKGROUND, NAMES_A_TEXT_COLOUR],
      gradient: [
        /(?:^|\s)bg-gradient-to-/,
        /(?:^|\s)from-\w/,
        /(?:^|\s)to-\w/,
        NAMES_A_TEXT_COLOUR,
      ],
    },
    size: [/(?:^|\s)px-/, /(?:^|\s)py-/, /(?:^|\s)text-ds-/],
  },
  Chip: {
    /* `border-border-secondary` is the ONE hand-kept preset colour still named by a class
       table: Figma's `01 Mark` strokes its default step in #93a2b0, which the generated
       border palette publishes nowhere. So this accepts either spelling rather than the
       generated one alone — see the note on `border.secondary` in tailwind.preset.js. */
    state: [
      NAMES_A_BORDER_COLOUR_OR_HAND_KEPT,
      /(?:^|\s)bg-/,
      NAMES_A_TEXT_COLOUR,
    ],
    size: [/(?:^|\s)px-/, /(?:^|\s)py-/, /(?:^|\s)text-ds-/],
  },
  /* PER VALUE, because the three treatments are defined by DIFFERENT properties: an elevated
     card is a shadow, an outlined one is a border. A single alternation over the axis
     (`bg-|border`) is satisfied by the background alone — which is exactly what let an
     injection strip `outlined`'s border and stay green. */
  /* `padding` had class evidence and no shape pin until the completeness check above found it:
     every step but the deliberately-empty `none` must actually carry a padding class, or a
     card renders flush against its own content while every table-derived assertion passes. */
  Card: {
    padding: [/(?:^|\s)p-ds-/],
    variant: {
      elevated: [/(?:^|\s)shadow-/, NAMES_A_BACKGROUND],
      outlined: [/(?:^|\s)border(?:\s|$)/, NAMES_A_BORDER_COLOUR, NAMES_A_BACKGROUND],
    },
  },
  /* The rule's SIDE is in the orientation shape: a vertical divider that kept `border-t`
     renders a line across the top of a 1px column, which is invisible rather than wrong. */
  Divider: {
    variant: [/(?:^|\s)border-(?:solid|dashed)(?:\s|$)/],
    orientation: { horizontal: [/(?:^|\s)my-/], vertical: [/(?:^|\s)mx-/] },
  },
  Tabs: {
    size: [/(?:^|\s)px-/, /(?:^|\s)py-/, /(?:^|\s)text-ds-/],
    /* The border is in the shape because the underline IS the treatment: a state table that
       carried only a text colour would let the rule vanish and still pass. */
    state: [/(?:^|\s)border-b/, NAMES_A_BORDER_COLOUR, NAMES_A_TEXT_COLOUR],
  },
  /* Every `type` must DECLARE its ratio behaviour — a fixed `aspect-` or the explicit `h-auto`
     that means "the image's own". Accepting either is what lets `natural` exist without
     letting a truncated `thumbnail` quietly lose its square. */
  Image: {
    type: [/(?:^|\s)(?:aspect-|h-auto)/, /(?:^|\s)rounded-/],
    size: [/(?:^|\s)w-/],
  },
  CodeBlock: {
    size: [/(?:^|\s)px-/, /(?:^|\s)py-/, /(?:^|\s)text-ds-/],
  },
  /* PER VALUE, because `default` is the one state Figma gives NO FILL — it is a 3px ring
     around the page behind it. A flat `bg-` rule over the axis would fail that correct value,
     and widening the rule to drop `bg-` entirely would let `current` or `done` lose its fill
     and keep a mark that is invisible against its own surface. So `default` owes the ring
     (colour AND width) and the other two owe the fill.

     The orientation shape is the AXIS the two values differ on: swapping `flex-col` for
     `flex-row` on one of them draws a vertical trail sideways, which is wrong rather than
     invisible. */
  Stepper: {
    state: {
      /* `border-border-secondary` is the ONE hand-kept preset colour a class table still
         names: Figma's `01 Mark` strokes its default step in #93a2b0, and the generated
         border palette publishes that hex nowhere. So this accepts either spelling — see the
         note on `border.secondary` in tailwind.preset.js. */
      default: [
        /(?:^|\s)border-3(?:\s|$)/,
        NAMES_A_BORDER_COLOUR_OR_HAND_KEPT,
        NAMES_A_TEXT_COLOUR,
      ],
      current: [NAMES_A_BACKGROUND, NAMES_A_TEXT_COLOUR, NAMES_A_BORDER_COLOUR],
      done: [NAMES_A_BACKGROUND, NAMES_A_TEXT_COLOUR, NAMES_A_BORDER_COLOUR],
    },
    orientation: { horizontal: [/(?:^|\s)flex-row(?:\s|$)/], vertical: [/(?:^|\s)flex-col(?:\s|$)/] },
  },
};

const GRIDS = {
  Badge: [BadgeStories.AllVariants, { colors: contract.Badge.axes.color, sizes: contract.Badge.axes.size }],
  Chip: [ChipStories.AllVariants, { states: contract.Chip.axes.state, sizes: contract.Chip.axes.size }],
  Card: [
    CardStories.AllVariants,
    { variants: contract.Card.axes.variant, paddings: contract.Card.axes.padding },
  ],
  Divider: [
    DividerStories.AllVariants,
    { variants: contract.Divider.axes.variant, orientations: contract.Divider.axes.orientation },
  ],
  Tabs: [TabsStories.AllSizes, { sizes: contract.Tabs.axes.size, states: contract.Tabs.axes.state }],
  Image: [ImageStories.AllVariants, { types: contract.Image.axes.type, sizes: contract.Image.axes.size }],
  CodeBlock: [CodeBlockStories.AllSizes, { sizes: contract.CodeBlock.axes.size }],
  Disclosure: [DisclosureStories.AllVariants, { appearances: contract.Disclosure.axes.appearance }],
  Stepper: [
    StepperStories.AllVariants,
    { orientations: contract.Stepper.axes.orientation, states: contract.Stepper.axes.state },
  ],
} as const;

describe('the content stories cover every axis value the contract declares', () => {
  /**
   * THE SHAPE PIN'S OWN COMPLETENESS, which nothing else here can see.
   *
   * `AXIS_SHAPE` is the one check in this file not derived from the tables it guards, so it is
   * the sole defence against a TRUNCATED value. Its keyset is a hand-maintained literal: a
   * component or an axis dropped from it loses that defence with every other assertion still
   * green — the guard's own version of the omission `spreads every class table` catches next
   * door. Compared against `AXIS_EVIDENCE` rather than a count, so which one went missing is
   * named rather than inferred.
   */
  it('pins a shape for every axis that has class evidence', () => {
    expect(Object.keys(AXIS_SHAPE).sort()).toEqual(Object.keys(AXIS_EVIDENCE).sort());
    for (const [name, axes] of Object.entries(AXIS_EVIDENCE)) {
      expect(
        Object.keys(AXIS_SHAPE[name]).sort(),
        `${name}'s shape pin does not cover the axes it has evidence for`,
      ).toEqual(Object.keys(axes).sort());
    }
  });

  it.each(Object.keys(MODULES))('%s is either axis-bearing or honestly pending', (name) => {
    const entry = contract[name as keyof typeof MODULES];
    const hasAxes = Object.keys(entry.axes).length > 0;
    if (hasAxes) {
      expect(
        AXIS_EVIDENCE[name as keyof typeof AXIS_EVIDENCE],
        `${name} declares axes but this guard has no class evidence for it`,
      ).toBeTruthy();
      expect(GRIDS[name as keyof typeof GRIDS], `${name} declares axes but ships no grid story`).toBeTruthy();
    } else {
      /* Not `toEqual({})` alone: an entry with no axes AND no pending axes is a component
         claiming to have no vocabulary at all. Assert the pending half explicitly, so this
         branch cannot be reached by an entry that simply lost everything. */
      expect(entry.axes).toEqual({});
      expect((entry as { pendingAxes?: readonly string[] }).pendingAxes?.length ?? 0).toBeGreaterThan(0);
      expect(AXIS_EVIDENCE[name as keyof typeof AXIS_EVIDENCE]).toBeUndefined();
      expect(GRIDS[name as keyof typeof GRIDS]).toBeUndefined();
    }
  });

  it.each(Object.entries(AXIS_EVIDENCE))('%s renders every axis value', (name, tables) => {
    const { classes } = mountAll(MODULES[name as keyof typeof MODULES] as unknown as AnyModule);

    /* THE ANTI-VACUITY SELF-CHECK, WRITTEN OVER EVERY AXIS THE ENTRY DECLARES — not the
       precedent's hardcoded `.axes.size`, which throws on `Card` (whose only axis is
       `padding`) and covers half of `Badge`, `Chip`, `Tabs` and `Image`, which carry two axes
       each.

       Comparing the table's KEYS against the axis, rather than counting a flattened list of
       its values, is what makes this bite. A step the contract declares and the table lacks,
       or a step the table carries and the contract never declared, both fail here — and so
       does an emptied class, on the assertion below.

       Scoped to axis-bearing components on purpose: a pending-axis component genuinely has
       nothing to cover, and running this against one is what would tempt a later reader to
       "fix" the guard by emptying the list instead. */
    const entry = contract[name as keyof typeof MODULES] as {
      axes: Record<string, readonly string[]>;
    };
    expect(Object.keys(entry.axes).length, `${name} declares no axes to cover`).toBeGreaterThan(0);
    expect(
      Object.keys(tables).sort(),
      `${name}'s class evidence does not cover the same axes the contract declares`,
    ).toEqual(
      Object.keys(entry.axes)
        .filter((axis) => !STRUCTURAL_AXES.has(`${name}.${axis}`))
        .sort(),
    );

    const missing: string[] = [];
    for (const [axis, table] of Object.entries(tables as Record<string, Record<string, string>>)) {
      expect(Object.keys(table).sort(), `${name}.${axis} table vs contract axis`).toEqual(
        [...entry.axes[axis]].sort(),
      );
      for (const [value, klass] of Object.entries(table)) {
        /* AN EMPTY CLASS IS A MISSING TREATMENT, not a passing one — the failure that
           motivated this whole shape. Only the enumerated exception is allowed to be blank. */
        if (klass.trim().length === 0) {
          expect(
            DELIBERATELY_EMPTY.has(`${name}.${axis}.${value}`),
            `${name}.${axis}.${value} maps to no class at all`,
          ).toBe(true);
          continue;
        }
        /* Multi-class values are split, because `classList` holds one class per entry. */
        for (const c of klass.split(' ')) if (c && !classes.has(c)) missing.push(c);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * THE ONE NON-SELF-REFERENTIAL CHECK. See `AXIS_SHAPE` for why it has to exist: every other
   * assertion in this file compares a render against the same table it renders from, so a
   * TRUNCATED table value shrinks the expectation along with the component and passes.
   */
  it.each(Object.entries(AXIS_SHAPE))('%s keeps the shape each axis value must have', (name, axes) => {
    const tables = AXIS_EVIDENCE[name as keyof typeof AXIS_EVIDENCE] as unknown as Record<
      string,
      Record<string, string>
    >;
    expect(tables, `${name} has no class tables to shape-check`).toBeTruthy();
    for (const [axis, rule] of Object.entries(axes)) {
      const table = tables[axis];
      expect(table, `${name}.${axis} has no table`).toBeTruthy();
      const perValue = !Array.isArray(rule);
      /* A per-value rule must still SAY something for every value it does not exempt, or a
         value silently drops out of the check by having no entry. */
      expect(
        Array.isArray(rule) ? rule.length > 0 : Object.keys(rule).length > 0,
        `${name}.${axis} declares no required shape`,
      ).toBe(true);
      for (const [value, klass] of Object.entries(table)) {
        if (DELIBERATELY_EMPTY.has(`${name}.${axis}.${value}`)) continue;
        const required = perValue
          ? (rule as Record<string, readonly RegExp[]>)[value]
          : (rule as readonly RegExp[]);
        expect(
          required,
          `${name}.${axis}.${value} has no shape rule and is not exempt`,
        ).toBeTruthy();
        for (const pattern of required) {
          expect(
            pattern.test(klass),
            `${name}.${axis}.${value} ("${klass}") is missing ${pattern}`,
          ).toBe(true);
        }
      }
    }
  });

  /**
   * `DIVIDER_RULE` IS NOT AN AXIS TABLE, so the coverage and shape checks above never look at
   * it — and it is where the divider's whole meaning lives. An injection that gave the vertical
   * rule a `border-t` (a line across the top of a 1px column, i.e. nothing visible) passed every
   * other assertion in this file.
   */
  /**
   * THE ASSERTION `Stepper.position` OWES for being exempt from the class-coverage loop above.
   *
   * Its whole meaning is that the first step has no leg behind it, which no class table can
   * express — a connector styled to zero width is still an element, and one styled to full
   * width on the first step draws a line into empty space. Asserted on the DOM, per position,
   * in both orientations, because a horizontal trail and a vertical one place the leg with
   * different classes and only one of them could regress.
   */
  it('gives only the non-first steps a connector, in both orientations', () => {
    for (const orientation of contract.Stepper.axes.orientation) {
      const { container } = render(
        <Stepper
          orientation={orientation}
          aria-label="trail"
          steps={[{ label: 'a' }, { label: 'b' }, { label: 'c' }]}
        />,
      );
      /* Queried by a data attribute rather than by the first class in the table: both
         orientations legitimately share their leading class, so a class selector would ask the
         same question twice and answer for neither. */
      const legs = [...container.querySelectorAll('li')].map((li) =>
        li.querySelector('[data-connector]'),
      );
      expect(legs[0], `${orientation}: the first step drew a leg into empty space`).toBeNull();
      expect(legs[1], `${orientation}: a middle step has no leg`).not.toBeNull();
      expect(legs[2], `${orientation}: the last step has no leg`).not.toBeNull();
    }
    /* And a step rendered ALONE with an explicit position still obeys it — the case an
       index-derived position gets wrong, and the reason the axis exists at all. */
    const alone = render(
      <Stepper aria-label="one" steps={[{ label: 'only', position: 'middle' }]} />,
    ).container;
    expect(alone.querySelector('[data-connector]')).not.toBeNull();
  });

  /**
   * The connector's STATE table is not an axis table either — the coverage loop reads the mark,
   * not the leg — so a leg that stopped changing colour on a completed step would pass every
   * other assertion here. Same shape and same reason as `DIVIDER_RULE` below.
   */
  /**
   * THE LEG REPORTS THE PREVIOUS STEP, not its own. A leg is the journey already travelled, so
   * keying it on the step it belongs to leaves a grey line between two finished marks — which
   * reads as a gap in the trail and passes every class assertion.
   */
  it('colours the leg from the step BEHIND it', () => {
    const { container } = render(
      <Stepper
        aria-label="trail"
        steps={[{ label: 'a', state: 'done' }, { label: 'b', state: 'current' }, { label: 'c' }]}
      />,
    );
    const legs = [...container.querySelectorAll('li')].map((li) =>
      li.querySelector('[data-connector]'),
    );
    /* Behind the CURRENT step sits a DONE one, so its leg is the completed colour. */
    expect(legs[1]!.className).toContain(STEPPER_CONNECTOR_STATE.done.split(' ')[0]);
    /* Behind the last step sits the current one, which is not travelled yet. */
    expect(legs[2]!.className).toContain(STEPPER_CONNECTOR_STATE.current.split(' ')[0]);
  });

  /**
   * THE MARK OUTRANKS EVERY LEG, including the one belonging to a LATER step.
   *
   * A step's leg reaches back to the previous step's mark and lives in a later `<li>`, so with
   * both merely positioned, paint order is DOM order and the leg draws across the earlier
   * circle — a struck-through step that no class, DOM or geometry assertion can see. Only a
   * browser showed it. This pins the one class that fixes it.
   */
  it('lifts the mark above every leg, not just its own', () => {
    expect(STEPPER_MARK).toMatch(/(?:^|\s)relative(?:\s|$)/);
    expect(STEPPER_MARK).toMatch(/(?:^|\s)z-\d/);
  });

  /**
   * THE VERTICAL LEG STOPS AT THE MARK'S CENTRE, not at half the step's height. The mark sits at
   * the top of a vertical step and the step carries bottom padding, so a percentage of the STEP
   * lands below the circle and the leg pokes out underneath it.
   */
  /* DERIVED FROM THE MARK, never written as a literal: a future resize that forgets the legs
     leaves every one of them misplaced while the classes, the DOM and the geometry stay
     exactly what the rest of this file asks for. Nothing else can see it. */
  it('centres each leg on the mark across the leg\'s own thickness', () => {
    const step = Number(STEPPER_MARK.match(/(?:^|\s)h-(\d+)(?:\s|$)/)![1]);
    const half = `${(step * 0.25) / 2}rem`;
    expect(STEPPER_CONNECTOR.vertical).toContain(`left-[${half}]`);
    expect(STEPPER_CONNECTOR.horizontal).toContain(`top-[${half}]`);
    /* THE CROSS-AXIS TRANSLATE IS LOAD-BEARING, not decoration: `top`/`left` place the leg's
       EDGE, so without it every line sits half its own thickness off the mark's centre. */
    expect(STEPPER_CONNECTOR.horizontal).toMatch(/(?:^|\s)-translate-y-1\/2(?:\s|$)/);
    expect(STEPPER_CONNECTOR.vertical).toMatch(/(?:^|\s)-translate-x-1\/2(?:\s|$)/);
  });

  /**
   * THE LEG STOPS AT THE RING, NOT AT THE MARK'S CENTRE — the along axis, which is a different
   * failure from the cross-axis centring above and is why the two are separate tests.
   *
   * A step is centred, so the step's own midpoint IS the mark's centre: `right-1/2` ends the
   * leg there and draws it under the left half of the disc. That was invisible only while
   * `default` carried an opaque fill. Figma leaves that state EMPTY — and the guard next door
   * now pins the missing fill — so the line shows through the ring and stops on the numeral.
   *
   * MEASURING THE CROSS-AXIS OFFSET CANNOT SEE THIS. A leg ending at the mark's centre reads
   * as a perfect 0px centring error while being one whole radius wrong along its own axis;
   * that measurement confirms the bug rather than catching it.
   */
  it('stops each leg at the ring rather than inside it', () => {
    const step = Number(STEPPER_MARK.match(/(?:^|\s)h-(\d+)(?:\s|$)/)![1]);
    const radius = `${(step * 0.25) / 2}rem`;
    const diameter = `${step * 0.25}rem`;
    /* Ending on the step's midpoint is ending on the mark's centre. */
    expect(STEPPER_CONNECTOR.horizontal).not.toMatch(/(?:^|\s)right-1\/2(?:\s|$)/);
    expect(STEPPER_CONNECTOR.vertical).not.toMatch(/bottom-\[calc\(100%-1?\.?\d*rem\)\]/);
    /* The near end clears the ring by a radius... */
    expect(STEPPER_CONNECTOR.horizontal).toContain(`right-[calc(50%+${radius})]`);
    expect(STEPPER_CONNECTOR.vertical).toMatch(/(?:^|\s)bottom-full(?:\s|$)/);
    /* ...and the far end clears the PREVIOUS mark, so the span loses a whole diameter. */
    expect(STEPPER_CONNECTOR.horizontal).toContain(`w-[calc(100%-${diameter})]`);
    expect(STEPPER_CONNECTOR.vertical).toContain(`h-[calc(100%-${diameter})]`);
  });

  it('colours the leg behind a completed step differently from an incomplete one', () => {
    expect(Object.keys(STEPPER_CONNECTOR_STATE).sort()).toEqual(
      [...contract.Stepper.axes.state].sort(),
    );
    for (const klass of Object.values(STEPPER_CONNECTOR_STATE)) {
      expect(klass).toMatch(NAMES_A_BACKGROUND);
    }
    expect(STEPPER_CONNECTOR_STATE.done).not.toBe(STEPPER_CONNECTOR_STATE.default);
  });

  /* The LABEL table is the third one outside the axis loop, and it is what a sighted reader
     actually reads. A label ramp that collapsed onto one style would leave the trail legible
     but stateless. */
  it('gives each step state its own label treatment', () => {
    expect(Object.keys(STEPPER_LABEL_STATE).sort()).toEqual([...contract.Stepper.axes.state].sort());
    expect(new Set(Object.values(STEPPER_LABEL_STATE)).size).toBe(
      contract.Stepper.axes.state.length,
    );
  });

  it('gives each divider orientation a rule on the correct edge', () => {
    const EDGE = { horizontal: /(?:^|\s)border-t(?:\s|$)/, vertical: /(?:^|\s)border-l(?:\s|$)/ };
    expect(Object.keys(DIVIDER_RULE).sort()).toEqual([...contract.Divider.axes.orientation].sort());
    for (const [orientation, klass] of Object.entries(DIVIDER_RULE)) {
      const edge = EDGE[orientation as keyof typeof EDGE];
      expect(edge, `${orientation} has no expected edge`).toBeTruthy();
      expect(edge.test(klass), `DIVIDER_RULE.${orientation} ("${klass}") is missing ${edge}`).toBe(true);
      expect(NAMES_A_BORDER_COLOUR.test(klass), `DIVIDER_RULE.${orientation} has no token colour`).toBe(true);
    }
    /* And the two must not be the same rule, which is the degenerate way to satisfy the above
       if someone later "simplifies" the table to one shared value. */
    expect(DIVIDER_RULE.horizontal).not.toBe(DIVIDER_RULE.vertical);
  });

  /* WHAT THIS CANNOT SEE, stated so nobody reads more into it: a hand-copied literal that
     still MATCHES the contract passes, because the comparison is on values and not on
     provenance. What it catches is DRIFT — the contract gaining or losing a value while the
     story keeps its own list — which is the failure that actually happens. */
  it('feeds each grid story from the contract rather than a literal', () => {
    expect(Object.keys(GRIDS).length).toBeGreaterThan(4);
    for (const [name, [story, props]] of Object.entries(GRIDS)) {
      const rendered = (story as AnyStory).render!({} as never, {} as never) as unknown as {
        props: Record<string, readonly string[]>;
      };
      for (const [prop, expected] of Object.entries(props)) {
        /* Assert the axis EXISTS first: `toEqual` is happy comparing undefined to undefined,
           so an entry that lost its axis would pass by having nothing to compare. */
        expect(expected, `${name}.${prop} has no contract axis to iterate`).toBeTruthy();
        expect(rendered.props[prop], `${name}.${prop}`).toEqual(expected);
      }
    }
  });
});

/**
 * The semantic probes. These are what separate these eight components from eight `<div>`s
 * that happen to carry the right classes, and each one names the specific regression it
 * catches rather than testing the framework.
 */
describe('the content components behave', () => {
  /**
   * THE ASSERTION EVERY `X.appearance` OWES FOR BEING STRUCTURAL (UMK-1307). The a2ui look is a separate
   * class set: it must carry its own classes and NONE of the default look's, or a `cn` merge has quietly
   * re-admitted a `ds-` rung beside it (both ship, and the stylesheet's order decides).
   */
  it('renders the a2ui appearance as its own class set', () => {
    const cases: [string, React.ReactElement, string, string][] = [
      ['Badge', <Badge appearance="a2ui" color="light">x</Badge>, A2UI_BADGE, 'px-ds-'],
      ['Chip', <Chip appearance="a2ui" size="xlarge">x</Chip>, A2UI_CHIP, 'px-ds-'],
      ['Divider', <Divider appearance="a2ui" />, A2UI_DIVIDER.horizontal, 'my-ds-'],
      ['Image', <Image appearance="a2ui" src="https://x.test/a.png" alt="a" />, A2UI_IMAGE, 'rounded-ds-'],
      ['CodeBlock', <CodeBlock appearance="a2ui">x</CodeBlock>, A2UI_CODE_BLOCK, 'rounded-ds-'],
      ['Disclosure', <Disclosure appearance="a2ui" title="t">x</Disclosure>, A2UI_DISCLOSURE, 'rounded-ds-'],
      ['Card', <Card appearance="a2ui-hero">x</Card>, A2UI_CARD_HERO, 'rounded-ds-'],
    ];
    for (const [name, node, own, foreign] of cases) {
      const { container, unmount } = render(node);
      const root = container.firstElementChild as HTMLElement;
      for (const c of own.split(' ')) expect(root.classList.contains(c), `${name}: a2ui lost ${c}`).toBe(true);
      expect(
        [...root.classList].filter((c) => /(?<!text)-ds-/.test(c)),
        `${name}: a2ui carries a default-look ds rung (${foreign})`,
      ).toEqual([]);
      unmount();
    }
  });

  it('wires every keyed a2ui value: badge colours, chip state, vertical divider, image placeholder', () => {
    for (const [color, klass] of Object.entries(A2UI_BADGE_COLOR)) {
      const { container, unmount } = render(<Badge appearance="a2ui" color={color as keyof typeof A2UI_BADGE_COLOR}>x</Badge>);
      for (const c of klass.split(' ')) expect(container.firstElementChild!.classList.contains(c), `Badge ${color} lost ${c}`).toBe(true);
      unmount();
    }
    for (const [state, klass] of Object.entries(A2UI_CHIP_STATE)) {
      const { container, unmount } = render(<Chip appearance="a2ui" state={state as 'default' | 'active'}>x</Chip>);
      for (const c of klass.split(' ')) expect(container.firstElementChild!.classList.contains(c), `Chip ${state} lost ${c}`).toBe(true);
      unmount();
    }
    const v = render(<Divider appearance="a2ui" orientation="vertical" />);
    for (const c of A2UI_DIVIDER.vertical.split(' ')) expect(v.container.firstElementChild!.classList.contains(c)).toBe(true);
    expect(v.container.firstElementChild!.firstElementChild!.className).toBe(A2UI_DIVIDER_RULE.vertical);
    v.unmount();
    const img = render(<Image appearance="a2ui" src="" alt="a" />);
    for (const c of A2UI_IMAGE_PLACEHOLDER.split(' ')) expect(img.container.firstElementChild!.classList.contains(c)).toBe(true);
  });

  it('makes a Chip a real button and leaves a Badge a span', () => {
    const { containers } = mountAll(ChipStories as unknown as AnyModule);
    expect(containers.some((c) => c.querySelector('button'))).toBe(true);

    /* THE OTHER HALF OF THE SPLIT, and the one worth pinning. Badge's whole rewrite is that
       it stopped accepting a handler; a Badge that grew a `<button>` back would render fine
       and quietly re-open the escape hatch five call sites were migrated off. */
    const badges = mountAll(BadgeStories as unknown as AnyModule);
    expect(badges.containers.some((c) => c.querySelector('button'))).toBe(false);
    expect(badges.containers.some((c) => c.querySelector('span'))).toBe(true);
  });

  it('fires a Chip handler, and does not fire a disabled one', async () => {
    const user = userEvent.setup();
    let fired = 0;
    const { getByRole } = render(
      <Chip onClick={() => (fired += 1)}>Tekan</Chip>,
    );
    await user.click(getByRole('button', { name: 'Tekan' }));
    expect(fired).toBe(1);

    const disabled = render(
      <Chip disabled onClick={() => (fired += 1)}>
        Mati
      </Chip>,
    );
    await user.click(disabled.getByRole('button', { name: 'Mati' }));
    /* Still one. A look-only disabled state dims the pill and fires anyway, which is the
       failure every hand-rolled disabled pill makes. */
    expect(fired).toBe(1);
    expect(disabled.getByRole('button', { name: 'Mati' })).toBeDisabled();
  });

  it('announces a Chip selection rather than only colouring it', () => {
    const { getByRole } = render(<Chip state="active">Terpilih</Chip>);
    /* A chip that only LOOKS selected tells a screen-reader user nothing, and every pill this
       component replaces was in exactly that state. */
    expect(getByRole('button').getAttribute('aria-pressed')).toBe('true');

    const idle = render(<Chip state="default">Belum</Chip>);
    expect(idle.getByRole('button', { name: 'Belum' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves aria-pressed OFF a Chip that is an action rather than a toggle', () => {
    /* `state` has no default, and this is why. A chip with no `state` is an action — a
       "+2 show more" pill, a category filter that navigates — and emitting
       `aria-pressed="false"` on it announces an unpressed switch that can never be pressed.
       The obvious "tidy-up" here is to give `state` a `'default'` default, which restores
       exactly that bug while every other assertion in this file stays green. */
    const { getByRole } = render(<Chip>Selengkapnya</Chip>);
    expect(getByRole('button').hasAttribute('aria-pressed')).toBe(false);
    /* And it still renders the idle treatment, so the omission is not a styling gap. */
    for (const c of CHIP_STATE.default.split(' ')) {
      expect(getByRole('button').classList.contains(c)).toBe(true);
    }
  });

  it('lets computed a11y wiring win over a caller passthrough', () => {
    /**
     * JSX IS LAST-WINS, so where `{...props}` sits decides who owns these attributes. Both
     * prop types legally carry them — `ButtonHTMLAttributes` has `aria-pressed` and `type`,
     * `HTMLAttributes` has `id` — so a spread placed after the computed values replaces the
     * component's own wiring with nothing failing to compile and nothing else here noticing.
     * Moving the spread back below the computed attributes is a one-line edit that reads like
     * a tidy-up; this is the assertion that reddens on it.
     */
    const chip = render(
      <Chip state="active" aria-pressed={false} type={'submit' as 'button'}>
        Terpilih
      </Chip>,
    );
    const button = chip.getByRole('button', { name: 'Terpilih' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('type')).toBe('button');

    const { container } = render(
      <Tabs defaultValue="satu">
        <TabsList label="X">
          <TabsTrigger value="satu" id="hijacked" aria-selected={false}>
            Satu
          </TabsTrigger>
        </TabsList>
        <TabsContent value="satu" id="hijacked-panel">
          A
        </TabsContent>
      </Tabs>,
    );
    const tab = container.querySelector('[role="tab"]')!;
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(tab.getAttribute('id')).not.toBe('hijacked');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(panel.getAttribute('id')).not.toBe('hijacked-panel');
    /* And the pairing still resolves, which is what the hijack would have broken. */
    expect(tab.getAttribute('aria-controls')).toBe(panel.getAttribute('id'));
  });

  it('takes the shared focus ring rather than a hand-rolled one', () => {
    /* Asserted against the ring's own source, so a later hand-rolled ring — which would look
       identical in a screenshot — fails here. */
    const { getByRole } = render(<Chip>Fokus</Chip>);
    const ring = getByRole('button').className;
    expect(ring).toContain('focus-visible:ring-halo');
  });

  it('renders a Disclosure as native details and summary', () => {
    const { containers } = mountAll(DisclosureStories as unknown as AnyModule);
    /* The behaviour a hand-rolled toggle has to reimplement — keyboard operation and the
       open-state announcement — arrives from these two elements. A div-based rewrite would
       render identically and lose both. */
    expect(containers.some((c) => c.querySelector('details > summary'))).toBe(true);
  });

  it('accepts an uppercase https scheme and still refuses every other one', () => {
    /* A URL scheme is case-insensitive, so a literal prefix check placeholders a valid photo.
       The second half is the one that must not regress: widening to a case-insensitive match
       must stay ANCHORED, or `http://evil/?x=https://` renders. */
    const ok = render(<Image src="HTTPS://cdn.example/a.jpg" alt="a" />);
    expect(ok.container.querySelector('img')).not.toBeNull();
    for (const bad of [
      'http://evil/?x=https://cdn.example/a.jpg',
      'javascript:alert(1)',
      'data:image/svg+xml,<svg/>',
      ' https://cdn.example/a.jpg',
    ]) {
      const r = render(<Image src={bad} alt="a" />);
      expect(r.container.querySelector('img'), `${bad} must not render an img`).toBeNull();
    }
  });

  it('refuses relative, protocol-relative, blob and data sources unless the caller opts in (UMK-960)', () => {
    /* Both opt-ins are OFF by default because the a2ui adapter passes a model-authored url
       straight through: a relative path there is a same-origin GET with the user's cookies. */
    for (const bad of [
      '/images/a.png',
      '//evil.example/a.jpg',
      '/\\evil',
      'blob:https://x.test/uuid',
      'data:image/jpeg;base64,AAAA',
    ]) {
      const r = render(<Image src={bad} alt="a" />);
      expect(r.container.querySelector('img'), `${bad} must not render an img`).toBeNull();
    }
  });

  it('accepts a same-origin path only under allowRelative, and parses rather than prefix-matches (UMK-960)', () => {
    const ok = render(<Image src="/images/a.png" alt="a" allowRelative />);
    expect(ok.container.querySelector('img')).not.toBeNull();
    /* The WHATWG URL parser strips tab/LF/CR, so `/\t/evil.example/x` is fetched as
       `//evil.example/x`. A prefix check on `/` lets it through. */
    for (const bad of [
      '//evil.example/a.jpg',
      '/\t/evil.example/a.jpg',
      '/\n/evil.example/a.jpg',
      '/\r/evil.example/a.jpg',
      '/ /evil',
      '/\\evil.example/a.jpg',
      'images/a.png',
      ' /images/a.png',
      'javascript:alert(1)',
      'blob:https://x.test/uuid',
      'http://evil/a.jpg',
      'data:image/png;base64,AAAA',
    ]) {
      const r = render(<Image src={bad} alt="a" allowRelative />);
      expect(r.container.querySelector('img'), `${JSON.stringify(bad)} must not render an img`).toBeNull();
    }
  });

  it('accepts a raster data URL only under allowDataImage, never SVG (UMK-960)', () => {
    const png = render(<Image src="DATA:image/PNG;base64,AAAA" alt="a" allowDataImage />);
    expect(png.container.querySelector('img')).not.toBeNull();
    const jpg = render(<Image src="data:image/jpeg;base64,/9j/4AAQ+=" alt="a" allowDataImage />);
    expect(jpg.container.querySelector('img')).not.toBeNull();
    for (const bad of [
      'data:image/svg+xml;base64,AAAA',
      'data:image/svg+xml,<svg/>',
      ' data:image/png;base64,AAAA',
      'data:image/png;base64,AAAA"onerror="x',
      'data:text/html;base64,AAAA',
      'data:image/gif;base64,AAAA',
    ]) {
      const r = render(<Image src={bad} alt="a" allowDataImage />);
      expect(r.container.querySelector('img'), `${bad} must not render an img`).toBeNull();
    }
  });

  it('hands the render slot src, alt and the forwarded props, and never calls it for a refused src (UMK-960)', () => {
    const calls: Array<Record<string, unknown>> = [];
    const Spy = (p: Record<string, unknown>) => {
      calls.push(p);
      return <img src={p.src as string} alt={p.alt as string} />;
    };
    const ok = render(
      <Image as={Spy} src="/a.png" alt="Foto" allowRelative imgProps={{ priority: true, sizes: '100vw' }} />,
    );
    expect(ok.container.querySelector('img')).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      src: '/a.png',
      alt: 'Foto',
      priority: true,
      sizes: '100vw',
      className: expect.stringContaining('object-'),
    });
    const refused = render(<Image as={Spy} src="/a.png" alt="Foto" />);
    expect(refused.container.querySelector('img')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('renders a static import through the slot and gates on its src (UMK-960)', () => {
    const calls: Array<Record<string, unknown>> = [];
    const Spy = (p: Record<string, unknown>) => {
      calls.push(p);
      return <img src="x" alt="" />;
    };
    const asset = { src: '/_next/static/media/a.hash.jpg', width: 800, height: 600, blurDataURL: 'data:image/jpeg;base64,AAAA' };
    const ok = render(<Image as={Spy} src={asset} alt="a" allowRelative imgProps={{ placeholder: 'blur' }} />);
    expect(ok.container.querySelector('img')).not.toBeNull();
    /* The slot gets the WHOLE object, or next/image loses its blur data and intrinsic size. */
    expect(calls[0].src).toBe(asset);
    expect(calls[0].placeholder).toBe('blur');
    /* Without the opt-in, or with a hostile src inside the object, nothing renders. */
    const bare = render(<Image as={Spy} src={asset} alt="a" />);
    expect(bare.container.querySelector('img')).toBeNull();
    const evil = render(<Image as={Spy} src={{ ...asset, src: '//evil.example/a.jpg' }} alt="a" allowRelative />);
    expect(evil.container.querySelector('img')).toBeNull();
    expect(calls).toHaveLength(1);
    const plain = render(<Image src={asset} alt="a" allowRelative />);
    expect(plain.container.querySelector('img')!.getAttribute('src')).toBe(asset.src);
  });

  it('forwards unoptimized, referrerPolicy, loading and decoding to the slot (UMK-960)', () => {
    const seen: Array<Record<string, unknown>> = [];
    const Spy = (p: Record<string, unknown>) => {
      seen.push(p);
      return <img src="x" alt="" />;
    };
    render(
      <Image
        as={Spy}
        src="https://cdn.example/a.jpg"
        alt="a"
        imgProps={{ unoptimized: true, referrerPolicy: 'no-referrer', loading: 'lazy', decoding: 'async', 'aria-hidden': true }}
      />,
    );
    expect(seen[0]).toMatchObject({ unoptimized: true, referrerPolicy: 'no-referrer', loading: 'lazy', decoding: 'async', 'aria-hidden': true });
    /* On the plain element too: React renders it as the attribute. */
    const plain = render(<Image bare decorative src="https://cdn.example/a.jpg" imgProps={{ 'aria-hidden': true }} />);
    expect(plain.container.querySelector('img')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('forwards suppressHydrationWarning to the box that carries the className (UMK-960)', () => {
    /* React does not render the prop as an attribute, so the observable proof is a client-state class
       that differs from the server's: no hydration error is raised for the box. */
    const html = '<div class="relative flex w-fit max-w-full h-8 invert"><img src="https://cdn.example/a.jpg" alt="x" class="block h-full w-auto max-w-full"></div>';
    const hydrateWith = (suppress: boolean) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      document.body.appendChild(host);
      const errors: unknown[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
      act(() => {
        hydrateRoot(host, <Image bare suppressHydrationWarning={suppress} src="https://cdn.example/a.jpg" alt="x" className="h-8" />, {
          onRecoverableError: (e: unknown) => errors.push(e),
        });
      });
      spy.mockRestore();
      host.remove();
      return errors;
    };
    /* The control: without the prop the same mismatch IS reported, so a silent `true` run proves the forwarding. */
    expect(hydrateWith(false).length).toBeGreaterThan(0);
    expect(hydrateWith(true)).toEqual([]);
  });

  it('draws a bare image with none of the box chrome, keeping the caller className (UMK-960)', () => {
    const bare = render(<Image bare src="https://cdn.example/a.jpg" alt="Logo" className="h-8 lg:h-10" />);
    const box = bare.container.firstElementChild!;
    for (const gone of ['aspect-square', 'overflow-hidden', 'bg-default-primary', 'w-full', 'rounded-ds-md']) {
      expect(box.classList.contains(gone), `bare must not carry ${gone}`).toBe(false);
    }
    expect(box.classList.contains('h-8')).toBe(true);
    expect(box.classList.contains('relative')).toBe(true);
    expect(bare.container.querySelector('img')!.className).toContain('h-full');
    /* `intrinsic` leaves the width/height attributes in charge: a CSS `h-full w-auto` would turn
       them into the image file's natural size whenever the box has no definite height. */
    const intrinsic = render(<Image bare fit="intrinsic" src="https://cdn.example/a.jpg" alt="" imgProps={{ width: 150, height: 36 }} />);
    const iclass = intrinsic.container.querySelector('img')!;
    expect(iclass.className).not.toContain('h-full');
    expect(iclass.className).not.toContain('w-auto');
    expect(iclass.getAttribute('width')).toBe('150');
    const filled = render(<Image bare fit="fill" src="https://cdn.example/a.jpg" alt="" />);
    expect(filled.container.querySelector('img')!.className).toContain('object-fill');
    /* The placeholder branch keeps the gate: a bare image with a bad src draws no img. */
    expect(render(<Image bare src="/a.png" alt="a" />).container.querySelector('img')).toBeNull();
  });

  it('merges a box style with the ratio and forwards data attributes and style to the slot (UMK-960)', () => {
    const seen: Array<Record<string, unknown>> = [];
    const Spy = (p: Record<string, unknown>) => {
      seen.push(p);
      return <img src="x" alt="" />;
    };
    const r = render(
      <Image
        as={Spy}
        bare
        ratio={2}
        style={{ width: '40%' }}
        src="https://cdn.example/a.jpg"
        alt=""
        imgProps={{ style: { objectPosition: '68% center' }, 'data-ai-pinwheel': '' }}
      />,
    );
    const box = r.container.firstElementChild as HTMLElement;
    expect(box.style.aspectRatio).toBe('2 / 1');
    expect(box.style.width).toBe('40%');
    expect(seen[0]).toMatchObject({ style: { objectPosition: '68% center' }, 'data-ai-pinwheel': '' });
  });

  it('lets a trigger shrink and gives xsmall its own padding and 14px type (UMK-960)', () => {
    const r = render(
      <Tabs size="xsmall" defaultValue="a">
        <TabsList label="Pengaturan">
          <TabsTrigger value="a">Tampilan</TabsTrigger>
          <TabsTrigger value="b">Komunitas</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    for (const tab of r.getAllByRole('tab')) {
      expect(tab.classList).toContain('min-w-0');
      expect(tab.classList).toContain('px-0');
      expect(tab.classList).toContain('py-ds-xs');
      expect(tab.classList).toContain('text-ds-paragraph-mobile');
      expect(tab.classList).not.toContain('px-ds-md');
    }
  });

  it('selects one Card radius token per rung and keeps the default when rounded is off (UMK-960)', () => {
    const radii = (el: Element) => [...el.classList].filter((c) => c.startsWith('rounded-'));
    expect(radii(render(<Card>x</Card>).container.firstElementChild!)).toEqual(['rounded-ds-2xl']);
    const want = { none: 'null', sm: 'lg', md: 'xl', lg: '2xl', full: 'full' } as const;
    for (const [rung, token] of Object.entries(want)) {
      const card = render(<Card rounded={rung as keyof typeof want}>x</Card>).container.firstElementChild!;
      expect(radii(card)).toEqual([`rounded-ds-${token}`]);
    }
  });

  it('applies a custom ratio by inline style and selects one radius token (UMK-960)', () => {
    const r = render(<Image type="natural" ratio="25 / 18" rounded="3xl" src="https://cdn.example/a.jpg" alt="a" />);
    const box = r.container.firstElementChild as HTMLElement;
    expect(box.style.aspectRatio).toBe('25 / 18');
    /* SELECTED, not appended: tailwind-merge keeps both rungs of an unknown scale. */
    const radii = [...box.classList].filter((c) => c.startsWith('rounded-'));
    expect(radii).toEqual(['rounded-ds-3xl']);
    const circle = render(<Image rounded="full" src="https://cdn.example/a.jpg" alt="a" />);
    expect([...circle.container.firstElementChild!.classList].filter((c) => c.startsWith('rounded-'))).toEqual(['rounded-ds-full']);
    expect((render(<Image src="https://cdn.example/a.jpg" alt="a" />).container.firstElementChild as HTMLElement).style.aspectRatio).toBe('');
  });

  it('selects one radius on an avatar too, since its circle is rounded-full (UMK-960)', () => {
    const r = render(<Image type="avatar" rounded="md" src="https://cdn.example/a.jpg" alt="a" />);
    const radii = [...(r.container.firstElementChild as HTMLElement).classList].filter((c) => c.startsWith('rounded-'));
    expect(radii).toEqual(['rounded-ds-md']);
  });

  it('adds the radius to a bare box and keeps style and ratio on a refused source (UMK-960)', () => {
    const bare = render(<Image bare rounded="lg" src="https://cdn.example/a.jpg" alt="a" />);
    const box = bare.container.firstElementChild as HTMLElement;
    expect(box.classList).toContain('rounded-ds-lg');
    expect(box.classList).toContain('overflow-hidden');
    const refused = render(<Image ratio="2 / 1" style={{ opacity: 0.5 }} src="/a.png" alt="a" />);
    const ph = refused.container.firstElementChild as HTMLElement;
    expect(refused.container.querySelector('img')).toBeNull();
    expect(ph.style.aspectRatio).toBe('2 / 1');
    expect(ph.style.opacity).toBe('0.5');
  });

  it('draws an avatar as a circle (UMK-1186)', () => {
    const { container } = render(<Image src="https://cdn.example/a.jpg" alt="Budi" type="avatar" />);
    const classes = [...container.querySelectorAll('*')].flatMap((el) => [...el.classList]);
    for (const c of IMAGE_TYPE.avatar.split(' ')) expect(classes).toContain(c);
    expect(IMAGE_TYPE.avatar).toContain('rounded-full');
  });

  it('fills the circle with the photo by default rather than letterboxing it', () => {
    const avatar = render(<Image src="https://cdn.example/a.jpg" alt="Budi" type="avatar" />);
    const thumb = render(<Image src="https://cdn.example/a.jpg" alt="Budi" type="thumbnail" />);
    expect(avatar.container.querySelector('img')!.className).toContain('object-cover');
    expect(thumb.container.querySelector('img')!.className).toContain('object-contain');
  });

  it('shows the placeholder, such as initials, for an avatar with no photo', () => {
    const { container, getByText } = render(
      <Image src="" alt="Budi Santoso" type="avatar" placeholder="BS" />,
    );
    expect(getByText('BS')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders an empty alt only for an explicitly decorative Image', () => {
    /* The union exists to stop a SILENT empty-string fallback. `decorative` is the opt-in, and
       this asserts the sentinel actually reaches the element rather than being dropped. */
    const dec = render(<Image src="https://cdn.example/a.jpg" decorative />);
    expect(dec.container.querySelector('img')!.getAttribute('alt')).toBe('');
    const named = render(<Image src="https://cdn.example/a.jpg" alt="Etalase" />);
    expect(named.container.querySelector('img')!.getAttribute('alt')).toBe('Etalase');
  });

  it('applies each Image fit mode to the img rather than the box', () => {
    const cover = render(<Image src="https://cdn.example/a.jpg" alt="a" fit="cover" />);
    const contain = render(<Image src="https://cdn.example/a.jpg" alt="a" fit="contain" />);
    /* The fit lands on the IMG. Putting it on the wrapper renders identically at the default
       size and wrongly at every other one. */
    expect(cover.container.querySelector('img')!.className).toContain('object-cover');
    expect(contain.container.querySelector('img')!.className).toContain('object-contain');
  });

  it('keeps exactly one tab in the tab order, and moves it with the selection', async () => {
    const user = userEvent.setup();
    const { container } = render(<TabsHarness />);
    const tabIndexes = () =>
      [...container.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('tabindex'));
    /* ROVING TABINDEX. Without it, Tab walks through every trigger one at a time — which is
       the pattern a tablist exists to avoid, and it renders identically. */
    expect(tabIndexes()).toEqual(['0', '-1', '-1']);
    await user.click(container.querySelectorAll('[role="tab"]')[1] as HTMLElement);
    expect(tabIndexes()).toEqual(['-1', '0', '-1']);
  });

  it('skips a disabled tab when traversing by keyboard', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Tabs defaultValue="satu">
        <TabsList label="Contoh">
          <TabsTrigger value="satu">Satu</TabsTrigger>
          <TabsTrigger value="dua" disabled>
            Dua
          </TabsTrigger>
          <TabsTrigger value="tiga">Tiga</TabsTrigger>
        </TabsList>
        <TabsContent value="satu">A</TabsContent>
        <TabsContent value="dua">B</TabsContent>
        <TabsContent value="tiga">C</TabsContent>
      </Tabs>,
    );
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    /* LANDING ON THE DISABLED TAB WOULD STRAND THE KEYBOARD THERE: `.focus()` and `.click()`
       are both silent no-ops on a disabled button, so every later arrow press would recompute
       from an index of -1 and return early, with the mouse the only way out. */
    expect(document.activeElement).toBe(tabs[2]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('opens a Disclosure only when it is told to', () => {
    const folded = render(<Disclosure title="T">body</Disclosure>);
    const open = render(
      <Disclosure title="T" defaultOpen>
        body
      </Disclosure>,
    );
    /* The native `open` attribute IS the state. A disclosure that renders its panel markup
       either way looks correct in a snapshot and is permanently expanded in a browser. */
    expect(folded.container.querySelector('details')!.hasAttribute('open')).toBe(false);
    expect(open.container.querySelector('details')!.hasAttribute('open')).toBe(true);
  });

  it('gives List a visibly different container per direction', () => {
    const vertical = render(<List>a</List>);
    const horizontal = render(<List direction="horizontal">a</List>);
    /* Two directions resolving to the same class is a layout axis that does not lay anything
       out — the same shape as an axis whose values map to one treatment. */
    const v = vertical.container.firstElementChild!.className;
    const h = horizontal.container.firstElementChild!.className;
    expect(v).not.toBe(h);
    expect(v).toContain('flex-col');
    expect(h).toContain('flex-wrap');
  });

  it('renders no img for a non-https Image source', () => {
    const { containers } = mountAll(ImageStories as unknown as AnyModule);
    const placeholders = containers.filter((c) => !c.querySelector('img'));
    /* THE SECURITY BRANCH. Not "renders a placeholder" — the claim is that NO REQUEST is
       made, and the only observable form of that is the absence of the element. The
       `NonHttps` and `Empty` stories are the two that take it. */
    expect(placeholders.length).toBeGreaterThanOrEqual(2);
    expect(containers.some((c) => c.querySelector('img[src^="https://"]'))).toBe(true);
    expect(containers.some((c) => c.querySelector('img[src^="http://"]'))).toBe(false);
  });

  it('renders a List as a div with a drawn bullet, not a ul, unless asked (UMK-960)', () => {
    const { containers } = mountAll(ListStories as unknown as AnyModule);
    /* The TAG NAME, so a later switch to `<ul>` has to be a decision rather than a drift.
       Items author their own prose, so a semantic list would announce a list of paragraphs.
       Only the `as` stories may carry a semantic list. */
    const semantic = containers.filter((c) => c.querySelector('ul, ol, li'));
    expect(semantic).toHaveLength(3);
    expect(containers.some((c) => c.querySelector('[class*="rounded-ds-full"]'))).toBe(true);
    expect(render(<List>a</List>).container.firstElementChild!.tagName).toBe('DIV');
    expect(render(<List direction="bullet">a</List>).container.querySelector('ul, ol, li')).toBeNull();
  });

  it('renders List as a real ul or ol with an li per child (UMK-960)', () => {
    const ul = render(
      <List as="ul">
        <span>a</span>
        <span>b</span>
      </List>,
    );
    expect(ul.container.firstElementChild!.tagName).toBe('UL');
    expect(ul.container.querySelectorAll('ul > li')).toHaveLength(2);
    const ol = render(
      <List as="ol">
        <span>a</span>
        <span>b</span>
      </List>,
    );
    expect(ol.container.firstElementChild!.tagName).toBe('OL');
    expect(ol.container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(ol.container.firstElementChild!.className).toContain('list-decimal');
    /* Preflight strips the marker and the flex column blockifies the li, so Safari/VoiceOver drops
       the list role unless it is stated. */
    expect(ul.container.firstElementChild!.getAttribute('role')).toBe('list');
    expect(ol.container.firstElementChild!.getAttribute('role')).toBe('list');
    expect(render(<List>a</List>).container.firstElementChild!.hasAttribute('role')).toBe(false);
  });

  it('does not wrap whitespace text, and does not double-wrap an li (UMK-960)', () => {
    const r = render(
      <List as="ul">
        {'\n'}
        <li>a</li>
        {'\n'}
        <li>b</li>
      </List>,
    );
    expect(r.container.querySelectorAll('li')).toHaveLength(2);
    expect(r.container.querySelectorAll('li > li')).toHaveLength(0);
    const itemless = render(
      <List as="ol" itemless>
        <li>a</li>
        <li>b</li>
      </List>,
    );
    expect(itemless.container.querySelectorAll('li')).toHaveLength(2);
    expect(itemless.container.querySelectorAll('li > li')).toHaveLength(0);
  });

  it('selects the gap rung instead of stacking it on the direction gap (UMK-960)', () => {
    const r = render(
      <List as="ul" gap="sm" itemless>
        <li>a</li>
      </List>,
    );
    const gaps = [...r.container.firstElementChild!.classList].filter((c) => c.startsWith('gap-'));
    expect(gaps).toEqual(['gap-ds-sm']);
    const h = render(<List direction="horizontal" gap="2xs">a</List>);
    expect([...h.container.firstElementChild!.classList].filter((c) => c.startsWith('gap-'))).toEqual(['gap-ds-2xs']);
  });

  it('takes a breakpoint-keyed gap, selecting one rung per breakpoint (UMK-960)', () => {
    const r = render(
      <List as="ul" itemless gap={{ base: '2xl', lg: '3xl-mobile' }}>
        <li>a</li>
      </List>,
    );
    const classes = [...r.container.firstElementChild!.classList];
    expect(classes.filter((c) => c.startsWith('gap-'))).toEqual(['gap-ds-2xl']);
    expect(classes.filter((c) => c.startsWith('lg:gap-'))).toEqual(['lg:gap-ds-3xl-mobile']);
    /* A base-only object is the same as the plain rung. */
    const plain = render(<List gap={{ base: 'sm' }}>a</List>);
    expect([...plain.container.firstElementChild!.classList].filter((c) => /gap-/.test(c))).toEqual(['gap-ds-sm']);
  });

  it('applies a md gap rung from a responsive gap (UMK-960)', () => {
    const el = render(<List gap={{ base: 'sm', md: 'lg' }}>a</List>).container.firstElementChild!;
    expect([...el.classList].filter((c) => c.startsWith('md:gap-'))).toEqual(['md:gap-ds-lg']);
  });

  it('gives a marker list the 4xs space-y when no gap is passed (UMK-960)', () => {
    const el = render(
      <List as="ul" marker="disc">
        <span>a</span>
      </List>,
    ).container.firstElementChild!;
    expect([...el.classList].filter((c) => c.startsWith('space-y-'))).toEqual(['space-y-ds-4xs']);
  });

  it('draws native markers on a block list, with space-y rather than a flex gap (UMK-960)', () => {
    const disc = render(
      <List as="ul" marker="disc" gap="xs">
        <span>a</span>
      </List>,
    );
    const el = disc.container.firstElementChild!;
    expect(el.className).toContain('list-disc');
    expect(el.className).not.toContain('flex');
    expect([...el.classList].filter((c) => c.startsWith('space-y-'))).toEqual(['space-y-ds-xs']);
    /* A horizontal ol is a breadcrumb: no numbers. */
    const crumbs = render(
      <List as="ol" direction="horizontal" itemless>
        <li>a</li>
      </List>,
    );
    expect(crumbs.container.firstElementChild!.className).not.toContain('list-decimal');
    expect(crumbs.container.firstElementChild!.className).toContain('flex-wrap');
  });

  it('keeps the drawn bullet inside the li for a semantic bullet list (UMK-960)', () => {
    const r = render(
      <List as="ul" direction="bullet">
        <span>a</span>
      </List>,
    );
    const li = r.container.querySelector('ul > li')!;
    expect(li.querySelector('[aria-hidden]')).not.toBeNull();
    /* A drawn bullet beside a native decimal marker would double-mark every row. */
    const olBullet = render(
      <List as="ol" direction="bullet">
        <span>a</span>
      </List>,
    );
    expect(olBullet.container.firstElementChild!.className).not.toContain('list-decimal');
  });

  const TabsHarness = ({ onValueChange }: { onValueChange?: (v: string) => void }) => (
    <Tabs defaultValue="satu" onValueChange={onValueChange}>
      <TabsList label="Contoh">
        <TabsTrigger value="satu">Satu</TabsTrigger>
        <TabsTrigger value="dua">Dua</TabsTrigger>
        <TabsTrigger value="tiga">Tiga</TabsTrigger>
      </TabsList>
      <TabsContent value="satu">Panel satu</TabsContent>
      <TabsContent value="dua">Panel dua</TabsContent>
      <TabsContent value="tiga">Panel tiga</TabsContent>
    </Tabs>
  );

  it('keeps every tab panel mounted and resolves aria-controls for the UNSELECTED tabs', () => {
    const { container } = render(<TabsHarness />);
    const panels = [...container.querySelectorAll('[role="tabpanel"]')];
    expect(panels).toHaveLength(3);
    expect(panels.filter((p) => p.hasAttribute('hidden'))).toHaveLength(2);

    /* THE WHOLE POINT OF THE RENDER CHANGE. `TabsContent` used to return `null` for inactive
       values, so only one panel existed — and an `aria-controls` on any other tab pointed at
       nothing. Asserting it for the UNSELECTED tabs specifically is what catches a revert:
       the selected tab's reference resolves either way. */
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      const id = tab.getAttribute('aria-controls');
      expect(id, 'a tab wired no aria-controls').toBeTruthy();
      const panel = container.ownerDocument.getElementById(id!);
      expect(panel, `aria-controls="${id}" resolves to nothing`).not.toBeNull();
      /* And back the other way, so the pairing is proven in both directions. */
      expect(panel!.getAttribute('aria-labelledby')).toBe(tab.getAttribute('id'));
    }
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('gives two mounted tab sets distinct ids', () => {
    const { container } = render(
      <>
        <TabsHarness />
        <TabsHarness />
      </>,
    );
    /* The collision an id scheme gets wrong first: six tabs across two sets, and a scheme
       keyed only on the tab's value hands three of them the other set's panel. */
    const ids = [...container.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('id'));
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('traverses tabs by arrow key, wrapping in both directions, with Home and End', async () => {
    const user = userEvent.setup();
    const { container, getByRole } = render(<TabsHarness />);
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0].focus();

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement, 'left from the first should wrap to the last').toBe(tabs[2]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement, 'right from the last should wrap to the first').toBe(tabs[0]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(tabs[2]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(tabs[0]);

    /* Selection FOLLOWS focus, per the automatic-activation pattern the click path already
       uses. A focused tab whose panel does not follow reads as a dead key. */
    await user.keyboard('{ArrowRight}');
    expect(getByRole('tab', { name: 'Dua' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switches the visible panel on click and reports the change', async () => {
    const user = userEvent.setup();
    const changes: string[] = [];
    const { container, getByRole } = render(<TabsHarness onValueChange={(v) => changes.push(v)} />);
    await user.click(getByRole('tab', { name: 'Dua' }));

    expect(changes).toEqual(['dua']);
    const visible = [...container.querySelectorAll('[role="tabpanel"]')].filter(
      (p) => !p.hasAttribute('hidden'),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toBe('Panel dua');
  });

  it('renders no legacy z-* brand token anywhere in the eight', () => {
    /* The four rewrites all carried these — `bg-z-primary`, `bg-z-lightGray`,
       `text-z-text-gray`, `text-z-text-primary`. They are a retiring group, so a survivor
       renders today and stops rendering on the day the group goes, with nothing else in the
       suite able to see it. Asserted over the RENDER rather than the source, so a legacy
       token reaching an element through `className` is caught too. */
    for (const [name, mod] of Object.entries(MODULES)) {
      const { classes } = mountAll(mod as unknown as AnyModule);
      const legacy = [...classes].filter(hasLegacyBrandToken);
      expect(legacy, `${name} renders a legacy z-* token`).toEqual([]);
    }
  });
});

describe('CodeBlock', () => {
  /* One stub per test, restored after — a shared spy leaks the copied state of one assertion
     into the next, which is how a "reverts to idle" test passes without reverting anything. */
  const withClipboard = async (impl: () => Promise<void>, run: () => Promise<void>) => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: impl },
      configurable: true,
    });
    try {
      await run();
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  };

  it('renders its content and a copy control', () => {
    render(<CodeBlock label="bash">npm install</CodeBlock>);
    expect(screen.getByText('npm install')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Salin/ })).toBeTruthy();
  });

  it('draws the copy icon on the idle button (E15)', () => {
    const { container } = render(<CodeBlock label="bash">npm install</CodeBlock>);
    const idle = container.querySelector('button svg')!.outerHTML;
    const { container: ref } = render(<Icon name="copy" size="sm" aria-hidden />);
    expect(idle).toBe(ref.querySelector('svg')!.outerHTML);
  });

  it('writes the content to the clipboard and shows the copied state', async () => {
    const written: string[] = [];
    await withClipboard(
      async (text?: string) => {
        written.push(String(text));
      },
      async () => {
        render(<CodeBlock label="bash">npm install</CodeBlock>);
        await userEvent.click(screen.getByRole('button', { name: /Salin/ }));
        expect(written).toEqual(['npm install']);
        expect(screen.getByRole('button', { name: /Tersalin/ })).toBeTruthy();
      },
    );
  });

  it('writes the explicit payload rather than the rendered text', async () => {
    const written: string[] = [];
    await withClipboard(
      async (text?: string) => {
        written.push(String(text));
      },
      async () => {
        render(
          <CodeBlock label="perintah" copyText="npm run dev">
            $ npm run dev
          </CodeBlock>,
        );
        await userEvent.click(screen.getByRole('button', { name: /Salin/ }));
        expect(written).toEqual(['npm run dev']);
      },
    );
  });

  /**
   * THE FAILURE THIS COMPONENT EXISTS TO FIX. Both live copies call `.then()` with no
   * rejection handler, so a refused or unavailable clipboard leaves the button doing nothing
   * at all and the user clicking again.
   */
  it('shows a visible failure when the clipboard write is rejected', async () => {
    await withClipboard(
      async () => {
        throw new Error('denied');
      },
      async () => {
        render(<CodeBlock label="bash">npm install</CodeBlock>);
        await userEvent.click(screen.getByRole('button', { name: /Salin/ }));
        expect(screen.getByRole('button', { name: /Gagal menyalin/ })).toBeTruthy();
        expect(screen.queryByText('Tersalin')).toBeNull();
      },
    );
  });

  /* `navigator.clipboard` is ABSENT outside a secure context, which is a different failure
     from a rejected write and reaches the same visible state rather than throwing. */
  it('fails visibly when there is no clipboard API at all', async () => {
    /* DEFINED as undefined, not deleted: the property lives on the prototype here, so
       `delete` on the instance leaves the real implementation in place and the test then
       passes by copying successfully — measuring nothing. */
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    try {
      render(<CodeBlock label="bash">npm install</CodeBlock>);
      await userEvent.click(screen.getByRole('button', { name: /Salin/ }));
      expect(screen.getByRole('button', { name: /Gagal menyalin/ })).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
    }
  });

  /* The glyph swap is not a channel every reader has, so the word changes AND is announced. */
  it('announces the transient state rather than only swapping the glyph', async () => {
    await withClipboard(
      async () => {},
      async () => {
        const { container } = render(<CodeBlock label="bash">npm install</CodeBlock>);
        const live = container.querySelector('[aria-live]')!;
        expect(live.textContent).toBe('Salin');
        await userEvent.click(screen.getByRole('button', { name: /Salin/ }));
        expect(live.textContent).toBe('Tersalin');
      },
    );
  });

  /* `writeText('')` RESOLVES, so an empty payload would otherwise announce success having put
     nothing on the clipboard — and element children with no `copyText` is the normal case for
     both named consumers. */
  it('fails visibly rather than announcing success when there is nothing to copy', async () => {
    const written: string[] = [];
    await withClipboard(
      async (text?: string) => {
        written.push(String(text));
      },
      async () => {
        render(<CodeBlock label="bash"><span>rendered as elements</span></CodeBlock>);
        await userEvent.click(screen.getByRole('button', { name: /Salin/ }));
        expect(written).toEqual([]);
        expect(screen.getByRole('button', { name: /Gagal menyalin/ })).toBeTruthy();
      },
    );
  });

  it('collapses the bar label when none is given', () => {
    const { container } = render(<CodeBlock>npm install</CodeBlock>);
    const bar = container.firstElementChild!.firstElementChild!;
    expect(bar.firstElementChild!.textContent).toBe('');
    /* The control is still there — the LABEL collapses, not the bar. */
    expect(bar.querySelector('button')).not.toBeNull();
  });
});

describe('Stepper', () => {
  it('derives first, middle and last from the trail', () => {
    const { container } = render(
      <Stepper aria-label="trail" steps={[{ label: 'a' }, { label: 'b' }, { label: 'c' }]} />,
    );
    const items = [...container.querySelectorAll('li')];
    expect(items).toHaveLength(3);
    expect(items[0].querySelector('[aria-hidden]')).toBeNull();
    for (const item of items.slice(1)) expect(item.querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('exposes the current step rather than only colouring it', () => {
    const { container } = render(
      <Stepper
        aria-label="trail"
        steps={[{ label: 'a', state: 'done' }, { label: 'b', state: 'current' }, { label: 'c' }]}
      />,
    );
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0].closest('li')!.textContent).toContain('b');
  });

  it('renders a one-step trail with no connector at all', () => {
    const { container } = render(<Stepper aria-label="trail" steps={[{ label: 'only' }]} />);
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.querySelector('[aria-hidden]')).toBeNull();
  });

  it('numbers each step, and swaps the numeral for a glyph once it is done', () => {
    const { container } = render(
      <Stepper aria-label="trail" steps={[{ label: 'a', state: 'done' }, { label: 'b' }]} />,
    );
    const marks = [...container.querySelectorAll('li')].map((li) => li.querySelector('span[class*="rounded-ds-full"]')!);
    expect(marks[0].querySelector('svg')).not.toBeNull();
    expect(marks[0].textContent).not.toContain('1');
    expect(marks[1].textContent).toContain('2');
  });

  /**
   * WHICH glyph, not merely that there is one.
   *
   * `Icon` renders the registry's component directly with no name and no `data-*`, so the
   * mark's DOM cannot say which drawing it mounted — the assertion above passes against any
   * `<svg>` at all, which is how the outline survived here. The pair below closes it: the
   * registry entry is pinned BY IDENTITY (the precedent in `Icon.test.tsx`), and the rendered
   * mark is pinned to that same glyph's `viewBox`, which is what ties the registry row to what
   * `Stepper` actually mounts. Substituting either check-circle reddens both halves.
   */
  it('draws the completed step with the filled check, not an outline', () => {
    expect(ICON_REGISTRY['check-circle-filled'].component).toBe(GlyphCheckCircleFilled);
    const { container } = render(
      <Stepper aria-label="trail" steps={[{ label: 'a', state: 'done' }]} />,
    );
    const glyph = container.querySelector('span[class*="rounded-ds-full"] svg')!;
    expect(glyph.getAttribute('viewBox')).toBe('0 0 17 17');
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
  });

  /* A `fill-*` utility would beat the glyph's own `fill="currentColor"` and no unit test could
     see which won — the class and the attribute are both present either way. So the absence is
     asserted here rather than left to a browser to discover. */
  it('lets the glyph inherit the mark\'s ink rather than overriding it', () => {
    const { container } = render(
      <Stepper aria-label="trail" steps={[{ label: 'a', state: 'done' }]} />,
    );
    const mark = container.querySelector('span[class*="rounded-ds-full"]')!;
    expect(mark.className).not.toMatch(/(?:^|\s)fill-/);
    expect(container.querySelector('svg')!.getAttribute('class') ?? '').not.toMatch(/(?:^|\s)fill-/);
  });

  /* Orientation is a LAYOUT change. The announced order is the list's, so it must not move. */
  it('changes the layout without changing the announced order', () => {
    const order = (orientation: 'horizontal' | 'vertical') =>
      [
        ...render(
          <Stepper
            orientation={orientation}
            aria-label="trail"
            steps={[{ label: 'a' }, { label: 'b' }, { label: 'c' }]}
          />,
        ).container.querySelectorAll('li'),
      ].map((li) => li.textContent);
    expect(order('horizontal')).toEqual(order('vertical'));
  });

  /**
   * THE TOKEN ASSERTIONS, WRITTEN AGAINST THE NAMES RATHER THAN THE TABLE.
   *
   * Everything else in this file renders a component and compares it to the table it rendered
   * from, so repointing a state at the wrong token passes every one of them. These name the
   * intent instead — brand for a finished step, no fill for a default one — so a revert to
   * `default-success` reddens here and only here.
   */
  describe('paints `01 Mark`, not an approximation of it', () => {
    /* BOUNDARY-MATCHED, not `toContain`. `toContain('bg-default-brand')` is satisfied by
       `bg-weak-brand`, so a repoint to a paler sibling passes it — the purge guard
       next door already uses this form for exactly that reason. */
    it('finishes a step in brand, and runs the leg behind it in the same brand', () => {
      expect(STEPPER_MARK_STATE.done).toMatch(/(?:^|\s)bg-default-brand(?![-\w])/);
      expect(STEPPER_MARK_STATE.done).not.toContain('success');
      expect(STEPPER_CONNECTOR_STATE.done).toMatch(/(?:^|\s)bg-default-brand(?![-\w])/);
      expect(STEPPER_CONNECTOR_STATE.done).not.toContain('success');
    });

    it('leaves the default mark unfilled behind a 3px ring', () => {
      expect(STEPPER_MARK_STATE.default).not.toMatch(/(?:^|\s)bg-/);
      expect(STEPPER_MARK_STATE.default).toContain('border-3');
      expect(STEPPER_MARK_STATE.default).toContain('border-border-secondary');
    });

    /* `current` was already right. Pinned so the three edits above cannot drift the one state
       that needed none — a copy-paste across the table is otherwise invisible. */
    it('leaves `current` exactly as it was', () => {
      expect(STEPPER_MARK_STATE.current).toBe(
        'border-default-brand bg-default-brand text-default-invert',
      );
    });

    /* Boundary-matched: `toContain('h-9')` is satisfied by `h-96`. */
    it('draws the mark at Figma\'s 36px', () => {
      expect(STEPPER_MARK).toMatch(/(?:^|\s)h-9(?![-\w.])/);
      expect(STEPPER_MARK).toMatch(/(?:^|\s)w-9(?![-\w.])/);
    });
  });

  it('onSelect wraps mark and label in ONE button and leaves the connector and the rest alone', () => {
    for (const orientation of contract.Stepper.axes.orientation) {
      const onSelect = vi.fn();
      const { container } = render(
        <Stepper
          orientation={orientation}
          aria-label="trail"
          steps={[{ label: 'a', state: 'done' }, { label: 'b', state: 'current', onSelect, testId: 'pick-b' }, { label: 'c' }]}
        />,
      );
      const items = [...container.querySelectorAll('li')];
      expect(container.querySelectorAll('button')).toHaveLength(1);
      const button = items[1]!.querySelector('button[type="button"]')!;
      expect(button.getAttribute('data-testid')).toBe('pick-b');
      expect(within(container as HTMLElement).getByRole('button', { current: 'step' })).toBe(button);
      expect(button.querySelector('[aria-current]')).toBeNull();
      expect(button.textContent).toContain('b');
      expect(button.querySelector('[data-connector]'), `${orientation}: connector inside the button`).toBeNull();
      expect(button.parentElement).toBe(items[1]);
      expect(items[1]!.querySelector(':scope > [data-connector]')).not.toBeNull();
      for (const banned of ['relative', 'isolate', 'transform', 'transition-opacity', 'opacity-']) {
        expect(button.className.split(/\s+/)).not.toContain(banned);
      }
      expect(button.className).not.toMatch(/(?:^|\s)z-\d/);
      expect(button.innerHTML).not.toMatch(/fill-/);
      fireEvent.click(button.querySelectorAll('span')[0]!);
      fireEvent.click(button.querySelectorAll('span')[1]!);
      expect(onSelect).toHaveBeenCalledTimes(2);
    }
  });

  it('a done + selected step keeps its tick and finished leg and puts aria-current on the button (UMK-1809)', () => {
    for (const orientation of contract.Stepper.axes.orientation) {
      const { container } = render(
        <Stepper
          orientation={orientation}
          aria-label="trail"
          steps={[{ label: 'a', state: 'done', onSelect: () => {}, selected: true, testId: 'pick-a' }, { label: 'b', state: 'done' }, { label: 'c', state: 'current' }]}
        />,
      );
      const items = [...container.querySelectorAll('li')];
      const button = items[0]!.querySelector('button')!;
      expect(button.getAttribute('aria-current')).toBe('step');
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.querySelector('[aria-current]')).toBeNull();
      expect(items[1]!.querySelector('[data-connector]')!.className).toContain('bg-default-brand');
      // the unselected done step has no aria-current on any button
      expect(container.querySelectorAll('button[aria-current]')).toHaveLength(1);
      expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(2); // the button + the plain current mark of 'c'
    }
  });

  it('names the select button with selectLabel', () => {
    render(<Stepper aria-label="t" steps={[{ label: 'a', onSelect: () => {}, selectLabel: 'Lihat a' }]} />);
    expect(screen.getByRole('button', { name: 'Lihat a' })).toBeTruthy();
  });

  it('a step without onSelect renders no button', () => {
    const { container } = render(<Stepper aria-label="t" steps={[{ label: 'a' }, { label: 'b' }]} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('names the trail, because a list of numerals announces as nothing', () => {
    render(<Stepper aria-label="Langkah pendaftaran" steps={[{ label: 'a' }]} />);
    expect(screen.getByRole('list', { name: 'Langkah pendaftaran' })).toBeTruthy();
  });
});
