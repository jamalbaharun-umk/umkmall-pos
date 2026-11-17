/**
 * The contract, checked against the code — the direction nothing ran (UMK-900).
 *
 * Every other guard here runs CONTRACT → CODE: it starts from an entry and asks whether the
 * component honours it. None of them can see the opposite failure, which is the one the ticket
 * names: a component carrying a variant vocabulary the contract has never heard of. That variant
 * cannot be mirrored on native — it simply goes missing, with nothing failing.
 *
 * SO THIS FILE MAKES THE FAILURE UNREPRESENTABLE RATHER THAN DETECTABLE. Two assertions, and only
 * the second one closes the hole:
 *
 *   (a) every axis the contract declares is provably READ by its component — contract → code, and
 *       still blind to a vocabulary the contract never declared;
 *   (b) no source file outside `contract/` may DECLARE a variant vocabulary at all — no unpinned
 *       `cva` variant table, no `keyof typeof` on an exported alias, no bare literal union on an
 *       exported type. With nowhere else for a vocabulary to live, the contract is the only legal
 *       place to name one.
 *
 * SITED IN `packages/ui`, DELIBERATELY. `turbo.json`'s `test` task is cacheable with no `inputs`
 * or `dependsOn`, so a task hash covers a package's own files and not its workspace dependencies'.
 * The same guard written in a dependent app would replay a cached PASS over a live regression here.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * THE CONTRACT IS IMPORTED, NOT PARSED, for the reason `native-parity.test.ts` gives at length: a
 * regex over `variants.ts` that stops matching yields zero entries, every loop runs zero times,
 * and the suite goes green over a contract nobody read.
 *
 * COMMENTS ARE STRIPPED BEFORE BOTH ASSERTIONS, and the exposures are OPPOSITE ways round — which
 * is why neither can be skipped. Under (a) a commented-out `Of<'size'>` would satisfy a coupling
 * that does not exist: a false GREEN, which is the exact failure this ticket exists to prevent.
 * Under (b) a `cva(` inside prose would fail a correct file: a false RED. The stripper is a regex
 * and is imperfect on a string containing `//`; under (b) that under-reports and under (a) it
 * over-reports, and neither is silent.
 * See docs/solutions/conventions/a-comment-can-blind-a-regex-guard-test.md
 *
 * PROVED RED, one break per injection, each on an observed `cache miss` — `turbo.json`'s `test`
 * task is cacheable with no `inputs`, so a cached PASS can replay over a live regression. The two
 * GREEN rows are not filler: each is a shape this guard must NOT fire on, and the argument for
 * both is only worth as much as the run behind it.
 *
 * | Injection | Result |
 * | -- | -- |
 * | A contract axis nothing reads (`Header.tone`) | 1 red — axis coverage |
 * | A bare literal union on an exported type | 1 red — the union ban |
 * | `Text`'s weight table stripped of its `satisfies` | 1 red — the unpinned-table ban |
 * | An UNEXPORTED `keyof typeof` added | **green** — KTD3's distinction holds |
 * | A `cva` variant table inside a COMMENT | **green** — the stripper holds |
 * | The axis allowlist given a duplicate row | 1 red — the one-row cap |
 * | A union-allowlist row deleted, declaration left standing | 1 red — the union ban |
 * | An override pointed at a missing file | **2** — the resolution check, plus the axis assertion
 *   that goes on to read the same path. Recorded rather than dressed up: crediting that red to one
 *   assertion would be crediting it to the wrong one (UMK-958) |
 * | An allowlisted entry that becomes couplable | **2** — the row's own assertion AND the one-row
 *   cap, because any entry couplable enough to prove this is also a second row |
 *
 * AND THEN REVIEW BROKE IT SIX WAYS, which is the part worth reading. Every red above used a
 * spelling the regexes already matched, so the table proved the guard caught what it caught — it
 * could not tell a ban on the IDIOM from a ban on three spellings of it. All six went GREEN, and
 * each reds now:
 *
 * | Evasion | Now |
 * | -- | -- |
 * | `export const X = ['a','b'] as const` + exported `(typeof X)[number]` | 1 red |
 * | A leading-pipe, multi-line union | 1 red |
 * | A double-quoted union | 1 red |
 * | `type X = keyof typeof …` declared bare, then `export type { X }` | 1 red |
 * | A second `cva` block in a file whose first one is pinned | 1 red |
 * | A vocabulary under `tokens/`, or in a loose file directly under `src/` | 1 red each |
 *
 * Those six are the evasions. The three below are the assertions the fix ADDED, injected on the
 * same terms — listed here rather than folded into the table above, so a later reader can still
 * see where the six ended:
 *
 * | Injection (assertions added by the fix) | Result |
 * | -- | -- |
 * | A scan root dropped from `SCAN_ROOTS` | 1 red — the completeness assertion |
 * | A `MODULE_OVERRIDES` key naming no contract entry | **2** — the override check plus the entry
 *   resolution that reads the same map |
 * | `ChatVoiceButton.state` widened away from its two siblings | 1 red |
 *
 * The first of those is the one to remember: it is the shape `header-classes.ts` itself carried
 * until this ticket coupled it. A guard that cannot catch the idiom it was written to remove is
 * the failure it exists to prevent, and only an injection nobody had recorded could find it.
 *
 * AND THEN REVIEW BROKE IT THREE MORE WAYS — on the FIXED guard, which is the part that should
 * temper any confidence in the table above. Two of the three were introduced by the fix itself:
 *
 * | Evasion | Now |
 * | -- | -- |
 * | A literal union on a property of an exported `interface` | 1 red, single-line and multi-line |
 * | `satisfies Record<string, string>` as the pin | 1 red |
 * | The `variants` table hoisted into a file with no `cva(` | 1 red |
 * | A pin alias re-declared locally instead of derived | 1 red — the alias-derivation check |
 * | The same property union on an UNEXPORTED interface | **green** — still the right answer |
 *
 * The property detector had been INERT SINCE THE FIRST FIX: unifying the export check onto
 * `exported.has(name)` filtered every property match, because a property name is never a
 * declaration name. It was the commonest spelling of the thing this bans, it was listed in the
 * table above as proved, and the red it recorded had come from the alias form. A regex that
 * matches and a detector that reports are not the same claim — and the anchor hid a second half of
 * it, since `^` missed every single-line interface even once the export check was right.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract, TEXT_COLORS, TEXT_ROLES, TEXT_WEIGHTS, type ComponentContract } from './variants';

const SRC = resolve(__dirname, '..');

/**
 * Entry → the file that declares its vocabulary, where a basename search cannot find it.
 *
 * Kept HERE rather than added as a field on the contract, the same call `native-parity.test.ts`'s
 * `module` override and `unfamilied-coverage.test.ts`'s allowlist make: it benefits a handful of
 * entries out of 43, and a contract field would have to be answered by every one of them.
 *
 * The three composer buttons all point at the SHARED base. Each wrapper is a ten-line alias
 * (`export type ChatVoiceButtonProps = ComposerButtonProps`) that declares nothing, so an entry
 * resolving to the wrapper would read no axis and red on a correct component.
 */
const MODULE_OVERRIDES: Readonly<Record<string, string>> = {
  Sidebar: 'primitives/Sidebar/SidebarMenuItem.tsx',
  Menu: 'primitives/overlay-classes.ts',
  Header: 'primitives/header-classes.ts',
  ChatToolsButton: 'primitives/ChatComposer/composer-button.tsx',
  ChatAttachmentButton: 'primitives/ChatComposer/composer-button.tsx',
  ChatVoiceButton: 'primitives/ChatComposer/composer-button.tsx',
  /* native-ui-v2 entries with NO web component (`status: 'declared'`, the web does not follow the
     identity): the native module is the only file that reads their vocabulary, so it is the one
     this guard must read, rather than letting the entry resolve to nothing. */
  Avatar: 'native/Avatar.tsx',
  /* NATIVE-ONLY entries (native-ui-v2, `status: 'declared'`): no web module exists or is meant
     to, so the module that reads the axes is the native one. Without an override the basename
     search finds nothing and the entry reds as "nothing resolves" on a correct component.
     (`TabBar` left this list in UMK-1757, and `ListGroup`, `ListRow` and `ProfileHeader` in UMK-1840:
     their web modules under `primitives/` resolve.) */
  IconButton: 'native/IconButton.tsx',
  FeatureTile: 'native/FeatureTile.tsx',
  PhotoCard: 'native/PhotoCard.tsx',
  CoinChip: 'native/CoinChip.tsx',
  MonthCalendar: 'native/MonthCalendar.tsx',
};

/** Where a component may live when no override names its file. */
const COMPONENT_ROOTS = ['primitives', 'compositions', 'layouts'] as const;

/**
 * Everything outside `contract/` that a vocabulary could hide in.
 *
 * EXCLUDING A ROOT IS EXCLUDING IT FROM THE BAN, which is why `tokens/` is listed rather than waved
 * off as generated: it is exported from the package root, so a union declared there is as reachable
 * by a caller as one in `primitives/`. Only two things are out — `contract/`, the one legal home of
 * a vocabulary, and `native/`, out of this ticket's scope. The generated files are excluded BY
 * FILENAME below, not by hiding the directories that hold them.
 *
 * `''` is the package root's own loose files (`purge-support.ts`, `index.ts`), which no directory
 * root reaches. `reaches every source file` below proves this list is complete rather than trusting
 * it — a floor counts what a listed root holds and is silent about a root nobody listed.
 */
const SCAN_ROOTS = ['primitives', 'compositions', 'layouts', 'patterns', 'utils', 'shared', 'hooks', 'tokens', 'docs', ''] as const;

/** Not scanned, each for its own stated reason — never merely forgotten. */
const UNSCANNED = ['contract', 'native'] as const;

/* `withFileTypes`, as every sibling scan guard in this package already does — one syscall batch
   rather than a `statSync` per entry. */
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const isSource = (path: string): boolean =>
  /\.tsx?$/.test(path) && !/\.(test|stories|test-d)\./.test(path) && !/\/generated\.ts$/.test(path);

/**
 * LINE COMMENTS FIRST, THEN BLOCK — the order is the whole point and the reverse is a recorded
 * incident. A `//` comment legally contains the two characters that open a block comment (a glob
 * like `src/a2ui/**`, a path like `next/*`), so stripping blocks first opens a comment there and
 * swallows real code until the next close — hundreds of lines, silently, from a documentation-only
 * edit. See docs/solutions/conventions/a-comment-can-blind-a-regex-guard-test.md
 */
const stripComments = (source: string): string =>
  source.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const entries = Object.entries(contract) as [string, ComponentContract][];

/** The file that declares an entry's vocabulary, or `undefined` when nothing resolves. */
const moduleFor = (name: string): string | undefined => {
  const override = MODULE_OVERRIDES[name];
  if (override) {
    const path = resolve(SRC, override);
    return existsSync(path) ? path : undefined;
  }
  for (const root of COMPONENT_ROOTS) {
    const hit = walk(resolve(SRC, root)).find((p) => p.endsWith(`/${name}.tsx`));
    if (hit) return hit;
  }
  return undefined;
};

/**
 * THE SECOND COUPLING ROUTE, and the one a name-matching guard would false-red.
 *
 * `Text` and `Icon` are correct today and spell no `Of<'color'>`: they import `TEXT_COLORS` and
 * friends, and those arrays ARE the contract's arrays — `contract.Icon.axes.color` and
 * `contract.Text.axes.color` are one array referenced twice. Naming the alias that vocabulary
 * publishes IS reading the axis out of the contract.
 *
 * Selected by ARRAY IDENTITY, never by axis name: matching on the name would let `Button.color`
 * satisfy a check meant for `Text.color`; identity cannot, because the arrays differ. It also
 * sidesteps `Text`'s per-role weight narrowing — this asserts the SOURCE ARRAY is the contract's
 * and never enumerates a value, so `WeightFor<R>` never comes into it.
 *
 * The alias still has to be matched against SOURCE TEXT: neither component exports an array to
 * compare, the coupling is type-level (`IconColor = TextColor`) and erases at runtime, and this
 * file is excluded from `tsconfig.json` so no typecheck sees it either.
 */
const SHARED_VOCABULARY: readonly { values: readonly string[]; alias: RegExp }[] = [
  { values: TEXT_ROLES, alias: /\bTextRole\b/ },
  { values: TEXT_WEIGHTS, alias: /\bTextWeight\b|\bWeightFor</ },
  { values: TEXT_COLORS, alias: /\bTextColor\b/ },
];

const readsAxis = (source: string, axis: string, values: readonly string[]): boolean => {
  if (new RegExp(`Of<'${axis}'>|Axes\\['${axis}'\\]`).test(source)) return true;
  const shared = SHARED_VOCABULARY.find((v) => v.values === values);
  return shared ? shared.alias.test(source) : false;
};

/**
 * Entries excused from (a), with the argument for each.
 *
 * ONE ROW, asserted — a growing allowlist is how this guard rots into a list of things somebody
 * once decided not to fix. The empty-reason rule is `unfamilied-coverage.test.ts`'s, copied for
 * its reason: a row must not be emptied into silence to make this pass.
 */
const AXIS_ALLOWLIST: Array<[name: string, axes: readonly string[], reason: string]> = [
  [
    'Toaster',
    ['position'],
    "position is `React.ComponentProps<typeof SonnerToaster>['position']` — sonner's own vocabulary, not ours. Coupling it would mean re-declaring a third-party union here and hoping it stays in step; a drifted copy of someone else's type is worse than a recorded gap.",
  ],
];

/**
 * Exported literal unions that are NOT variant vocabularies, and have no contract axis to move to.
 *
 * SEPARATE FROM `AXIS_ALLOWLIST` AND DELIBERATELY NOT PINNED TO A COUNT. A placement prop, a CSS
 * keyword set or an upload lifecycle is a prop that was never a variant, and a new one is
 * legitimate — pinning this list would make every one of them a plan edit. The empty-reason rule
 * still applies, and each row is asserted to still MATCH something, so a row cannot outlive the
 * declaration it excuses.
 */
const NON_VARIANT_UNIONS: Array<[file: string, type: string, reason: string]> = [
  ['primitives/Button/Button.tsx', 'htmlType', 'the DOM `type` attribute, moved aside because Figma\'s axes claim the name — HTML owns this vocabulary'],
  ['primitives/ChatComposer/ChatAttachment.tsx', 'ChatAttachmentStatus', 'an upload lifecycle (idle → compressing → uploading → done/error), which is progress rather than a visual variant'],
  ['primitives/ChatComposer/ChatComposer.tsx', 'ChatComposerTone', 'coupled: derived from the contract axis, and the class table is pinned to it'],
  ['primitives/Icon/Icon.tsx', 'IconSize', 'coupled: derived from the contract axis, and `SIZES` is pinned to it'],
  ['primitives/Icon/registry.ts', 'IconName', '`Icon.pendingAxes` names `name` as enumerated by the registry rather than the contract — the contract would need editing on every glyph added'],
  ['primitives/List/List.tsx', 'as', 'the HTML element the list renders (div, ul or ol) — structural, not a design variant, like `direction`'],
  ['primitives/Image/Image.tsx', 'placeholder', 'a prop forwarded untouched to the render slot, whose vocabulary is owned by next/image rather than by the contract'],
  ['primitives/Image/Image.tsx', 'loading', 'a prop forwarded untouched to the render slot, whose vocabulary is owned by the HTML img element rather than by the contract'],
  ['primitives/Image/Image.tsx', 'decoding', 'a prop forwarded untouched to the render slot, whose vocabulary is owned by the HTML img element rather than by the contract'],
  ['primitives/List/List.tsx', 'ListGap', 'the spacing-scale rungs a list may pick, SELECTED out of the direction\'s own gap; `direction` is the layout choice and this is neither of the contract\'s axes'],
  ['primitives/List/List.tsx', 'ListMarker', 'which native marker a block list draws (disc or decimal), a CSS list-style choice rather than a design variant'],
  ['primitives/Image/Image.tsx', 'ImageRounded', 'the radius rungs of the radius token scale, SELECTED out of the type\'s own radius; the contract\'s `Image` axes are `type` and `size` and this is neither'],
  ['primitives/Image/Image.tsx', 'ImageFit', 'CSS `object-fit` keywords; the contract\'s `Image` axes are `type` and `size` and this is neither'],
  ['compositions/Card/Card.tsx', 'CardRounded', 'the radius rungs a Card selects out of its default radius, each an existing radius token; the contract\'s `Card` axes are `variant`, `padding` and `appearance` and this is none of them'],
  ['primitives/List/List.tsx', 'ListDirection', 'the contract entry says it outright: "`direction` is a layout choice rather than a design variant and is deliberately not contracted as an axis"'],
  ['primitives/Menu/Menu.tsx', 'MenuSide', 'Radix placement — where the panel opens relative to its anchor, not what it looks like'],
  ['primitives/Menu/Menu.tsx', 'MenuAlign', 'Radix placement — which edge of the panel lines up with the anchor; `contract.Menu.axes` is `variant` only'],
  ['primitives/Tooltip/Tooltip.tsx', 'TooltipSide', 'Radix placement; `contract.Tooltip.axes` is `color` and `size` only'],
  ['primitives/Tooltip/Tooltip.tsx', 'TooltipAlign', 'Radix placement — which edge of the bubble lines up with the anchor, not what the bubble looks like'],
  ['primitives/overlay-classes.ts', 'MenuVariant', 'coupled: derived from the contract axis rather than hardcoded'],
  ['primitives/header-classes.ts', 'HeaderType', 'coupled: derived from the contract axis, and `HEADER_TYPES` IS the contract\'s array'],
  ['tokens/foundation-pages.ts', 'FOUNDATION_PAGES', 'the Storybook Foundation pages a reader can browse — a navigation list, not a prop any component accepts'],
  ['tokens/typography-specimens.ts', 'TYPOGRAPHY_PLATFORMS', 'which platform a type specimen is rendered for; a documentation axis of the token pages, with no component and no contract entry'],
  ['utils/focus-ring-classes.ts', 'FocusRingRole', 'which focus ring a control takes — a utility vocabulary with no component and no contract entry'],
  ['utils/responsive.ts', 'Breakpoint', 'the Tailwind breakpoint names; a layout vocabulary, not a variant'],
];

/**
 * Every object literal that sits directly inside a `cva(..., { variants: { … } })` block, with
 * whatever follows its closing brace — which is where a `satisfies Record<…>` would be.
 *
 * `cva` IS NOT THE IDIOM BEING BANNED, and banning it outright was an earlier draft's mistake:
 * `Button.tsx` is this package's model of a correctly coupled component and every one of its
 * variant tables is a `cva` table closed with `satisfies Record<Of<'…'>, string>`. What lets a
 * vocabulary live locally is an UNPINNED table.
 */
/**
 * Is what follows a variant table a pin that names the CONTRACT'S key type?
 *
 * `satisfies Record<` alone is not a pin, and matching only that prefix was the hole: review proved
 * `satisfies Record<string, string>` silences the ban while leaving the vocabulary entirely local —
 * and a bare `Record<string, …>` is exactly what someone reaches for first to make a red go away.
 * The key type has to come from the contract: `Of<'x'>`, `Axes['x']`, `contract.X.axes.y`, or an
 * alias derived from one of those (`TextWeight`, `IconSize`, `TextColor`), which is how `Text.tsx`
 * and `Icon.tsx` legitimately spell it.
 */
const CONTRACT_KEY = /^\s*satisfies\s+Record<\s*([^,]+),/;

const isContractPinned = (after: string): boolean => {
  const key = CONTRACT_KEY.exec(after)?.[1];
  if (!key) return false;
  if (/\bOf<'[^']+'>|\bAxes\[|\bcontract\./.test(key)) return true;
  /* An alias, accepted only when it is one this package derives from the contract. A bare
     `string`/`PropertyKey` is not a vocabulary and must never satisfy the pin. */
  return CONTRACT_DERIVED_ALIASES.some((alias) => new RegExp(`\\b${alias}\\b`).test(key));
};

/**
 * Type aliases this package derives from a contract axis, so `satisfies Record<Alias, …>` is a real
 * pin. Each is asserted below to still be contract-derived — an alias that stops being derived stops
 * being evidence, the same reasoning `native-parity.test.ts` applies to its shared-vocabulary names.
 */
const CONTRACT_DERIVED_ALIASES = ['TextRole', 'TextWeight', 'TextColor', 'IconSize'] as const;

const unpinnedVariantTables = (source: string): string[] => {
  const unpinned: string[] = [];
  /* EVERY block, not the first. A file may hold more than one `cva` call, and an `indexOf` that
     stops at the first let the rest declare whatever they liked. */
  for (let at = source.indexOf('variants: {'); at !== -1; at = source.indexOf('variants: {', at + 1)) {
    let depth = 0;
    let cursor = source.indexOf('{', at);
    const open = cursor;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}' && (depth -= 1) === 0) break;
    }
    const block = source.slice(open + 1, cursor);
    const key = /(\w+)\s*:\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = key.exec(block))) {
      let inner = 0;
      let i = match.index + match[0].length - 1;
      for (; i < block.length; i += 1) {
        if (block[i] === '{') inner += 1;
        else if (block[i] === '}' && (inner -= 1) === 0) break;
      }
      if (!isContractPinned(block.slice(i + 1))) unpinned.push(match[1]);
      key.lastIndex = i;
    }
    at = cursor;
  }
  return unpinned;
};

/* `''` is the package root's LOOSE files only — descending from there would re-scan every root
   plus `contract/` and `native/`, which are excluded on purpose. */
const filesUnder = (root: string): string[] =>
  root === ''
    ? readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(SRC, e.name))
    : walk(resolve(SRC, root));

const scanned = SCAN_ROOTS.map((root) => ({
  root,
  files: filesUnder(root)
    .filter(isSource)
    .map((path) => ({ path, rel: relative(SRC, path), source: stripComments(readFileSync(path, 'utf8')) })),
}));

describe('a variant vocabulary cannot be declared outside the contract', () => {
  /**
   * THE ANTI-VACUITY FLOOR, per ROOT. Four roots passing a combined total while one is dark is a
   * recorded failure in this repo (UMK-956), and a truncated walk leaves a PARTIAL result rather
   * than nothing at all (UMK-958) — so each floor is sized near what its root actually holds,
   * not at `> 0`.
   */
  it.each([
    ['primitives', 60],
    ['compositions', 4],
    ['layouts', 2],
    ['patterns', 1],
    ['utils', 8],
    ['shared', 1],
    ['hooks', 2],
  ])('scans %s and finds at least %i source files', (root, floor) => {
    expect(scanned.find((r) => r.root === root)?.files.length ?? 0).toBeGreaterThanOrEqual(floor);
  });

  it('reads 67 contract entries — an empty contract would pass every loop below', () => {
    expect(entries).toHaveLength(67);
  });

  /**
   * THE SCAN ROOTS REACH EVERY SOURCE FILE, and this is the assertion the per-root floors cannot
   * make. A floor counts what a listed root HOLDS; it is silent about a root nobody listed, so a
   * whole directory can sit outside the ban with every floor still green — which is exactly how
   * `tokens/` went unscanned while being exported from the package root. Enumerating the two
   * exclusions makes adding a directory a decision rather than an omission.
   */
  it('reaches every source file under src, outside the two it names', () => {
    const reached = new Set(scanned.flatMap(({ files }) => files.map(({ rel }) => rel)));
    const unreached = walk(SRC)
      .filter(isSource)
      .map((path) => relative(SRC, path))
      .filter((rel) => !reached.has(rel))
      .filter((rel) => !UNSCANNED.some((dir) => rel.startsWith(`${dir}/`)));
    expect(unreached, 'these files are outside every scan root, so the ban does not apply to them').toEqual([]);
  });

  /**
   * The pin's aliases are only evidence while they are DERIVED from the contract.
   *
   * `satisfies Record<TextWeight, string>` counts as a pin because `TextWeight` is the contract's
   * vocabulary wearing a shorter name. Re-declare it locally and the pin silently starts certifying
   * a local table — the same reasoning `native-parity.test.ts` applies to the aliases it trusts.
   */
  it.each([...CONTRACT_DERIVED_ALIASES])('derives %s from the contract, which is what makes it a pin', (alias) => {
    const declaration = scanned
      .flatMap(({ files }) => files)
      .map(({ source }) => new RegExp(`export type ${alias}\\s*=\\s*([^;\n]+)`).exec(source)?.[1])
      .find((rhs): rhs is string => Boolean(rhs));
    expect(declaration, `${alias} is not declared anywhere the scan reaches`).toBeDefined();
    expect(
      /\bOf<'[^']+'>|\bAxes\[|\bcontract\.|typeof TEXT_|typeof ICON_/.test(declaration!),
      `${alias} is no longer derived from the contract, so it cannot certify a variant table`,
    ).toBe(true);
  });

  it('names a live contract entry in every module override', () => {
    /* A key left behind by a renamed entry resolves nothing and is asked nothing — the map just
       carries a name no loop reads, forever, with no assertion looking at it. */
    expect(Object.keys(MODULE_OVERRIDES).filter((name) => !(name in contract))).toEqual([]);
  });

  /**
   * ONE MODULE TYPES THREE ENTRIES' `state`, so the three have to agree.
   *
   * `composer-button.tsx` derives `Of<'state'>` from `contract.ChatToolsButton.axes` alone. Widening
   * `ChatVoiceButton.state` would give that button a value its own component cannot accept, and the
   * coverage assertion would not notice — it only asks whether the module reads SOME axis by that name.
   */
  it('keeps the three composer buttons on one `state` vocabulary, since one module types them all', () => {
    for (const name of ['ChatToolsButton', 'ChatAttachmentButton', 'ChatVoiceButton'] as const) {
      expect(
        [...contract[name].axes.state],
        `${name} disagrees with the axis composer-button.tsx types itself from`,
      ).toEqual([...contract.ChatToolsButton.axes.state]);
    }
  });

  /* ---- (a) every declared axis is read by its component ---- */

  for (const [name, entry] of entries) {
    const allowed = AXIS_ALLOWLIST.find(([n]) => n === name)?.[1] ?? [];

    /* PER ENTRY, not a total. An aggregate stays green while one entry is silently skipped. */
    it(`${name} resolves to a real, non-trivial module`, () => {
      const path = moduleFor(name);
      expect(path, `${name}: nothing resolves — a missing file must not read as a passing entry`).toBeDefined();
      expect(readFileSync(path!, 'utf8').length, `${name}: module is empty`).toBeGreaterThan(200);
    });

    it(`${name} reads every axis it declares out of the contract`, () => {
      const source = stripComments(readFileSync(moduleFor(name)!, 'utf8'));
      /* `pendingAxes` and `booleans` are exempt in both directions: a pending axis has no values
         to read, and a boolean is deliberately not an axis. */
      const missing = Object.entries(entry.axes)
        .filter(([axis]) => !allowed.includes(axis))
        .filter(([axis, values]) => !readsAxis(source, axis, values))
        .map(([axis]) => axis);
      expect(missing, `${name} declares ${missing.join(', ')} and its module reads neither Of<'…'> nor a shared vocabulary`).toEqual([]);
    });
  }

  /* ---- the allowlists argue for themselves ---- */

  for (const [name, axes, reason] of AXIS_ALLOWLIST) {
    it(`${name} argues its way onto the axis allowlist, and is still uncouplable`, () => {
      expect(reason.length, `${name}: a row without a reason is a row emptied into silence`).toBeGreaterThan(60);
      expect(axes.length, `${name}: allowlisted but names no axis`).toBeGreaterThan(0);
      const source = stripComments(readFileSync(moduleFor(name)!, 'utf8'));
      const couplable = axes.filter((axis) => readsAxis(source, axis, contract[name as keyof typeof contract].axes[axis]));
      expect(couplable, `${name}: ${couplable.join(', ')} now couples — delete the row rather than keeping an excuse that expired`).toEqual([]);
    });
  }

  it('keeps the axis allowlist at exactly one row', () => {
    /* THE THING STANDING BETWEEN THIS GUARD AND ALLOWLIST ROT. A second row is the path of least
       resistance for the next component that wants a local vocabulary, so it costs a plan edit. */
    expect(AXIS_ALLOWLIST.map(([name]) => name)).toEqual(['Toaster']);
  });

  for (const [file, type, reason] of NON_VARIANT_UNIONS) {
    it(`${file} still declares ${type}, which its allowlist row excuses`, () => {
      expect(reason.length, `${file}/${type}: a row without a reason is a row emptied into silence`).toBeGreaterThan(40);
      const source = stripComments(readFileSync(resolve(SRC, file), 'utf8'));
      expect(
        new RegExp(`\\b${type}\\b`).test(source),
        `${file}: ${type} is gone — remove the row rather than leaving it to excuse nothing`,
      ).toBe(true);
    });
  }

  /* ---- (b) no vocabulary is declarable outside the contract ---- */

  const excused = new Set(NON_VARIANT_UNIONS.map(([file, type]) => `${file}::${type}`));

  it('declares no variant vocabulary through an unpinned cva variant table', () => {
    /* NO `cva(` PRE-FILTER. Requiring the call in the same file meant splitting the table into a
       module of its own — an ordinary refactor, no new spelling — left neither file checked: the
       table file has no `cva(`, the component file has no `variants: {`. The table is the thing
       being banned, so it is banned wherever it lives. */
    const offenders = scanned.flatMap(({ files }) =>
      files.flatMap(({ rel, source }) => unpinnedVariantTables(source).map((axis) => `${rel}: variants.${axis}`)),
    );
    expect(offenders, 'a variant table must be closed with `satisfies Record<Of<…>, …>` — see Button.tsx').toEqual([]);
  });

  /**
   * IS THIS NAME REACHABLE BY A CALLER? — asked once, because `export` on the declaration line is
   * only one of the ways a name leaves a module.
   *
   * Keying on the keyword where a type is DECLARED let the same vocabulary through by declaring it
   * bare and re-exporting it a line later (`type X = …` then `export type { X }`) — a formatting
   * choice, not a different design. The distinction that matters is unchanged (a caller can only
   * pass what is exported), so this collects every exported name and the detectors below ask
   * membership instead of matching a keyword.
   *
   * `composer-button.tsx`'s `ComposerButtonKind` is still correct and still green: it is declared
   * bare AND never re-exported, which its own comment says outright — "Not an exported axis."
   */
  /**
   * The declaration a literal-union PROPERTY sits inside, and whether that declaration is exported.
   *
   * The property detector was INERT and could never produce an offender: it captures the property
   * name (`emphasis`), and the exported-name filter only ever holds DECLARATION names — so every
   * match was discarded, including the commonest spelling of the thing this bans. Review proved it
   * with `export interface DensityProps { emphasis?: "loud" | "quiet" }`, which passed 118/118.
   *
   * A property is reachable by a caller exactly when its enclosing `interface`/`type` is, so this
   * walks back to the nearest preceding declaration and reports THAT name for the export check.
   */
  const enclosingDeclaration = (source: string, at: number): string | null => {
    const before = source.slice(0, at);
    const decls = [...before.matchAll(/\b(?:interface|type)\s+(\w+)/g)];
    return decls.length ? decls[decls.length - 1][1] : null;
  };

  const exportedNames = (source: string): Set<string> => {
    const names = new Set<string>();
    for (const [, name] of source.matchAll(/export\s+(?:declare\s+)?(?:type|interface|const|enum)\s+(\w+)/g)) names.add(name);
    /* `export { A, type B }` and `export type { A, B }`, including the `from '…'` re-export form. */
    for (const [, list] of source.matchAll(/export\s+(?:type\s*)?\{([^}]*)\}/g)) {
      for (const part of list.split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
        if (name) names.add(name);
      }
    }
    return names;
  };

  /** ONE literal fragment, so a spelling cannot be closed in one detector and left open in another. */
  const LIT = `['"\`][^'"\`]*['"\`]`;

  it('declares no variant vocabulary through `keyof typeof` on an exported type', () => {
    const offenders = scanned.flatMap(({ files }) =>
      files.flatMap(({ rel, source }) => {
        const exported = exportedNames(source);
        return [...source.matchAll(/\btype\s+(\w+)\s*=\s*keyof\s+typeof\s+\w+/g)]
          .filter(([, type]) => exported.has(type))
          .map(([, type]) => `${rel}::${type}`)
          .filter((key) => !excused.has(key));
      }),
    );
    expect(offenders, 'an exported `keyof typeof` names a vocabulary the contract does not know').toEqual([]);
  });

  /**
   * THE LITERAL-VOCABULARY BAN, ACROSS EVERY SPELLING OF ONE IDEA.
   *
   * The first cut matched single-line, single-quoted unions only, and review proved six evasions —
   * five of them here. That is this guard's own failure mode wearing its clothes: a ban naming three
   * spellings of a thing reads exactly like a ban on the thing. So these tolerate a leading pipe,
   * newlines between members, and double or backtick quotes, and they cover the `as const` ARRAY as
   * well as the union — `export const X = ['a','b'] as const` with `(typeof X)[number]` exported is
   * the idiom `header-classes.ts` itself carried until this ticket, and the first cut sailed past it.
   */
  it('declares no variant vocabulary through a bare literal union', () => {
    const alias = new RegExp(`\\btype\\s+(\\w+)\\s*=\\s*\\|?\\s*${LIT}(?:\\s*\\|\\s*${LIT})+`, 'g');
    /* Anchored on a MEMBER BOUNDARY, not a line start: `{`, `;`, `,` or a new line all begin a
       member, and requiring a line start missed every single-line interface — which is how the
       commonest spelling of this ban stayed open even after the export check was fixed. */
    /* Anchored on a MEMBER BOUNDARY, not a line start: `{`, `;`, `,` and a newline all begin a
       member, and requiring a line start missed every single-line interface — which is how the
       commonest spelling of this ban stayed open even after the export check was fixed. */
    const prop = new RegExp(`(?:^|[{;,])[ \t]*(?:readonly\\s+)?([A-Za-z_$][\\w$]*)\\??:\\s*\\|?\\s*${LIT}(?:\\s*\\|\\s*${LIT})+`, 'gm');
    /* The `as const` array is a vocabulary in every sense that matters: the values are closed, the
       type is derived from them, and a caller passes one of them. */
    const asConst = new RegExp(`\\bconst\\s+(\\w+)\\s*=\\s*\\[\\s*${LIT}(?:\\s*,\\s*${LIT})*\\s*,?\\s*\\]\\s*as\\s+const`, 'g');
    const offenders = scanned.flatMap(({ files }) =>
      files.flatMap(({ rel, source }) => {
        const exported = exportedNames(source);
        const named = [...source.matchAll(alias), ...source.matchAll(asConst)].map((m) => [m[1], m[1]] as const);
        /* A property reports its enclosing declaration's name for the export check, and its own for
           the offender label — `Button.tsx::htmlType` stays the excusable key. */
        const props = [...source.matchAll(prop)].map(
          (m) => [enclosingDeclaration(source, m.index ?? 0), m[1]] as const,
        );
        return [...named, ...props]
          .filter(([owner]) => owner !== null && exported.has(owner))
          .map(([, label]) => `${rel}::${label}`)
          .filter((key) => !excused.has(key));
      }),
    );
    expect(offenders, 'a literal vocabulary on an exported name has nowhere to be mirrored from').toEqual([]);
  });
});
