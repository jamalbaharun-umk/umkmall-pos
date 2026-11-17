import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  PROGRESS_FILL,
  PROGRESS_LABEL,
  PROGRESS_LABEL_TEXT,
  PROGRESS_LABEL_VALUE,
  PROGRESS_RADIAL_GRADIENT_STOPS,
  PROGRESS_RADIAL_SIZE,
  PROGRESS_RADIAL_STROKE,
  PROGRESS_RADIAL_TRACK,
  PROGRESS_SIZE,
  PROGRESS_TRACK,
  PROGRESS_VARIANT,
} from '../feedback-classes';

type Axes = typeof contract.ProgressBar.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * The class tables, re-tied to this component's own axes. The tables live in
 * `feedback-classes.ts` so the two guards can read them as data; asserting the link here buys
 * back what moving them out cost, so adding a value to the contract entry reddens the table
 * rather than silently rendering unstyled.
 */
const VARIANT = PROGRESS_VARIANT satisfies Record<Of<'variant'>, string>;
const SIZE = PROGRESS_SIZE satisfies Record<Of<'size'>, string>;
const RADIAL_SIZE = PROGRESS_RADIAL_SIZE satisfies Record<Of<'size'>, string>;
const RADIAL_STROKE = PROGRESS_RADIAL_STROKE satisfies Record<Of<'variant'>, string>;

/**
 * The arc geometry, in ONE place.
 *
 * `pathLength` re-scales the circle's own length to 100 whatever its radius is, so the dash
 * maths below is in percent and needs no circumference constant that has to be kept in step
 * with the radius. The computed sweep is the only thing that travels inline, as a number in a
 * custom property — the stroke colour is a class, per the rule the slider's track set.
 */
const ARC = { viewBox: '0 0 36 36', cx: 18, cy: 18, r: 16, pathLength: 100 } as const;

export interface ProgressBarProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> {
  variant?: Of<'variant'>;
  size?: Of<'size'>;
  /**
   * A bar or a gauge. Defaults to `linear`, so every existing call site is unchanged.
   *
   * On `radial` the `size` axis is a DIAMETER rather than a track thickness — same axis, and
   * the value means what the shape needs it to mean.
   */
  shape?: Of<'shape'>;
  /** Progress, in the same units as `max`. */
  value?: number;
  max?: number;
  /** Renders a label row above the track, with the percentage beside it. */
  label?: string;
}

/**
 * A determinate progress bar.
 *
 * BROUGHT ONTO TOKENS AND UNDER A GUARD (UMK-961 U10). It shipped `bg-green-500`,
 * `bg-orange-500`, `bg-red-500`, `bg-gray-200` and the legacy `z-*` brand token, with no class
 * table and no coverage in any of the four family guards — so every one of those would have
 * rendered nothing on the day its group retired and nothing here would have noticed. Slice 6
 * owns reconciling this component with its native sibling; this change goes as far as tokens,
 * a table and guard coverage, and no further.
 */
export const ProgressBar = React.forwardRef<HTMLDivElement, ProgressBarProps>(
  (
    {
      className,
      variant = 'default',
      size = 'small',
      shape = 'linear',
      value = 0,
      max = 100,
      label,
      ...props
    },
    ref,
  ) => {
    /* Clamped ONCE, and the clamped number is what is both drawn and announced. Drawing the
       clamped value while announcing the raw one is how a bar reads "150%" to a screen reader
       while looking full — the two must not be able to disagree. */
    /* Per instance: two gauges on one page would otherwise both point at the first one's
       gradient definition, and removing that one leaves the other painting nothing. */
    const gradientId = `${React.useId()}-progress-gradient`;
    const span = max || 1;
    const clamped = Math.min(Math.max(value, 0), max);
    const percentage = Math.min(Math.max((clamped / span) * 100, 0), 100);

    /* ONE set of semantics for both shapes. A gauge that announced anything different from the
       bar would be a second answer to the same question, and the shape is a drawing decision. */
    const semantics = {
      role: 'progressbar' as const,
      'aria-label': label,
      'aria-valuenow': clamped,
      'aria-valuemin': 0,
      'aria-valuemax': max,
    };

    if (shape === 'radial') {
      return (
        <div ref={ref} className={className} {...props}>
          <svg
            {...semantics}
            viewBox={ARC.viewBox}
            className={cn(RADIAL_SIZE[size], 'fill-none')}
            /* A number, never a colour. `stroke-dashoffset` counts DOWN from the full length,
               so the offset is the unfilled remainder. */
            style={{ '--progress-sweep': `${percentage}` } as React.CSSProperties}
          >
            {variant === 'gradient' && (
              /* An SVG stroke reads a paint server, never a CSS gradient — so the sweep needs
                 a real `linearGradient`. The colours stay CLASSES on the stops and reach the
                 paint through `currentColor`; writing the token into `stopColor` would put a
                 colour value back into markup. The id is per instance, or two gauges on one
                 page share the first one's definition. */
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    className={PROGRESS_RADIAL_GRADIENT_STOPS.from}
                  />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    className={PROGRESS_RADIAL_GRADIENT_STOPS.to}
                  />
                </linearGradient>
              </defs>
            )}
            <circle
              cx={ARC.cx}
              cy={ARC.cy}
              r={ARC.r}
              pathLength={ARC.pathLength}
              strokeWidth={4}
              className={PROGRESS_RADIAL_TRACK}
            />
            <circle
              cx={ARC.cx}
              cy={ARC.cy}
              r={ARC.r}
              pathLength={ARC.pathLength}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={ARC.pathLength}
              /* Starts at twelve o'clock rather than three, which is where a gauge reads from. */
              transform={`rotate(-90 ${ARC.cx} ${ARC.cy})`}
              className={RADIAL_STROKE[variant]}
              /* SVG2 paint with a FALLBACK: if the gradient id ever fails to resolve the arc
                 paints the class's token colour instead of black. */
              stroke={variant === 'gradient' ? `url(#${gradientId}) currentColor` : undefined}
              style={{ strokeDashoffset: `calc(${ARC.pathLength} - var(--progress-sweep))` }}
            />
          </svg>
          {label && <span className={PROGRESS_LABEL_TEXT}>{label}</span>}
        </div>
      );
    }

    return (
      <div ref={ref} className={className} {...props}>
        {label && (
          <div className={PROGRESS_LABEL}>
            <span className={PROGRESS_LABEL_TEXT}>{label}</span>
            <span className={PROGRESS_LABEL_VALUE}>{`${Math.round(percentage)}%`}</span>
          </div>
        )}
        <div className={cn(PROGRESS_TRACK, SIZE[size])}>
          <div
            {...semantics}
            className={cn(PROGRESS_FILL, VARIANT[variant])}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  },
);

ProgressBar.displayName = 'ProgressBar';
