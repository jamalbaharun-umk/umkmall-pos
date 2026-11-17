# Overlays

Anything that renders above the page. Open this section when you are asking *where does this
go if it does not belong in the flow* — a modal decision, a list of actions, or an image opened
full-bleed.

## Use this, not that

**A `Dialog` for a modal surface, and a `Lightbox` for an image.** The contract is explicit
that `Lightbox` composes the Radix dialog directly rather than widening `Dialog`: `Dialog`'s
presentation is fixed by decision and its modality claim is hardcoded because it has no
non-modal form, so bending it to serve a full-bleed viewer would reverse both. The viewer also
renders its image with a plain element rather than through the library `Image`, whose
refusal to accept a non-remote-https source is correct there and would blank every base64
preview here.

**A `Menu` for actions, not for a value.** Its rows carry their own handlers and an optional
tick, but there is no `value`/`onValueChange` pair — the `Select` entry records that directly
as the reason Menu cannot substitute for it.

## Members

- **Dialog** — the modal: four width steps, a bottom sheet below the medium breakpoint and a
  centred card from there up, with `centered` forcing the card at every width.
- **Menu** — a popover list of rows, in a `pill` or a `boxed` treatment. Rows may nest a
  submenu or carry a destination, rendered through an app-supplied link component.
- **Lightbox** — the full-bleed image viewer. Its two affordances are callbacks rather than
  variants: supply one and its control appears.

## Worth knowing

`Menu` has no published Figma set at all, so its two treatments were read off two shipped
surfaces — `pill` from the chat composer's tools menu, `boxed` from the user-settings popover.
Neither is wrong with nothing published, which is why the settings popover was not restyled
onto the composer's look; the axis is where a designer reconciling the two later lands. The
Storybook render is what a designer works against.

`Dialog` had no published set either, so its four-step width ladder was read off the code it
replaces. `Lightbox` deliberately has no zoom, no pan, no gallery and no drag gesture: the
component it replaces has none, and drag-to-dismiss stays module-private inside `Dialog`.

Both `Menu` and `Lightbox` state their emptiness explicitly rather than incidentally. Inventing
a multi-value axis to satisfy the structural guard is exactly the fabrication the contract
exists to prevent.
