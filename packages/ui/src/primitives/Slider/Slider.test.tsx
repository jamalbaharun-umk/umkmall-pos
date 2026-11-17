/**
 * THE THUMB IS A RING, IN EVERY ENGINE (UMK-1091).
 *
 * Figma `Slider` 1308:8026 draws both thumbs as a white disc with a 6px brand stroke; ours was
 * a solid brand dot. The rules reach the thumb through vendor-prefixed pseudo-element
 * selectors, and a rule written for one prefix is simply ABSENT in the other engine — no
 * error, no fallback, just a ring in Chromium and a dot in Firefox. So the two lists are
 * asserted against each other rather than one being spot-checked.
 *
 * Gecko's arm carried an explicit `border-0`, which had to be REPLACED rather than joined: a
 * zero width beside a colour paints nothing, and both classes would have looked correct.
 *
 * WHAT THIS CANNOT SEE. That the disc is actually white and the ring actually blue is a look
 * (KTD6), and happy-dom applies no stylesheet, so the assertions read the class string the
 * component composes. The purge guards separately prove each of those classes resolves.
 */
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import resolveConfig from 'tailwindcss/resolveConfig';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';
import { SLIDER_SIZE as NATIVE_SIZE, SLIDER_THUMB as NATIVE_THUMB } from '../../native/field-styles';
import { tokens } from '../../tokens';
import { Slider } from './Slider';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const preset = require('../../../tailwind.preset.js');

const PREFIXES = ['[&::-webkit-slider-thumb]', '[&::-moz-range-thumb]'] as const;

const classesOf = (size: (typeof contract.Slider.axes.size)[number]) => {
  render(
    <Slider label={size} size={size} defaultValue={50} />,
  );
  return screen.getByLabelText(size).className.split(/\s+/);
};

describe('the slider thumb', () => {
  it.each(contract.Slider.axes.size)('draws a white disc with a brand ring at %s', (size) => {
    const classes = classesOf(size);
    for (const prefix of PREFIXES) {
      expect(classes, `${prefix} has no white fill`).toContain(`${prefix}:bg-default-primary`);
      expect(classes, `${prefix} has no ring colour`).toContain(`${prefix}:border-default-brand`);
      expect(classes, `${prefix} has no ring width`).toContain(`${prefix}:border-6`);
      /* The one that made the ring invisible in a real browser while every other assertion
         here passed. Tailwind's preflight sets `border-style: solid` on `*, ::before, ::after`
         and nothing else, so a vendor-prefixed thumb keeps `border-style: none` and paints no
         ring however wide or however coloured. This assertion is the whole reason a class-name
         guard is not enough on its own — it was added after a browser found the omission. */
      expect(classes, `${prefix} sets a border width and colour but no border STYLE`).toContain(
        `${prefix}:border-solid`,
      );
      expect(
        classes,
        `${prefix} still sets a zero border width, which paints no ring however it is coloured`,
      ).not.toContain(`${prefix}:border-0`);
      expect(classes, `${prefix} still fills the thumb solid brand`).not.toContain(
        `${prefix}:bg-default-brand`,
      );
      /* Load-bearing for the DIAMETER, not the box model in the abstract: Tailwind's preflight
         sets border-box on `*`, `::before` and `::after` only, so a vendor thumb defaults to
         content-box and a 6px ring on each side makes a 20px thumb render at 32px. Dropping
         this class leaves every assertion above green and the thumb visibly wrong. */
      expect(classes, `${prefix} lets the ring grow the thumb past its published size`).toContain(
        `${prefix}:box-border`,
      );
    }
  });

  /**
   * Figma's two diameters, and both moved — 24 to 20 and 16 to 18. Asserted per size rather
   * than on one representative, since the table is where a single-size edit would hide.
   */
  it.each([
    ['large', 5],
    ['small', 4.5],
  ] as const)('sizes the %s thumb to Figma', (size, rung) => {
    const classes = classesOf(size);
    for (const prefix of PREFIXES) {
      expect(classes).toContain(`${prefix}:h-${rung}`);
      expect(classes).toContain(`${prefix}:w-${rung}`);
    }
  });

  /** The track already matched Figma and is deliberately untouched — 12px and 8px. */
  it.each([
    ['large', 'h-3'],
    ['small', 'h-2'],
  ] as const)('leaves the %s track alone', (size, height) => {
    expect(classesOf(size)).toContain(height);
  });
});

/**
 * THE THUMB HAS NO PURGE COVERAGE, so these rungs are checked here instead.
 *
 * Every purge guard in this package filters out class names containing `[` — a rule written
 * for ARBITRARY VALUES (`bg-[#fff]`), which also catches an arbitrary VARIANT. Every thumb
 * class is spelled `[&::-webkit-slider-thumb]:…`, so the entire thumb is invisible to the one
 * check that proves a class survives a real Tailwind compile. That blind spot is how a missing
 * border style shipped: the rules were in the stylesheet and the ring still painted nothing.
 *
 * The two hand-kept preset rungs the thumb depends on are the part a purge guard would have
 * covered, so they are asserted directly against the resolved config. Delete `spacing['4.5']`
 * or `borderWidth['6']` and Tailwind silently emits no rule for the class that names it.
 */
describe('the preset rungs the thumb depends on', () => {
  const theme = resolveConfig({ content: [], presets: [preset] }).theme as {
    spacing: Record<string, string>;
    borderWidth: Record<string, string>;
  };

  it('publishes the 18px spacing rung the small thumb names', () => {
    expect(theme.spacing['4.5'], 'h-4.5 / w-4.5 resolves to nothing').toBe('18px');
  });

  it('publishes the 6px border width the ring names', () => {
    expect(theme.borderWidth['6'], 'border-6 resolves to nothing').toBe('6px');
  });

  /* The 20px thumb rides Tailwind's own `5`; asserted so a preset edit that dropped the
     default scale would not leave the large thumb silently unsized. */
  it('keeps the 20px rung the large thumb names', () => {
    expect(theme.spacing['5']).toBe('1.25rem');
  });
});

/**
 * THE NATIVE SIBLING DRAWS THE SAME THUMB (UMK-1091 R8).
 *
 * The web thumb moved in 0cf76ad01 and `native/Slider.tsx` did not: it went on drawing a
 * solid brand dot at 24px and 16px, with both suites green, because the two tables share no
 * compile-time link and the native one cannot be rendered here. `field-styles.ts` imports no
 * `react-native` value, so its table is read directly and compared with what the WEB element
 * carries — each web rung resolved through the real Tailwind config, so neither side is a
 * restatement of the other.
 *
 * PROVED RED, one injection each:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | native `SLIDER_SIZE.large.thumb` back to `measure['1-5']` (24) | 1 — large thumb |
 * | native `SLIDER_SIZE.small.track` set to `measure['0-75']` | 1 — small track |
 * | native `SLIDER_THUMB.backgroundColor` back to `surface.default.brand` (the dot) | 1 — the ring |
 * | `Slider.tsx` stops spreading `SLIDER_THUMB` onto the thumb | 1 — the wiring |
 */
describe('the native slider agrees with the web one', () => {
  const theme = resolveConfig({ content: [], presets: [preset] }).theme as {
    spacing: Record<string, string>;
    height: Record<string, string>;
  };
  const px = (value: string | undefined) => {
    expect(value, 'a rung that resolves to nothing').toBeTypeOf('string');
    return value!.endsWith('rem') ? parseFloat(value!) * 16 : parseFloat(value!);
  };
  /** The unprefixed `h-*` is the track; the webkit-prefixed one is the thumb. */
  const webPx = (size: (typeof contract.Slider.axes.size)[number]) => {
    const classes = classesOf(size);
    const track = classes.find((c) => /^h-[\d.]+$/.test(c))?.slice(2);
    const thumb = classes.find((c) => c.startsWith(`${PREFIXES[0]}:h-`))?.slice(`${PREFIXES[0]}:h-`.length);
    return { track: px(theme.height[track!] ?? theme.spacing[track!]), thumb: px(theme.spacing[thumb!]) };
  };

  it.each(contract.Slider.axes.size)('sizes the %s track and thumb as the web does', (size) => {
    expect(NATIVE_SIZE[size]).toEqual(webPx(size));
  });

  it('draws the thumb as a white disc with a 6px brand ring, the tokens the web classes name', () => {
    expect(NATIVE_THUMB).toEqual({
      backgroundColor: tokens.surface.default.primary,
      borderColor: tokens.border.default.brand,
      borderWidth: 6,
    });
  });

  it('puts that ring on the thumb it draws', () => {
    const source = readFileSync(resolve(__dirname, '../../native/Slider.tsx'), 'utf8')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source, 'native Slider no longer paints its thumb from SLIDER_THUMB').toMatch(/\.\.\.SLIDER_THUMB\b/);
    expect(source, 'native Slider sizes from its own table again').toMatch(/SLIDER_SIZE\b/);
  });
});

describe('the scrubber appearance (UMK-1383)', () => {
  it('is a thin track that keeps the slider role and name, with no ring thumb', () => {
    render(<Slider aria-label="Posisi video" appearance="scrubber" defaultValue={30} />);
    const input = screen.getByRole('slider', { name: 'Posisi video' });
    const classes = input.className.split(/\s+/);
    expect(classes).toContain('h-1');
    expect(classes).toContain('[&::-webkit-slider-thumb]:opacity-0');
    expect(classes).toContain('hover:[&::-webkit-slider-thumb]:opacity-100');
    expect(classes).not.toContain('[&::-webkit-slider-thumb]:border-6');
    expect(classes).not.toContain('h-3');
  });
});
