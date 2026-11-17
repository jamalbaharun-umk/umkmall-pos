/**
 * ONE SIZE LADDER, WRITTEN THREE TIMES (UMK-1091 KTD4).
 *
 * `CheckBox`, `Radio` and native's `field-styles.ts` each hold their own size table, and
 * nothing links them at compile time. Move one and web `Radio` is a step larger than web
 * `CheckBox`, or native is a step off both, with every suite green — a person reading a form
 * sees one control size, not two.
 *
 * WHAT THIS CAN AND CANNOT SEE. The web tables are module-private, so they are read through a
 * RENDER: the class the component actually puts on the element, resolved through the real
 * Tailwind config rather than against a hardcoded pixel map — a guard carrying its own copy of
 * the ladder would be a fourth table to drift. It follows that this proves the three tables
 * AGREE, and separately that they agree with Figma's published numbers. It cannot prove the
 * rendered box measures 18px in a browser; happy-dom lays nothing out. That is the devtools
 * check in the Definition of Done.
 *
 * PROVED RED, one injection each:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `CheckBox`'s `large` back to `h-6 w-6` | 1 — the Figma-scale row for large |
 * | `Radio`'s `medium` back to `h-5 w-5` | 1 — the sibling-agreement row for medium |
 * | native's `small` back to `measure['1']` | 1 — the native-agreement row for small |
 */
import { render } from '@testing-library/react';
import resolveConfig from 'tailwindcss/resolveConfig';
import { describe, expect, it } from 'vitest';
import { CheckBox } from './CheckBox';
import { Radio } from './Radio';
import { CONTROL_SIZE as NATIVE_CONTROL_SIZE } from '../native/field-styles';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const preset = require('../../tailwind.preset.js');

/**
 * Figma `01 Check Box` 121:1457, read 2026-09-18. `xlarge` is OURS — Figma's `Size=XL` keeps
 * an 18px box and grows only the label — so it is recorded here as a divergence rather than
 * as a published value, which is the one number in this file a reader must not take as Figma's.
 */
const FIGMA_PX = { xlarge: 20, large: 18, medium: 16, small: 14 } as const;

/** The real spacing scale, so the guard reads the ladder rather than restating it. */
const spacing = resolveConfig({ content: [], presets: [preset] }).theme.spacing as Record<string, string>;

const rungPx = (className: string, axis: 'h' | 'w') => {
  const rung = new RegExp(`(?:^|\\s)${axis}-([\\d.]+)(?:\\s|$)`).exec(className)?.[1];
  expect(rung, `no ${axis === 'h' ? 'height' : 'width'} rung in "${className}"`).toBeTypeOf('string');
  const value = spacing[rung!];
  expect(value, `${axis}-${rung} is not on the spacing scale`).toBeTypeOf('string');
  return value.endsWith('rem') ? parseFloat(value) * 16 : parseFloat(value);
};

/**
 * BOTH AXES, because these controls are square and nothing else says so. Reading `h-` alone
 * let a width drift to a different rung with the guard fully green — the box would render as
 * a rectangle, which is the one shape a checkbox may never be.
 */
const pxOf = (className: string) => {
  const height = rungPx(className, 'h');
  const width = rungPx(className, 'w');
  expect(width, `the box is ${width}x${height}, not square`).toBe(height);
  return height;
};

const boxOf = (element: React.ReactElement) =>
  pxOf(render(element).container.querySelector('input')!.className);

describe('the control size ladder agrees across all three tables', () => {
  it.each(Object.keys(FIGMA_PX) as (keyof typeof FIGMA_PX)[])(
    'renders a %s checkbox at the published size',
    (size) => {
      expect(boxOf(<CheckBox label="x" size={size} />)).toBe(FIGMA_PX[size]);
    },
  );

  /** Radio publishes three of the four rungs; `xlarge` is a checkbox-only step. */
  it.each(['large', 'medium', 'small'] as const)('renders a %s radio at the same size', (size) => {
    expect(boxOf(<Radio label="x" size={size} />)).toBe(FIGMA_PX[size]);
  });

  it.each(Object.keys(FIGMA_PX) as (keyof typeof FIGMA_PX)[])(
    'gives the native %s box the same number the web class expresses',
    (size) => {
      expect(NATIVE_CONTROL_SIZE[size]).toBe(FIGMA_PX[size]);
    },
  );
});
