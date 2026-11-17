/**
 * Layout Components
 *
 * The frames a page is built in, as opposed to the things inside them.
 *
 * @example
 * ```typescript
 * import { AppShell } from '@umkmall/ui'
 * // or, equivalently
 * import { AppShell } from '@umkmall/ui/layouts'
 * ```
 *
 * THIS IS NOT A REVERSAL of UMK-961's decision to leave this directory empty, and it is worth
 * a sentence because it reads like one. 961 declined `Row`, `Column` and `Stack` on the
 * grounds that their real job in this repo is A2UI's `weight` protocol, and a library
 * equivalent would drag an A2UI concept into the design system. An app-shell frame is not an
 * A2UI concept — it has no weight, no protocol and no renderer on the other side of it — so
 * that reasoning simply does not reach it. The A2UI layout primitives are still declined.
 *
 * THE EXPORT PATH IS BOTH, deliberately. `src/index.ts` re-exports this directory as well as
 * the subpath, which is a line that had to be added by hand — it re-exported contract,
 * primitives, compositions, tokens and utils and nothing else, because this directory had
 * nothing in it. `Sidebar` and `Header` are reachable from the package root through
 * `primitives`, and a shell that composes them but is reachable only through a subpath is the
 * kind of asymmetry a caller discovers as an error rather than as a decision. The subpath is
 * already published in `package.json`, so it stays working either way and no manifest changed.
 *
 * `patterns/` is still a stub, and this does not settle it: its docblock names Navigation,
 * Footer and Carousel, and UMK-963 sited `Header` and `Sidebar` under `primitives/` instead.
 * That placement call is stated in the PR rather than argued here.
 */

export { AppShell, type AppShellProps } from './AppShell';
