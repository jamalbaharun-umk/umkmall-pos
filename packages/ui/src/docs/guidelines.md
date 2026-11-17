# Guidelines

The rules that hold across the whole library. Each of the seven **Components** sections opens
with its own Guidelines page covering the choices specific to it; this page covers the ones
that are not specific to anything.

## The contract is the vocabulary

`packages/ui/src/contract/variants.ts` declares what axes every component has. Before this
file, every primitive declared its own variant block inline and nothing compared them — which
is how two components end up with size ramps that disagree about what `medium` means.

Three things follow from that, and they are the ones most often got wrong:

**An axis value that is not in the contract does not exist.** If a component has three sizes
and you need a fourth, the change is a contract entry and a component that reads it — not a
class override at the call site. An override at the call site is invisible to every guard in
this repo and to everyone reading the component later.

**The contract holds vocabulary, never Tailwind.** No classes, no `cva`, no React, no DOM
types, not even an import. `variants.platform-neutral.test.ts` walks the import graph and
fails on any bare specifier, so this is enforced rather than remembered. It is also why the
React Native renderer consumes the same file unchanged.

**A departure from Figma is recorded, not hidden.** Where this repo deliberately differs from
what the design file publishes, the entry carries a `divergences` record saying what Figma
calls it, what we do instead, and why. An undocumented divergence reads as a mistake and gets
"corrected" back into Figma's shape by the next person through — which is exactly what the
record exists to prevent. If you are about to make a component match Figma more closely, read
its divergences first; you may be undoing a decision.

## Absence is an answer

Several things in this library are missing on purpose, and each absence has a reason written
down beside it:

- `display` and `h1` publish Bold and Semibold only. Offering `medium` on them would resolve
  to no token and render a browser default, which looks like a styling bug rather than a
  missing style.
- `Tooltip` and `DateTimeInput` have no React Native sibling.
- Eight contract entries carry no `family`, meaning no family guard pair covers them.
  `unfamilied-coverage.test.ts` names each one together with the guard **files** that are the
  whole of its coverage — including one row that says plainly there is no dedicated guard at
  all. A recorded gap is not the same as a claim of coverage.

Treat a gap as deliberate until you have read the note saying otherwise.

## Accessibility is in the type, where it can be

Where an accessibility requirement can be made unbuildable, this library makes it
unbuildable rather than documenting it:

- `Button`'s icon-only form is a union that does not compile without an accessible name. A
  nameless icon button is not a lint warning here; it is a type error.
- `Image` accepts `alt` **or** `decorative`, never both and never neither.
- The form family shares one labelling union: a visible `label` or an `aria-label`, not both.
  Passing both is how a field ends up announcing one thing and showing another.

Two of those unions have a runtime companion, because a plain-JavaScript caller can still do
the thing the type forbids. Where you see one, do not "simplify" it away on the grounds that
the type already covers it.

## Language

Interface copy is Indonesian. Story labels, example strings and placeholder content in this
Storybook follow the app, not the code. Prop names, token names and everything in the
contract stay English.

## Colour comes from tokens, and a class that resolves can still be wrong

Every colour in the library resolves through the token pipeline. The utilities are split per
utility, which means `Text` and `Surface` publish many of the same sub-paths and disagree on
several of them — so `text-default-primary` and `bg-default-primary` are a well-formed pair
holding two completely different colours.

Every gate in this repo proves a class **resolves**. None of them proves it resolves to the
right hex. A mistyped palette is green everywhere and only visible in a browser, which is why
a colour change is one of the few things here that has to be looked at rather than tested.
