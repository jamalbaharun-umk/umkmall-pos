# Navigation

Moving between views, and showing where you are. Two components, and they answer different
questions: `Tabs` lets a reader choose which of several peer views to see, while `Stepper`
shows progress through an ordered sequence the reader is being taken along.

## Use this, not that

**Do not reach for a per-item "active" prop in either.** In `Tabs`, which tab is active is a
property of the set: the contract drops Figma's `State` axis from the trigger and reads it off
the shared context instead, because a per-trigger prop makes two simultaneously-active tabs —
and a set with none — representable, and both render perfectly. `Stepper` is the other way
round for a stated reason: a step's `state` and its `position` are separate axes, because
Figma's mark set folds a position value into a state enum, which makes "done and mid"
unsayable while "mid and default" is sayable twice.

There is no second real "use this, not that" here. With two members that do unrelated jobs,
inventing a third would be the fabrication the contract exists to prevent.

## Members

- **Tabs** — a tab set with a size ramp, an optional leading icon, an optional title and a
  `notif` count. Supplying the number is what shows the badge; the boolean Figma publishes
  could not say what the badge displays.
- **Stepper** — a step trail, horizontal or vertical, with `default`, `current` and `done`
  states. `position` is derivable from the index and kept explicit anyway, so a single step
  rendered in isolation can say it has no leg behind it.

## Worth knowing

`Stepper` has two consumers: the journey run page's stage trail and the account-deletion flow. A
step that passes `onSelect` draws its mark and label as one button (UMK-1809) with the connector
outside it; one without it renders as before, with no button. Its vocabulary was first validated
against the design source alone, and the recorded divergences keep a revision cheap.

`Tabs` was keyed `Tab` in the contract until UMK-979, because the axes Figma publishes describe
one tab rather than the set. The axis values still describe one tab; the entry name now matches
the component, its story and its native sibling.
