# CLAUDE.md — `@umkmall/ui`

> The design system package: the variant contract, the web primitives, the React Native
> siblings, and the Storybook stories that document all three. This file carries the traps —
> the things a green suite will not catch. Orientation and prose live in the Storybook itself
> (`Getting Started`, `Guidelines`, `Patterns`, `Contributing`, served by `apps/design`).
> Last updated: 2026-09-09 (UMK-979).

## Where things are

- `src/contract/variants.ts` — the vocabulary. What axes every component has, and nothing else.
- `src/primitives/`, `src/compositions/`, `src/layouts/` — the web components, each with its
  story beside it.
- `src/native/` — the React Native siblings, against the same contract.
- `src/tokens/` — the generated token tree and the Foundation pages that browse it.
- `src/examples/` — whole-surface pages assembled out of the library, documenting no single
  component. `Examples/TemanAI chat` is the product's chat room built from twenty of them, and
  it is where a composition that broke between components shows up. A file here has no contract
  entry, so it must be named in `story-taxonomy.test.ts`'s `NOT_A_COMPONENT` **and** given its
  own title assertion there — the derived-title check skips it, which would otherwise leave the
  title asserted by nothing.
- `apps/design` — the Storybook that renders all of it. The stories live HERE, in this
  package, and that app's glob reaches out of its own workspace to find them. A new top-level
  section also needs an entry in that app's `preview.ts` `storySort.order`, or it sorts wherever
  Storybook puts it.

## ⚠️ Traps

### The title lockstep is thirteen files, and nothing links them at compile time

A story's `title` is a hand-written string literal. Thirteen guard files assert it. Nothing
connects the two except the guard running, so a partial retitle is red for reasons unrelated
to the change under review — **move them in one commit**.

The literal **cannot** be computed. Storybook's CSF indexer extracts `title` by static
analysis **without executing the module**, so a computed title is never read: the story falls
back to path-derived autotitling and lands in a section nobody chose, with no error anywhere.
So the derivation lives in the guard — `storyTitle(name)` in `src/contract/variants.ts`
computes `Components/<Category>/<Name>` from the contract — and the literal is what gets
checked. The literal is the thing that can be wrong; a guard reading both from the same place
would be measuring itself.

The thirteen: `content`, `form-controls`, `feedback`, `overlays`, `composer`, `message`,
`header`, `sidebar`, `lightbox`, `layouts` (`.stories.test.tsx`), plus `Icon/Icon.stories.test.ts`
(which asserts **two** titles, Icon and Text), `Button/Button.stories.test.ts`, and
`tokens/Foundation.test.ts`. `contract/story-taxonomy.test.ts` covers the whole set at once
and is the one to reach for first.

### A title sweep must not assume one quote style

`AppShell.stories.tsx` was the only file in the package writing its title in DOUBLE quotes,
and any sweep, codemod or audit keyed on `title: '` skipped it in silence and reported a clean
result. That cost a wrong conclusion during UMK-979's research before it was caught.

UMK-979 normalised every title to single quotes, so the specific instance is gone — but
nothing enforces the style, and the next file to arrive with double quotes will be invisible
to the same sweep. Match on either quote, or on the parsed literal, rather than on one.

### `category` is required and `family` is not, and they are not the same field

`family` answers *which guard pair covers this*; `undefined` is a real answer for eight
entries. `category` answers *where a person looks for it* and has no legitimate absent case,
so the type requires it — a component with no category appears nowhere in the sidebar, which
nothing else would catch.

**Never derive one from the other.** `Tabs` and `Stepper` are Navigation while their guard
pair is the content pair. That disagreement is the whole reason there are two fields.
Collapsing them would also reintroduce the hand-maintained member list UMK-961 deleted.

### `unfamilied-coverage.test.ts` rows name guard FILES, not counts

An entry with no `family` is invisible to all four family guards — so deleting its behaviour
file leaves the suite green and merely shorter. Each row in that allowlist names the files
that are the whole of a component's coverage, and one row says plainly that there is no
dedicated guard at all. A recorded gap is not a claim of coverage; a count cannot say which
one went missing, and the files can.

### The contract's platform-neutrality regex reddens on the bare word `window` in a NOTE

`variants.platform-neutral.test.ts` matches ambient platform types by name — `React.`, `JSX.`,
`HTML*Element`, `document`, `window` — and prose is not exempt. A `note` or `reason` string
that happens to use the word in an ordinary English sentence fails the guard. Reword it.

### `Image` silently refuses any non-`https://` source

It renders the placeholder and **no `<img>` element at all**, so no request is made. The check
is case-insensitive and anchored (`/^https:\/\//i`) — deliberately, because a case-sensitive
`startsWith` placeholders a valid `HTTPS://…` and an unanchored match lets
`http://evil/?x=https://` through. The consequence for a caller: a typo in the protocol, or a
relative path, gives a blank placeholder rather than a broken image.

Since UMK-960 two OPT-IN props widen the gate: `allowRelative` (a same-origin path, decided by
parsing — tab/LF/CR and backslashes are refused first, because the URL parser strips them and
`/<TAB>/evil.example` would otherwise fetch `//evil.example`) and `allowDataImage` (raster
`data:image/(jpeg|png|webp);base64,…` only, never SVG). Both default OFF because the a2ui adapter
forwards a model-authored url: a default that accepted a relative path is a same-origin GET with
the user's cookies. The adapter must never set either (`a2ui/components/Image.test.tsx` pins it).

### Stories are outside the inline-class guard while Tailwind still compiles them

`src/inline-classes.purge.test.ts` line 278 makes the exclusion a **hard assertion** —
`expect(scanned.some((f) => f.endsWith('.stories.tsx'))).toBe(false)` — and ten sibling purge tests
(`content`, `form-controls`, `feedback`, `overlays`, `composer`, `message`, `header`,
`sidebar`, `lightbox`, `layouts`) carry the same per-file exclusion. So a stale colour class written into any story ships
in the Storybook build with no guard able to see it.

`.mdx` pages in `apps/design/src/docs` are worse: they are reached by that app's Tailwind
content array and by nothing else, so a class there is compiled but unguarded. Prefer a live
component example over a hand-written class string on those pages.

This is an accepted gap, not an oversight (UMK-979 KTD6). Closing it means inverting eleven
deliberate assertions, which is its own piece of work.

### `cn(…, className)` cannot resolve two `ds-` spacing rungs, so a caller can stack both

The class merger recognises conflicts from a map of Tailwind's OWN utility names. `py-ds-sm` and
`py-ds-md` are not in it, so they are not a conflict: **both ship**, and the stylesheet's order
decides which wins. Inside this package the answer is to SELECT one rung rather than append an
override — `ChatMessageBubble` substitutes the ghost instead of appending a zeroing entry, and
`ChatMessageList` picks one of two gap tables — after a ghost bubble shipped inert for a run by
appending.

**The `className` prop reopens it from outside.** A caller passing `py-ds-md` to a component that
already selected `py-ds-sm` reproduces the original defect exactly: two rungs on the element, every
class name still correct, no guard able to see it (a guard would have to reason about the merged
output of an arbitrary caller string). To override a density rung, pass the component's own prop —
or pass an `!important` variant knowing what it is. This is the reason the two density tables are
split at all; do not merge them back.

### A class can resolve and still be the wrong colour

The per-utility palette split means `Text` and `Surface` publish many of the same sub-paths
and disagree on several, so `text-default-primary` and `bg-default-primary` are a well-formed
pair holding two different colours. Every gate in this repo proves a class **resolves**; none
proves the hex. Look at a colour change in a browser — there is no test that can do it for you.

### Two typechecks, and neither one is redundant

This package's `tsconfig.json` **excludes** `**/*.stories.tsx`, and `storybook build`
transpiles without typechecking. So a story with a type error passes both
`typecheck -w @umkmall/ui` and `build -w @umkmall/design`; only
`typecheck -w @umkmall/design` sees it. Run both.

### And a contract entry is also checked from `apps/design`, by its TEST

`apps/design/src/docs/contract-reference.generated.ts` is a CHECKED-IN generated file — the
component-and-axis reference the prototyping starter and the AI prompt page both embed
(UMK-1027). Adding, renaming or re-axising a contract entry makes it stale, and the only thing
that says so is `starter-published.test.ts` in **that** workspace. A full green `test -w
@umkmall/ui` proves nothing about it, because turbo hashes `test` per package.

Run `npm run proto:reference` from the repo root — not from the workspace, which has no such
script — and commit the result. Caught in CI on PR #1099, after the package's own 1262 tests and
all three typechecks were green.

### Prove a guard red, on an observed cache miss

`turbo.json`'s `test` task is cacheable, and a task hash covers a package's own files rather
than its workspace dependencies'. A guard sited in a dependent app can replay a cached PASS
over a live regression here. Any guard proof needs `--force` and an observed
`cache miss`/`cache bypass` line, and the injection should break exactly one thing — a
harsher break reds several assertions at once and the red gets credited to the wrong one.

### The native `Dialog` avoids the keyboard only under a host-mounted `KeyboardProvider`

`native/Dialog.tsx` makes `react-native-keyboard-controller`'s `KeyboardAvoidingView` the
modal's root (UMK-1001) — an optional peer, because this package carries no app-level provider.
The view reads the keyboard through React context, so a host that renders the sheet without a
`KeyboardProvider` above its navigator gets a sheet that mounts, renders and **never moves**,
with nothing thrown and this package's suite fully green. `apps/mobile` mounts it once in
`app/_layout.tsx` and pins it in `src/__tests__/keyboard-avoidance.test.ts`; a second native
host owes the same two lines. Keep `statusBarTranslucent` and `navigationBarTranslucent`
together on that `Modal`: with only the status half, RN runs the window non-edge-to-edge and
keyboard handling inside it is defeated.
