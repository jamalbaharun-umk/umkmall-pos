# Shell

The chrome around a screen: the frame, the bar across the top and the navigation column beside
the content. Open this section when you are asking *what holds the page*, not what goes in it.

Everything here is slots. `AppShell` reaches for React and this package's own class table and
nothing else — no store, no router, no feature gate — because a library frame that imported a
router would be unusable by the second app that wanted a frame. That is asserted by
`layouts.stories.test.tsx`, not merely intended.

## Use this, not that

**Let `AppShell` own the scroll flag; do not wire your own listener.** A header that gains a
shadow once the content has moved has to know about a scroll in a node it did not render, and
scroll events do not bubble — so the frame listens in the capture phase. It also skips targets
that are not vertical scrollers (a horizontal card rail always reports offset zero) and targets
outside the content region, because `Sidebar` gives its list its own scroller and scrolling the
navigation would otherwise answer "not scrolled" for a page that is still scrolled. Two
surfaces in this repo arrived at that independently, which is why it moved here.

**Do not pass a viewport size to `Header` or `Sidebar`.** Neither takes one. `Header`'s
published `Size: Mobile | Desktop` pair became one component that reflows at the package
breakpoint, because the two sizes differ in three measurements and a bar told it is the small
one on a wide screen is a bug nothing can catch. `Sidebar`'s published `Size` became a
`collapsed` boolean for the same family of reason: a two-value axis whose values mean yes and
no is a boolean wearing an enum.

## Members

- **AppShell** — the frame: four slots, a full-height column that does not itself scroll, and
  a pinned overflow chain so the caller's scroller is the thing that scrolls.
- **Header** — the top bar, mirroring all seven published `type` values, with `showBack`,
  `showTab`, `showTextLeft` and `scrolled`.
- **Sidebar** — the navigation column and its row, `SidebarMenuItem`, shipped from one module
  and contracted together.

## Worth knowing

`Sidebar` is the one contract entry covering two exports, and it says so rather than leaving it
to read as a name/prop mismatch: `state`, `active`, `expanded` and `nested` belong to the row,
`collapsed` and `open` to the shell. Its `state` values are spelled `menu | submenu` against
Figma's `Satate`, corrected deliberately so nobody restores the typo on their next read of the
design file. Sign-out is not a prop at all — the footer slot takes the caller's own control.

`Header` mirrors an axis it disagrees with, on purpose. Those seven values conflate three
independent facts — signed in or not, which product surface the bar frames, and what kind of
page it is — so "signed in, on a detail page" cannot be said. It is carried whole anyway,
because a library that half-adopts a published axis diverges from the file it mirrors, and the
conflation is recorded so design can split it and the library can follow. Exactly one value,
`temanAiChat`, has a real consumer today.

None of these three declares a `family`, so each is covered by its own guard pair rather than
by a family guard. That is not optional: a family guard reconciles only against entries that
claim its family, so an unfamilied component is invisible to all four.
