import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import { DS_STATE_SEGMENT } from './purge-support';

/**
 * THE BLIND SPOT THE OTHER TEN PURGE GUARDS LEAVE.
 *
 * Each `*.purge.test.ts` derives its expectations from a namespace import of its own
 * `*-classes.ts` module, so it can only see classes a class TABLE names. A class written
 * inline in a component reaches Tailwind as CONTENT — content can only ADD rules to the
 * compiled stylesheet, so nothing anywhere asserts that an inline class resolves to one.
 *
 * That gap is not theoretical. UMK-978 renamed every colour token in the package, and 39 of
 * the 522 sites were inline: half of them in `DateTimeInput.tsx` alone, and two inside a
 * DOCBLOCK in `utils/cn.ts` — which are still live, because Tailwind scans that file as
 * content and does not care that the text is prose. A stale one renders as no colour, with
 * no build error and no failing test.
 *
 * WHY THIS IS NOT GRADING ITS OWN HOMEWORK. The expectation is read out of the SOURCE TEXT;
 * the evidence is the COMPILED CSS. Those are independent, because Tailwind's JIT emits a
 * rule for a class it finds in content only if that class resolves against the theme — an
 * unknown utility produces silence, not a rule. So a class this extractor finds and the
 * stylesheet does not carry is exactly the failure, and it cannot pass by construction.
 *
 * Sited in THIS package, like every other purge guard: turbo's `test` hash covers a
 * package's own files and not its workspace dependencies' (UMK-852), so a guard living in a
 * dependent app would replay a cached PASS over a live break here.
 */
const require_ = createRequire(import.meta.url);
const PACKAGE = resolve(__dirname, '..');
const SRC = resolve(PACKAGE, 'src');

/**
 * Source only, and the same exclusions the other guards use. If this swept `.test.ts` in,
 * the class names written out below as expectations would become their own content and
 * every one would report as emitted whether or not a component uses it.
 */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.(?:test|test-d|stories)\./.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

/**
 * Every colour-bearing utility shape, extracted by SHAPE rather than by membership.
 *
 * Keying the extraction on "is this one of the palette's keys?" would be the vacuous
 * version: a class naming a token that no longer exists would fail the membership test,
 * drop out of the extraction, and never be checked — the guard would go quiet on precisely
 * the input it exists to catch. So this matches the utility PREFIX and takes whatever
 * follows, and lets the compiled stylesheet decide whether it is real.
 *
 * Variant prefixes (`hover:`, `focus-within:`, `md:`) are stripped: the emitted selector carries
 * them escaped, and the question here is whether the COLOUR resolves.
 *
 * WHICH IS WHY `:` IS IN THE LEADING CHARACTER CLASS, and leaving it out is how this guard shipped
 * blind to most of what it was written for. A variant-prefixed class is preceded by the variant's
 * colon, not by whitespace or a quote — so `focus-visible:border-focus-brand` matched nothing, and
 * the guard skipped every stateful class in the package. `DateTimeInput.tsx`, the file this exists
 * for, is mostly those. An injection proof that happens to use an unprefixed class passes either
 * way, which is exactly how the hole survived one.
 */
const UTILITY = /(?:^|[\s"'`:])((?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|placeholder|accent|caret|shadow)(?:-[trblxyse])?-[a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?![-\w])/g;

/**
 * THE DIMENSION HALF, and it is here because leaving it out cost a second rename (UMK-978).
 *
 * The colour list above is a list of UTILITY names, which is the wrong shape for the design
 * system's spacing and radius scales: those ride Tailwind's own utilities (`p-`, `gap-`,
 * `rounded-`, `w-`) and are told apart from Tailwind's built-in steps only by the `ds-` prefix
 * the emitter gives them. Enumerating every utility that can take a spacing value is a list that
 * goes stale; matching the prefix is not.
 *
 * Scoped to `-ds-` deliberately rather than widened to all of `p-`/`w-`/`rounded-`: a built-in
 * step always resolves, so checking it adds no signal, and matching bare `w-9`-shaped tokens
 * would start finding them in prose.
 */
const DS_UTILITY = /(?:^|[\s"'`:])(-?[a-z]+(?:-[a-z]+)*-ds-[a-z0-9]+(?:-[a-z0-9]+)*)(?![-\w])/g;

/**
 * PROSE THAT HAPPENS TO BE CLASS-SHAPED. Matching by shape over raw file text is what keeps
 * the extraction falsifiable (see above), and the price is that an English hyphenation after
 * a utility word reads as a class: "a text-shaped box", "a stroke-shaped tick". The one SVG
 * entry is a CSS PROPERTY named in a comment, not a utility.
 *
 * Each entry is a WHOLE candidate string, so an exclusion cannot hide a stale token: nothing
 * here is a prefix, and `text-default-primary` is not `text-shaped`. Add to this only for a
 * string that is provably not a class.
 */
const PROSE_NOT_CLASSES = new Set(['text-shaped', 'stroke-shaped', 'stroke-dashoffset']);

/** Anything Tailwind's JIT generates from the very line it is read off cannot be falsified,
 *  and anything interpolated is not a class at all. Both are excluded by every guard here. */
const isCheckable = (klass: string): boolean =>
  !klass.includes('[') &&
  !klass.includes('$') &&
  !klass.includes('{') &&
  !klass.endsWith('-') &&
  !PROSE_NOT_CLASSES.has(klass);

const extract = (text: string): string[] => {
  const out: string[] = [];
  for (const re of [UTILITY, DS_UTILITY])
    for (const m of text.matchAll(re)) if (isCheckable(m[1])) out.push(m[1]);
  return out;
};

/** A class is OURS if it names a design-system colour state or carries the `ds-` scale prefix. */
const isDesignSystem = (klass: string): boolean =>
  DS_STATE_SEGMENT.test(klass) || klass.includes('-ds-');

/**
 * WHICH FILES CONTRIBUTE, enumerated (UMK-956). A guard over N contributors cannot see one
 * of them disappear: if the walk stopped descending into `primitives/`, or the extension
 * filter stopped matching `.tsx`, the remaining files would still yield hundreds of classes
 * and every "each class resolves" assertion would stay green over a dark root.
 *
 * A `> 0` floor is no answer either — most extraction failures are PARTIAL, and a partial
 * one leaves plenty behind (UMK-958). So the contributors are named. Adding a colour class
 * to a component not on this list is a one-line admission; losing one is red.
 *
 * `src/tokens/TypographyPage.tsx` was on this list until `Text` dropped its `lg:` Desktop step.
 * Its only class literal lived in a DOCBLOCK — a sentence quoting the responsive pair — and this
 * guard counts comments on purpose, so that prose was emitting a real `lg:text-ds-h2-desktop`
 * rule into the bundle after nothing applied it any more. The page's specimens paint from CSS
 * variables, so rewriting the sentence left the file with no `ds-` literal at all. It is removed
 * rather than kept alive by restoring the class: a comment should not carry a live class it is
 * only talking about.
 */
const CONTRIBUTORS = [
  'src/docs/generated.ts',
  'src/native/ChatMessageTTSButton.tsx',
  'src/native/ChatSoundWave.tsx',
  'src/native/CheckBox.tsx',
  'src/native/Switch.tsx',
  'src/native/content-styles.ts',
  'src/native/feedback-styles.ts',
  'src/native/Stepper.tsx',
  /* Joined the list in UMK-1091. Its colour tables named the app's legacy `z-*`/`state-*`
     keys until then, which are not design-system classes — so the component wrote sixty
     colour classes and contributed nothing here, and its whole palette sat outside the one
     guard that would have proved those classes resolve. */
  'src/primitives/Button/Button.tsx',
  'src/primitives/CheckBox/CheckBox.tsx',
  'src/primitives/DateTimeInput/DateTimeInput.tsx',
  'src/primitives/Dialog/Dialog.tsx',
  /* UMK-1325: these two write only a `text-ds-*` TYPE class (it was a plain Tailwind size), which the shape
     scan reads as a `text-` utility; the compiled sheet still decides, and it resolves. */
  'src/primitives/Label/Label.tsx',
  'src/primitives/Menu/Menu.tsx',
  'src/primitives/OtpInput/OtpInput.tsx',
  'src/primitives/Radio/Radio.tsx',
  'src/primitives/Select/Select.tsx',
  'src/primitives/Sidebar/SidebarMenuItem.tsx',
  'src/primitives/Slider/Slider.tsx',
  'src/primitives/Switch/Switch.tsx',
  'src/primitives/Text/Text.tsx',
  'src/primitives/TextField/TextField.tsx',
  'src/primitives/Tooltip/Tooltip.tsx',
  'src/primitives/Upload/Upload.tsx',
  'src/primitives/field-support.tsx',
  'src/utils/cn.ts',
];

/**
 * SEVERAL OF THOSE ARE NATIVE FILES, AND THAT IS CORRECT — no count is given here on purpose,
 * because the list above is the enforcement and a number in prose only rots beside it.
 *
 * A native file earns a place by naming a web class IN A DOCBLOCK, to record something the two
 * platforms hold in common: `native/Switch.tsx` and `native/CheckBox.tsx` cite "`border-2` plus
 * `p-ds-5xs` on the web" for a measurement; `native/content-styles.ts` and
 * `native/feedback-styles.ts` cite `from-default-brand to-hover-brand` and
 * `from-hover-brand to-hover-success` to say WHICH stop of a web gradient their flat native fill
 * is; `native/Stepper.tsx` cites `border-border-secondary` to record that the web keeps a
 * hand-kept preset entry for a colour native reads as a real token.
 *
 * `src/docs/generated.ts` IS ON THE LIST FOR A BETTER REASON THAN THE REST, and it is worth
 * saying: the design-system prose used to live in `apps/design/src/docs/*.mdx`, and KTD6
 * records that this guard and its nine siblings do not see `.mdx` at all — so a stale colour
 * class written in a Guidelines page shipped with nothing able to catch it. That prose is now
 * compiled into a `.ts` module both platforms import, which puts it inside the scan for the
 * first time. The two classes it names are `bg-default-primary` and `text-default-primary`:
 * the UMK-978 pair that share a name and hold different hexes, cited in the page that warns
 * about exactly that. A guard now proves they still resolve.
 *
 * React Native never sees a class, but Tailwind's content scan reads the comment and emits a real
 * rule for it, exactly as it does for `utils/cn.ts`. So the reference is live in the only sense
 * that matters here: if the scale is renamed and the comment is not, the parity note now cites a
 * class that does not exist. Same reasoning as the docblock rule below, one platform over.
 */


const compile = async (files: string[]): Promise<string> => {
  const preset = require_(resolve(PACKAGE, 'tailwind.preset.js'));
  const processed = await postcss([
    tailwind({ presets: [preset], content: files }),
  ]).process('@tailwind utilities;', { from: undefined });
  return processed.css;
};

describe('the classes written inline in components survive the purge', () => {
  let css = '';
  /** Read once. Every check below reads the same text, and Tailwind is given the same file
   *  list — so a walk that goes dark cannot be dark for one check and lit for another. */
  const source = new Map<string, string>();
  const byFile = new Map<string, string[]>();

  beforeAll(async () => {
    for (const file of sourceFiles(SRC)) source.set(file, readFileSync(file, 'utf8'));
    for (const [file, text] of source) {
      /* `-classes.ts` files are the other nine guards' territory. `purge-support.ts` is this
         file's own matchers — the class names in it are regex source, not markup, and counting
         them would make the guard part of what it measures. */
      if (/(?:-classes|purge-support)\.tsx?$/.test(file)) continue;
      const found = extract(text);
      if (found.length) byFile.set(relative(PACKAGE, file), found);
    }
    css = await compile([...source.keys()]);
  });

  it('emits a rule for every colour class written inline in a component', () => {
    /* The class is matched after a `.` OR after an escaped `\:`, because the extraction strips
       variant prefixes while Tailwind keeps them in the selector: `lg:text-ds-h1-desktop` is
       emitted as `.lg\:text-ds-h1-desktop`, which does not contain `.text-ds-h1-desktop`. Without
       the second alternative every variant-prefixed class reports as purged the moment the
       extraction starts finding them. */
    const emitted = (klass: string) =>
      new RegExp(
        `(?:\\.|\\\\:)${klass.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`,
      ).test(css);
    const pairs = [...byFile].flatMap(([file, classes]) => classes.map((c) => [file, c] as const));
    /* Scanned once per DISTINCT class rather than once per site — 138 classes across 602
       sites — but reported per site, because the file name is what a reader needs. */
    const resolves = new Map([...new Set(pairs.map(([, klass]) => klass))].map((k) => [k, emitted(k)]));
    const missing = pairs.filter(([, klass]) => !resolves.get(klass)).map(([file, klass]) => `${file}: ${klass}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  /**
   * THE ANTI-VACUITY FLOOR, sized to a PARTIAL failure rather than a total one (UMK-958).
   * The contributors are named, so a walk that goes dark on one directory reds even though
   * the other ten still yield classes — which a `> 0` total, or a `>= 50` total, would not.
   */
  it('reads a design-system colour class out of every component that writes one', () => {
    const contributing = [...byFile]
      .filter(([, classes]) => classes.some(isDesignSystem))
      .map(([file]) => file)
      .sort();
    expect(contributing).toEqual([...CONTRIBUTORS].sort());
  });

  /**
   * `utils/cn.ts` IS ON THAT LIST AND ITS CLASSES ARE IN A DOCBLOCK. That is not an
   * oversight to tidy away: Tailwind scans the file as content and emits a real rule for a
   * class written in a comment, so the comment is live code with respect to this check.
   * Asserted explicitly because a future reader will otherwise "fix" it.
   */
  it('counts the classes in a docblock, because Tailwind does', () => {
    const cn = byFile.get('src/utils/cn.ts') ?? [];
    expect(cn.some((c) => DS_STATE_SEGMENT.test(c)), 'cn.ts names no design-system colour').toBe(true);
  });

  /**
   * THE HOLE EVERY OTHER GUARD IN THIS PACKAGE HAS, INCLUDING THE ONE ABOVE (UMK-978).
   *
   * Every purge guard filters arbitrary values out of its coverage, and correctly: Tailwind's
   * JIT generates the rule from the very line the expectation is read off, so `bg-[#fff]`
   * always resolves and the check always passes. But an arbitrary value that names a CSS
   * VARIABLE is not self-satisfying at all — `rgb(var(--surface-brand))` compiles to a
   * perfectly valid declaration referencing a variable nothing defines, and the browser drops
   * it. The rule exists, the class is emitted, and the element paints nothing.
   *
   * That is exactly what the token restructure did to `Slider`'s filled track and the
   * gradient spinner's sweep: both are documented escapes from the class-only rule, both name
   * a token by variable, and both went silent while every guard here stayed green. A browser
   * pass caught them; this catches the next one.
   *
   * `tokens.css` is the independent evidence — it is generated from the export, so it cannot
   * agree with a stale reference by construction. `--slider-fill` and friends are the
   * component's OWN inline properties, which is why the check is scoped to the token prefixes.
   */
  it('resolves every design-token CSS variable named inside an arbitrary value', () => {
    const declared = new Set(
      [...readFileSync(resolve(PACKAGE, 'tokens.css'), 'utf8').matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(
        (m) => m[1],
      ),
    );
    expect(declared.size, 'tokens.css declares no variables — did the path move?').toBeGreaterThan(100);
    /* Matches the FALLBACK form too — `var(--x, #fff)` is the shape most likely to be written by
       someone being careful, and closing on `)` alone skipped exactly those. And the token
       prefixes are derived from what `tokens.css` actually declares rather than hand-listed: a
       hand-list silently stops covering a group the day Ensyra adds one, which is the drift this
       whole change set is about. `--slider-fill` and friends are the components' OWN inline
       properties, share no prefix with a declared token, and so fall outside by construction. */
    const groupOf = (name: string) => name.slice(2).split('-')[0];
    const TOKEN_PREFIXES = new Set([...declared].map(groupOf));
    const TOKEN_VAR = /var\(\s*(--[a-z0-9-]+)\s*[,)]/g;
    const missing: string[] = [];
    for (const [file, text] of source) {
      for (const m of text.matchAll(TOKEN_VAR)) {
        if (!TOKEN_PREFIXES.has(groupOf(m[1]))) continue;
        if (!declared.has(m[1])) missing.push(`${relative(PACKAGE, file)}: ${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = [...source.keys()];
    expect(scanned.some((f) => f.endsWith('inline-classes.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('DateTimeInput.tsx'))).toBe(true);
  });
});
