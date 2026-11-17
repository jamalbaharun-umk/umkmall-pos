/**
 * The three generated token artifacts, checked against each other.
 *
 * `npm run tokens:build` emits ONE design source into THREE files, and each platform reads a
 * different one:
 *
 * - `src/tokens/generated.ts` — hex strings and unitless numbers. What `@umkmall/ui/native`
 *   reads, straight into `StyleSheet`.
 * - `tokens.css` — the same colours as space-separated RGB triples, as CSS custom properties.
 *   What the browser actually paints.
 * - `tokens.preset.js` — Tailwind class names pointing at those custom properties through
 *   `rgb(var(--x) / <alpha-value>)`. What a web component's class resolves through.
 *
 * NOTHING COMPARED THEM. `generated.test.ts` spot-checks one brand hex and one measurement,
 * which says the file parsed — not that the other two agree with it. So a generator change
 * that touched one emitter, a regeneration that wrote one file, or a hand-edit to any of them
 * would leave web and native rendering DIFFERENT COLOURS with both suites green and both
 * typechecks clean. That is the exact failure the design system exists to make impossible,
 * and it was the one part of "web and native use the same tokens" that rested on the
 * generator being correct rather than on anything checking.
 *
 * This is a DIFFERENT question from the purge guards. Those ask whether a class survives
 * Tailwind's content scan — whether it resolves at all. UMK-978 already records that a class
 * can resolve and still be the wrong colour. This asks whether the value behind it is the
 * value native draws.
 *
 * Sited in `packages/ui` with the artifacts it reads, per
 * docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md.
 *
 * PROVED RED, one injection per assertion. Four of five isolate to a single failure; the
 * fifth reds two for a reason worth writing down rather than tuning away:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | An opaque colour's triple drifts in `tokens.css` | 1 — opaque agreement |
 * | An alpha tint's rgb half drifts | 1 — alpha-as-triple |
 * | A shadow composite loses its colour | 1 — composite carriage |
 * | The preset points at a renamed property | 1 — dangling reference |
 * | A custom property is renamed away entirely | **2** — the colour it carried AND the
 *   preset reference that pointed at it. Both are true and both are the point: deleting a
 *   property is exactly the change that breaks the value and the pointer at once |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { tokens } from './generated';

const PACKAGE = resolve(__dirname, '..', '..');
const css = readFileSync(resolve(PACKAGE, 'tokens.css'), 'utf8');
const preset = createRequire(import.meta.url)(resolve(PACKAGE, 'tokens.preset.js')) as {
  theme: { extend: Record<string, Record<string, unknown>> };
};

/** Every `--name: value;` declaration in the stylesheet. */
const cssVars = new Map<string, string>();
for (const m of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) cssVars.set(m[1], m[2].trim());

/** `surface.hoverNeutral` → `surface-hover-neutral`, the emitter's own naming. */
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const flatten = (o: unknown, path: string[] = []): [string, unknown][] =>
  o && typeof o === 'object'
    ? Object.entries(o).flatMap(([k, v]) => flatten(v, [...path, k]))
    : [[path.map(kebab).join('-'), o]];

const leaves = flatten(tokens);

/** `#0074e7` → `0 116 231`, the triple form `tokens.css` publishes. */
const toTriple = (hex: string) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
};

/** Opaque colours — the ones published as their own custom property. */
const OPAQUE = leaves.filter(
  (e): e is [string, string] => typeof e[1] === 'string' && /^#[0-9a-f]{6}$/i.test(e[1]),
);

/**
 * Colours carrying ALPHA, which the emitter writes TWO different ways — so they get two
 * checks rather than one exclusion.
 *
 * A CSS custom property feeding Tailwind must hold a BARE TRIPLE, because the preset wraps it
 * as `rgb(var(--x) / <alpha-value>)` and the alpha slot is what an opacity modifier fills. A
 * value with its own alpha baked in cannot go there. So the emitter splits:
 *
 * - Ramp tints and the popup surface are published as their RGB HALF, alpha dropped
 *   (`--surface-default-overlay: 4 38 72` for `#04264899`). Native takes the baked hex.
 * - The three shadow colours have no standalone property at all; they sit inside a COMPOSITE
 *   (`--shadow-5-pct: 0 4px 12px 0 #0000000d`) as raw 8-digit hex, because a shadow is one
 *   CSS value rather than a colour a utility composes with.
 *
 * WHAT THIS MEANS FOR PARITY, and it is worth stating where someone will read it: the web does
 * NOT inherit a token's baked opacity. `bg-default-overlay` is FULLY OPAQUE unless the call
 * site writes `/40`, while native's `surface.default.overlay` is 60% by construction. That is
 * a real difference and it is a COMPONENT-level choice, not an emitter fault — the artifacts
 * agree, which is all this file can honestly assert. Do not widen it into a colour-equality
 * check between platforms; that question belongs to the component that picks the opacity.
 */
const ALPHA_AS_TRIPLE = leaves.filter(
  (e): e is [string, string] =>
    typeof e[1] === 'string' && /^#[0-9a-f]{8}$/i.test(e[1]) && !e[0].endsWith('-color'),
);

const ALPHA_IN_COMPOSITE = leaves.filter(
  (e): e is [string, string] =>
    typeof e[1] === 'string' && /^#[0-9a-f]{8}$/i.test(e[1]) && e[0].endsWith('-color'),
);

describe('the generated token artifacts agree with each other', () => {
  /**
   * THE ANTI-VACUITY FLOOR, per CATEGORY rather than per total. A total would stay green with
   * the alpha set empty — three values against 184 — and those three are exactly the ones
   * whose check is the fiddly one. Each category is asserted against a real count, because
   * every assertion below iterates one of them.
   */
  it('flattens the token tree into a real set of leaves to compare', () => {
    expect(leaves.length).toBeGreaterThan(600);
    /* 200 since the 18 Sep export (UMK-1091): 179 + the 24 leaves of the new `Disable` state
       group - the 3 `Default/Disable` leaves it replaced. READ OFF the build output, not
       predicted from that arithmetic — the arithmetic is what the number is checked against.
       201 since UMK-1333: + the `Red/R450` primitive (the AA error step).
       202 since UMK-1041: + the overlay's `Surface/Default Subtle` (L24).
       229 since native-ui-v2: + the identity overlay's opaque colours (`_overlay-identity-v2`), incl. Text/Default/Muted.
       228 since UMK-1603: - Surface/Page/Mesh (the mesh's base, no reader left).
       231 since UMK-1887: + Surface/Tile/Neutral, Icon/Tile/Neutral and its Text/Tile twin. */
    expect(OPAQUE.length).toBe(231);
    expect(ALPHA_AS_TRIPLE.length).toBe(7); // + 2 native-ui-v2: Glass/Strong, Border/Glass (the 4 mesh glows and Glass/Default left, UMK-1603)
    expect(ALPHA_IN_COMPOSITE.length).toBe(5); // + Shadow/Nav, Shadow/Float (native-ui-v2)
    expect(cssVars.size).toBeGreaterThan(300);
  });

  it('publishes every opaque colour as a css custom property with the same value', () => {
    const wrong: string[] = [];
    for (const [name, hex] of OPAQUE) {
      const declared = cssVars.get(name);
      if (declared === undefined) wrong.push(`${name}: generated.ts has ${hex}, tokens.css has no --${name}`);
      else if (declared !== toTriple(hex))
        wrong.push(`--${name}: tokens.css "${declared}" vs generated.ts ${hex} ("${toTriple(hex)}")`);
    }
    expect(wrong).toEqual([]);
  });

  it('publishes an alpha tint as its rgb half, so the preset can fill the alpha slot', () => {
    const wrong: string[] = [];
    for (const [name, hex] of ALPHA_AS_TRIPLE) {
      const declared = cssVars.get(name);
      if (declared === undefined) wrong.push(`${name}: generated.ts has ${hex}, tokens.css has no --${name}`);
      else if (declared !== toTriple(hex))
        wrong.push(`--${name}: tokens.css "${declared}" vs the rgb half of ${hex} ("${toTriple(hex)}")`);
    }
    expect(wrong).toEqual([]);
  });

  it('carries every shadow colour inside its composite property', () => {
    const wrong: string[] = [];
    for (const [name, hex] of ALPHA_IN_COMPOSITE) {
      /* `shadow-5-pct-color` is the leaf; `--shadow-5-pct` is the composite holding it. */
      const composite = name.replace(/-color$/, '');
      const declared = cssVars.get(composite);
      if (declared === undefined) wrong.push(`${name}: no --${composite} to carry it`);
      else if (!declared.toLowerCase().includes(hex.toLowerCase()))
        wrong.push(`--${composite} "${declared}" does not carry generated.ts's ${hex}`);
    }
    expect(wrong).toEqual([]);
  });

  /**
   * The third artifact. A Tailwind class resolving to `rgb(var(--gone) / <alpha-value>)` is
   * not an error anywhere — the rule is emitted, the browser cannot resolve the property, and
   * the element paints its inherited or default colour. Silent, and invisible to every purge
   * guard, which asks only whether the CLASS survives.
   */
  it('points every preset colour class at a custom property that exists', () => {
    const dangling: string[] = [];
    let references = 0;
    for (const [family, entries] of Object.entries(preset.theme.extend)) {
      for (const [name, value] of Object.entries(entries ?? {})) {
        if (typeof value !== 'string') continue;
        for (const m of value.matchAll(/var\(--([a-z0-9-]+)\)/gi)) {
          references++;
          if (!cssVars.has(m[1])) dangling.push(`${family}.${name} → --${m[1]}`);
        }
      }
    }
    /* Its own floor: a regex that stopped matching would find zero references and pass. */
    expect(references).toBeGreaterThan(200);
    expect(dangling).toEqual([]);
  });

  /**
   * UMK-1325: type is rem times the text-size scale, never px. Reads the COMMITTED files so
   * turbo's hash for this package covers what actually ships.
   */
  it('publishes no px type: size and leading are rem calc, tracking is em', () => {
    const sizes = Object.entries(preset.theme.extend.fontSize ?? {}) as [string, [string, { lineHeight: string; letterSpacing?: string }]][];
    expect(sizes.length).toBeGreaterThan(20);
    for (const [name, [size, opts]] of sizes) {
      expect(size, name).toMatch(/^calc\([\d.]+rem \* var\(--ds-text-scale, 1\)\)$/);
      expect(opts.lineHeight, name).toMatch(/^calc\([\d.]+rem \* var\(--ds-text-scale, 1\)\)$/);
      if (opts.letterSpacing) expect(opts.letterSpacing, name).toMatch(/em$/);
    }
    const typeVars = [...cssVars].filter(([k]) => k.startsWith('typography-'));
    expect(typeVars.length).toBeGreaterThan(20);
    for (const [k, v] of typeVars) expect(v, k).not.toMatch(/\d(\.\d+)?px/);
  });
});
