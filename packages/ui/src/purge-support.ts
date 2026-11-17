import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/**
 * The design system's own state vocabulary, READ OUT OF THE GENERATED PRESET rather than
 * hand-copied into each guard.
 *
 * The guards in this package ask a recurring question — "does this class table name a colour
 * from OUR palette, rather than a raw hex or a Tailwind step?" — and they used to ask it with a
 * literal like `/(?:^|\s)bg-(?:default|hover|active|focus|weak|selected)-/`, written out by hand
 * in 33 places across four files. That list is a slice of Ensyra's vocabulary, so it moves when
 * Ensyra moves, and nothing links the copies: a new state segment lands, someone updates the
 * ones they remember, and the ones they miss keep passing by matching LESS. A guard that
 * under-matches reports no offenders, which is indistinguishable from having none.
 *
 * That is the same failure this whole change set kept finding — an assertion that survives a
 * rename by no longer matching anything — so the vocabulary is derived here, once, from the
 * artifact the rename actually rewrites.
 *
 * THIS IS A FILTER, NOT AN ASSERTION, which is what keeps deriving it legitimate. It decides
 * WHICH classes a guard has an opinion about; whether the class then resolves, or is the right
 * one, is checked against the compiled CSS or against the table's own stated intent. Deriving
 * the assertion from the preset would be grading its own homework — deriving the filter is not.
 */
const { theme } = createRequire(import.meta.url)(
  resolve(__dirname, '..', 'tokens.preset.js'),
) as { theme: { extend: Record<string, Record<string, unknown>> } };

/**
 * The distinct STATE segments a palette publishes — `default`, `hover`, `weak`… — taken from
 * the key's first segment. `halo` has no second segment and is a state of one, which is why the
 * matcher below does not require a trailing dash.
 *
 * It throws when a palette collapses, because the failure mode this file exists to prevent is a
 * matcher that quietly NARROWS: an empty list would build `bg-(?:)-`, which matches nothing and
 * reports every guard clean.
 *
 * THE FLOOR COUNTS STATES, NOT KEYS, AND THAT DISTINCTION IS THE WHOLE POINT. Counting keys sizes
 * the floor to the wrong dimension: `textColor` publishes 27 keys across 4 states, so losing the
 * entire `focus` state still leaves 20 keys and a key-count floor of four never fires — while
 * every matcher built from it silently stops recognising `text-focus-*`. That is the failure this
 * repo has already recorded twice (UMK-958): a floor must be sized to what a PARTIAL failure
 * leaves behind, and a partial failure here leaves most of the keys and one fewer state.
 *
 * Three is the floor because every palette here publishes at least `default`, `hover` and
 * `active`; a palette down to two states has lost one, which is exactly the case to refuse.
 */
const MINIMUM_STATES = 3;

/** Exported for its own test — the refusal below is the only thing standing between a collapsed
 *  palette and 33 assertions that quietly stop finding offenders, so it is proved rather than
 *  trusted. Takes the keys rather than reading the preset so a collapse can be staged. */
export const deriveStates = (palette: string, keys: string[]): string[] => {
  const states = [...new Set(keys.map((key) => key.split('-')[0]))];
  if (states.length < MINIMUM_STATES) {
    throw new Error(
      `tokens.preset.js publishes ${states.length} state segment(s) for "${palette}" ` +
        `(${states.join(', ') || 'none'}) across ${keys.length} keys — too few to derive a state ` +
        'vocabulary from. The palette was renamed, emptied, or lost a whole state; a matcher built ' +
        'on this would narrow silently and every guard using it would report clean.',
    );
  }
  return states;
};

const statesOf = (palette: string): string[] =>
  deriveStates(palette, Object.keys(theme.extend[palette] ?? {}));

/**
 * The groups still in the shared `colors` map, which are addressed WITHOUT a state segment
 * (`text-callout-warn-border`). Derived like everything else here — hand-writing `'callout'`
 * would put one un-derived string in the file whose thesis is that hand-copied vocabulary drifts.
 */
const sharedColourGroups = (): string[] => {
  const groups = Object.keys(theme.extend.colors ?? {});
  if (!groups.length) {
    throw new Error(
      'tokens.preset.js publishes no groups in the shared `colors` map. `Callout` is emitted ' +
        'there because its leaves are role-suffixed and read across utilities; if that moved, ' +
        'the matchers below stop recognising it and every guard using them reports clean.',
    );
  }
  return groups;
};

/**
 * "This value names a colour from the `<utility>` palette." Anchored at a word boundary so a
 * class inside another class cannot satisfy it, and closed with a negative lookahead rather than
 * a literal dash so single-segment states (`ring-halo`) match alongside two-segment ones
 * (`ring-focus-brand`).
 */
const namesAColour = (utility: string, palette: string): RegExp =>
  new RegExp(`(?:^|\\s)${utility}-(?:${statesOf(palette).join('|')})(?![a-z])`);

export const NAMES_A_BACKGROUND = namesAColour('bg', 'backgroundColor');
export const NAMES_A_TEXT_COLOUR = namesAColour('text', 'textColor');
export const NAMES_A_BORDER_COLOUR = namesAColour('border', 'borderColor');
export const NAMES_A_STROKE = namesAColour('stroke', 'stroke');

/**
 * `Stepper`'s mark is the one class table that still names a HAND-KEPT preset colour: Figma's
 * `01 Mark` strokes its default step in `#93a2b0`, which the generated border palette publishes
 * nowhere, so `border-border-secondary` survives in `tailwind.preset.js`. Built from the derived
 * matcher rather than beside it, so the generated half cannot go stale while the exception stays.
 */
export const NAMES_A_BORDER_COLOUR_OR_HAND_KEPT = new RegExp(
  `${NAMES_A_BORDER_COLOUR.source}|(?:^|\\s)border-border-secondary(?![a-z])`,
);

/**
 * Every state segment any colour palette publishes, as a bare alternation. For a caller that
 * has already isolated one class and wants to know only whether it is one of OURS — the inline
 * guard's contributor floor, which reads a class list rather than a class table.
 */
export const DS_STATE_SEGMENT = new RegExp(
  `-(?:${[
    ...new Set([
      ...statesOf('backgroundColor'),
      ...statesOf('textColor'),
      ...statesOf('borderColor'),
      ...sharedColourGroups(),
    ]),
  ].join('|')})(?![a-z])`,
);
