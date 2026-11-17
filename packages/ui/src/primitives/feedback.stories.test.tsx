import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import * as AlertStories from './Alert/Alert.stories';
import * as ProgressBarStories from './ProgressBar/ProgressBar.stories';
import * as SkeletonStories from './Skeleton/Skeleton.stories';
import * as SpinnerStories from './Spinner/Spinner.stories';
import * as ToasterStories from './Toaster/Toaster.stories';
import * as TooltipStories from './Tooltip/Tooltip.stories';
import { contract, storyTitle, type ComponentName } from '../contract';
import {
  ALERT_SIZE,
  ALERT_SURFACE,
  ALERT_TREATMENT,
  ALERT_TREATMENT_GLYPH_INK,
  PROGRESS_FILL,
  PROGRESS_RADIAL_GRADIENT_STOPS,
  PROGRESS_RADIAL_SIZE,
  PROGRESS_RADIAL_STROKE,
  PROGRESS_RADIAL_TRACK,
  PROGRESS_SIZE,
  PROGRESS_TRACK,
  PROGRESS_VARIANT,
  SPINNER_BASE,
  SPINNER_GRADIENT_FILL,
  SPINNER_GRADIENT_MASK,
  SPINNER_SIZE,
  SPINNER_VARIANT,
  SKELETON_SHAPE,
  TOOLTIP_SIZE,
  TOOLTIP_SURFACE,
} from './feedback-classes';
import { NAMES_A_BACKGROUND, NAMES_A_STROKE, NAMES_A_TEXT_COLOUR } from '../purge-support';

/**
 * "Every state has a story" is asserted rather than eyeballed — and asserted against what
 * the stories RENDER, not against the prop names their source happens to contain. A guard
 * reading source text passes on a story that sets the prop and never mounts it, which is
 * one of the three ways slice 2's guards shipped green while proving nothing.
 *
 * The probes here differ from slice 2's: those were form-control shaped (`disabled`,
 * `aria-invalid`, `checked`). Feedback is announcement-shaped, so what is read off the DOM
 * is a live-region role, a resolved `aria-describedby`, a close affordance and a
 * reduced-motion class.
 *
 * Importing the story modules also pulls them into the typecheck program: `tsconfig`
 * excludes every stories file, so a story imported by a test is the only way one is
 * checked at all.
 */

/** Every axis VALUE's evidence, taken from the same tables the components render — so a
 *  story that omits `warning` leaves its class absent and this goes red. */
const EXPECTED = {
  Alert: [
    ...Object.values(ALERT_SURFACE.alert),
    ...Object.values(ALERT_SIZE).map((s) => s.box.split(' ')[0]),
    /* Every treatment × function pair, spread from the table itself — a treatment with no
       story leaves its classes absent and this goes red. `full` is derived from the surface
       table above, so its entries are the same strings and dedupe harmlessly. */
    ...Object.values(ALERT_TREATMENT).flatMap((byFunction) =>
      Object.values(byFunction).flatMap((klass) => klass.split(' ')),
    ),
  ],
  Toaster: [
    ...Object.values(ALERT_SURFACE.toast),
    ...Object.values(ALERT_SIZE).map((s) => s.box.split(' ')[0]),
  ],
  Tooltip: [
    ...Object.values(TOOLTIP_SURFACE).map((s) => s.split(' ')[0]),
    ...Object.values(TOOLTIP_SIZE).map((s) => s.box.split(' ')[0]),
  ],
  Skeleton: Object.values(SKELETON_SHAPE).map((s) => s.split(' ').at(-1)!),
  /* Both tables in full, spread rather than sampled: these two shipped with no coverage at
     all, so the first version of their entry is the one that decides what "covered" means. */
  ProgressBar: [
    /* Split, not whole: a table value is a class STRING and `classList` holds single classes,
       so spreading the string looks for a class name nothing can ever match — and a check that
       can never pass is no better than one that always does. */
    ...Object.values(PROGRESS_VARIANT).flatMap((v) => v.split(' ')),
    ...Object.values(PROGRESS_SIZE).flatMap((v) => v.split(' ')),
    /* The radial tables too, or the `shape` axis has stories nothing checks. */
    ...Object.values(PROGRESS_RADIAL_SIZE).flatMap((v) => v.split(' ')),
    ...Object.values(PROGRESS_RADIAL_STROKE).flatMap((v) => v.split(' ')),
    ...Object.values(PROGRESS_RADIAL_GRADIENT_STOPS),
  ],
  Spinner: [
    ...Object.values(SPINNER_VARIANT).flatMap((v) => v.split(' ')),
    ...Object.values(SPINNER_SIZE).flatMap((v) => v.split(' ')),
    ...SPINNER_GRADIENT_FILL.split(' '),
    ...SPINNER_GRADIENT_MASK.split(' '),
  ],
} as const;

const MODULES = {
  Alert: AlertStories,
  Toaster: ToasterStories,
  Tooltip: TooltipStories,
  Skeleton: SkeletonStories,
  ProgressBar: ProgressBarStories,
  Spinner: SpinnerStories,
};

type AnyStory = {
  args?: Record<string, unknown>;
  render?: (a: never, b: never) => React.ReactElement;
};
type AnyModule = { default: { component: React.ElementType; args?: Record<string, unknown> } } & Record<
  string,
  unknown
>;

const element = (mod: AnyModule, story: AnyStory): React.ReactElement => {
  if (typeof story.render === 'function') return story.render(story.args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...(mod.default.args ?? {})} {...(story.args ?? {})} />;
};

/** Mounts every story in a module and returns everything the DOM ended up holding. */
const mountAll = (mod: AnyModule) => {
  const classes = new Set<string>();
  const roots: HTMLElement[] = [];
  for (const [name, story] of Object.entries(mod)) {
    if (name === 'default' || !story || typeof story !== 'object') continue;
    const { baseElement } = render(element(mod, story as AnyStory));
    roots.push(baseElement as HTMLElement);
    for (const el of baseElement.querySelectorAll('*')) for (const c of el.classList) classes.add(c);
  }
  return { classes, roots };
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

describe('the feedback stories cover every renderable state', () => {
  /**
   * `MODULES` and `EXPECTED` are hand-maintained objects and nothing in the suite asks a
   * component to join them — one omitted from both ships with zero story-guard coverage
   * against a fully green suite, which is exactly the state ProgressBar and Spinner were in.
   * The count is what makes a component dropping back out loud.
   */
  it('covers every component the contract puts in this family, each with its own evidence', () => {
    /* There was an UNCONTRACTED exemption here for `Toaster`, on the argument that a HOST is
       not a variant-bearing component. UMK-979 gave it a contract entry — the contract and
       the story set must correspond one-to-one for the sidebar to be derivable — so the
       exemption is deleted rather than left as an empty list waiting to be widened. */
    expect(Object.keys(MODULES).sort()).toEqual(contractFamilyMembers('feedback'));
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(MODULES).sort());
  });

  it.each(Object.entries(EXPECTED))('%s renders every axis value', (name, expected) => {
    const { classes } = mountAll(MODULES[name as keyof typeof MODULES] as unknown as AnyModule);
    /* Assert there is something to look for FIRST. An empty expectation list would make
       the loop below pass by never running — the shape of a guard measuring itself. */
    expect(expected.length).toBeGreaterThanOrEqual(contract.Skeleton.axes.shape.length);
    expect(expected.filter((c) => !classes.has(c))).toEqual([]);
  });

  it('shows an alert that announces itself', () => {
    const { roots } = mountAll(AlertStories as unknown as AnyModule);
    expect(roots.some((r) => r.querySelector('[role="alert"]'))).toBe(true);
  });

  it('shows a tooltip whose trigger resolves to its tip', () => {
    const { roots } = mountAll(TooltipStories as unknown as AnyModule);
    const resolved = roots.some((root) =>
      [...root.querySelectorAll('[aria-describedby]')].some((trigger) => {
        const target = root.ownerDocument.getElementById(trigger.getAttribute('aria-describedby')!);
        return (target?.textContent?.length ?? 0) > 0;
      }),
    );
    expect(resolved).toBe(true);
  });

  it('shows a tooltip that can be dismissed', () => {
    const { roots } = mountAll(TooltipStories as unknown as AnyModule);
    expect(roots.some((r) => r.querySelector('button[aria-label="Tutup"]'))).toBe(true);
  });

  /* No `role`, no `aria-live`, and hidden — the absence IS the state, so it is asserted
     rather than left to a reviewer noticing nothing is there. */
  it('shows a skeleton that announces nothing', () => {
    const { roots } = mountAll(SkeletonStories as unknown as AnyModule);
    const skeletons = roots.flatMap((r) => [...r.querySelectorAll('[data-skeleton]')]);
    expect(skeletons.length).toBeGreaterThan(0);
    for (const el of skeletons) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.querySelector('[role], [aria-live]')).toBeNull();
    }
  });

  it('shows the reduced-motion form of the shimmer', () => {
    const { classes } = mountAll(SkeletonStories as unknown as AnyModule);
    expect([...classes].some((c) => c.startsWith('motion-reduce:'))).toBe(true);
  });

  it('titles every story set for Storybook', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
      expect((mod as unknown as { default: { title: string } }).default.title).toBe(
        storyTitle(name as ComponentName),
      );
    }
  });

  it('passes the contract arrays into each grid rather than a default', () => {
    const grids = {
      Alert: [AlertStories.AllVariants, ['types', 'variants', 'sizes'] as const],
      AlertTreatments: [AlertStories.AllTreatments, ['treatments', 'variants'] as const],
      Toaster: [ToasterStories.AllVariants, ['variants', 'sizes'] as const],
      Tooltip: [TooltipStories.AllVariants, ['colors', 'sizes'] as const],
      Skeleton: [SkeletonStories.AllShapes, ['shapes'] as const],
      ProgressBar: [ProgressBarStories.AllVariants, ['variants', 'sizes'] as const],
      Spinner: [SpinnerStories.AllVariants, ['variants', 'sizes'] as const],
    } as const;
    const AXIS = {
      types: contract.Alert.axes.type,
      variants: contract.Alert.axes.function,
      treatments: contract.Alert.axes.treatment,
      colors: contract.Tooltip.axes.color,
      shapes: contract.Skeleton.axes.shape,
    } as const;
    /* `variants` is not one axis across the family — Alert's is `function` while these two
       have an axis literally named `variant`. Keyed per component rather than per prop name,
       because one shared lookup would quietly compare a spinner against Alert's vocabulary. */
    const PER_COMPONENT: Record<string, Record<string, readonly string[]>> = {
      ProgressBar: {
        variants: contract.ProgressBar.axes.variant,
        sizes: contract.ProgressBar.axes.size,
      },
      Spinner: { variants: contract.Spinner.axes.variant, sizes: contract.Spinner.axes.size },
    };
    const SIZES = {
      Alert: contract.Alert.axes.size,
      Toaster: contract.Alert.axes.size,
      Tooltip: contract.Tooltip.axes.size,
    } as const;

    for (const [name, [story, props]] of Object.entries(grids)) {
      const rendered = (story as AnyStory).render!({} as never, {} as never) as unknown as {
        props: Record<string, readonly string[]>;
      };
      for (const prop of props) {
        const expected =
          PER_COMPONENT[name]?.[prop] ??
          (prop === 'sizes' ? SIZES[name as keyof typeof SIZES] : AXIS[prop]);
        /* Assert the axis EXISTS first: `toEqual` is happy comparing undefined to
           undefined, so an entry that lost its axis would pass by having nothing to
           compare. */
        expect(expected, `${name}.${prop} has no contract axis to iterate`).toBeTruthy();
        expect(rendered.props[prop], `${name}.${prop}`).toEqual(expected);
      }
    }
  });
});

/**
 * WHAT EACH TREATMENT MUST STRUCTURALLY CARRY — THE ONE CHECK HERE THAT IS NOT DERIVED FROM
 * THE TABLES.
 *
 * Everything else in this file and in the purge sibling reads the same tables the component
 * renders from, so the tables are their own oracle: they prove the component echoes whatever
 * the table says, never that the table says the right thing. An EMPTIED value is caught; a
 * TRUNCATED one is not — and a gradient is the worst case, because `from-… to-…` shortened to
 * `from-…` still paints something and every table-derived expectation shrinks with it. That
 * injection was run against this file before this block existed and the whole suite stayed
 * green.
 *
 * So the pin is the SHAPE rather than a hand-copied string: an accent is a callout surface
 * plus a LEFT border plus callout ink, a coaching box is the same with a full border, a banner
 * is a gradient that must name BOTH of its stops. None of these need updating when a token is
 * repointed, and no truncation can satisfy them.
 */
const TREATMENT_SHAPE: Record<string, readonly RegExp[]> = {
  full: [/(?:^|\s)bg-weak-/, NAMES_A_TEXT_COLOUR],
  accent: [
    /(?:^|\s)bg-callout-/,
    /(?:^|\s)border-l-\d/,
    /(?:^|\s)border-callout-/,
    /(?:^|\s)text-callout-/,
  ],
  coach: [
    /(?:^|\s)bg-callout-/,
    /(?:^|\s)border(?:\s|$)/,
    /(?:^|\s)border-callout-/,
    /(?:^|\s)text-callout-/,
  ],
  banner: [
    /(?:^|\s)bg-gradient-to-/,
    /(?:^|\s)from-\w/,
    /(?:^|\s)to-\w/,
    /(?:^|\s)text-default-invert(?:\s|$)/,
  ],
};

describe('the Alert treatments keep the shape each one must have', () => {
  it('covers every treatment the contract declares, with a non-empty rule each', () => {
    expect(Object.keys(TREATMENT_SHAPE).sort()).toEqual([...contract.Alert.axes.treatment].sort());
    for (const rule of Object.values(TREATMENT_SHAPE)) expect(rule.length).toBeGreaterThan(1);
  });

  it.each(Object.entries(TREATMENT_SHAPE))('%s carries every class its look needs', (treatment, rule) => {
    const table = ALERT_TREATMENT[treatment as keyof typeof ALERT_TREATMENT] as Record<string, string>;
    expect(table, `${treatment} has no table`).toBeTruthy();
    /* PER FUNCTION, not over the joined table. Four values sharing one alternation is
       satisfied by whichever value still has the class, which is exactly how a single
       truncated stop hides. */
    for (const [fn, klass] of Object.entries(table)) {
      for (const pattern of rule) {
        expect(pattern.test(klass), `${treatment}.${fn} ("${klass}") is missing ${pattern}`).toBe(
          true,
        );
      }
    }
  });

  it('gives every treatment a glyph ink for every function', () => {
    for (const treatment of contract.Alert.axes.treatment) {
      const table = ALERT_TREATMENT_GLYPH_INK[treatment] as Record<string, string>;
      expect(Object.keys(table).sort()).toEqual([...contract.Alert.axes.function].sort());
      for (const [fn, klass] of Object.entries(table)) {
        expect(/(?:^|\s)text-\w/.test(klass), `${treatment}.${fn} glyph has no ink`).toBe(true);
      }
    }
  });
});

/**
 * THE SAME NON-DERIVED PIN, for the two components that just joined the family.
 *
 * They arrive with no history of coverage at all, so their tables have never once been checked
 * against anything but themselves. A size step emptied to `''` or a spinner variant truncated
 * to one side renders wrong and shrinks every table-derived expectation with it.
 */
/**
 * PER VALUE where the values are defined by DIFFERENT properties.
 *
 * The gradient value on each of these three is not a variation of its siblings — it paints
 * through a different mechanism. A single alternation over the axis (`bg-`, say) is satisfied
 * by `bg-gradient-to-r` alone, which is exactly how a gradient truncated to one stop stays
 * green: the same shape the content guard's `Card.variant` rule was split to catch.
 */
type ShapeRule = readonly RegExp[] | Record<string, readonly RegExp[]>;

const GRADIENT_STOPS = [/(?:^|\s)bg-gradient-to-/, /(?:^|\s)from-\w/, /(?:^|\s)to-\w/] as const;

const TABLE_SHAPE: Record<string, { table: Record<string, string>; rules: ShapeRule }> = {
  PROGRESS_VARIANT: {
    table: PROGRESS_VARIANT,
    rules: {
      default: [NAMES_A_BACKGROUND],
      success: [NAMES_A_BACKGROUND],
      warning: [NAMES_A_BACKGROUND],
      error: [NAMES_A_BACKGROUND],
      gray: [NAMES_A_BACKGROUND],
      gradient: GRADIENT_STOPS,
    },
  },
  PROGRESS_SIZE: { table: PROGRESS_SIZE, rules: [/(?:^|\s)h-\d/] },
  /* A DIAMETER needs both dimensions. Height alone gives an ellipse the moment the box is not
     square, and half a rule is satisfied by half a table. */
  PROGRESS_RADIAL_SIZE: { table: PROGRESS_RADIAL_SIZE, rules: [/(?:^|\s)h-\d/, /(?:^|\s)w-\d/] },
  /* An arc is `stroke-current` PLUS a text token — either half alone paints nothing visible.
     The gradient value is the exception and is named as one: its colour lives on the two stop
     elements, which are checked separately below rather than exempted. */
  PROGRESS_RADIAL_STROKE: {
    table: PROGRESS_RADIAL_STROKE,
    rules: {
      default: [/(?:^|\s)stroke-current(?:\s|$)/, NAMES_A_TEXT_COLOUR],
      success: [/(?:^|\s)stroke-current(?:\s|$)/, NAMES_A_TEXT_COLOUR],
      warning: [/(?:^|\s)stroke-current(?:\s|$)/, NAMES_A_TEXT_COLOUR],
      error: [/(?:^|\s)stroke-current(?:\s|$)/, NAMES_A_TEXT_COLOUR],
      /* THE GREY ARC IS THE ONE THAT IS NOT A TEXT COLOUR (UMK-978). It is the surface grey the
         track behind it uses, and it now says so through the `stroke` palette instead of
         borrowing a text utility — so it names NO `stroke-current`, and requiring one here
         would be requiring the borrowing back. */
      gray: [NAMES_A_STROKE],
      /* NO `stroke-current`: a CSS stroke beats the presentation attribute naming the paint
         server, so carrying it painted the arc black with the gradient fully defined. The
         token class is the SVG paint fallback instead. */
      gradient: [NAMES_A_TEXT_COLOUR],
    },
  },
  /* BOTH sides, named separately. A ring coloured on one side is a spinning dot; a ring
     coloured on all four has no apparent motion. One alternation over the pair is satisfied by
     whichever side survives, which is exactly how the truncation hides. The gradient value
     carries no border ink at all — its colour is the fill — so it has its own rule. */
  SPINNER_VARIANT: {
    table: SPINNER_VARIANT,
    rules: {
      primary: [/(?:^|\s)border-t-default-/, /(?:^|\s)border-r-default-/],
      white: [/(?:^|\s)border-t-default-/, /(?:^|\s)border-r-default-/],
      gray: [/(?:^|\s)border-t-default-/, /(?:^|\s)border-r-default-/],
      gradient: [/(?:^|\s)border-transparent(?:\s|$)/],
    },
  },
  SPINNER_SIZE: { table: SPINNER_SIZE, rules: [/(?:^|\s)h-\d/, /(?:^|\s)w-\d/] },
};

describe('the progress and spinner tables keep the shape each value must have', () => {
  /**
   * THE SHAPE PIN'S OWN COMPLETENESS, for the same reason as its two siblings: a hand-maintained
   * keyset that is the only non-derived check, so a table dropped from it goes quiet.
   */
  it('pins a shape for every axis table these two components render', () => {
    expect(Object.keys(TABLE_SHAPE).sort()).toEqual([
      'PROGRESS_RADIAL_SIZE',
      'PROGRESS_RADIAL_STROKE',
      'PROGRESS_SIZE',
      'PROGRESS_VARIANT',
      'SPINNER_SIZE',
      'SPINNER_VARIANT',
    ]);
  });

  it.each(Object.entries(TABLE_SHAPE))('%s carries every class its look needs', (name, { table, rules }) => {
    expect(Object.keys(table).length, `${name} is empty`).toBeGreaterThan(1);
    const perValue = !Array.isArray(rules);
    /* A per-value rule must SAY something for every value in the table, or a value drops out
       of the check by simply having no entry — silence reading as a pass. */
    for (const [value, klass] of Object.entries(table)) {
      const required = perValue
        ? (rules as Record<string, readonly RegExp[]>)[value]
        : (rules as readonly RegExp[]);
      expect(required, `${name}.${value} has no shape rule`).toBeTruthy();
      expect(required.length, `${name}.${value} declares an empty rule`).toBeGreaterThan(0);
      for (const pattern of required) {
        expect(pattern.test(klass), `${name}.${value} ("${klass}") is missing ${pattern}`).toBe(true);
      }
    }
  });

  /**
   * THE RADIAL GRADIENT'S COLOUR, which lives on the stop elements rather than in the stroke
   * table — so the rule above deliberately cannot see it and this is where it is checked. Two
   * DIFFERENT tokens, because a gradient whose stops collapse onto one colour is a flat fill
   * that still satisfies every "has a token" assertion.
   */
  it('gives the radial gradient two distinct token stops', () => {
    for (const stop of Object.values(PROGRESS_RADIAL_GRADIENT_STOPS)) {
      expect(stop).toMatch(NAMES_A_TEXT_COLOUR);
      /* AND NOT AN INK STEP. These stops wear a `text-` utility only because an SVG `<stop>`
         reads `currentColor` and nothing else — the colour they carry is a progress hue. Before
         the restructure the family said so by itself (`text-surface-*` could not be body text);
         after it, `text-default-primary` and `text-default-brand` are siblings, so the
         constraint has to be stated. A stop repointed at the ink step draws a dark navy arc and
         satisfies every other assertion here. */
      expect(stop, 'a gradient stop names the ink step, not a progress hue').not.toMatch(
        /(?:^|\s)text-(?:default|hover|active|focus)-(?:primary|secondary|disable|invert)(?![-\w])/,
      );
    }
    expect(PROGRESS_RADIAL_GRADIENT_STOPS.from).not.toBe(PROGRESS_RADIAL_GRADIENT_STOPS.to);
  });

  /* The gradient spinner's colour is a FILL, not a border, so the fill string is where its
     stops live — same reasoning, different table. */
  it('gives the gradient spinner a conic sweep and a mask to cut the ring', () => {
    /* CONIC, not the shared linear pair: a linear gradient on a ring is nearly one colour all
       the way round and the spin becomes invisible. And a TOKEN REFERENCE rather than a
       literal, which is what keeps `Slider`'s escape an escape rather than a hole. */
    expect(SPINNER_GRADIENT_FILL).toMatch(/conic-gradient/);
    expect(SPINNER_GRADIENT_FILL).toMatch(/rgb\(var\(--[a-z-]+\)\)/);
    expect(SPINNER_GRADIENT_FILL).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(SPINNER_GRADIENT_MASK).toMatch(/(?:^|\s)absolute(?:\s|$)/);
    expect(SPINNER_GRADIENT_MASK).toMatch(NAMES_A_BACKGROUND);
    expect(SPINNER_GRADIENT_MASK).toMatch(/(?:^|\s)rounded-ds-/);
  });

  it('keeps each table tied to the contract axis it renders', () => {
    expect(Object.keys(PROGRESS_VARIANT).sort()).toEqual([...contract.ProgressBar.axes.variant].sort());
    expect(Object.keys(PROGRESS_SIZE).sort()).toEqual([...contract.ProgressBar.axes.size].sort());
    expect(Object.keys(PROGRESS_RADIAL_SIZE).sort()).toEqual([...contract.ProgressBar.axes.size].sort());
    expect(Object.keys(PROGRESS_RADIAL_STROKE).sort()).toEqual(
      [...contract.ProgressBar.axes.variant].sort(),
    );
    expect(Object.keys(SPINNER_VARIANT).sort()).toEqual([...contract.Spinner.axes.variant].sort());
    expect(Object.keys(SPINNER_SIZE).sort()).toEqual([...contract.Spinner.axes.size].sort());
  });

  /* The track and the fill are single strings with no per-value loop to hide in, and they are
     what makes the bar a bar: a fill with no height fills nothing. */
  it('keeps the track and the fill carrying what they are for', () => {
    expect(PROGRESS_TRACK).toMatch(NAMES_A_BACKGROUND);
    expect(PROGRESS_TRACK).toMatch(/(?:^|\s)overflow-hidden(?:\s|$)/);
    expect(PROGRESS_FILL).toMatch(/(?:^|\s)h-full(?:\s|$)/);
    /* The track paints through the `stroke` palette directly rather than through
       `stroke-current` plus a borrowed text token — see PROGRESS_RADIAL_STROKE.gray. */
    expect(PROGRESS_RADIAL_TRACK).toMatch(NAMES_A_STROKE);
    expect(PROGRESS_RADIAL_TRACK).not.toMatch(/(?:^|\s)stroke-current(?:\s|$)/);
  });

  /**
   * REDUCED MOTION IS ON THE BASE. A spinner is nothing but an animation, so this is the
   * class that decides whether the component is usable for a reader who has asked motion to
   * stop — and it is one word in one string, with no axis loop that would notice it going.
   */
  it('suppresses the spin under reduced motion', () => {
    expect(SPINNER_BASE).toMatch(/(?:^|\s)animate-spin(?:\s|$)/);
    expect(SPINNER_BASE).toMatch(/(?:^|\s)motion-reduce:animate-none(?:\s|$)/);
  });
});
