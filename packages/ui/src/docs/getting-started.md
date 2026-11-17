# The UMKMall design system

This is `@umkmall/ui` — the component library the web app, the admin dashboard and the React
Native app all render from. This Storybook is its reference: every component here is the real
one, imported from source, not a mock of it.

## Read this first

The library is built around **one contract**. `packages/ui/src/contract/variants.ts` declares
what axes every component has — which variants, which sizes, which states — and nothing else
in the repo is allowed to disagree with it. A component maps a contract entry to its own
classes; the contract itself holds no Tailwind and imports nothing, which is what lets the
native renderer consume the same file unchanged.

That has a practical consequence worth knowing before you write any code against this
library: **if a value is not in the contract, the component does not accept it.** A size that
looks like it should exist and does not is a deliberate absence, not an oversight — check the
component's entry before reaching for a class override at the call site.

## Install and run

The library is a workspace package; nothing to install separately.

```bash
npm install                       # once, from the repo root
npm run dev -w @umkmall/design    # this Storybook, on :3003
```

Two commands matter while you work in it:

```bash
npm run test -w @umkmall/ui       # the guards — see Contributing
npm run typecheck -w @umkmall/design
```

The second one is not optional and not redundant. `packages/ui`'s own tsconfig **excludes**
`*.stories.tsx`, and `storybook build` transpiles without typechecking — so a story with a
type error passes both the library's typecheck and the build, and only this command sees it.

## Import from the barrel

```tsx
import { Button, Text, Alert } from '@umkmall/ui';
```

React Native imports from a sibling entry point, which publishes the same names against the
same contract:

```tsx
import { Button, Text, Alert } from '@umkmall/ui/native';
```

The two are deliberately not identical. `Tooltip` and `DateTimeInput` have no native sibling
and are absent by design; `Menu` is a bottom sheet on native and a dropdown on web. Absence
is an answer there, the same way it is in the contract.

## How this Storybook is organised

**Foundations** holds the design tokens — colour, the type scale, layout and spacing — plus
the three components that are closer to tokens than to widgets: `Text`, `Icon` and `Button`.
Start here if you are looking for a value rather than a component.

**Components** holds everything else, in seven sections. Each one opens with a Guidelines
page saying what belongs in it and which component to reach for:

- **Form** — the controls a user types into or chooses from.
- **Content** — the pieces a page is built out of.
- **Navigation** — moving between views, and showing where you are.
- **Feedback** — telling the user what happened.
- **Overlays** — anything that renders above the page.
- **Shell** — the chrome around a screen.
- **Chat** — the composer and its parts, which are one surface rather than general widgets.

The section a component sits in answers *where do I look for this*, and is decided on that
basis alone — it is not the same thing as which guard pair covers it in the test suite. Two
components sit somewhere their test family would not have put them, and that disagreement is
deliberate.

**Guidelines**, **Patterns** and **Contributing** are the prose sections: how to choose
between components, how to compose them, and what changing one costs.

## Every page has a props table

Each component's **Docs** page is generated from its TypeScript, so the props table is the
real prop surface — including the parts that are hard to read in source. `Button`'s icon-only
form is a discriminated union that will not compile without an accessible name; `Image`
accepts `alt` or `decorative`, never both; the form family shares one labelling union where
passing both a visible label and an `aria-label` is a type error. Those show up as unions in
the table rather than as `any`, which is the whole reason the docs are wired to TypeScript.

**Show code** under any example prints the JSX. On a state-matrix story it prints a single
canonical usage instead of the grid scaffolding — the grid is how the page proves coverage,
not how you would write it.
