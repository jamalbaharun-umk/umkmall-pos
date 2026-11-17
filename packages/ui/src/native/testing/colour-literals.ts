/**
 * THE COLOUR-LITERAL MATCHERS, shared by the two guards that ban them (UMK-1317):
 * `apps/mobile/src/__tests__/design-literals.test.ts` (Jest) and
 * `packages/ui/src/native/__tests__/no-raw-colour.test.ts` (vitest).
 *
 * ONE MODULE, CALLED BY BOTH, because a ban is its matcher: two copies drift, and the copy that
 * forgets a spelling is the suite that stays green. The same goes for the COMMENT STRIPPER, which
 * decides what the matcher is shown at all — the two suites each had their own for one review
 * round, and each could be made to hide a literal (`blankComments` below says how). The module
 * lives under `native/` and outside `__tests__/` so that `apps/mobile`'s turbo `test` inputs
 * (`packages/ui/src/native/**`, tests excluded) hash it — an edit here misses the mobile cache. It
 * is exported from no entry; it is a test helper that sits where both runners can reach it, and
 * `typescript` is the only thing it imports.
 *
 * WHAT THE BAN FORBIDS, in its own words: **a colour value that is not read from the token tree.**
 * The spellings the language gives that, one row each — every `yes` row has a synthetic case in
 * both suites:
 *
 * | Spelling | Kind | Caught |
 * | -- | -- | -- |
 * | a hex that is the whole string, `'#FFFFFF'` | `hex` | yes |
 * | a hex inside a longer string, `'1px solid #fff'`, or on a later line of a template | `hex` | yes |
 * | a hex built by concatenation, `'#' + value`, `` `#${value}` `` | `hex-built` | yes |
 * | a hex assembled any other way — `'\x23fff'`, `['#', v].join('')`, `'#'.concat(v)`, `` `${'#'}fff` `` | — | no: these are a value being COMPUTED, and no lexical scan follows a computation |
 * | an alpha stuck onto a colour, `` `${token}cc` `` (nested braces included) or `token + 'cc'` | `alpha-concat` | yes |
 * | the same with DIGITS only and a `+`, `token + '80'` | — | no: `+ '00'` is zero-padding far more often than an alpha. The template form `` `${token}80` `` is still caught |
 * | the same through a call or a second interpolation — `token.concat('cc')`, `` `${token}${'cc'}` ``, `[token, 'cc'].join('')` | — | no: computed, as above. `withAlpha` is the one sanctioned way and is what a reader should find |
 * | a numeric colour, `0xFFFFFF`, `0XFF0074E7`, `0xFF_00_74_E7` | `hex-number` | yes |
 * | a number parsed from text, `parseInt('ff0074e7', 16)` | — | no: computed |
 * | a CSS colour function in any case, `rgb(`, `RGBA(`, `hsl(`, `hsla(`, `hwb(`, `lab(`, `lch(`, `oklab(`, `oklch(`, `color-mix(` | `colour-fn` | yes |
 * | a colour function split across a concatenation, `'rgba' + '(0,0,0,.5)'` | — | no: computed |
 * | a platform colour, `PlatformColor(`, `DynamicColorIOS(`, `processColor(` | `platform-colour` | yes |
 * | a CSS named colour — any of the 148 — anywhere in the VALUE of a colour key or prop: `color: 'white'`, `fill="black"`, `ctx.fillStyle = 'white'`, `color: dark ? 'white' : 'black'`, `color: ('white')`, `colors={['white', 'black']}`, `['color']: 'white'`, `background: 'white'`, `tint: 'red'` | `named` | yes |
 * | a named colour as any other word — `variant="white"`, `tone: 'red'` | — | no, deliberately: the word is a variant NAME there, and a bare word match cannot tell the two apart |
 * | `transparent`, `currentColor`, `none`, `inherit` | — | no: keywords, not colours |
 * | a decimal integer colour, `16777215` | — | no: indistinguishable from any other number |
 * | a colour behind an imported or local constant | — | no: the scan is lexical. For a hex, a number or a colour function the constant's own declaration is what gets caught |
 * | a NAMED colour behind a constant, a default or a return — `const C = { primary: 'white' }` then `color: C.primary`, `(c = 'white') =>`, `() => 'black'` | — | no: the name sits under no colour key where it is declared, and a bare word is also a variant name. A known miss, with no live case |
 * | the CSS `color(` function | — | no: `color(` is also an ordinary function name |
 * | a colour in a file that is not `.ts`/`.tsx` | — | no — so both suites assert no other source extension exists under their roots |
 *
 * `scanColourLiterals` takes source with COMMENTS ALREADY BLANKED by `blankComments` (a hex named
 * in a docblock is prose about a colour, not a colour). Strings are kept.
 */
import ts from 'typescript';

export type ColourOffenceKind = 'hex' | 'hex-built' | 'alpha-concat' | 'hex-number' | 'colour-fn' | 'platform-colour' | 'named';

export interface ColourOffence {
  line: number;
  kind: ColourOffenceKind;
  text: string;
}

/**
 * Comments and regex literals blanked, every newline kept so line numbers survive.
 *
 * READ OFF THE PARSER, NOT A PATTERN. Both suites first stripped comments by hand, and a stripper
 * that is wrong hides whatever follows it:
 *
 * - a regex stripper took the `//` in `'cdn//x'` for a comment and blanked the rest of the line,
 *   and took the slash-star in `'video/…'` for one and blanked every line up to the next close;
 * - a hand tokenizer took the apostrophe in the JSX text `Jum'at` for an opening quote, and from
 *   there read strings as code and code as strings.
 *
 * The parser already knows what a string, a template, a regex and JSX text are, so it is asked
 * for exactly that: the ranges of every such literal. Outside those ranges a `//` or a slash-star
 * can only be a comment, and is blanked to its end. A regex literal is blanked too — a colour
 * inside a pattern is a match target, not a colour. (Comment ranges are not read off the parser
 * directly: its trailing-comment lookup after a `>` would take the JSX text `// x` for one.)
 * `.ts` files are parsed as TS (a `<T>(x) => x` arrow is JSX to the TSX parser); everything else,
 * including the inline sources the suites test with, as TSX.
 */
const LITERAL_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

export function blankComments(source: string, fileName = 'inline.tsx'): string {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  /* Where each literal ends, by where it starts; and the regexes, which are blanked whole. */
  const literalEnd = new Map<number, number>();
  const regexes: [number, number][] = [];
  const visit = (node: ts.Node): void => {
    if (LITERAL_KINDS.has(node.kind)) {
      literalEnd.set(node.getStart(file), node.getEnd());
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) regexes.push([node.getStart(file), node.getEnd()]);
    }
    ts.forEachChild(node, (child) => {
      visit(child);
    });
  };
  visit(file);

  const out = source.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  for (const [from, to] of regexes) blank(from, to);
  for (let i = 0; i < source.length; ) {
    const end = literalEnd.get(i);
    if (end !== undefined && end > i) {
      i = end;
    } else if (source[i] === '/' && source[i + 1] === '/') {
      const stop = source.indexOf('\n', i);
      blank(i, stop === -1 ? source.length : stop);
      i = stop === -1 ? source.length : stop;
    } else if (source[i] === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const stop = close === -1 ? source.length : close + 2;
      blank(i, stop);
      i = stop;
    } else i += 1;
  }
  return out.join('');
}

/**
 * `#` and 3, 4, 6 or 8 hex digits, not part of a longer word or an HTML entity — and not a private
 * class member, which is the one place the language itself writes `#abc`: after a `.`, or before
 * `=`, `(`, `:`, `?` or `!`.
 */
const HEX = /(?<![\w$.&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z_-])(?!\s*[=(:?!])/g;

/** `'#' + x`, `"#" + x` and a template that opens `#${`. */
const HEX_BUILT = /(['"])#\1\s*\+|`#\$\{/g;

/** An interpolation closed right before exactly two hex digits and the end of the template, or `+ 'cc'` (a pair holding a letter). */
const ALPHA_CONCAT = /\}[0-9a-fA-F]{2}`|\+\s*(['"])(?:[a-fA-F][0-9a-fA-F]|[0-9][a-fA-F])\1/g;

/** `0x` and 6 or 8 hex digits, numeric separators allowed. */
const HEX_NUMBER = /\b0[xX](?:(?:[0-9a-fA-F]_?){7}[0-9a-fA-F]|(?:[0-9a-fA-F]_?){5}[0-9a-fA-F])\b/g;

const COLOUR_FN = /(?<![\w$.-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/gi;

const PLATFORM_COLOUR = /\b(?:PlatformColor|DynamicColorIOS|processColor)\s*\(/g;

/** The CSS named colours, all 148 (CSS Color 4), `transparent` and `currentColor` excluded as keywords. */
const NAMES = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral ' +
    'cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange ' +
    'darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey ' +
    'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ' +
    'ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink ' +
    'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose ' +
    'moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru ' +
    'pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue ' +
    'slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

/**
 * Something that takes a colour: a style key (`color`, `…Color`, `colors`, `background`, `tint`),
 * an SVG paint prop (`fill`, `stroke`, `stopColor`, `floodColor`) or a canvas paint (`fillStyle`,
 * `strokeStyle`) — bare, quoted or computed (`['color']`) — followed by `:` or `=`. Keyed on the
 * KEY, because a colour word alone is also a variant name.
 */
const COLOUR_KEY = /(?<![\w$])\[?['"]?(?:colors?|[A-Za-z]*Colors?|background|tint|fill|stroke|fillStyle|strokeStyle)['"]?\]?\s*[:=](?!=)/g;

const QUOTED = /(['"`])([A-Za-z]+)\1/g;

/**
 * The value that follows a key, and no further. A value that OPENS with a quote is that string; one
 * that opens with a bracket is that balanced group (a JSX `{…}`, a parenthesised value, an array) —
 * a JSX attribute has no terminator, so reading on would hand `fill="white"` every string after it.
 * Anything else runs to the `,`, `;` or closing bracket that ends it at depth 0, across lines, so
 * both arms of a ternary are inside it and the next key of the same object is not.
 */
function valueAfter(code: string, start: number): string {
  let from = start;
  while (/\s/.test(code[from] ?? '')) from += 1;
  const first = code[from];
  if (first === "'" || first === '"' || first === '`') {
    const close = code.indexOf(first, from + 1);
    return code.slice(from, close === -1 ? code.length : close + 1);
  }
  const grouped = first === '(' || first === '[' || first === '{';
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return code.slice(from, i);
      depth -= 1;
      if (grouped && depth === 0) return code.slice(from, i + 1);
    } else if ((c === ',' || c === ';') && depth === 0) return code.slice(from, i);
  }
  return code.slice(from);
}

/** Every colour literal in `code`, in line order. `code` must already be through `blankComments`. */
export function scanColourLiterals(code: string): ColourOffence[] {
  const offences: ColourOffence[] = [];
  /* Line starts, so a match's index becomes a line without re-splitting per match. */
  const starts = [0];
  for (let i = 0; i < code.length; i += 1) if (code[i] === '\n') starts.push(i + 1);
  const lineOf = (index: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  const each = (pattern: RegExp, kind: ColourOffenceKind) => {
    for (const m of code.matchAll(pattern)) offences.push({ line: lineOf(m.index), kind, text: m[0] });
  };
  each(HEX, 'hex');
  each(HEX_BUILT, 'hex-built');
  each(ALPHA_CONCAT, 'alpha-concat');
  each(HEX_NUMBER, 'hex-number');
  each(COLOUR_FN, 'colour-fn');
  each(PLATFORM_COLOUR, 'platform-colour');
  for (const key of code.matchAll(COLOUR_KEY)) {
    const from = key.index + key[0].length;
    for (const word of valueAfter(code, from).matchAll(QUOTED)) {
      if (NAMES.has(word[2].toLowerCase())) offences.push({ line: lineOf(from), kind: 'named', text: `${key[0].trim()} ${word[0]}` });
    }
  }
  return offences.sort((a, b) => a.line - b.line);
}
