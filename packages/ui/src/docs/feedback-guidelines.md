# Feedback

Telling the user what happened, or that something is still happening. Open this section when
you are asking *how do I say this went wrong*, *how do I show this is loading*, or *where does
this bit of explanation go*.

## Use this, not that

**`Alert` is the element; `Toaster` is the host.** They are one component and one surface, not
two ways of saying the same thing. A raised toast renders `Alert` at `type='toast'`, so the
severity and size vocabulary lives on the `Alert` entry and `Toaster` does not restate it. The
contract also records why dismissal belongs to the host: an Alert rendered inline has nothing
to dismiss it from, and the toast host already owns the queue, the timer and the close control,
so a second one on the element would give two things the power to remove one toast.

**A `Skeleton` when you know the shape, a `Spinner` when you do not.** `Skeleton` is
deliberately `aria-hidden` and announces nothing — the surface owning the loading state does
the announcing — while `Spinner` carries `role="status"` and a spoken `label`, because the
movement is not a channel every reader has and under reduced motion there is no movement at
all. Passing an empty label is a real choice there, distinct from omitting one: a spinner
inside a button would otherwise concatenate its text into that button's accessible name.

**A `ProgressBar` when there is a value, not a `Spinner`.** `ProgressBar` shares its value,
maximum, clamping and announced semantics across both its shapes; only the drawing differs
between the bar and the gauge.

## Members

- **Alert** — the severity box, inline or as a toast, with a `treatment` axis controlling how
  much of the box the severity paints.
- **Toaster** — the toast host. `position` is its only real axis; the queue cap and the
  auto-dismiss delay are numbers.
- **Tooltip** — a tip on a trigger, dark or white. It has no arrow prop: the arrow follows the
  resolved placement after collision flipping.
- **Skeleton** — one shape primitive and one shimmer, in `text`, `circle` or `rect`.
- **Spinner** — the indeterminate loading indicator, with a spoken label.
- **ProgressBar** — determinate progress, `linear` or `radial`.

## Worth knowing

**The success toast is the filled check; the inline success Alert is the outline.** Figma draws
the toast's tick knocked out of a white disc so the green reads through it, and the inline box
with lucide's outline on a tint — two drawings for two jobs, and neither name may be repointed at
the other. The fork lives in `Alert` itself, on both platforms, so `ALERT_VARIANT_ICON` still
answers only for the inline box; a "consolidation" that moves `success` in that table moves the
inline Alert too, and nothing but the pinning test would notice.

**A raised toast is Medium at every width on the web** (14/20 text, 24px glyph, 12px side padding,
copy at weight 500 as Figma draws it); the close glyph beside it is 20px. Pass `size` to pick
Large or Small. Native still follows `useWindowDimensions` — Medium from 768 up, Small below — so
the two platforms now differ on a phone, by decision (UMK-957). The inline `Alert` keeps its own default.

`Tooltip`'s `showClose` defaults off even though Figma defaults it on: a tip that closes on
pointer-leave has nothing for a close button to do. And its `children` is typed
`ReactElement` rather than `ReactNode` on purpose — Radix's `asChild` calls `Children.only`,
so the narrower type is the only compile-time signal there is.

`Spinner` and `ProgressBar` disagree on how their size steps are spelled — abbreviated on one,
spelled out on the other. That is recorded rather than repaired: changing a shipped vocabulary
belongs to the slice that owns reconciling both.
