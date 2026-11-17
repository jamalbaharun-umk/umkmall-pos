import React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import * as CheckBoxStories from './CheckBox/CheckBox.stories';
import * as DateTimeInputStories from './DateTimeInput/DateTimeInput.stories';
import * as OtpInputStories from './OtpInput/OtpInput.stories';
import { SEGMENTED_SEGMENT_SIZE } from './field-classes';
import * as RadioStories from './Radio/Radio.stories';
import * as SegmentedControlStories from './SegmentedControl/SegmentedControl.stories';
import * as SelectStories from './Select/Select.stories';
import * as SelectionCardStories from './SelectionCard/SelectionCard.stories';
import * as SliderStories from './Slider/Slider.stories';
import * as SwitchStories from './Switch/Switch.stories';
import * as TextFieldStories from './TextField/TextField.stories';
import * as UploadStories from './Upload/Upload.stories';
import { contract, storyTitle, type ComponentName } from '../contract';
import * as fieldTables from './field-classes';
import {
  BOX_SIZE,
  BOX_STATE,
  BOX_STATE_COMPACT,
  BOX_HEIGHT_COMPACT,
  CONTROL_FIRST_LINE,
  SELECT_DISABLED_HINT,
  SELECT_LIST_SIZE,
  SELECT_OPTION,
  SELECT_ROW_SIZE,
  SELECT_OPTION_HINT,
  SELECTION_CARD_INDICATOR_SHAPE,
  SELECTION_CARD_INDICATOR_STATE,
  SELECTION_CARD_LAYOUT,
  SELECTION_CARD_TILE_SIZE,
  SELECTION_CARD_SIZE,
  SELECTION_CARD_STATE,
  UPLOAD_BORDER,
  UPLOAD_SIZE,
  UPLOAD_STATUS,
  CONTROL_BOX,
  RADIO_BOX,
  FIELD_ADORNMENT,
  FIELD_COUNTER,
  FIELD_COUNTER_LIMIT,
  OTP_BOX_SIZE,
} from './field-classes';
import { NAMES_A_BACKGROUND, NAMES_A_BORDER_COLOUR, NAMES_A_TEXT_COLOUR } from '../purge-support';

/**
 * The state table is a deliverable, so "every state is visible in Storybook" is asserted
 * rather than eyeballed — and asserted against what the stories RENDER, not against the prop
 * names their source happens to contain. A guard reading source text passes on a story that
 * sets the prop and never mounts it.
 *
 * Importing the story modules also pulls them into the typecheck program: `tsconfig` excludes
 * every stories file, and a story imported by a test is the only way one gets checked at all.
 * The precedent is `Icon.stories.test.ts`.
 *
 * hover and focus-visible are CSS-only and exempt — no story can render them.
 */
const STATE_TABLE = {
  TextField: ['disabled', 'error', 'required', 'readOnly', 'filled'],
  /* `required` left this row in UMK-1091, with the story demonstrating it. Figma's checkbox
     set publishes neither a required nor an error axis, so the two stories asserting them
     were states we had invented. `error` STAYS listed — the surviving accessibility story
     renders an errored box, and that is the whole point it makes. This guard asserts a story
     actually renders every state its row names, so deleting a story without editing this row
     reds the suite; the pairing is the enforcement. */
  CheckBox: ['disabled', 'error', 'checked', 'indeterminate'],
  Radio: ['disabled', 'error', 'required', 'checked'],
  Switch: ['disabled', 'checked', 'loading'],
  SegmentedControl: ['disabled', 'checked'],
  Slider: ['disabled'],
  DateTimeInput: ['disabled', 'error', 'required', 'filled'],
  /* The three that joined in UMK-961. `filled` is the derived state on all three — a chosen
     option, a chosen file, a chosen value — and each is exposed the way its own control does
     it, which is why the probes below read `checked`, `data-filled` and `aria-selected` rather
     than one attribute. */
  SelectionCard: ['disabled', 'checked'],
  /* `loading` is the busy zone, probed by `aria-busy` like `Switch`'s. Drag-over is not here
     because it is not a status at all — it is a pointer condition no story can render, and the
     browser gate covers it. */
  Upload: ['disabled', 'error', 'required', 'filled', 'loading'],
  Select: ['disabled', 'error', 'filled'],
  /* UMK-1186. `filled` is the one real input holding digits. */
  OtpInput: ['disabled', 'error', 'filled'],
} as const;

const MODULES = {
  TextField: TextFieldStories,
  CheckBox: CheckBoxStories,
  Radio: RadioStories,
  Switch: SwitchStories,
  SegmentedControl: SegmentedControlStories,
  Slider: SliderStories,
  DateTimeInput: DateTimeInputStories,
  SelectionCard: SelectionCardStories,
  Upload: UploadStories,
  Select: SelectStories,
  OtpInput: OtpInputStories,
};

type AnyStory = { args?: Record<string, unknown>; render?: (a: never, b: never) => React.ReactElement };
type AnyModule = { default: { component: React.ElementType } } & Record<string, unknown>;

const element = (mod: AnyModule, story: AnyStory): React.ReactElement => {
  if (typeof story.render === 'function') return story.render(story.args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...(story.args ?? {})} />;
};

/** The states an actually-mounted story exposes, read off the DOM the way a user's AT would. */
const statesRendered = (mod: AnyModule): Set<string> => {
  const found = new Set<string>();
  for (const [name, story] of Object.entries(mod)) {
    if (name === 'default' || !story || typeof story !== 'object') continue;
    const { container } = render(element(mod, story as AnyStory));
    const all = [...container.querySelectorAll<HTMLElement>('*')];
    if (all.some((el) => el.hasAttribute('disabled'))) found.add('disabled');
    if (all.some((el) => el.getAttribute('aria-invalid') === 'true')) found.add('error');
    if (all.some((el) => el.hasAttribute('required'))) found.add('required');
    if (all.some((el) => el.getAttribute('aria-busy') === 'true')) found.add('loading');
    if (all.some((el) => el.hasAttribute('data-filled'))) found.add('filled');
    for (const input of container.querySelectorAll('input')) {
      if (input.checked) found.add('checked');
      if (input.indeterminate) found.add('indeterminate');
      if (input.readOnly) found.add('readOnly');
      if (input.value !== '' && input.type !== 'range') found.add('filled');
    }
    if (all.some((el) => el.getAttribute('aria-checked') === 'true')) found.add('checked');
    /* `aria-selected` is how a listbox says "filled"; nothing else in this family uses it, and
       without it the Select's own selected state would have no probe at all. */
    if (all.some((el) => el.getAttribute('aria-selected') === 'true')) found.add('filled');
  }
  return found;
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

describe('the form-control stories cover the state table', () => {
  /**
   * THE COUNT LITERAL THIS FILE SHIPPED WITHOUT.
   *
   * `MODULES` and `STATE_TABLE` are hand-maintained, and nothing in the suite asks a new
   * control to join them — a component omitted from both ships with zero story-guard coverage
   * against a fully green suite. The sibling content guard has had this assertion since it was
   * written; this one had none, which is why the omission had to be caught by reading rather
   * than by running.
   */
  it('covers every control the contract puts in this family', () => {
    expect(Object.keys(MODULES).sort()).toEqual(contractFamilyMembers('form-controls'));
    expect(Object.keys(STATE_TABLE).sort()).toEqual(Object.keys(MODULES).sort());
  });

  it.each(Object.entries(STATE_TABLE))('%s renders every state it has', (name, states) => {
    const rendered = statesRendered(MODULES[name as keyof typeof MODULES] as unknown as AnyModule);
    for (const state of states) {
      expect(rendered.has(state), `${name} has no story RENDERING "${state}"`).toBe(true);
    }
  });

  it.each(Object.keys(MODULES))('%s passes the contract array into its grid, not a default', (name) => {
    const mod = MODULES[name as keyof typeof MODULES] as Record<string, AnyStory>;
    const grid = (mod.AllSizes ?? mod.AllStates)!;
    const rendered = grid.render!({} as never, {} as never) as unknown as {
      props: { sizes: readonly string[] };
    };
    const axis = (contract[name as keyof typeof contract].axes as { size?: readonly string[] }).size;
    /* Assert the axis EXISTS first. `toEqual` is happy comparing undefined to undefined, so
       an entry that lost its size axis would pass this by having nothing to compare. */
    expect(axis, `${name} declares no size axis for the grid to iterate`).toBeTruthy();
    expect(rendered.props.sizes).toEqual(axis);
  });

  it('titles every story set for Storybook', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
      expect((mod as unknown as { default: { title: string } }).default.title).toBe(
        storyTitle(name as ComponentName),
      );
    }
  });
});

const PRIMITIVES = resolve(__dirname);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.test-?d?\./.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

describe('the form controls stay on their shared sources', () => {
  const files = sourceFiles(PRIMITIVES).map((f) => [f, readFileSync(f, 'utf8')] as const);

  it('names the focus token nowhere but the shared constant', () => {
    const offenders = files.filter(([, src]) => /composer-(?:border|ring)-focus/.test(src));
    expect(offenders.map(([f]) => f)).toEqual([]);
  });

  it('leaves no import of the absorbed Input or PasswordInput anywhere in the package', () => {
    /* Every module-load form, not just `from '…'`. A form list keyed on one shape has a
       hole in the middle that neither end reaches — a bare side-effect import, a dynamic
       `import()`, or a `require()` walks straight through it. Same rule the contract's own
       guard follows.
       See docs/solutions/conventions/a-guards-form-list-must-cover-export-star-and-barrels.md */
    const ABSORBED =
      /(?:from|import|require)\s*\(?\s*['"][^'"]*\/(?:Input|PasswordInput)(?:\/index)?['"]/;
    const offenders = files.filter(([, src]) => ABSORBED.test(src));
    expect(offenders.map(([f]) => f)).toEqual([]);
    /* `/index` too: the barrel already writes index-resolved specifiers elsewhere, so a
       re-export spelled `./Input/index` would slip past a pattern anchored on the name. */
    expect(readFileSync(join(PRIMITIVES, 'index.ts'), 'utf8')).not.toMatch(
      /'\.\/(?:Input|PasswordInput)(?:\/index)?'/,
    );
  });
});

/**
 * WHAT EACH TABLE VALUE MUST STRUCTURALLY CARRY — THE ONE CHECK IN THIS FAMILY THAT IS NOT
 * DERIVED FROM THE TABLES.
 *
 * Every other assertion here and in the purge sibling reads the same tables the controls
 * render from, so the tables are their own oracle: they prove a control faithfully echoes
 * whatever the table says, never that the table says the right thing. Emptying `BOX_SIZE.small`
 * was run as an injection against the whole package and NOTHING went red — both text-shaped
 * controls render unsized, and every table-derived expectation shrank by exactly as much as the
 * subject.
 *
 * So the pin is the SHAPE rather than a hand-copied string: a size step is padding plus a type
 * step plus a radius, a box state is a border colour, a counter is a type step plus an ink.
 * None of these need updating when a token is repointed, and no truncation can satisfy them.
 * The same reasoning and the same structure as `AXIS_SHAPE` in the content guard.
 */
const TABLE_SHAPE = {
  SEGMENTED_SEGMENT_SIZE: {
    table: SEGMENTED_SEGMENT_SIZE as Record<string, string>,
    rules: [/(?:^|\s)px-/, /(?:^|\s)py-/, /(?:^|\s)text-ds-/],
  },
  BOX_SIZE: {
    table: BOX_SIZE as Record<string, string>,
    rules: [/(?:^|\s)px-/, /(?:^|\s)py-/, /(?:^|\s)text-ds-/, /(?:^|\s)rounded-ds-/],
  },
  BOX_STATE: {
    table: BOX_STATE as Record<string, string>,
    rules: [NAMES_A_BORDER_COLOUR],
  },
  /* UMK-1548: the compact box's border ink replaces BOX_STATE's, and its height is a floor on one
     line or a line-height on many — each value names one of the two. */
  BOX_STATE_COMPACT: {
    table: BOX_STATE_COMPACT as Record<string, string>,
    rules: [NAMES_A_BORDER_COLOUR],
  },
  BOX_HEIGHT_COMPACT: {
    table: BOX_HEIGHT_COMPACT as Record<string, string>,
    rules: [/(?:^|\s)(?:min-h-|leading-)/],
  },
  /* UMK-955: a labelled control drops into its label's first 20px line, so every step names a top margin. */
  CONTROL_FIRST_LINE: {
    table: CONTROL_FIRST_LINE as Record<string, string>,
    rules: [/(?:^|\s)mt-/],
  },
  /* The three that joined in UMK-961. A size step is padding plus a type step plus a radius on
     every control in this family; a state is a border colour, because that is what the family
     draws its state with. */
  SELECTION_CARD_SIZE: {
    table: SELECTION_CARD_SIZE as Record<string, string>,
    rules: [/(?:^|\s)px-/, /(?:^|\s)py-/, /(?:^|\s)rounded-ds-/],
  },
  SELECTION_CARD_STATE: {
    table: SELECTION_CARD_STATE as Record<string, string>,
    rules: [NAMES_A_BORDER_COLOUR],
  },
  /* UMK-1218. A layout names its flex direction; the tile's corner control is a shape (a radius)
     and a state (a border colour), as the card itself is. */
  SELECTION_CARD_LAYOUT: {
    table: SELECTION_CARD_LAYOUT as Record<string, string>,
    rules: [/(?:^|\s)flex-(?:row|col)(?:\s|$)/],
  },
  /* The tile's own step: padding, a gap and a radius — the same shape as a size step. */
  SELECTION_CARD_TILE_SIZE: {
    table: SELECTION_CARD_TILE_SIZE as Record<string, string>,
    rules: [/(?:^|\s)px-/, /(?:^|\s)pt-/, /(?:^|\s)gap-ds-/, /(?:^|\s)rounded-ds-/],
  },
  SELECTION_CARD_INDICATOR_SHAPE: {
    table: SELECTION_CARD_INDICATOR_SHAPE as Record<string, string>,
    rules: [/(?:^|\s)rounded-ds-/],
  },
  SELECTION_CARD_INDICATOR_STATE: {
    table: SELECTION_CARD_INDICATOR_STATE as Record<string, string>,
    rules: [NAMES_A_BORDER_COLOUR],
  },
  UPLOAD_SIZE: {
    table: UPLOAD_SIZE as Record<string, string>,
    rules: [/(?:^|\s)px-/, /(?:^|\s)py-/, /(?:^|\s)rounded-ds-/, /(?:^|\s)text-ds-/],
  },
  UPLOAD_STATUS: {
    table: UPLOAD_STATUS as Record<string, string>,
    rules: [NAMES_A_BORDER_COLOUR, NAMES_A_TEXT_COLOUR],
  },
  /* Each value must NAME a stroke style. Without the rule a value could carry the other's
     class, or nothing at all, and the zone would inherit whatever `UPLOAD_BASE` last said —
     which is the drift this axis exists to replace. */
  UPLOAD_BORDER: {
    table: UPLOAD_BORDER as Record<string, string>,
    rules: [/(?:^|\s)border-(?:solid|dashed)(?:\s|$)/],
  },
  /* A listbox row's STATE is an ink; its padding and type step live in `SELECT_ROW_SIZE`
     (UMK-1122). The active row's surface is pinned separately below. */
  SELECT_OPTION: {
    table: SELECT_OPTION as Record<string, string>,
    rules: [NAMES_A_TEXT_COLOUR],
  },
  /* UMK-1122: the list's size step. A row is padding plus a type step — the type step is the
     whole fix, since a row without one inherits the page's size and ignores the trigger's. */
  SELECT_LIST_SIZE: {
    table: SELECT_LIST_SIZE as Record<string, string>,
    rules: [/(?:^|\s)rounded-ds-/],
  },
  SELECT_ROW_SIZE: {
    table: SELECT_ROW_SIZE as Record<string, string>,
    rules: [/(?:^|\s)px-/, /(?:^|\s)py-/, /(?:^|\s)text-ds-/],
  },
  /* UMK-1186: a code box is a fixed square-ish cell, so its step is a height, a width, a type
     step and a radius rather than padding. */
  OTP_BOX_SIZE: {
    table: OTP_BOX_SIZE as Record<string, string>,
    rules: [/(?:^|\s)h-/, /(?:^|\s)w-/, /(?:^|\s)text-ds-/, /(?:^|\s)rounded-ds-/],
  },
} as const;

describe('the form-control tables keep the shape each value must have', () => {
  /**
   * THE SHAPE PIN'S OWN COMPLETENESS. `TABLE_SHAPE` is a hand-maintained literal and the only
   * non-derived check in this family, so a table dropped from it loses its truncation defence
   * against a fully green suite. Every class TABLE the module exports owes a pin; the single
   * strings are checked by name below instead.
   */
  it('pins a shape for every class table the module exports', () => {
    const SINGLE_STRINGS = new Set([
      'BOX_BASE',
      'BOX_CONTROL',
      'CONTROL_BOX',
      'RADIO_BOX',
      'CONTROL_BOX_ERROR',
      'CONTROL_GLYPH',
      'CONTROL_ROW',
      'CONTROL_LABEL',
      'FIELD_LABEL',
      'FIELD_ADORNMENT',
      'FIELD_COUNTER',
      'FIELD_COUNTER_LIMIT',
      'FIELD_COUNTER_LARGE',
      'FIELD_COUNTER_LIMIT_LARGE',
      'FIELD_VALID_MARK',
      'BARE_BOX',
      'BARE_CONTROL',
      'BOX_SIZE_XSMALL',
      'BOX_SIZE_COMPACT',
      'BOX_STATE_VALID',
      'SELECTION_CARD_ROW',
      'SELECTION_CARD',
      'SELECTION_CARD_EYEBROW',
      'SELECTION_CARD_HEADING',
      'SELECTION_CARD_BODY',
      'SELECTION_CARD_INPUT',
      'SELECTION_CARD_INDICATOR',
      'SELECTION_CARD_INDICATOR_MARK',
      'SELECTION_CARD_TILE_TEXT',
      'SELECTION_CARD_TILE_BADGE',
      'UPLOAD_BASE',
      'UPLOAD_DRAG_OVER',
      'UPLOAD_INPUT',
      'SELECT_TRIGGER',
      'SELECT_LIST',
      'SELECT_SEARCH',
      'SELECT_SEARCH_INPUT',
      'SELECT_EMPTY',
      'SELECT_OPTION_HINT',
      'SELECT_DISABLED_HINT',
      'OTP_ROW',
      'OTP_BOX',
      'OTP_BOX_ACTIVE',
      'OTP_INPUT',
    ]);
    const unpinned = Object.entries(fieldTables)
      .filter(([name, value]) => typeof value === 'object' && !SINGLE_STRINGS.has(name))
      .map(([name]) => name)
      .filter((name) => !(name in TABLE_SHAPE));
    expect(unpinned, 'these class tables have no shape pin').toEqual([]);
    expect(Object.keys(fieldTables).length).toBeGreaterThan(15);
  });

  it.each(Object.entries(TABLE_SHAPE))('%s carries every class its look needs', (name, { table, rules }) => {
    expect(Object.keys(table).length, `${name} is empty`).toBeGreaterThan(1);
    /* PER VALUE, never over the joined table: one alternation across the whole table is
       satisfied by whichever value still has the class, which is exactly how a single emptied
       or truncated step hides. */
    for (const [value, klass] of Object.entries(table)) {
      for (const pattern of rules) {
        expect(pattern.test(klass), `${name}.${value} ("${klass}") is missing ${pattern}`).toBe(true);
      }
    }
  });

  it('gives the listbox cursor a visible surface, not only an ink', () => {
    /* The `active` row is where a keyboard user IS. A rule over the shared shape above cannot
       say this, because the default row legitimately has no surface. */
    expect(SELECT_OPTION.active).toMatch(NAMES_A_BACKGROUND);
    expect(SELECT_OPTION.active).not.toBe(SELECT_OPTION.default);
  });

  it('ties every new table to the contract axis it renders', () => {
    expect(Object.keys(SELECTION_CARD_SIZE).sort()).toEqual([...contract.SelectionCard.axes.size].sort());
    expect(Object.keys(SELECTION_CARD_STATE).sort()).toEqual([...contract.SelectionCard.axes.state].sort());
    expect(Object.keys(SELECTION_CARD_LAYOUT).sort()).toEqual([...contract.SelectionCard.axes.layout].sort());
    expect(Object.keys(SELECTION_CARD_TILE_SIZE).sort()).toEqual([...contract.SelectionCard.axes.size].sort());
    expect(Object.keys(SELECTION_CARD_INDICATOR_STATE).sort()).toEqual([...contract.SelectionCard.axes.state].sort());
    expect(Object.keys(UPLOAD_SIZE).sort()).toEqual([...contract.Upload.axes.size].sort());
    expect(Object.keys(UPLOAD_STATUS).sort()).toEqual([...contract.Upload.axes.status].sort());
    expect(Object.keys(UPLOAD_BORDER).sort()).toEqual([...contract.Upload.axes.border].sort());
    /* Select has no tables of its own — it reads the text field's. Asserted against the SHARED
       tables so a Select axis that drifted from them still reddens. */
    expect(Object.keys(BOX_SIZE).sort()).toEqual([...contract.Select.axes.size].sort());
    expect(Object.keys(BOX_STATE).sort()).toEqual([...contract.Select.axes.status].sort());
    expect(Object.keys(SELECT_LIST_SIZE).sort()).toEqual([...contract.Select.axes.size].sort());
    expect(Object.keys(SELECT_ROW_SIZE).sort()).toEqual([...contract.Select.axes.size].sort());
  });

  it('keeps the size table tied to the contract axis both controls share', () => {
    expect(Object.keys(BOX_SIZE).sort()).toEqual([...contract.DateTimeInput.axes.size].sort());
    /* TextField adds `xsmall` (BOX_SIZE_XSMALL) on top of the shared pair; nothing else. */
    expect([...Object.keys(BOX_SIZE), 'xsmall', 'compact'].sort()).toEqual([...contract.TextField.axes.size].sort());
  });

  /* Single strings rather than tables, so they have no per-value loop to hide in — but they
     are the classes that make a control's chrome visible at all. */
  it('keeps the single-string chrome carrying what it is for', () => {
    expect(CONTROL_BOX).toMatch(NAMES_A_BORDER_COLOUR);
    expect(CONTROL_BOX).toMatch(/(?:^|\s)appearance-none(?:\s|$)/);
    expect(RADIO_BOX).toMatch(NAMES_A_BORDER_COLOUR);
    expect(RADIO_BOX).toMatch(/(?:^|\s)appearance-none(?:\s|$)/);
    expect(FIELD_ADORNMENT).toMatch(/(?:^|\s)shrink-0(?:\s|$)/);
    for (const counter of [FIELD_COUNTER, FIELD_COUNTER_LIMIT]) {
      expect(counter).toMatch(/(?:^|\s)text-ds-/);
      expect(counter).toMatch(NAMES_A_TEXT_COLOUR);
    }
    /* And the two counter inks are DIFFERENT, or the limit state is invisible. */
    expect(FIELD_COUNTER).not.toBe(FIELD_COUNTER_LIMIT);
    /* The two Select hints are muted TEXT and nothing else — emptying either leaves the words
       in the DOM at the inherited size and colour, which reads as a layout bug rather than a
       missing class. A single string has no per-value loop to catch that. */
    for (const hint of [SELECT_OPTION_HINT, SELECT_DISABLED_HINT]) {
      expect(hint).toMatch(NAMES_A_TEXT_COLOUR);
    }
    expect(SELECT_DISABLED_HINT).toMatch(/(?:^|\s)text-ds-/);
  });
});
