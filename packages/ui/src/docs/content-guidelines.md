# Content

The pieces a page is built out of — the containers, the rules, the labels on things and the
media inside them. Open this section when you are asking *what do I put this in*, or *what do
I mark it with*, rather than how a user gives you a value.

## Use this, not that

**A `Chip` when it is pressable, a `Badge` when it is not.** They look alike and the
difference is structural: `Badge` renders a `<span>`, takes no handler and has no focus ring,
and its docblock says that is the point rather than an omission — five of its six call sites
had passed an `onClick`, which is what made them chips. `Chip` renders a real `<button>`, so
it is reachable by keyboard and announced as a control.

**A `Card` for a container, not for a course.** The published Figma set named Card is a course
card — it publishes a rating row, a struck price, a best-seller flag and tags. The contract
records that it was read and deliberately not adopted; ours takes a variant and a padding
ladder and nothing else. The course card is a composition on top, and already exists in the
app as `CourseCard.tsx`.

**`Image` only for a remote https source.** It refuses anything else, as an SSRF control. Both
`Lightbox` and `ChatAttachment` record in the contract that they render a plain element instead
precisely because that refusal would blank every local blob and base64 preview.

## Members

- **Badge** — a non-interactive status or category mark. `bestseller` is a solid success
  surface where the other colours are tints, which is why its text inverts.
- **Chip** — the pressable sibling, with a `default`/`active` state and a size ramp that opens
  at `huge`.
- **Card** — the container: an `elevated`, `outlined` or `plain` treatment and a padding step.
- **Divider** — a rule, solid or dashed, horizontal or vertical. The vertical one is a
  different element rather than a rotated one, since it takes its height from the row.
- **List** — the list renderer. Its direction is a layout choice, deliberately not contracted
  as an axis.
- **Disclosure** — a show/hide section. No Figma set exists; this is the design-it-first case.
- **Image** — the media element, with a `natural` type beyond Figma's fixed thumbnail and
  banner ratios, and `fit` kept as a separate prop from `type`.
- **CodeBlock** — a fenced code block with a language header and a copy control. Named for its
  content rather than its affordance, which leaves room for syntax highlighting later.

## Worth knowing

`Card`'s `variant` axis was dropped once because no consumer passed it, then restored when a
survey of the TemanAI surfaces found all three treatments live. The contract keeps the reason
on the entry: "no consumer" is evidence about adoption, never about need.
