/**
 * The native icon registry names the SAME glyphs as the web registry — no more, no fewer.
 *
 * The native file cannot import the web one (its import graph would pull `lucide-react`
 * through the DOM guard), so the two lists are restated and this is what links them. A name
 * added on the web without a native entry — even a `null` one — reddens here, so the
 * "house artwork is ported per screen" rule (UMK-952) cannot quietly become "house artwork
 * is missing on native and nothing says so".
 *
 * The web registry is imported for real (it loads fine under happy-dom); the native one is
 * read as text, because `lucide-react-native` requires `react-native`, whose entry is Flow.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES as WEB_ICON_NAMES } from '../../primitives/Icon/registry';

const NATIVE_REGISTRY = resolve(__dirname, '..', 'icon-registry.ts');

/** The keys of the `ICON_REGISTRY = { … }` literal, quoted or bare. */
const nativeNames = (): { all: string[]; ported: string[] } => {
  const source = readFileSync(NATIVE_REGISTRY, 'utf8');
  const body = source.slice(source.indexOf('export const ICON_REGISTRY = {'), source.indexOf('} as const satisfies'));
  const all: string[] = [];
  const ported: string[] = [];
  /* The value is a bare identifier for the lucide half and a `glyphs.GlyphX` member for the
     generated house half, so the dot belongs in the pattern — without it the house rows do
     not parse at all and every count below silently drops to the lucide list. */
  for (const m of body.matchAll(/^\s*'?([a-z][a-z0-9-]*)'?:\s*([A-Za-z0-9.]+|null),/gm)) {
    all.push(m[1]);
    if (m[2] !== 'null') ported.push(m[1]);
  }
  return { all, ported };
};

describe('native icon registry parity', () => {
  const { all, ported } = nativeNames();

  it('parses the native registry, so the comparison is not vacuous', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it('names exactly the glyphs the web registry names', () => {
    expect([...all].sort()).toEqual([...WEB_ICON_NAMES].sort());
  });

  it('lists no name twice', () => {
    expect(new Set(all).size).toBe(all.length);
  });

  // The lucide half ports wholesale, and since the generator
  // (`scripts/generate-native-glyphs.mjs`) the house half does too: nothing may be `null`.
  // A `null` here is a house glyph the generator did not produce — re-run it, or fix the
  // web glyph it choked on — never a name to leave for later.
  it('has ported every glyph, lucide and house alike', () => {
    expect(ported).toHaveLength(all.length);
    expect(ported).toContain('whatsapp');
    expect(ported).toContain('composer-mic');
  });
});
