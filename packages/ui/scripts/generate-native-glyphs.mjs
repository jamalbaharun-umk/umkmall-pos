/**
 * Generates the native house glyphs from the web ones.
 *
 *   node packages/ui/scripts/generate-native-glyphs.mjs
 *
 * Reads every `export const GlyphX = (props) => (<svg …>…</svg>)` in
 * `src/primitives/Icon/glyphs/index.tsx`, converts the SVG children to `react-native-svg`
 * elements, and writes `src/native/glyphs/generated.tsx`. It then reads the house half of the
 * web registry and rewrites the matching section of `src/native/icon-registry.ts`, so a name
 * points at the same drawing on both platforms.
 *
 * WHY A GENERATOR: a retyped path is a silently wrong drawing, and UMK-952 kept house glyphs
 * unported on native because porting 38 of them by hand was the real cost. Deriving them
 * from the web source makes the port mechanical — and re-runnable when a glyph changes.
 *
 * Only `path`, `rect` and `circle` children are supported, which is every element the web
 * file uses; anything else fails loudly so a new shape is ported deliberately.
 * `currentColor` becomes the `color` prop; any other literal fill/stroke (the file tiles'
 * colours, the sparkle's white halo) is kept as artwork. The credit coin is NOT generated: its
 * gradient needs a per-instance `useId`, so it lives in `glyphs/credit-coin.tsx` on the web and
 * `native/glyphs/credit-coin.tsx` here, hand-written over the same path and tokens (UMK-1218).
 *
 *   node packages/ui/scripts/generate-native-glyphs.mjs --check
 *
 * `--check` writes nothing and exits non-zero if either output differs from what is committed.
 * WITHOUT IT NOTHING GUARDS THE DRAWINGS: `icon-parity.test.ts` compares the two registries by
 * NAME, so editing a web glyph's path data left native rendering the old shape with every test
 * green — a generated file is only as trustworthy as the check that it was regenerated.
 * `__tests__/glyphs-generated.test.ts` runs this mode.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CHECK = process.argv.includes('--check');

/** Writes, or in `--check` compares and remembers the mismatch. */
const stale = [];
const emit = (path, content) => {
  if (!CHECK) return writeFileSync(path, content);
  const current = readFileSync(path, 'utf8');
  if (current !== content) stale.push(path);
};
const WEB_GLYPHS = resolve(here, '../src/primitives/Icon/glyphs/index.tsx');
const WEB_REGISTRY = resolve(here, '../src/primitives/Icon/registry.ts');
const OUT_GLYPHS = resolve(here, '../src/native/glyphs/generated.tsx');
const NATIVE_REGISTRY = resolve(here, '../src/native/icon-registry.ts');

const web = readFileSync(WEB_GLYPHS, 'utf8');

/** `export const GlyphX = (props: …) => (\n  <svg …>…</svg>\n);` */
const GLYPH = /export const (Glyph\w+) = \(props: SVGProps<SVGSVGElement>\) => \(\s*<svg([^>]*)>([\s\S]*?)<\/svg>\s*\);/g;
const ATTR = /([a-zA-Z:-]+)=(?:"([^"]*)"|\{([^}]*)\})/g;
const ELEMENT = /<(path|rect|circle|[a-zA-Z]+)\b([^>]*?)\/>/g;

const RN = { path: 'Path', rect: 'Rect', circle: 'Circle' };
const used = new Set();

const attrs = (raw) => {
  const out = [];
  for (const m of raw.matchAll(ATTR)) {
    const name = m[1];
    const value = m[2] ?? m[3];
    if (name === 'xmlns' || name === 'className') continue;
    if ((name === 'fill' || name === 'stroke') && value === 'currentColor') {
      out.push(`${name}={color}`);
      continue;
    }
    out.push(m[2] !== undefined ? `${name}="${m[2]}"` : `${name}={${m[3]}}`);
  }
  return out.join(' ');
};

const children = (glyph, inner) => {
  const els = [];
  for (const m of inner.matchAll(ELEMENT)) {
    const tag = m[1];
    if (!RN[tag]) throw new Error(`${glyph}: unsupported SVG element <${tag}> — extend the generator deliberately`);
    used.add(RN[tag]);
    els.push(`    <${RN[tag]} ${attrs(m[2])} />`);
  }
  const stripped = inner.replace(ELEMENT, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim();
  if (stripped) throw new Error(`${glyph}: unhandled SVG content: ${stripped.slice(0, 80)}`);
  return els.join('\n');
};

const glyphs = [];
for (const m of web.matchAll(GLYPH)) {
  const [, name, svgAttrs, inner] = m;
  const viewBox = /viewBox="([^"]+)"/.exec(svgAttrs)?.[1];
  if (!viewBox) throw new Error(`${name}: no viewBox`);
  const svgFill = /\bfill="([^"]+)"/.exec(svgAttrs)?.[1];
  const fillAttr = svgFill === undefined ? '' : svgFill === 'currentColor' ? ' fill={color}' : ` fill="${svgFill}"`;
  /* A STROKED glyph (the native-ui-v2 tab set) carries its stroke on the `<svg>` so every
     child inherits it, and the web caller's `strokeWidth` — spread last — re-weights the whole
     drawing. Native mirrors that: the four attributes go onto `Svg`, and the web's literal
     width becomes the DEFAULT of a destructured `strokeWidth` prop. Destructured, not left in
     `...a11y`: `Icon` always passes the key, so an unset width would spread `undefined` over
     the default and draw at SVG's 1. Glyphs without a root stroke emit exactly what they did. */
  const svgStroke = /\bstroke="([^"]+)"/.exec(svgAttrs)?.[1];
  const svgStrokeWidth = /\bstrokeWidth=(?:"([^"]+)"|\{([^}]+)\})/.exec(svgAttrs);
  const svgCap = /\bstrokeLinecap="([^"]+)"/.exec(svgAttrs)?.[1];
  const svgJoin = /\bstrokeLinejoin="([^"]+)"/.exec(svgAttrs)?.[1];
  let strokeAttr = '';
  if (svgStroke !== undefined) strokeAttr += svgStroke === 'currentColor' ? ' stroke={color}' : ` stroke="${svgStroke}"`;
  const strokeDefault = svgStrokeWidth ? (svgStrokeWidth[1] ?? svgStrokeWidth[2]) : undefined;
  if (strokeDefault !== undefined) strokeAttr += ' strokeWidth={strokeWidth}';
  if (svgCap !== undefined) strokeAttr += ` strokeLinecap="${svgCap}"`;
  if (svgJoin !== undefined) strokeAttr += ` strokeLinejoin="${svgJoin}"`;
  const drawn = children(name, inner);
  /* A fixed-palette glyph (a file tile's colour) never reads `color`; leaving it in the
     destructuring is an unused variable, which is a lint error rather than a nicety here. */
  const usesColor = drawn.includes('{color}') || fillAttr.includes('{color}') || strokeAttr.includes('{color}');
  const widthParam = strokeDefault !== undefined ? `strokeWidth = ${strokeDefault}, ` : '';
  glyphs.push(`export const ${name}: HouseGlyph = ({ size, ${usesColor ? 'color, ' : ''}${widthParam}style, ...a11y }) => (
  <Svg width={size} height={size} viewBox="${viewBox}"${fillAttr}${strokeAttr} style={style} {...a11y}>
${drawn}
  </Svg>
);`);
}
if (glyphs.length < 30) throw new Error(`only ${glyphs.length} glyphs parsed — the web file's shape changed`);

/* Top-level constants the glyphs reference (`d={SPARKLE_PATH}`, `rx={TILE_RADIUS}`) travel
   with them, verbatim. Only the ones actually referenced, so the file carries no dead data. */
const CONST = /^(?:export )?const ([A-Z_][A-Z0-9_]*) =\s*([^;]+);/gm;
const body = glyphs.join('\n');
const consts = [...web.matchAll(CONST)]
  .filter(([, name]) => new RegExp(`\\b${name}\\b`).test(body))
  .map(([, name, value]) => `const ${name} = ${value};`);

const imports = ['Svg', ...[...used].sort()].join(', ');
if (!CHECK) mkdirSync(dirname(OUT_GLYPHS), { recursive: true });
emit(
  OUT_GLYPHS,
  `/* GENERATED by packages/ui/scripts/generate-native-glyphs.mjs from primitives/Icon/glyphs/index.tsx.
 * Do not edit: change the web glyph and re-run the generator. Path data is byte-identical to
 * the web's; \`currentColor\` became the \`color\` prop, every other literal is artwork. */
import ${imports.includes(', ') ? `Svg, { ${[...used].sort().join(', ')} }` : 'Svg'} from 'react-native-svg';
import type { HouseGlyph } from './index';

${consts.join('\n')}

${glyphs.join('\n\n')}
`,
);

/* The registry: every `'name': { component: glyphs.GlyphX … }` line on the web becomes a
   `'name': GlyphX,` line on native, spliced between the two markers. */
const webRegistry = readFileSync(WEB_REGISTRY, 'utf8');
const rows = [...webRegistry.matchAll(/^\s*'?([a-z][a-z0-9-]*)'?:\s*\{\s*component:\s*glyphs\.(Glyph\w+)/gm)].map(
  ([, name, glyph]) => `  '${name}': glyphs.${glyph},`,
);
if (rows.length < 30) throw new Error(`only ${rows.length} house rows found in the web registry`);

const native = readFileSync(NATIVE_REGISTRY, 'utf8');
const START = '  // --- house artwork';
const END = '} as const satisfies';
const a = native.indexOf(START);
const b = native.indexOf(END);
if (a < 0 || b < 0) throw new Error('native registry markers not found');
const section = `  // --- house artwork: GENERATED from the web registry by scripts/generate-native-glyphs.mjs.
  // Every house name resolves to the same drawing as the web; re-run the generator after
  // adding a glyph there. ------------------------------------------------------------
${rows.join('\n')}
`;
emit(NATIVE_REGISTRY, native.slice(0, a) + section + native.slice(b));

/* A floor, for the same reason the palette sweep has one: if the glyph regex ever stops
   matching, this script produces an empty file and `--check` would compare it against an empty
   file it wrote earlier — two nothings agreeing. */
if (glyphs.length < 30) throw new Error(`only ${glyphs.length} glyphs parsed from the web source — the regex has drifted`);

if (CHECK) {
  if (stale.length > 0) {
    console.error(`✗ stale: ${stale.join(', ')}\n  run: node packages/ui/scripts/generate-native-glyphs.mjs`);
    process.exit(1);
  }
  console.log(`✓ ${glyphs.length} glyphs and ${rows.length} registry rows match the web source`);
} else {
  console.log(`✓ ${glyphs.length} glyphs → ${OUT_GLYPHS}`);
  console.log(`✓ ${rows.length} registry rows → ${NATIVE_REGISTRY}`);
}
