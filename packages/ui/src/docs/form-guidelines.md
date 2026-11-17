# Form

The controls a user types into or chooses from. Open this section when you are asking *how
does this value get entered* — a string, a number, a date, a file, one choice out of several,
or an on/off setting. Every control here owns its own label: the contract records that
decision on `TextField` and applies it to the whole family, because a shared field wrapper is
a second component a caller can forget, and forgetting it yields an unlabelled control that
still renders perfectly.

## Use this, not that

**A `Switch`, not a `CheckBox`, when the change applies immediately.** The contract states
this as the reason `Switch` carries neither an error boolean nor a `required` prop: a toggle
applies its change on the spot, so there is nothing to validate against. A setting that has
to be saved before it takes effect is a checkbox.

**A `Select`, not a `Menu`, when there is a value to hold.** `Menu` carries items with their
own handlers and an optional per-row tick, but no `value`/`onValueChange` pair — the contract
says so directly — so a caller using it for selection holds the selection itself and the menu
never reflects it.

**`Label` only where no control owns one.** Because every slice-2 control renders its own
label from a `label` prop, the standalone `Label` is for a group heading or something that is
not a control at all.

## Members

- **TextField** — the single-line and multiline text input.
- **Select** — a value picker with an optional type-to-search; the list renders in place
  rather than portalled.
- **CheckBox** — a box that can also be `indeterminate`, kept as a boolean because a
  part-selected parent is neither checked nor unchecked.
- **Radio** — one choice out of a group; no indeterminate boolean, because there is no partial
  selection to express.
- **Switch** — an immediately-applied on/off, with a `loading` boolean for a change in flight.
- **Slider** — a single-value control with min, max and step. Figma publishes the track and
  thumb geometry (`Slider` 1308:8026) and nothing else, so the states are ours.
- **DateTimeInput** — date and time entry, web only; the contract records that the platform
  picker is the right answer away from the browser.
- **Upload** — a dropzone with a status ramp, a preview slot and a drag-over treatment that
  composes over the resolved status.
- **SelectionCard** — the agent surface's choice picker, shaped against the option payloads
  that surface renders. Its selection value is an array even in single-select. `layout="tile"`
  is a pack picker's card: content centred and the control drawn in the top-right corner, over
  the same hidden real input.
- **Label** — the standalone form label, with `required` carrying the mandatory mark.

## Worth knowing

`Slider` and `DateTimeInput` are the two controls whose label prop is a union of a visible
label **or** an accessible name. The compile-time gate stays — omitting both still fails to
build — but the visible half is given up on the name arm, because the A2UI wire format feeding
those two carries no label at all. The other controls still require the visible label.

`Upload` records four states as divergences that Figma publishes none of: drag-over, busy,
preview and the dashed border. Each is written as its own entry so a reader can tell "we added
this" from "Figma has this", per state.
