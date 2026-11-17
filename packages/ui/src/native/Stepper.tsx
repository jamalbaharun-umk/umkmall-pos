import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { Icon } from './Icon';
import { Text } from './Text';
import { tokens } from './theme';

type Axes = typeof contract.Stepper.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** The mark's diameter — the web's `h-9 w-9`. Every leg offset below is derived from it. */
const MARK = 36;
/** The leg's thickness — the web's `h-ds-5xs` / `w-ds-5xs`. */
const LEG = tokens.spacing['5xs'];

/**
 * `01 Mark`, value for value.
 *
 * `default` HAS NO FILL and a 3px ring — Figma strokes it and leaves the disc empty, so a
 * background here would paint over the surface it is meant to sit on. The width lives per
 * state because only this one has a visible stroke.
 *
 * `done` is BRAND, not success. A finished step is not a success message; Figma paints it the
 * same blue as the current one, and the leg behind it matches.
 *
 * THE RING READS A REAL TOKEN HERE, unlike the web. Figma strokes the default step in
 * `#93a2b0`, which the generated BORDER palette publishes nowhere — so `tailwind.preset.js`
 * keeps a hand-kept `border-border-secondary` entry alive for this one class, and
 * `purge-support.ts` carries a matcher for the exception. Native has no per-utility palettes:
 * `text.default.secondary` IS `#93a2b0`, and a border may read it. Same colour, one fewer
 * exception.
 */
const MARK_STATE = {
  default: {
    backgroundColor: 'transparent',
    borderColor: tokens.text.default.secondary,
    borderWidth: 3,
    ink: 'secondary',
  },
  current: {
    backgroundColor: tokens.surface.default.brand,
    borderColor: tokens.surface.default.brand,
    borderWidth: 1,
    ink: 'invert',
  },
  done: {
    backgroundColor: tokens.surface.default.brand,
    borderColor: tokens.surface.default.brand,
    borderWidth: 1,
    ink: 'invert',
  },
} as const satisfies Record<Of<'state'>, unknown>;

const LABEL_STATE = {
  default: { color: 'secondary', weight: 'regular' },
  current: { color: 'primary', weight: 'bold' },
  done: { color: 'primary', weight: 'regular' },
} as const satisfies Record<Of<'state'>, unknown>;

/** Grey until travelled, then brand — matching the mark the leg runs into. */
const LEG_STATE = {
  default: tokens.text.default.secondary,
  current: tokens.text.default.secondary,
  done: tokens.surface.default.brand,
} as const satisfies Record<Of<'state'>, string>;

export interface StepperStep {
  label: React.ReactNode;
  state?: Of<'state'>;
  /**
   * Where this step sits in the trail. Derived from the index when omitted, and it has to
   * survive a step rendered ALONE — which is why it is an axis rather than a lookup.
   */
  position?: Of<'position'>;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  orientation?: Of<'orientation'>;
  /** Names the trail for assistive technology. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

const positionOf = (index: number, total: number): Of<'position'> =>
  index === 0 ? 'first' : index === total - 1 ? 'last' : 'middle';

/**
 * A step trail.
 *
 * THE LEG IS DRAWN IN TWO HALVES, one per step, and that is the native construction rather
 * than a different design. The web draws one absolutely-positioned leg per step reaching back
 * to the previous mark, sized with `calc(100% - 2.25rem)` and offset by `calc(50% + 1.125rem)`.
 * React Native has no `calc`, so a single leg spanning from one mark's edge to another's
 * cannot be expressed. Two halves can, using only a non-negative percentage and a numeric
 * margin: the half to the RIGHT of step i and the half to the LEFT of step i+1 meet in the
 * gap and together are that one leg.
 *
 * Both halves report the step they travel AWAY from, so the pair always agrees — the failure
 * the web's own docblock records (a grey leg between two finished marks) cannot happen here
 * by construction rather than by keying it correctly.
 *
 * THE LEG STOPS AT THE RING, not at the mark's centre. `default` has no fill, so a leg run to
 * the centre shows through the empty disc and stops on the numeral — the web hit exactly this
 * once its default state stopped being opaque. The `MARK / 2` PADDING is what holds it off.
 *
 * PADDING ON A HALF-WIDTH BOX, not a margin on a two-inset one, and the difference is that one
 * of them is a thing I can be sure of. `Slider` already positions a thumb with `left: '<pct>%'`
 * plus a negative `marginLeft`, so percentage insets and margins do compose — but that node
 * carries an explicit `width`. Setting BOTH `left` and `right` and letting Yoga derive the
 * width, then expecting a margin to shrink that derived width, is a different question and not
 * one this repo has an answer to. A half-width box with padding, holding a `flex: 1` child, is
 * plain flexbox: the child fills what the padding leaves. No layout question to get wrong, and
 * jest's renderer could not have told me either way.
 *
 * VERTICAL DRAWS ONE LEG, not two: a vertical step's mark sits at its TOP, so the whole gap
 * to the next mark is inside this step's own bottom padding and is exactly `top: MARK` to
 * `bottom: 0` — no percentage and no subtraction needed.
 *
 * THE TRAILING LEG ALSO CHECKS THE INDEX, not just `position`, and a bug is why. `positionOf`
 * gives a step rendered ALONE `first` — index 0 wins before the last-index test — so
 * `position !== 'last'` was true for it and it painted a leg reaching towards a step that does
 * not exist. The web never had this: it draws only the leg BEHIND a step, and `first` suppresses
 * that. Splitting one leg into two halves added a second predicate, and the second one needed
 * its own answer rather than the mirror of the first.
 *
 * An author-supplied `position` still wins for the leg BEHIND, matching the web — a lone step
 * forced to `middle` draws its trailing edge there too. What the index check removes is a leg
 * into empty space in the DEFAULT case, which is the one nobody passes a position for.
 *
 * THE CURRENT STEP IS EXPOSED, not merely coloured: `accessibilityState.selected` is the only
 * channel a reader who cannot see the fill has. The web spells the same thing `aria-current`.
 */
export const Stepper = ({ steps, orientation = 'horizontal', label, style }: StepperProps) => {
  const horizontal = orientation === 'horizontal';

  return (
    <View
      accessibilityRole="list"
      accessibilityLabel={label}
      style={[
        horizontal
          ? { flexDirection: 'row', alignItems: 'flex-start' }
          : { flexDirection: 'column', alignItems: 'stretch' },
        style,
      ]}
    >
      {steps.map((step, index) => {
        const state = step.state ?? 'default';
        const position = step.position ?? positionOf(index, steps.length);
        const mark = MARK_STATE[state];
        const labelStyle = LABEL_STATE[state];
        /* The half BEHIND this step reports the step before it — the journey already
           travelled. Keying it on this step would leave a grey gap between two finished
           marks, which reads as a break in the trail. */
        const behind = steps[index - 1]?.state ?? 'default';

        return (
          <View
            key={index}
            style={
              horizontal
                ? { flex: 1, alignItems: 'center', gap: tokens.spacing['3xs'] }
                : { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.spacing['2xs'], paddingBottom: tokens.spacing.sm }
            }
          >
            {/* No leg before the first step — the absence of an element, not a zero-length
                one, which is why `position` has to survive a step rendered alone. */}
            {horizontal && position !== 'first' && (
              <View
                accessibilityElementsHidden
                style={{ position: 'absolute', top: (MARK - LEG) / 2, height: LEG, left: 0, width: '50%', paddingRight: MARK / 2 }}
              >
                <View style={{ flex: 1, backgroundColor: LEG_STATE[behind] }} />
              </View>
            )}
            {horizontal && position !== 'last' && index < steps.length - 1 && (
              <View
                accessibilityElementsHidden
                style={{ position: 'absolute', top: (MARK - LEG) / 2, height: LEG, right: 0, width: '50%', paddingLeft: MARK / 2 }}
              >
                <View style={{ flex: 1, backgroundColor: LEG_STATE[state] }} />
              </View>
            )}
            {!horizontal && position !== 'last' && index < steps.length - 1 && (
              <View
                accessibilityElementsHidden
                style={{
                  position: 'absolute',
                  top: MARK,
                  bottom: 0,
                  left: (MARK - LEG) / 2,
                  width: LEG,
                  backgroundColor: LEG_STATE[state],
                }}
              />
            )}

            <View
              accessibilityRole="text"
              accessibilityState={{ selected: state === 'current' }}
              style={{
                width: MARK,
                height: MARK,
                borderRadius: tokens.radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                backgroundColor: mark.backgroundColor,
                borderColor: mark.borderColor,
                borderWidth: mark.borderWidth,
              }}
            >
              {/* `check-circle-filled`, NOT `check-circle`. The lucide name is an OUTLINE
                  circle, and drawn on an already-filled mark it reads as a circle inside a
                  circle; the house glyph is Figma's disc with a knocked-out tick. */}
              {state === 'done' ? (
                <Icon name="check-circle-filled" size="lg" color="invert" />
              ) : (
                <Text variant="bodyLg" weight="bold" color={mark.ink}>
                  {String(index + 1)}
                </Text>
              )}
            </View>

            {typeof step.label === 'string' ? (
              <Text variant="bodyLg" weight={labelStyle.weight} color={labelStyle.color}>
                {step.label}
              </Text>
            ) : (
              step.label
            )}
          </View>
        );
      })}
    </View>
  );
};

Stepper.displayName = 'Stepper';
