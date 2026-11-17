import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DS_STATE_SEGMENT,
  NAMES_A_BACKGROUND,
  NAMES_A_BORDER_COLOUR,
  NAMES_A_BORDER_COLOUR_OR_HAND_KEPT,
  NAMES_A_STROKE,
  NAMES_A_TEXT_COLOUR,
  deriveStates,
} from './purge-support';

/**
 * THE GUARD'S OWN GUARD.
 *
 * `purge-support.ts` supplies the matcher that ~33 assertions across four files use to decide
 * whether a class table names one of OUR colours. Every one of those assertions is positive
 * ("this table names a design-system colour"), so a matcher that narrows too far reds them —
 * today. The moment someone writes the first `.not.toMatch(NAMES_A_*)`, a narrowed matcher
 * inverts into a silent pass across the whole set.
 *
 * So the narrowing is refused at the source, and this is where that refusal is proved. It was
 * previously proved only by hand, against the real preset — which is not a test.
 */
describe('the derived colour matchers', () => {
  describe('refuse to narrow', () => {
    /**
     * THE FLOOR COUNTS STATES, NOT KEYS, AND THIS IS THE CASE THAT SEPARATES THEM. A palette
     * that loses a whole state keeps most of its keys — `textColor` publishes 27 keys across 4
     * states, so dropping `focus` leaves 20. A key-count floor of four sails past it while every
     * matcher built from the palette silently stops recognising `text-focus-*`.
     */
    it('accepts a palette that lost most of its KEYS but kept its states', () => {
      expect(deriveStates('x', ['default-primary', 'hover-primary', 'active-primary'])).toEqual([
        'default',
        'hover',
        'active',
      ]);
    });

    it('refuses a palette that kept its keys but lost a whole state', () => {
      const keys = ['default-primary', 'default-secondary', 'default-brand', 'default-error', 'hover-brand'];
      expect(() => deriveStates('textColor', keys)).toThrow(/2 state segment\(s\) for "textColor"/);
    });

    it('names the states it did find, so the reader sees which one went', () => {
      expect(() => deriveStates('borderColor', ['default-primary', 'hover-primary'])).toThrow(
        /default, hover/,
      );
    });

    it('refuses an empty palette rather than building a matcher that matches nothing', () => {
      /* `bg-(?:)-` is a well-formed regex that finds no offenders, which reads exactly like
         having none. This is the failure the whole file exists to prevent. */
      expect(() => deriveStates('backgroundColor', [])).toThrow(/0 state segment/);
    });
  });

  /**
   * THE PALETTES THAT ARE ONLY PROTECTED BY THEIR SOURCE, pinned to the source.
   *
   * `check.mjs` asserts each generated palette ARRIVES — `['fill','default-primary']` and
   * friends — and its own comment admits that is presence, not value. `purge-support.ts` derives
   * state vocabularies for `backgroundColor`, `textColor`, `borderColor` and `stroke` only, so
   * `fill` and `gradientColorStops` are covered transitively, by happening to share
   * `cssVars('Surface')` with the others.
   *
   * That leaves the one-line edit `build.mjs`'s own comment warns about — `fill: cssVars('Text')`
   * — resolving perfectly and painting the wrong colour: `fill-default-primary` flips #FFFFFF to
   * #042648, `feedback-classes.ts`'s white spinner fill turns near-black, and every gate in this
   * repo stays green because they all ask whether a class RESOLVES. So these assert the VARIABLE
   * behind the key, which is the only thing that distinguishes the two palettes.
   */
  describe('draw from the palette they claim to', () => {
    const { theme } = createRequire(import.meta.url)(resolve(__dirname, '..', 'tokens.preset.js')) as {
      theme: { extend: Record<string, Record<string, string>> };
    };

    it.each([
      ['fill', 'default-primary', '--surface-default-primary'],
      ['stroke', 'default-secondary', '--surface-default-secondary'],
      ['gradientColorStops', 'default-brand', '--surface-default-brand'],
      ['gradientColorStops', 'hover-brand', '--surface-hover-brand'],
      /* The counterpart: the text palette must NOT be the surface one. Without this the
         assertions above are satisfied by every palette pointing at the same group. */
      ['textColor', 'default-primary', '--text-default-primary'],
      ['borderColor', 'default-primary', '--border-default-primary'],
    ])('%s.%s reads %s', (palette, key, cssVar) => {
      expect(theme.extend[palette]?.[key], `${palette}.${key} is not published`).toBeDefined();
      expect(theme.extend[palette][key]).toContain(`var(${cssVar})`);
    });
  });

  /**
   * The matchers built from the LIVE preset. These are the strings the assertions across the
   * package actually depend on, so they are pinned here rather than left to the call sites.
   */
  describe('match what the package writes, and only that', () => {
    it.each([
      ['bg-default-primary', NAMES_A_BACKGROUND, true],
      ['bg-weak-brand', NAMES_A_BACKGROUND, true],
      ['bg-hover-invert/25', NAMES_A_BACKGROUND, true],
      ['bg-blue-500', NAMES_A_BACKGROUND, false],
      ['bg-surface-primary', NAMES_A_BACKGROUND, false],
      ['text-default-secondary', NAMES_A_TEXT_COLOUR, true],
      ['text-hover-brand', NAMES_A_TEXT_COLOUR, true],
      ['text-text-primary', NAMES_A_TEXT_COLOUR, false],
      ['border-focus-brand', NAMES_A_BORDER_COLOUR, true],
      /* Single-segment states have no trailing dash, which is why the matcher closes on a
         lookahead rather than a literal `-`. */
      ['border-halo', NAMES_A_BORDER_COLOUR, true],
      ['border-border-primary', NAMES_A_BORDER_COLOUR, false],
      ['stroke-default-secondary', NAMES_A_STROKE, true],
      ['stroke-current', NAMES_A_STROKE, false],
    ])('%s', (klass, matcher, expected) => {
      expect(matcher.test(klass)).toBe(expected);
    });

    it('matches a class mid-string but not one embedded in a longer name', () => {
      expect(NAMES_A_BACKGROUND.test('rounded-full bg-default-brand p-2')).toBe(true);
      expect(NAMES_A_TEXT_COLOUR.test('hovertext-default-primary')).toBe(false);
    });

    /**
     * `border-border-secondary` is the ONE hand-kept preset colour a class table still names —
     * Figma's `01 Mark` strokes its default step in `#93a2b0`, which the generated border
     * palette publishes nowhere. The plain matcher must NOT accept it, or the exception stops
     * being visible; the paired one must.
     */
    it('keeps the hand-kept exception out of the derived matcher', () => {
      expect(NAMES_A_BORDER_COLOUR.test('border-3 border-border-secondary')).toBe(false);
      expect(NAMES_A_BORDER_COLOUR_OR_HAND_KEPT.test('border-3 border-border-secondary')).toBe(true);
      expect(NAMES_A_BORDER_COLOUR_OR_HAND_KEPT.test('border-default-primary')).toBe(true);
    });

    /**
     * `DS_STATE_SEGMENT` also covers the groups still in the shared `colors` map, which are
     * addressed with no state segment at all. Derived, not hand-written — this pins that the
     * derivation actually reaches them.
     */
    it('recognises a shared-map group as one of ours', () => {
      expect(DS_STATE_SEGMENT.test('text-callout-warn-border')).toBe(true);
      expect(DS_STATE_SEGMENT.test('bg-weak-error')).toBe(true);
      expect(DS_STATE_SEGMENT.test('text-red-500')).toBe(false);
    });
  });
});
