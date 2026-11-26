# @umkmall/ui

> [← Back to the project README](../../README.md). This is a **vendored copy** used by UMKMall POS; read
> [POS-COPY.md](POS-COPY.md) first and do not edit components here. Links below that point into the UMKMall monorepo do
> not resolve in this repository.

The UMKMall design system (Ensyra — DS in Figma): primitives, compositions, layouts, tokens, and the
variant contract they all build against. **In `apps/main-website` this library is the default.** A raw
`<button>`, `<input>`, `<svg>`, hex colour or stock palette class is the exception and needs a
`ds-raw-ok: <reason>` marker; the `umkmall-ds` lint rule enforces it at error level.
Rules and exemptions: [docs/guidelines/frontend-ui.md](../../docs/guidelines/frontend-ui.md).

## What to reach for

Everything is public from the root, `src/index.ts`:

| Need | Use | Lives in |
|---|---|---|
| Text, headings | `Text` (`variant`, `as`, `color`) | `primitives/Text` |
| Icons | `Icon name="…"` (a registry, not inline SVG) | `primitives/Icon` |
| Buttons, form controls | `Button`, `TextField`, `Select`, `CheckBox`, `Radio`, `Switch`, `Slider`, `Upload`… | `primitives/` |
| Overlays, feedback | `Dialog`, `Menu`, `Popover`, `Tooltip`, `Toaster`, `Alert`, `Spinner`… | `primitives/` |
| Chat | `ChatComposer`, `ChatMessage`, `Lightbox`, `Sidebar`, `Header` | `primitives/` |
| Cards, tabs | `Card`, `Tabs` | `compositions/` |
| Page frames | `AppShell` | `layouts/` |
| Colours, spacing, type | the token tree and Tailwind classes such as `bg-default-brand` | `tokens/`, `tailwind.preset.js` |
| Class merging | `cn` | `utils/` |

```tsx
import { Button, Icon, Text } from '@umkmall/ui'

<Text variant="h3" as="h2">Judul</Text>
<Button type="primary" color="primary" size="medium"><Icon name="x" className="h-4 w-4" />Tutup</Button>
```

Subpath exports (`./contract`, `./docs`, `./primitives`, `./compositions`, `./patterns`, `./layouts`, `./tokens`,
`./utils`, `./native`, `./tokens.css`, `./theme.v4.css`, `./tailwind-preset`) are listed in `package.json`. `./native` is the
React Native sibling set, against the same contract.

## The contract

`src/contract/variants.ts` declares which axes each component has (variants, sizes, states): vocabulary
only, no classes. Where the repo deliberately departs from Figma, the entry carries a `divergences`
record saying so and why. That record is the place to look before "fixing" a component back to the
design file.

## How main-website consumes it

- `apps/main-website` depends on `@umkmall/ui` and transpiles it (`transpilePackages` in
  `next.config.ts`).
- Its `tailwind.config.ts` uses the `@umkmall/ui/tailwind-preset` preset and lists the package source
  in `content`, so the library's classes survive Tailwind's purge.
- Stories live beside each component here and render in the `apps/design` Storybook.

## Working in this package

Traps a green suite will not catch are in [CLAUDE.md](./CLAUDE.md). Lint rules, the exemption marker and
what the rules cannot see are in [docs/guidelines/frontend-ui.md](../../docs/guidelines/frontend-ui.md).
