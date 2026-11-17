/**
 * A FADED SLIDER FADES AS ONE LAYER (UMK-1121).
 *
 * `Slider` draws its disabled state as `opacity: 0.5` on the view that holds both the track and
 * the thumb, and the thumb sits ON TOP of the fill. Android applies a view's opacity to each child
 * separately unless the view composites offscreen, so the half-transparent white centre of the
 * thumb let the brand fill show through it: on a Pixel 9 the disabled thumb read as a half-blue
 * dot, while iOS (which groups the layer) drew it correctly. Nothing in either suite could see it.
 *
 * So the element that carries the disabled opacity must also carry
 * `needsOffscreenAlphaCompositing`. SOURCE-SCANNED, like `disabled-keeps-state.test.ts`, because
 * `react-native` does not load under vitest: this checks the WIRING, never the pixels.
 *
 * PROVED RED, one injection each:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | the `needsOffscreenAlphaCompositing` prop deleted from `Slider.tsx` | 1 — the pairing |
 * | the prop moved onto the thumb's `View` instead of the faded one | 1 — the pairing |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Line comments first, then blocks — so a `/*` quoted inside a `//` line cannot open a block. */
const stripComments = (source: string): string =>
  source.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `<View …>` opening tag, attributes included. */
const openingViewTags = (source: string): string[] => source.match(/<View\b[\s\S]*?>/g) ?? [];

describe('Slider disabled fade', () => {
  const source = stripComments(readFileSync(resolve(__dirname, '..', 'Slider.tsx'), 'utf8'));
  const faded = openingViewTags(source).filter((tag) => /opacity:\s*disabled\b/.test(tag));

  it('fades exactly one view', () => {
    expect(faded).toHaveLength(1);
  });

  it('composites that view offscreen, so Android fades it as one layer', () => {
    expect(faded[0]).toMatch(/needsOffscreenAlphaCompositing=/);
  });
});
