/**
 * The variant contract.
 *
 * One place that declares what axes a component HAS — variant names, size names, states —
 * so slice 2 cannot invent a size vocabulary that disagrees with slice 5's. Before this
 * file every primitive declared its own `cva` block inline and nothing compared them.
 *
 * VOCABULARY ONLY. No Tailwind classes live here; a component maps a contract entry to its
 * own classes. That is what lets the native renderer consume this file unchanged
 * (R8) — it does so today, through `@umkmall/ui/native` (UMK-912). A `.native.tsx` sibling was
 * the original plan and was retired: the shared barrel re-exports every primitive, so that
 * form pulls Radix and `lucide-react` into the app bundle, and it is why this module imports NOTHING — not React, not `cva`, not `clsx`, and
 * no DOM type. `variants.platform-neutral.test.ts` walks the import graph and fails on any
 * bare specifier, so the rule is enforced rather than remembered.
 *
 * Slice 1 declared nine components up front, including the ones no slice had built yet, so
 * that this file would be a GATE for slices 2–5 rather than a running log each slice appends
 * its own vocabulary to after the fact. That claim is no longer the whole truth and is
 * corrected here rather than left to read as one: slice 4 ADDED `Dialog` and `Menu`, which
 * the original nine never carried. The gate still holds for everything it declared — a slice
 * may not redefine an entry it inherited — but a component the survey never saw arrives as a
 * new entry, with its evidence stated, and that is the intended way in.
 *
 * Axis values are seeded from Ensyra — DS, Figma file `1f9QeG7bSFaIvFh6ktRbat`, read
 * 2026-09-04. Where this repo deliberately departs from Figma, the entry carries a
 * `divergences` record saying so and why (R7) — the departures are the part a later reader
 * would otherwise "fix" back.
 */

/**
 * NAMING: this file declares the VOCABULARY, not the prop names.
 *
 * An axis keeps the design source's word so the two can be compared; a component is free to
 * expose it under a different prop name, and records a divergence when it does. Two rules
 * decide that name:
 *
 * 1. A component's primary semantic axis is spelled `variant` — `Text` (Figma `role`) and
 *    `Alert` (Figma `Function`) both do. Reach for the design source's word only when it is
 *    already `variant` or genuinely more precise.
 * 2. Rename whenever the source's word is a reserved word or an HTML/ARIA attribute. `role`
 *    made `role="status"` unsayable on a `Text`; `function` cannot be destructured at all.
 *    `Button` is the standing exception, and a deliberate one: it kept `type` and `color`
 *    and moved the DOM attribute to `htmlType` instead.
 */

/** A single axis: the closed set of values that axis accepts. */
export type Axis = readonly string[]

/**
 * A deliberate departure from what Figma publishes. Recorded rather than hidden, because
 * an undocumented divergence reads as a mistake and gets "corrected" back into Figma's
 * shape by the next person through.
 */
export interface Divergence {
  /** What Figma calls the thing we changed. */
  readonly figma: string
  /** What this repo does instead. */
  readonly ours: string
  readonly reason: string
}

/**
 * Which family guard pair covers this component.
 *
 * The six guards each hold a hand-maintained `MODULES` map, and a component omitted from one
 * ships with zero behaviour-guard coverage against a fully green suite. A count literal cannot
 * see that — the list is simply one shorter and still matches its own number. This key gives
 * each guard something external to reconcile against, the way the purge guards already
 * reconcile against their class-table module's exports.
 *
 * `undefined` is a real answer, not an omission: `Button`, `Text`, `Icon`, `Label`, `Sidebar`,
 * `Header`, `Lightbox` and `AppShell` belong to no family pair today. Leaving the key off says
 * so, and the guards assert against exactly the entries that claim their family, so an
 * unfamilied entry is never silently expected somewhere.
 *
 * WHICH IS ALSO THE HOLE. Invisible to all six guards means invisible when its own coverage
 * disappears — deleting one such component's behaviour file left the suite green and merely
 * shorter. `unfamilied-coverage.test.ts` closes it: every entry is either claimed by a family
 * or named there with the guard files that are the whole of its coverage.
 */
export type ComponentFamily = 'form-controls' | 'content' | 'feedback' | 'overlays' | 'composer' | 'message'

/**
 * Where a person LOOKS for this component — the Storybook sidebar section it lives under,
 * and the section its Guidelines page opens (UMK-979 KTD2).
 *
 * Not a widened `family`, and the two must not be collapsed. `family` answers *which guard
 * pair covers this* and is legitimately absent for eight entries; `category` answers a
 * navigation question that has no absent case, which is why it is REQUIRED below. Collapsing
 * them would also reintroduce a hand-maintained member list, which is the thing UMK-961
 * deleted.
 *
 * Decide each one on navigation grounds and never inherit it from `family`: `Tabs` and
 * `Stepper` are Navigation even though their guard pair is the content pair. That
 * disagreement is the whole reason there are two fields.
 *
 * `Foundations` is a TOP-LEVEL section beside `Components`, holding `Text`, `Icon`, `Button`
 * and the token pages — not one of the seven category sections under `Components`.
 */
export type ComponentCategory =
  | 'Foundations'
  | 'Form'
  | 'Content'
  | 'Navigation'
  | 'Feedback'
  | 'Overlays'
  | 'Shell'
  | 'Chat'

/**
 * The categories IN THE ORDER A SIDEBAR SHOWS THEM, which is a different fact from the union
 * above — a union has no order, and both playbooks need one.
 *
 * `Foundations` is FIRST and is not one of the seven: it is a top-level section beside
 * `Components`, holding `Text`, `Icon`, `Button` and the token pages. `storyTitle()` encodes
 * the same split by dropping the `Components/` prefix for it.
 *
 * IT LIVES HERE SO THERE IS ONE LIST, not two. `apps/design/.storybook/preview.ts` hand-writes
 * this order for Storybook's `storySort`, and the native playbook needs the identical order to
 * render the identical menu. A second hand-written copy is how the two surfaces end up showing
 * the same components under differently-ordered headings, which is exactly the drift a person
 * comparing them would be least likely to notice. `category-order.test.ts` reconciles the
 * Storybook array against this one.
 */
export const COMPONENT_CATEGORIES = [
  'Foundations',
  'Form',
  'Content',
  'Navigation',
  'Feedback',
  'Overlays',
  'Shell',
  'Chat',
] as const satisfies readonly ComponentCategory[]

/**
 * What the NATIVE half of the design system does with this entry.
 *
 * REQUIRED, and that is the whole mechanism. `status` above is one field with no platform
 * dimension, so every entry claimed `implemented` while native implemented 23 of 42 and 32
 * of 59 axes — the contract asserting a parity that did not exist, in the one artifact whose
 * job is to be the list both platforms read. An OPTIONAL field would be answered by
 * forgetting it, which is precisely the state it exists to end.
 *
 * `absent` IS A REAL ANSWER AND USUALLY THE RIGHT ONE. UMK-952 settled that a native sibling
 * is built when a screen renders it, never when the web slice closes, because a sibling
 * nobody imports is dead code. Nothing here reopens that. What it changes is that the
 * absence is now written down with a reason, the way `icon-registry.ts` names a glyph it has
 * not ported instead of leaving the name out.
 *
 * `partial` is the state a guard has to be able to express in order to be worth having: it
 * pins the gap at its current size, so it cannot quietly grow, and it reds when someone
 * CLOSES the gap — which forces the record to be updated rather than drifting the other way.
 */
/** UMK-1307: the `a2ui` appearance is web-only — native renders its own agent surface and has nothing to adopt it. */
const A2UI_NATIVE_REASON =
  "UMK-1307 added the `a2ui` appearance (the agent surface's pre-library look) on web only; native renders its own agent surface and has nothing to adopt it.";
const A2UI_NATIVE_OWNER = 'UMK-877';

export type NativeParity =
  | {
      readonly state: 'implemented'
      /** Set only when the native module's name differs from the contract key. */
      readonly module?: string
    }
  | {
      readonly state: 'partial'
      readonly module?: string
      /**
       * Declared axes the native sibling does not accept. Checked mechanically, exactly:
       * neither more nor fewer.
       */
      readonly missingAxes?: readonly string[]
      /**
       * Non-axis props the web sibling accepts and native does not. RECORDED BUT NOT
       * MECHANICALLY CHECKED — prop names are not contract vocabulary, so the guard cannot
       * enumerate them from here without becoming a second, weaker source for them. Named
       * rather than omitted, because an unlisted prop reads as "both platforms agree".
       *
       * ONE DIRECTION IS CHECKED (UMK-1371): a bare prop name recorded here that the native
       * module now declares reds `native-parity.test.ts`, so a closed gap cannot stay recorded
       * as open. A prop the web gains that nobody records here is still invisible.
       */
      readonly missingProps?: readonly string[]
      readonly reason: string
      /**
       * The ticket that closes it — one that stays OPEN while the gap exists. A decided, standing
       * divergence names its standing decision ticket, never the ticket that introduced it.
       */
      readonly owner: string
    }
  | {
      readonly state: 'absent'
      readonly reason: string
      /** The ticket that would build it, where one exists. */
      readonly owner?: string
    }

export interface ComponentContract {
  /** The family guard pair covering this component; absent when no pair covers it. */
  readonly family?: ComponentFamily
  /**
   * REQUIRED, with no `?`: a component with no category appears nowhere in the sidebar, and
   * that is a green-suite failure. The type is the enforcement — deleting one fails
   * typecheck rather than shipping a component nobody can find.
   */
  readonly category: ComponentCategory
  /**
   * `implemented` — a component in this repo reads these axes today.
   * `declared` — the vocabulary is fixed, the component is not built yet. `slice` says who
   * builds it. A `declared` entry may legitimately carry fewer axes than Figma has.
   */
  readonly status: 'implemented' | 'declared'
  /** Which UMK-875 slice owns building it, for `declared` entries. */
  readonly slice?: string
  /**
   * What `@umkmall/ui/native` does with this entry. Required — see `NativeParity`.
   * Guarded by `native-parity.test.ts`, which runs contract → native, the direction no
   * other guard in this package runs.
   */
  readonly native: NativeParity
  readonly axes: Readonly<Record<string, Axis>>
  /**
   * Boolean props, NOT axes. A boolean composes with every axis value at once; folding one
   * into an enum makes invalid states representable. See `Button.disabled`'s divergence.
   */
  readonly booleans?: readonly string[]
  /**
   * Axes Figma publishes whose values have not been read out of the file yet. Named rather
   * than omitted: an absent axis reads as "this component has no such axis", which is a
   * different and wrong claim.
   */
  readonly pendingAxes?: readonly string[]
  readonly divergences?: readonly Divergence[]
  readonly note?: string
}

/**
 * The Ensyra type scale (`Typography` in the token pipeline), as roles.
 *
 * The heading roles are named for the HTML elements they usually render as. Ensyra calls them
 * "Heading 1".."Heading 6", but the token source is keyed `H1`..`H6` to match — so the web
 * utility (`ds-h1-*`), the native theme (`typography.mobile.h1`) and this list all spell a
 * role the same way. Each token keeps its Figma style path in its own description, so the
 * provenance survives the shorter key.
 *
 * NAMING TRAP: `bodyLg` is 14px — SMALLER than `paragraph` at 16px. "Body" is the
 * small-text ramp BELOW paragraph, not above it. Reading this list as a descending size
 * ramp is correct; reading `bodyLg` as "large body text" is not.
 */
export const TEXT_ROLES = [
  'display',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'paragraph',
  'bodyLg',
  'bodyMd',
  'bodySm',
] as const

export const TEXT_WEIGHTS = ['bold', 'semibold', 'medium', 'regular'] as const

/**
 * Not every role publishes all four weights (R3). `display` and `h1` publish Bold and
 * Semibold only — offering `medium` on them would resolve to nothing and render a default,
 * which looks like a styling bug rather than a missing token.
 */
export const TEXT_ROLE_WEIGHTS = {
  display: ['bold', 'semibold'],
  h1: ['bold', 'semibold'],
  h2: TEXT_WEIGHTS,
  h3: TEXT_WEIGHTS,
  h4: TEXT_WEIGHTS,
  h5: TEXT_WEIGHTS,
  h6: TEXT_WEIGHTS,
  paragraph: TEXT_WEIGHTS,
  bodyLg: TEXT_WEIGHTS,
  bodyMd: TEXT_WEIGHTS,
  bodySm: TEXT_WEIGHTS,
  /**
   * `satisfies`, NOT a type annotation. Annotating this
   * `Readonly<Record<TextRole, readonly TextWeight[]>>` type-checks identically and widens
   * every entry to all four weights, which silently turns `Text`'s per-role `weight`
   * constraint into no constraint at all — `<Text role="display" weight="medium" />` compiles
   * and renders a token that does not exist.
   */
} satisfies Readonly<Record<(typeof TEXT_ROLES)[number], readonly (typeof TEXT_WEIGHTS)[number][]>>

/** Semantic colour roles, mirroring the token pipeline's `Text` group. */
export const TEXT_COLORS = [
  'primary',
  'secondary',
  'disable',
  'invert',
  'brand',
  'success',
  'error',
  'warning',
  /** `muted` (UMK-1548) is the Text group's `default.muted`, #314d69; no Figma component axis, ours. */
  'muted',
] as const

export const contract = {
  /** Figma: General. */
  Button: {
    category: 'Foundations',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /** Figma `Type`, plus `outline` (UMK-1548, ours): the ghost on a solid fill with a real border. */
      type: ['primary', 'ghost', 'outline', 'text'],
      /** Figma `Colors`, minus `Disable` — see the divergence. */
      color: ['primary', 'light', 'danger', 'dark'],
      /** Figma `Size`. */
      /** `compact` (UMK-1548) is ours, no Figma rung: 12px semibold, 6 / 12 padding. */
      size: ['large', 'medium', 'small', 'micro', 'compact'],
      /** Repo-only. Figma has no counterpart; both values have live call sites. */
      width: ['auto', 'full'],
    },
    booleans: ['disabled', 'isLoading'],
    divergences: [
      {
        figma: '`Colors` includes a `Disable` value, and `State` offers only Default and Hover',
        ours: '`disabled` is a boolean that composes with every `color`',
        reason:
          'Disabled changes semantics and interaction, not just palette. Modelling it as one more colour makes "disabled danger button" unrepresentable and lets a caller set a colour that silently means non-interactive.',
      },
      {
        figma: 'no `width` axis',
        ours: '`width: auto | full`',
        reason:
          'Additive, and recorded as ours rather than passed off as Figma\'s. Both values have live call sites; the component cannot drop the axis.',
      },
      {
        figma: 'no icon-only variant on the General set — every published step carries horizontal padding and a label slot',
        ours: 'an `iconOnly` plain prop that swaps the size step for a square one and forces the auto width',
        reason:
          'Between 74 and 96 icon-only buttons in the chat surface alone reach past the axes to get this today, overriding the padding through a class string AND passing the non-default width. A prop rather than an axis value because the width axis is pinned by an equality lock and, more to the point, "the label is a glyph" is a fact about the content rather than a visual variant. It is typed as a union so a nameless icon-only button does not build.',
      },
      {
        figma: 'no unstyled or as-child form — every published cell is a styled pill',
        ours: 'an `unstyled` plain prop that renders no type/colour/size/width class, and an `asChild` plain prop that renders the single child with the button props',
        reason:
          'UMK-878: the chat chrome has raw `<button>`s whose look is its own, and a styled Button cannot be pixel-identical to them. A plain prop, not an axis value or a boolean, so native-parity (which compares axes only) is not asked for an answer and native stays `implemented` and untouched; the style axes are typed `never` beside it so a colour that silently does nothing does not build.',
      },
      {
        // ds-raw-ok: Figma/doc description prose naming a hex, never painted
        figma: 'the `Colors` value carrying `#0074E7` is called `Brand`',
        ours: 'the same value is called `primary`',
        reason:
          'A NOTE, not a queued rename (UMK-1091). The values agree exactly — this is one word, not one colour. Renaming the axis reaches 49 call sites, 34 of them in `apps/mobile`, plus the published prototyping starter, which is not typechecked and would render colourless with no error. Recorded here so the next reader comparing this component to Figma does not report the spelling as drift.',
      },
      {
        figma: 'no loading state',
        ours: '`isLoading` boolean',
        reason:
          'Additive. Async submit buttons need it and it composes with every other axis, so it is a boolean rather than a `State` value.',
      },
    ],
  },

  /**
   * Figma: Alerts & Toast.
   *
   * `Type` includes `toast`, and a toast is a portal, a stacking container, a dismissal and
   * a live region — not a shadow. Slice 1 deliberately did NOT wire this up early for that
   * reason: a component that accepted `type="toast"` and only changed its border radius
   * would be the looks-right-does-nothing failure the rest of this work exists to avoid.
   * Slice 3 built the host as well, so the axis now means what it says.
   */
  Alert: {
    category: 'Feedback',
    family: 'feedback',
    status: 'implemented',
    native: { state: 'partial', missingAxes: ['appearance'], reason: A2UI_NATIVE_REASON, owner: A2UI_NATIVE_OWNER },
    axes: {
      type: ['alert', 'toast'],
      /**
       * Figma `Function`. `danger`, not `error` — the Figma word won, and slice 3's rebuild
       * is where the primitive stopped saying `error`.
       */
      function: ['success', 'info', 'warning', 'danger'],
      /**
       * Figma spells these `Large`, `Medium`, `Small`. Slice 1 abbreviated them to `l|m|s`
       * without reading the set; every other entry in this file spells the scale out, which
       * is the disagreement the contract exists to prevent. Corrected in slice 3 against the
       * component set (`Alerts & Toast`, node 191:1745, read 2026-09-05).
       */
      size: ['large', 'medium', 'small'],
      /**
       * Repo-only. How much of the box the severity paints — see the divergence, and
       * `feedback-classes.ts` for where each value's colours come from.
       */
      treatment: ['full', 'accent', 'coach', 'banner'],
      /** UMK-1307. `a2ui` is the agent surface's pre-library note box, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    divergences: [
      {
        figma: 'no treatment axis of any kind — the set publishes only Type, Function and Size',
        ours: '`treatment: full | accent | coach | banner`, defaulting to `full`',
        reason:
          "The app's own callout has six looks this component could not express, and 19 of its 30 live instances are the left-accent shape while four more are a gradient banner. Without the axis those 23 have nowhere to migrate onto. The values are built from the published callout token group, whose keys are that component's own variants, so the colours are read rather than invented. Four values rather than three because `full` is pinned byte-identical to what shipped before the axis existed, which leaves the coaching look — a full border and coloured ink on a green surface — with no arm of its own; the alternative was approximating it, which is what reading the token group exists to make unnecessary.",
      },
      {
        figma: '`Show Icon` is a boolean and `Icon` an instance swap',
        ours: 'one `icon` prop that takes a node, with a per-`function` default, and `null` to hide it',
        reason:
          'Two Figma properties for "which glyph" and "is there a glyph" collapse into one nullable prop in code, where absence is already expressible. A separate boolean makes "no icon but here is the icon" representable, and one live call site passes a custom glyph with no variant at all.',
      },
      {
        figma: '`Function` is the axis name',
        ours: 'the axis keeps Figma\'s word here; the PROP is `variant`',
        reason:
          'Same split as `Text`, whose `role` axis is a `variant` prop: this file declares the vocabulary, not the prop names. `function` is a reserved word, so it can never be destructured or shorthanded, and `function="danger"` reads as nothing at a call site. `variant` is this package\'s standard name for a component\'s primary semantic axis.',
      },
      {
        figma: 'Toast publishes a close button inside the same component set',
        ours: 'dismissal belongs to the toast HOST, not to the Alert element',
        reason:
          'An Alert rendered inline has nothing to dismiss it from — the surface owning it decides whether it can go away. The toast host (sonner) already owns the queue, the timer and the close affordance, so putting a second one on the element would give two things the power to remove one toast.',
      },
    ],
  },

  /**
   * Figma: Badge (component set 146:2464).
   *
   * There is no `large` step between `xlarge` and `medium` — that is Figma's ladder, not an
   * omission here, and inventing one to make the ramp look even is the fabrication this file
   * exists to prevent.
   */
  Badge: {
    category: 'Content',
    family: 'content',
    status: 'implemented',
    native: { state: 'partial', missingAxes: ['appearance'], reason: A2UI_NATIVE_REASON, owner: A2UI_NATIVE_OWNER },
    axes: {
      color: ['primary', 'warning', 'success', 'danger', 'light', 'bestseller', 'gradient'],
      /** `compact` and `compactTight` (UMK-1548) are ours, no Figma rung: 14px bold, 6 / 10 and 4 / 12 padding. */
      size: ['xlarge', 'medium', 'small', 'micro', 'compact', 'compactTight'],
      /** UMK-1307. `a2ui` is the agent surface's pre-library look for this component, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    booleans: ['showIconLeft', 'showIconRight'],
    note: 'Every colour resolves to a published token. `bestseller` is the odd one and deliberately so: it is the SOLID success surface where the other five are 10% tints, which is why its text inverts. A refactor that flattens the six onto one tint shape loses exactly that.',
  },

  /** Figma: Chips (component set 146:3347). */
  Chip: {
    category: 'Content',
    family: 'content',
    status: 'implemented',
    native: { state: 'partial', missingAxes: ['appearance'], reason: A2UI_NATIVE_REASON, owner: A2UI_NATIVE_OWNER },
    axes: {
      state: ['default', 'active'],
      /** `compact` (UMK-1548) is ours, no Figma rung: regular weight idle, semibold selected, an n40 idle border. */
      size: ['huge', 'xlarge', 'large', 'medium', 'small', 'micro', 'compact'],
      /** UMK-1307. `a2ui` is the agent surface's pre-library look for this component, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    booleans: ['showIconLeft', 'showIconRight'],
    note: '`huge` sits above `xlarge` on the ramp and is kept as published — it is a whole word Figma uses, not an abbreviation of the kind slice 3 reverted.',
  },

  /** Figma: Field Input. */
  TextField: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['appearance', 'counterPlacement', 'prefixPlacement'],
      missingProps: ['aria-label', 'autoResize', 'maxRows', 'labelSize', 'valid', 'resize'],
      reason: `${A2UI_NATIVE_REASON} UMK-955 added more web-only props: \`aria-label\` (a name with no visible caption, \`label\` XOR \`aria-label\`), \`autoResize\` / \`maxRows\` (a multiline field that grows with its content), \`valid\` (a success border and tick) and \`resize\` (the drag handle), plus the web-only axes \`counterPlacement\` (the counter inside the box) and \`prefixPlacement\` (the prefix in its own box). It also added the web-only \`appearance\` value \`bare\` (no chrome at all) and the web-only \`size\` value \`xsmall\` (a compact 12px field with no Figma rung). Native has not adopted them.`,
      owner: A2UI_NATIVE_OWNER,
    },
    axes: {
      /** `compact` (UMK-1548) is ours, no Figma rung: 14px type, 10 / 12 padding, r12, an n40 rest border, a 44 single line, a 12px muted caption. */
      size: ['large', 'small', 'xsmall', 'compact'],
      /** UMK-1307. \`a2ui\` is the agent surface's pre-library look, reproduced value for value. Ours; no Figma. \`bare\` (UMK-955) draws no chrome at all. Ours; no Figma. */
      appearance: ['default', 'a2ui', 'bare'],
      /** UMK-955. Where \`showCounter\` draws the count. Ours; no Figma. */
      counterPlacement: ['below', 'inside'],
      /** UMK-955. Where \`prefix\` sits: in the box, or in its own box beside it. Ours; no Figma. */
      prefixPlacement: ['inside', 'outside'],
    },
    booleans: ['error', 'disabled'],
    divergences: [
      {
        figma:
          '`Status` is a nine-value enum: Default, Active, Filled, Filled Label, Error Filled, Error Not Filled, Disable, Disable Filled, Error Disable',
        ours: '`error` and `disabled` booleans; "filled" is derived from the value and never passed',
        reason:
          'Those nine values are three orthogonal booleans wearing an enum — error × disabled × hasValue. A literal nine-value prop makes invalid states representable (there is no "Error Disable Filled") and forces every caller to recompute a combination the component can see for itself.',
      },
      {
        figma: 'label, helper text and error message sit in a shared Field wrapper',
        ours: 'every control owns its own label and error message through a `label` prop',
        reason:
          'A wrapper is a second component every caller has to remember, and forgetting it yields an unlabelled control that renders perfectly. Owning the label makes the association impossible to omit. Applies to all six controls of slice 2.',
      },
    ],
  },

  /**
   * Figma: Button page, checkbox set.
   *
   * `indeterminate` is a boolean rather than a third value of a checked axis: a
   * partly-selected parent is neither checked nor unchecked, and folding it into the checked
   * vocabulary makes "indeterminate and checked" representable when it is not a real state.
   */
  CheckBox: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['appearance'],
      missingProps: ['aria-label'],
      reason: `${A2UI_NATIVE_REASON} UMK-955 added one more web-only prop: \`aria-label\` (a checkbox with no visible caption, \`label\` XOR \`aria-label\`). Native has not adopted it.`,
      owner: A2UI_NATIVE_OWNER,
    },
    axes: {
      size: ['xlarge', 'large', 'medium', 'small'],
      /** UMK-1307. `native` keeps the browser's own natively tinted box (the agent surface's pre-library look). Ours; no Figma. */
      appearance: ['default', 'native'],
    },
    booleans: ['error', 'disabled', 'indeterminate'],
    pendingAxes: ['label', 'hover', 'active'],
    divergences: [
      {
        figma: '`Size=XL` exists, but its BOX is 18px — the same as Large — and only the label\'s type scale changes',
        ours: '`xlarge` is a 20px box, one rung above Large on the same two-pixel rhythm',
        reason:
          'Read from `01 Check Box` 121:1457 on 2026-09-18 (UMK-1091): the published ladder is Large 18, Medium 16, Small 14, and XL repeats Large\'s box. This component does not vary its label type by size, so adopting XL literally would leave two of four sizes pixel-identical and the axis meaningless. The extra rung is ours; the three below it are Figma\'s.',
      },
    ],
    note: 'Figma publishes Label, Hover and Active alongside Size; their values were not read out of the file. Hover and active are CSS states here rather than props, so they may never become axes. The top step was spelled `extraLarge` until slice 5 normalised it to `xlarge` — an inherited entry edited deliberately, and a spelling normalisation rather than a vocabulary change: camelCase inside a size value reads badly beside `small`/`medium`/`large`, and `Dialog` already shipped `xlarge`.',
  },

  /** Figma: Button page, radio set. */
  Radio: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /** The checkbox scale minus the largest step, which the radio set does not publish. */
      size: ['large', 'medium', 'small'],
    },
    booleans: ['error', 'disabled'],
    pendingAxes: ['label', 'hover', 'active'],
    note: 'No indeterminate boolean, unlike CheckBox: a radio in a group is chosen or it is not, and there is no partial selection to express.',
  },

  /** No Figma set (UMK-1325). One choice out of a few, all visible at once: a radiogroup of segments. */
  SegmentedControl: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: {
      state: 'absent',
      reason: 'UMK-1325 web-only; native font scaling is separate mobile work.',
    },
    axes: { size: ['medium', 'small'] },
    booleans: ['disabled'],
    note: 'A radiogroup, not tabs: nothing swaps below it. Options are data (`options`), so the only axis is the size.',
  },

  /**
   * Figma: Button page, toggle set. Ensyra and the reference design system both call this
   * Toggle; the name differs deliberately and the component does not.
   */
  Switch: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      size: ['large', 'medium', 'small'],
    },
    booleans: ['disabled', 'loading'],
    pendingAxes: ['label', 'hover', 'active'],
    divergences: [
      {
        figma: 'Toggle',
        ours: 'Switch',
        reason:
          'Named for what the control does rather than for the Figma set, and kept distinct from the toggle BUTTONS elsewhere in the app. Same component, different word; recorded so nobody renames it back thinking the sets diverged.',
      },
      {
        figma: '`05 Toggle` 775:3361 publishes ONE size, a 44x24 track',
        ours: 'a `size` axis of large, medium and small',
        reason:
          'Recorded in UMK-1091, having gone unstated since the axis was written. Our `medium` IS the published size — 44x24 — so the parity answer is the default and the other two rungs are ours. They have live call sites in dense settings rows, so the axis cannot simply drop to match; naming it here stops the next reader reporting three sizes as drift, and stops anyone treating `large` as the Figma one.',
      },
      {
        figma: 'the field sets publish error and required states',
        ours: 'Switch carries neither an error boolean nor a required prop',
        reason:
          'A toggle applies its change immediately rather than behind a submit, so there is nothing to validate against. A setting that needs saving before it takes effect is a checkbox, not a switch.',
      },
      {
        figma: 'no loading state',
        ours: '`loading` boolean',
        reason:
          'Additive. An instantly-applied change can be in flight, and that has to be visible while it is. It composes with every size, so it is a boolean rather than a state value.',
      },
    ],
  },

  /**
   * Figma DOES publish a slider: `Slider` 1308:8026, read 2026-09-18 (UMK-1091). This entry
   * claimed the opposite for long enough that the thumb drifted — a solid brand dot where the
   * set draws a white disc with a brand ring — because nobody went looking for a set the
   * contract said did not exist. The published set carries `Size` only; the rest of the
   * vocabulary below is still ours.
   */
  Slider: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['appearance'],
      reason:
        'UMK-1383 added `appearance: scrubber`, the web video player\'s thin seek bar, on the web only. Native has no video player built on this control yet; the thin track is queued with it.',
      owner: 'UMK-1383',
    },
    axes: {
      size: ['large', 'small'],
      /** UMK-1383. `scrubber` is the video player\'s 4px seek bar, reproduced value for value. Ours; Figma publishes no thin slider. */
      appearance: ['default', 'scrubber'],
    },
    booleans: ['disabled'],
    note:
      'Slice 2 required a visible label on all six controls so a caller could not produce an unlabelled one by omission. This entry narrows that: the prop is a union of a visible label OR an accessible name, because the A2UI wire format that feeds this control carries no label at all and a string name is the only one available. The compile-time gate is kept — omitting both still fails to build — but the visible half is given up on the name arm. The other four controls are unchanged and still require the visible label.',
    divergences: [
      {
        figma: '`Slider` 1308:8026 publishes a `Size` axis (Large, Small) and nothing else — no state, no disabled variant',
        ours: 'a `size` axis matching it, plus min, max, step and an opacity fade when disabled',
        reason:
          'Corrected in UMK-1091: this said "no slider is published" until the set was read on 2026-09-18, and the false claim is why the thumb drifted unchecked. Track heights and thumb diameters now come from that set. The disabled treatment stays an opacity fade because the set publishes no disabled variant — replacing it would be invention rather than reconciliation.',
      },
      {
        figma: 'the reference design system never announces a formatted value',
        ours: 'an optional formatter supplies a spoken value alongside the raw number',
        reason:
          'A percentage or a unit-bearing value otherwise reaches assistive technology as a bare integer, which is a gap in the reference rather than a decision. Deliberately ahead of it.',
      },
    ],
  },

  /** Figma: Field Input, Calendar and Date sets. */
  DateTimeInput: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['selection', 'appearance'],
      missingProps: ['withTime', 'rangeValue', 'defaultRangeValue', 'onRangeChange', 'presets', 'portal', 'labelSize'],
      reason:
        'UMK-1185 added the admin pickers\' modes on the web only: a date range with an Apply/Clear draft, a local date-time value (YYYY-MM-DDTHH:mm, parsed and formatted in shared/date-input.ts so native can reuse it), one-click presets, and `portal` (render the calendar at the page root when an ancestor would clip it). Native opens the platform picker, which has no anchored panel for `portal` to move; the range and time modes are queued. UMK-1383 added `timeOnly` on the web (`<input type="time">` inside the field box, value HH:mm); native has it since UMK-1358, on the platform time picker (a wheel on iOS, the system dialog on Android) with no `min`/`max`, as on the web. UMK-955 added `labelSize`: the caption draws through the web-only Label field look (Figma Field Input), which native does not have.',
      owner: 'UMK-1193',
    },
    axes: {
      size: ['large', 'small'],
      /** `range` added in UMK-1185 for admin's date-range filters. Not `mode`: admin already uses that word for a trigger style. */
      selection: ['single', 'range'],
      /** UMK-1307. `a2ui` is the agent surface's pre-library field box, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    booleans: ['error', 'disabled', 'withTime', 'portal'],
    note:
      'Slice 2 required a visible label on all six controls so a caller could not produce an unlabelled one by omission. This entry narrows that: the prop is a union of a visible label OR an accessible name, because the A2UI wire format that feeds this control carries no label at all and a string name is the only one available. The compile-time gate is kept — omitting both still fails to build — but the visible half is given up on the name arm. The other four controls are unchanged and still require the visible label.',
    pendingAxes: ['calendar', 'date'],
    divergences: [
      {
        figma: 'the Calendar page publishes further sets beyond Calendar and Date',
        ours: 'only the Calendar and Date sets are taken',
        reason:
          'The rest of that page is scheduling surface this product has no use for. Naming the boundary keeps a later reader from reading the omission as an oversight.',
      },
      {
        figma: 'one component set, no platform note',
        ours: 'on native the box is a button that opens the PLATFORM picker (the system dialog on Android, the system inline calendar on iOS) rather than a typeable field with a drawn calendar, and it displays DD/MM/YYYY where the web box shows the ISO string it is typed in',
        reason:
          'Built in UMK-1128, when two screens needed a date. A phone has no reason to type a date and the OS already ships the calendar its users know, so the native sibling is a design decision rather than a port of the web file. What does not diverge is the VALUE: both platforms parse and emit YYYY-MM-DD through one shared module, the same bytes an HTML date input sends.',
      },
    ],
  },

  /**
   * No Figma set. A one-time code as ONE input drawn as boxes (UMK-1186), mirroring the
   * native control in `apps/mobile` rather than the six-input shape both web apps ship.
   */
  OtpInput: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: {
      state: 'absent',
      reason:
        'A native OTP input already exists at apps/mobile/src/auth/views/OtpInput.tsx, and this web entry mirrors it. Moving it into @umkmall/ui/native is a separate change with no ticket yet; until then the app owns it.',
    },
    axes: {
      /** The text box's scale, so the boxes match a field's height beside them. */
      size: ['large', 'small'],
    },
    booleans: ['error', 'disabled'],
    note: 'ONE real input with `autocomplete="one-time-code"`, drawn as `length` boxes. The OS delivers an SMS/WhatsApp code as one autofill into one field, so six separate inputs each receive nothing — the reason the native control is built this way and the reason this one is. Labelled by the visible-label OR accessible-name union `DateTimeInput` uses.',
  },

  /** Figma: Tab (component set 185:1050), axes read 2026-09-05. */
  Tabs: {
    category: 'Navigation',
    family: 'content',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['appearance'],
      reason: A2UI_NATIVE_REASON,
      owner: A2UI_NATIVE_OWNER,
    },
    axes: {
      /** `xsmall` (UMK-960) is ours, no Figma step: 14px type and 10px vertical padding for a dense bar of four or more tabs. */
      size: ['large', 'small', 'xsmall'],
      state: ['default', 'active'],
      /** UMK-1290. `a2ui` is the agent surface's pre-library tab bar, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    booleans: ['showIconLeft', 'showNotif', 'showTitle'],
    divergences: [
      {
        figma: '`State` is an axis with values Default and Active',
        ours: 'no `state` prop; a trigger reads its state from the active value on the shared context',
        reason:
          'Which tab is active is a property of the tab SET, not of one trigger. A per-trigger prop makes two simultaneously-active tabs and a set with none representable, and both render perfectly. The vocabulary is kept so the two can still be compared.',
      },
      {
        figma: '`Show Notif` is a boolean toggling a badge whose content is a count',
        ours: 'a `notif` number; supplying it is what shows the badge',
        reason:
          'The published badge reads a number. A boolean can say the badge is present and cannot say what it displays, so a component honouring the boolean literally would have to invent the count or hardcode it. The published vocabulary is kept here because the toggle is genuinely what Figma exposes.',
      },
    ],
    note: "The entry is keyed `Tabs`, matching the component, its story and its native sibling; it was `Tab` until UMK-979 because the axes Figma publishes describe ONE tab rather than the set, which was a real observation that cost every reader a lookup. The axis values still describe one tab. Slice 1's note asked the slice that builds it to read these values rather than invent them; slice 5 read them and the note is discharged. The component's own invented `default | outlined` treatment axis has no Figma counterpart and was discarded rather than contracted — which is precisely what that note existed to prevent.",
  },

  /** Figma: Tooltip (component set 180:1707), axes read 2026-09-05. */
  Tooltip: {
    category: 'Feedback',
    family: 'feedback',
    status: 'implemented',
    native: {
      state: 'absent',
      reason:
        'Decided, not deferred: hover-triggered, and touch has no hover. A control that needs to explain itself does so in its label or hint. Standing decision UMK-1127.',
      owner: 'UMK-1127',
    },
    axes: {
      color: ['dark', 'white'],
      size: ['large', 'small'],
    },
    booleans: ['showClose'],
    divergences: [
      {
        figma: '`Arrow` is a six-value axis: Top Left, Top Mid, Top Right, Bottom Left, Bottom Mid, Bottom Right',
        ours: 'no arrow axis; `side` and `align` place the tip and the arrow follows the RESOLVED placement',
        reason:
          'Those six values are the consequence of where the tip ended up, not an independent choice. Exposing them as a prop lets a caller pin an arrow to the top while collision detection flips the tip to the bottom — a tooltip pointing away from its own trigger, which renders perfectly and is simply wrong.',
      },
    ],
    note: 'Slice 1 recorded this as slice 4 and UMK-875 places it in slice 3; corrected before it was built, because the structural guard checks a declared entry HAS a slice, never that the value is right. `showClose` defaults OFF here though Figma defaults it on — a tip that closes on pointer-leave has nothing for a close button to do.',
  },

  /**
   * No Figma component set — Ensyra's `Loading Screen` page publishes none, so the visual
   * vocabulary here is ours and the Storybook story is what Agil designs against.
   *
   * This used to cite `Slider` as the precedent for "proposed rather than published". Figma
   * publishes a Slider (1308:8026) and always may publish a skeleton, so the precedent is
   * withdrawn rather than repointed: a claim that a set does not exist goes stale silently,
   * and citing one such claim from another doubles the reach of the next stale one.
   */
  Skeleton: {
    category: 'Feedback',
    family: 'feedback',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /** The three shapes every hand-rolled skeleton in this repo turns out to be. */
      shape: ['text', 'circle', 'rect'],
    },
    divergences: [
      {
        figma: 'no skeleton is published',
        ours: 'a shape primitive with one shared shimmer, styled from published neutrals',
        reason:
          'The axis here was not read from Figma because there is nothing to read. Recorded so a later reader does not assume the vocabulary was copied from a design and quietly "correct" it against a set that does not exist.',
      },
      {
        figma: 'n/a',
        ours: 'hidden from assistive technology rather than announced',
        reason:
          'A skeleton is a placeholder, and a live region firing on every page load is noise that trains people to ignore it. The surface that owns the loading state does the announcing; this element deliberately says nothing.',
      },
    ],
  },

  /**
   * No Figma component set — `Text` renders the type scale, which Figma publishes as text
   * styles rather than as a component (see the token pipeline's `Typography` group).
   */
  Text: {
    category: 'Foundations',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      role: TEXT_ROLES,
      weight: TEXT_WEIGHTS,
      color: TEXT_COLORS,
    },
    note: 'Weight is a SEPARATE axis from role, unlike the retired `Typography` which baked weight into the variant name. `TEXT_ROLE_WEIGHTS` says which weights each role actually publishes.',
  },

  /**
   * No Figma component set — the axis is the repo's own registry of names, seeded from
   * what call sites already render.
   */
  Icon: {
    category: 'Foundations',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /** Optional conveniences for new code. Neither is required: every existing call site sizes and colours through `className`. */
      size: ['xs', 'sm', 'md', 'lg', 'xl'],
      color: TEXT_COLORS,
    },
    pendingAxes: ['name'],
    note: '`name` is enumerated by the registry in `primitives/Icon/registry.ts`, not here — the contract would have to be edited on every glyph added, and the registry is already the single list. Listed as pending so its absence does not read as "Icon has no name axis".',
  },

  /**
   * No Figma component set — Ensyra publishes no dialog, so the vocabulary below is read
   * off what this repo's most-used overlay already does rather than off a design.
   *
   * The `size` values are `Modal.tsx`'s `maxWidth` ladder, spelled out the way every other
   * entry here spells a scale. All four steps are live across its eight call sites, which
   * is the evidence for a four-value axis; the abbreviations are not the vocabulary and the
   * migrating call sites remap in the M4 follow-up.
   *
   * `centered` is a BOOLEAN, not a presentation axis. Placement is a prop rather than an
   * axis for the same reason Tooltip refused Figma's Arrow axis — see its divergence — and
   * a sheet-versus-centred enum would make the flag's second meaning unsayable: `centered`
   * also suppresses drag-to-dismiss and its handle, which is what a confirmation dialog for
   * a destructive action relies on.
   */
  /**
   * The app-shell sidebar, from Ensyra `02 Sidebar/AI` (`706:854`) and `Menus` (`772:846`).
   *
   * NO `family`. `Button`, `Text`, `Icon` and `Label` already answer the family question with
   * silence, and this component is a shell frame rather than a member of any of the four
   * pairs. Its own guards — `sidebar.stories.test.tsx` and `sidebar.purge.test.ts` — are the
   * coverage that buys, and they are not optional: a family guard reconciles only against the
   * entries that claim its family, so an unfamilied component is invisible to all four.
   */
  Sidebar: {
    category: 'Shell',
    status: 'implemented',
    native: {
      state: 'absent',
      reason:
        'A PORT WOULD BE A DIFFERENT COMPONENT, not a mirror, which is why this is a decision rather than a queue position. The web component is a rail PLUS a drawer PLUS slots; native has no rail, and the drawer half already exists on the Teman AI surface doing the part the web one had to be taught — translate off-screen, `pointerEvents` none, hidden from the accessibility tree while closed. Building a mirror would ship a rail nothing renders.',
    },
    axes: {
      /** Figma `Satate` on the `Menus` set, spelled correctly — see the divergence. */
      state: ['menu', 'submenu'],
    },
    booleans: ['collapsed', 'open', 'active', 'expanded', 'nested'],
    divergences: [
      {
        figma: '`State: Non Login | Login | Login - Learn | Login-Chat`',
        ours: 'no such axis — whether a viewer is signed in is the caller\'s boolean, and which surface is mounted is the caller\'s slot content',
        reason:
          'The published axis mixes two independent facts: an authentication state, and which product surface the sidebar is framing. As one enum they multiply rather than compose, so "signed in, on the learning surface" and "signed out, on the learning surface" cannot both be said, and the component would have to know what a learning surface is. Split rather than carried, so the shell stays chrome.',
      },
      {
        figma: '`Satate: Menu | SubMenu` on the `Menus` set',
        ours: '`state: menu | submenu`',
        reason:
          'The published name is a typo rather than a word. Carrying it would spell a misspelling into every call site in the repo permanently, and correcting it later would be a breaking rename of a prop nobody chose. Recorded here instead so the correction is visibly deliberate and nobody restores it on their next read of the design file.',
      },
      {
        figma: '`Size: Small | Large` on the sidebar set',
        ours: 'a `collapsed` boolean',
        reason:
          'A two-value axis whose values mean "yes" and "no" is a boolean wearing an enum. Callers already hold this state as a boolean, it toggles rather than being selected from a list, and as a boolean it composes with every other prop instead of multiplying against them. Same reasoning that made `Button.disabled` a boolean rather than a `Colors` value.',
      },
      {
        figma: '`Show Dropdown` and `Icon Dropdown` as separate properties from the state',
        ours: 'the disclosure is shown exactly when `state` is `submenu`; `disclosure` only replaces the glyph',
        reason:
          'The set says one fact twice. Kept as two independent props, a caller can build a row that owns a submenu and shows no way to open it, or a row that discloses nothing — both representable, both wrong, and neither catchable at compile time.',
      },
      {
        figma: 'no breakpoint is published, and the surface this shape was read off switches at the large one',
        ours: 'the rail and the drawer cross over at the medium breakpoint, matching every other responsive decision in this package',
        reason:
          'Recorded rather than adopted silently, because either choice looks like a copy of something. One breakpoint across the package beats matching one app: a shell whose frame and whose dialogs change at different widths has a band where they disagree, and no test in this package can see a layout band.',
      },
    ],
    note:
      'ONE ENTRY, TWO EXPORTS. `Sidebar` and its row `SidebarMenuItem` ship from the same module and are contracted together here, because the row has no meaning outside the shell and a second entry would split the `Menus` set\'s divergences away from the set they belong to: `state`, `active`, `expanded` and `nested` are the ROW\'s, while `collapsed` and `open` are the shell\'s. Every other entry in this file covers exactly one export, so this is the exception and it is stated rather than left to read as a name/prop mismatch. The session-row shape has NO published source — Ensyra publishes no chat-session row, so it was derived from the app\'s own `SessionItem`, the same way `Select` was in UMK-961. `01 Sidebar/Profile` (`521:910`) WAS read and deliberately rejected: it is the dashboard\'s sidebar and its only axis names which page is showing, which is the caller\'s routing rather than a structural variant — do not re-open it. Sign-out is not a prop at all: the surface this comes from signs out with a hard navigation for a reason that a callback would silently let a caller break, so the footer slot takes the caller\'s control instead.',
  },

  /**
   * The app-shell header, from Ensyra `Navbar` (`469:1048`).
   *
   * NO `family`, the same answer `Button`, `Text`, `Icon`, `Label` and `Sidebar` give. Its own
   * guards — `header.stories.test.tsx` and `header.purge.test.ts` — are the coverage that
   * buys, and they are not optional: a family guard reconciles only against the entries that
   * claim its family, so an unfamilied component is invisible to all four.
   */
  Header: {
    category: 'Shell',
    status: 'implemented',
    native: {
      state: 'absent',
      reason:
        'A PORT WOULD BE A DIFFERENT COMPONENT. It mirrors Ensyra\'s published `Navbar` whole — seven `type` values, of which one has a consumer — and its mobile/desktop split is a `md:` BREAKPOINT rather than a prop. That is exactly the part that does not translate: a native screen has one width and a platform header of its own. Read the entry\'s divergences before starting one.',
    },
    axes: {
      /**
       * All seven published values, mirrored whole rather than trimmed to the one a consumer
       * exists for — see the first divergence for what the axis mixes, and for the rule that
       * turned the published strings into these spellings.
       */
      type: [
        'nonLogin',
        'nonLoginBlack',
        'login',
        'temanAiLearn',
        'temanAiChat',
        'dashboard',
        'detailPage',
      ],
    },
    booleans: ['showBack', 'showTab', 'showTextLeft', 'scrolled'],
    divergences: [
      {
        figma:
          '`Type: Non Login | Non Login_Black | Login | Teman AI -Learn | Teman AI - Chat | Dashboard | Detail Page`',
        ours: 'the same seven values, respelled `nonLogin | nonLoginBlack | login | temanAiLearn | temanAiChat | dashboard | detailPage`',
        reason:
          'Two things recorded rather than repaired. First the SPELLING: the published names separate their words three different ways — a space, an underscore, and a hyphen that appears on both sides of a word and on neither. Carrying that literally would spell an inconsistency into every call site permanently, so the words are taken as published and the separators normalised by one rule: split on space, hyphen and underscore, lowercase each word, join in camelCase, which is how this package already writes a multi-word value. Second the AXIS ITSELF: these seven conflate three independent facts — whether a viewer is signed in, which product surface the bar is framing, and what kind of page it is. As one enum they multiply rather than compose, so "signed in, on a detail page" cannot be said at all. It is mirrored whole anyway, deliberately, because a library that half-adopts a published axis diverges from the file it is meant to mirror; the conflation is recorded here so design can split the axis and the library can follow, and it is NOT fixed unilaterally.',
      },
      {
        figma: '`Size: Mobile | Desktop`',
        ours: 'no such prop — one component that reflows at the package breakpoint',
        reason:
          'The two published sizes are the same bar at two widths, not two components: the height, the inset and the title step, and nothing else changes. Exposed as a prop it would have to be set by hand from a viewport measurement the caller does not have at render time, and a bar told it is the small one on a wide screen is a bug nothing can catch. As a breakpoint it is always right. Recorded rather than adopted silently because the published set does say Size, and the next reader should be able to tell this was a decision. `01 Chat Bar` was expected to get the same treatment and DOES NOT — see its own first divergence, which compares the two: its published pair differs in nine measurements rather than three, so it is two drawings and takes a real prop. Two published Size axes, two answers, both stated.',
      },
    ],
    note:
      'THE ONE REAL CONSUMER IS `temanAiChat`. `AIPageHeader` has exactly one call site, the TemanAI chat popup, and that is the value it corresponds to — named here so the first migration is a mapping rather than a guess. Its scroll state, its single back affordance and its one actions slot are all present in this entry; nothing else about it is. The other six values ship with no consumer at all, which is an accepted cost of mirroring the published set whole rather than evidence that they are wanted. The back affordance takes a caller-supplied element or render function because this package may not import a router or a link library, the same constraint `Menu.linkComponent` answers; the scroll state is presentation only, and the caller owns the listener.',
  },

  /**
   * The app-shell frame. NO published Figma set, and no code axis either — see the note.
   *
   * NO `family`, the same answer `Button`, `Text`, `Icon`, `Label`, `Sidebar` and `Header`
   * give. Its own guards — `layouts.stories.test.tsx` and `layouts.purge.test.ts` — are the
   * coverage that buys, and they are not optional: a family guard reconciles only against the
   * entries that claim its family, so an unfamilied component is invisible to all four.
   */
  AppShell: {
    category: 'Shell',
    status: 'implemented',
    native: {
      state: 'absent',
      reason:
        'ALMOST EVERYTHING IT OWNS IS A BROWSER PROBLEM. The dynamic viewport height exists because mobile browser chrome hides the bottom of a full-height page (UMK-653); a native screen has no such chrome and safe-area insets are a different mechanism. The overflow chain is a flexbox-in-a-page concern, and native\'s scroll view already owns its scrolling. The capture-phase scroll spy has no equivalent at all — native scroll events go to the scroll view\'s own handler, so a native shell would take a callback rather than listen from above. What would survive is the slot arrangement and the route-keyed reset, which is the smaller half; Expo Router\'s layout routes are the native frame and a library shell would compete with them.',
    },
    axes: {},
    pendingAxes: ['breakpoint'],
    booleans: ['scrolled'],
    note:
      'THE SAME HONEST-EMPTINESS CASE `Menu` IS. There is no published set for an app frame, so there are no unread values waiting in a file, and the code offers no evidence for an axis either: the frame renders one way and varies only by viewport. `axes: {}` is spelled explicitly because the property is required, not because the emptiness is incidental — inventing a multi-value axis to satisfy the structural guard is exactly the fabrication this file exists to prevent. What IS pending is the crossover width at which the in-flow navigation column gives way to the drawer: it is fixed at the package breakpoint today, matching `Sidebar`, whose entry records that choice as a divergence — this frame follows it rather than recording it twice. If a shell set is ever published and varies that crossover, this is the axis it becomes. The scroll flag is presentation state the frame OWNS rather than takes: it listens in the capture phase because the scroller belongs to the caller content and a scroll event does not bubble, it skips targets with nothing to scroll vertically, and it is cleared by a caller-supplied route key rather than inferred. `routeKey`, `onScrolledChange` and the four slots are plumbing rather than variants and are deliberately absent from the axes above. Reachable from the package root as well as from the `layouts` subpath; the reasoning is in `layouts/index.ts`.',
  },

  /**
   * The full-bleed image viewer.
   *
   * NO `family`, the same answer `Button`, `Text`, `Icon`, `Label`, `Sidebar`, `Header` and
   * `AppShell` give — and deliberately NOT the overlays family, which is the pair of Radix
   * surfaces that share one class table. Its own guards, `lightbox.stories.test.tsx` and
   * `lightbox.purge.test.ts`, are the coverage that buys, and they are not optional: a family
   * guard reconciles only against the entries that claim its family.
   */
  Lightbox: {
    category: 'Overlays',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['scrim'],
      missingProps: ['media', 'actions', 'linkAs'],
      reason:
        'The web viewer gained the gallery treatment in UMK-1690 (Figma 15055:57360): a `light` scrim with a round close, a `media` slot for a player the app owns, and a labelled action bar whose links render through `linkAs`. The native viewer still draws the dense scrim, an image only, and the two icon callbacks; the native gallery (UMK-1699) is where it gains them, so the gap is recorded rather than closed here.',
      owner: 'UMK-1699',
    },
    axes: {
      /**
       * The backdrop (UMK-1690). `default` is the dense one the chat surfaces use, the image's own background;
       * `light` is the viewer opened over a light page (the gallery), and it brings the round close with it.
       */
      scrim: ['default', 'light'],
    },
    booleans: [],
    note:
      'No published set exists for an image viewer, and the surface is full-bleed at every width. The one axis is the backdrop density (UMK-1690): `default`, chosen so the surface reads as the image\'s background rather than as a dimming of what is behind, and `light` for a viewer opened over a light page (Figma 15055:57360, the gallery), which also brings the round close. It composes the Radix dialog DIRECTLY rather than widening `Dialog`, whose presentation is fixed by decision and whose modality claim is hardcoded because it has no non-modal form; bending either to serve this component would reverse both. It is modal, so the scroll lock, the focus trap, the background inertness and the modality announcement travel together and its guard reads those side effects rather than the attribute. The image is rendered by a plain element rather than through `Image`, whose refusal to render a src that is not remote-https is an SSRF control that is correct there and would blank every base64 preview here — the guard pins that case. No zoom, no pan, no gallery and no drag gesture: the component this replaces has none, and drag-to-dismiss stays module-private inside `Dialog`. The two affordances are callbacks rather than variants — supply one and its control appears — and are deliberately absent from the axes above; so are the UMK-1690 props, `media` (a body in place of the image), `actions` (a labelled bar, absent unless supplied) and `linkAs` (the element an action with an `href` renders through, so this package never imports `next`).',
  },

  /**
   * THE CHAT COMPOSER FAMILY, from Ensyra `01 Chat Bar` (`812:489`) and `02 Tools` (`813:185`).
   *
   * Eight entries share `family: 'composer'`, so ONE guard pair —
   * `packages/ui/src/primitives/composer.stories.test.tsx` and `composer.purge.test.ts` —
   * reconciles against all of them, the way the other four families work. They were briefly two
   * unfamilied entries (`ChatBar`, `Tools`) with two allowlist rows; splitting the shell into its
   * parts would have meant seven rows naming seven pairs, which is the situation `family` exists
   * to avoid.
   */
  ChatComposer: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    /**
     * ONE AXIS, AND IT IS THE TRAY'S. Figma's `State: Default | Image | File` describes the bar
     * WITH AN ATTACHMENT IN IT; with the drawer moved outside the bordered box, that axis belongs
     * to `ChatAttachment.variant`. The `Type: Desktop | Mobile` axis was collapsed earlier for its
     * own recorded reason. What is left is `tone`, which the published set does not draw at all —
     * it is read off the reference surfaces this was rebuilt against, where the panel behind the
     * editor carries the message's colour.
     *
     * `density` is pending rather than absent: the published set really does draw two spacings and
     * this ships the compact one at every width, so if the hero surface ever wants the roomier one
     * that is the axis it becomes, with values already read out of the file. The V2 hero's
     * Desktop radius and padding from `md` (UMK-1755) ride on `heroEdge` (with `raised`) instead and are not that axis:
     * the docked composer still wants the compact spacing at every width.
     */
    axes: {
      /**
       * The tray's tint, effective only once a `header` or `footer` is filled. Same four values as
       * `ChatDrawer.variant`'s opaque set, on the same published `callout` group, so the two never
       * need translating between each other.
       */
      tone: ['neutral', 'info', 'warning', 'danger'],
    },
    pendingAxes: ['density'],
    booleans: [],
    divergences: [
      {
        figma: '`Type: Desktop | Mobile`, the same shape `Navbar` publishes as `Size`',
        ours: 'NO such axis — one presentation, on the published MOBILE values, bar the V2 hero’s Desktop radius and padding from `md` (`heroEdge`)',
        reason:
          'A product decision, and it reverses an earlier one recorded here: this briefly shipped the pair as a real `variant` prop on the grounds that nine measurements differ. The surface does not want two drawings — it wants one composer at every width, with the compact spacing. Collapsing them also removes the prop nobody could set correctly without knowing the viewport, and puts this entry back in agreement with `Header`, which reaches the same single-presentation answer from the same published pair. The published WIDTHS (760 and 328) go with the axis rather than surviving it: those are artboard measurements, and the component is full-width in every surface that renders it. One exception, by the author’s decision on UMK-1755: the V2 hero (`raised` with `heroEdge`, set where `temanai-web-beranda-v2` is on) is the page’s subject, so from `md` it takes the published Desktop radius (24) and padding (20 by 32). It is not the axis coming back: no prop names a width, the docked composer keeps the compact values at every width, and the composer purge guard allows exactly those three responsive classes in the hero’s table.',
      },
      {
        figma: 'ONE component named `01 Chat Bar`',
        ours: '`ChatComposer`, composed of `ChatComposerInput`, `ChatDrawer` and four named buttons — each usable on its own',
        reason:
          'The published set is one artboard because a design file has no other way to draw a composer. In code the parts have genuinely different lifetimes and consumers: a surface with an unusual toolbar builds its own arrangement from the same buttons rather than growing this component a prop per variation, and the editor and drawer are independently useful. The shell still owns the frame and the arrangement, so adopting `ChatComposer` whole remains the default path.',
      },
      {
        figma: 'the "Tingkatkan Gambar" quick-action pill, still published in the bar',
        ours: 'no such element — the app deleted it from both layouts and moved it into the tools menu',
        reason:
          'A deliberate REMOVAL, not an omission, and recorded so nobody reinstates it from the design file. The pill and the menu row were two routes to one panel; the code kept the row and left an in-code note saying the pill was gone. Rebuilding it here would restore a duplicate entry point a shipped ticket had already closed.',
      },
      {
        figma: 'no focus or active state is published for the bar at all',
        ours: 'a focus treatment on the shared BRAND focus pair, plus a shadow that lifts on focus',
        reason:
          'The set draws one resting bar. The surface has both an elevation and a visible active border, and a composer with neither reads as a block of the page rather than as somewhere to type. SETTLED: the colour is BRAND, not the teal the app\'s docked layout currently draws — Figma will publish it as `border.focus.brand`, and the hero layout already hardcodes that same value as a hex. The tokens are `border.focus.brand` (published) and `focus.halo` (overlay); UMK-872\'s rename landed in UMK-978, and `focus-ring-classes.ts` staying the single file that names them is what kept it a one-line change. Nothing to re-decide here — the teal is the thing that moves at adoption.',
      },
      {
        figma: 'no send-enablement rule is expressed at all',
        ours: 'a `sendDisabled` boolean the caller owns',
        reason:
          'The rule the app applies — enabled once there is an attachment or at least two characters, and blocked while a photo compresses or an upload is in flight — is product logic about uploads and quotas that this component cannot see and must not learn. Exposed as one boolean so the shell can draw the state without owning the decision, which is the same split every slot here makes.',
      },
      {
        figma: 'three boolean properties — `Show Tools`, `Show Mic`, `Show Size`',
        ours: 'four — `showTools`, `showAttachment`, `showVoice`, `showSize`',
        reason:
          'Figma\'s `Show Tools` gates the paperclip, which is `showAttachment` here; `showTools` gates the `+` menu the published set does not model at all (see `ChatToolsButton`). Renaming rather than reusing the published word is what keeps the two buttons distinguishable at a call site. Recorded also because the plan for this work said "four published booleans" and the file publishes three — a reader reconciling the two would otherwise go looking for a fourth.',
      },
    ],
    note:
      'SHIPS UNCONSUMED, AND ADOPTION IS A VISUAL CHANGE. Nothing in `apps/` imports it — M4 (UMK-878) owns the call sites. Its geometry is Figma\'s and the app\'s composer chrome has NO responsive sizing at all, so the swap will move sizes rather than being like-for-like. THE SLOT BOUNDARY is the rest of the entry: a 45-row parity audit found 24 things the code has that the design does not publish, and every one — the slash menu, the ratio chip, the voice bar, the error banner, the file-required card, the fullscreen modal, the capability menus — renders into a named slot rather than becoming logic here. Every colour resolves to an existing token: the `composer.*` surface and border pair, the success surface for the file badge, the error and brand surfaces for the active controls, and the shared field focus ring. No Ensyra dependency and no blocker on UMK-901.',
  },

  /**
   * The composer's text editor. No published entry of its own — it is the text layer of
   * `01 Chat Bar`, extracted because it carries real behaviour the shell should not own.
   */
  ChatComposerInput: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    /**
     * NO AXES TODAY, and one genuinely pending — the distinction `Lightbox` spells out at length.
     * The editor briefly carried the shell's Desktop/Mobile pair for its type ramp; with that axis
     * collapsed it renders one way, so an axis here would be invented rather than read, which is
     * the fabrication this file exists to prevent.
     *
     * `size` is PENDING rather than absent, and that is not a hedge: `01 Chat Bar` really does
     * publish two type ramps (16/24 and 14/20) and this ships the smaller one at every width. If a
     * surface ever wants the larger — the landing composer is the candidate, being the widest of
     * the four — the ramp becomes an axis with values already read out of the file. Saying nothing
     * would claim the editor has no such dimension, which is a different and wrong claim.
     */
    axes: {},
    pendingAxes: ['size'],
    booleans: [],
    divergences: [
      {
        figma: 'a TEXT layer inside `01 Chat Bar`, with a `Text` property for its placeholder',
        ours: 'a component, with a placeholder SLOT alongside the text property',
        reason:
          'A string cannot express the landing composer\'s rotating, animated placeholder, and a host forced to choose between the property and its own animation would reimplement the editor to keep it. The text property stays as the fallback and is what most callers use.',
      },
    ],
    note:
      'A `<textarea>`, never a `contentEditable`: the element it replaces accepted no `inputMode`, no `enterKeyHint`, no `autoCapitalize`, no `spellCheck` and no accessible name — not by oversight but because a `div` cannot carry them. It AUTOGROWS, which is why it is not the library\'s multiline field (that takes a fixed row count). The autogrow is a measured effect rather than CSS because `field-sizing` is not yet supported widely enough; happy-dom has no layout engine, so the guard asserts the mechanism exists rather than a resulting height — this component shipped once claiming to grow with nothing but `rows={1}` behind it, and nothing in the suite could see it. The four editor events are pass-throughs and are NOT optional extras: every surface this serves needs all four, so a shell without them could not be adopted anywhere.',
  },

  /**
   * The region above the editor. A CONTAINER — see the divergence for what it is not.
   */
  ChatDrawer: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /**
       * The semantic treatment the drawer paints for ITSELF. NOT invented here — the four opaque
       * values are `Alert`'s, and the classes behind them are the published `callout` token group,
       * which is named for exactly this shape. `danger` rather than `error` for the same reason
       * `Alert` says it: Figma's word won. `neutral` is the drawer's own addition, because holding
       * attachments is not a message about anything and takes the plain secondary surface.
       *
       * `inherit` IS THE DEFAULT and paints nothing. Inside a composer the tray behind the drawer
       * already carries the tint (`ChatComposer.tone`), so a self-painting drawer stacked a second
       * panel on the first — two containers with the page showing between them, where the
       * reference surfaces draw one. The opaque values remain for a drawer used outside a
       * composer, which has no tray to inherit from.
       */
      variant: ['inherit', 'neutral', 'info', 'warning', 'danger', 'floating'],
    },
    booleans: ['collapsed'],
    divergences: [
      {
        figma: '`01 Chat Bar` draws attachments directly inside the bar, with no container of their own',
        ours: 'a `ChatDrawer` that holds arbitrary children, and a separate `ChatAttachment` for each item',
        reason:
          'This component briefly WAS the attachment list — it took an `attachments` array, chose their treatment and rendered their chips — which made its name a lie: a drawer is the thing that holds, not the things held. Splitting them gives the chip a life outside a composer (a sent-message card and a file-picker list want the same chip) and gives the region a use beyond attachments (suggestion chips, a reply-to preview, a recording waveform). The published set has no opinion here because it draws one bar with one attachment in it.',
      },
      {
        figma: 'no handle, no collapse, no dismiss — the set draws one static bar',
        ours: 'a toggle that draws a hairline when open and a caller-supplied SUMMARY when shut, plus a dismiss control gated on its callback',
        reason:
          'A drawer that cannot collapse is a container with a decorative bar on it. Collapse is CONTROLLED and collapsible only when both `collapsed` and `onCollapsedChange` are supplied — the shape `Menu` uses, which never owned its own open state either — so a host that wants "collapse once four files are attached" can drive it and one that does not gets no toggle at all. An earlier draft had a `showHandle` boolean drawing a decorative handle on a drawer that could not collapse: a control that looks operable and does nothing, which is why the handle now appears exactly when it works. Dismiss follows `Lightbox`\'s rule — supply the callback and the control appears — because it is right for a warning and wrong for a drawer holding a file the user still needs. The COLLAPSED FACE is the other half: a shut drawer showing only a hairline says nothing about what it is holding, so `collapsedSummary` renders inside the same toggle in the line\'s place. Its content is the host\'s for the reason the buttons\' labels are — "4 Attachments" is copy about a specific kind of content, and a container that takes arbitrary children cannot know whether it holds files, chips or a waveform.',
      },
      {
        figma: 'attachments are drawn INSIDE the bar',
        ours: 'the drawer sits outside the bordered box, in the composer\'s `header` or `footer`, inside a shared TRAY',
        reason:
          'Not arrangement taste: the bordered box carries `focus-within` styling, so a drawer inside it made typing in the editor draw the focus band around the attachments too — a focus indicator claiming a region the focus was not in. Moving it out fixes that. What it moves INTO is the second half of the decision: the drawer first shipped as its own bordered panel floating above a separate bordered bar, two containers with the page showing between them. The reference surfaces draw ONE tinted tray with the white editor box resting inside it, so the fill and the radius moved to the tray (`COMPOSER_TRAY`) and the drawer became a transparent row. That is why its default variant is `inherit` and why the tone prop is on the composer.',
      },
      {
        figma: 'not published',
        ours: '`variant="floating"`: the chat-history sidebar, an inset solid white panel (`surface.default.primary`, the 1px `border.default.primary` card edge; a translucent glass over a blur until UMK-1603) with `shadow.float` over a `surface.default.overlay` scrim, entering from the left on the sheet spring',
        reason:
          'native-ui-v2 identity component (docs/guidelines/mobile-design-identity.md); the web does not follow this identity. Native draws the full presentation (its own modal, the scrim, `open`/`onDismiss`, the motion). The web accepts the value and paints ONLY a fill and hairline on its ordinary drawer row (still `surface.glass.strong` and `border.glass.default` there), because the contract is one vocabulary and an axis value one platform rejects is the gap `native-parity.test.ts` exists to stop; nothing on the web renders it. On native, since UMK-1603 (UMK-1516 D1, "white solid surfaces as in Figma, no glass"), the panel is the bordered white card the other cards in the app are: a solid `surface.default.primary` fill, no blur, and the one 1px `border.default.primary` edge.',
      },
    ],
    note:
      'RENDERS NOTHING WHEN EMPTY rather than an empty box: the composer\'s resting state is a bar with no drawer at all, so an always-present container would add a gap on the surface\'s most common state — and a caller would otherwise have to mount it conditionally, which is the job this does.',
  },

  /**
   * ONE attachment. `01 Chat Bar`'s `State=Image` and `State=File` treatments, extracted.
   */
  ChatAttachment: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /** Which published treatment this attachment takes. Figma's `State`, minus its empty value. */
      /** `tile` is the square boxed non-image treatment the app's picker draws: a file icon over its extension. Ours; no Figma. */
      variant: ['image', 'file', 'tile'],
      /** The image box: the published 80px, or the 96px `large` the app's picker has always drawn. Ours; no Figma. */
      size: ['default', 'large'],
    },
    booleans: ['showSize'],
    divergences: [
      {
        figma: 'the file chip is the only non-image treatment',
        ours: 'a square boxed `tile` (file icon over the extension) beside the chip, the one the app\'s picker draws',
        reason: 'Owner decision, UMK-1373: the picker keeps its square 96px tile for documents rather than taking the chip. The chip stays for hosts that want it.',
      },
      {
        figma: 'exactly ONE attachment, drawn inside the bar',
        ours: 'a standalone component the drawer renders N times, up to the ten the upload path allows',
        reason:
          'Neither side as published, and deliberately so. The design models a single attachment and the product has always accepted ten; taking the design literally would ship a composer that cannot draw what the app already lets a user do, and taking the code literally would throw away the chip treatment.',
      },
      {
        figma: 'the composer displays no size anywhere in the app today, while the set publishes `Show Size`',
        ours: 'implemented, in the B/KB/MB shape the SENT message card already uses',
        reason:
          "Figma has more here so it is implemented, but the shape was not free to choose: a chip reading 4.8 KB beside a message card reading 4,915 bytes is one file described two ways in two places a user sees seconds apart. `formatFileSize` is shared for that reason. Nothing consumes it yet — it is one of the additions M4 decides on at adoption.",
      },
      {
        figma: 'no upload state is drawn at all',
        ours: 'a `status` prop, plus children placed inside the chip',
        reason:
          'The app\'s upload overlays are `absolute inset-0` children of EACH tile — the dim, the retry panel, the done badge — not a bar over the attachment area. They are positioned against THIS box, so a host cannot place them from outside it. With the chip exported, that content is ordinary children; the shell keeps a callback form only because a host that hands it an `attachments` array has no handle on an individual chip.',
      },
    ],
    note:
      'THE PREVIEW IS A PLAIN ELEMENT, NEVER THE LIBRARY `Image`. That component refuses any source which is not remote https — an SSRF control that is correct there and would blank every local blob and base64 preview here, since a composer\'s previews are all local by definition. It is the trap `Lightbox` already hit, and the guard pins the blob case directly. The FILE treatment is the half the app never built: its type-branching helper has four branches that all return identical grey classes, so the colour hook exists and is inert, and this is the design that was intended.',
  },

  /**
   * The composer's `+` menu trigger. THE ONE BUTTON WITH NO PUBLISHED SOURCE — see its divergence.
   */
  ChatToolsButton: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /** Open or closed. The glyph becomes a minus because the same tap closes the menu. */
      state: ['default', 'active'],
      /** 32px in a chat, 36px on the landing hero, the same two heights as the voice bar it swaps with. Ours; no Figma. */
      size: ['compact', 'landing'],
    },
    booleans: [],
    divergences: [
      {
        figma: '`02 Tools` publishes three types — Mic, Tools, Send — and no `+` menu',
        ours: 'a fourth button the set does not model',
        reason:
          'The app has FOUR composer controls: a `+` that opens image, video and optimize, and a paperclip that opens the file picker. They sit side by side and open different things. Folding the `+` into the paperclip because the design file has only three types would misrepresent the surface; carried here with the divergence recorded so a designer adding it later finds the decision rather than a surprise.',
      },
    ],
    note:
      'Uses `composer-plus`/`composer-minus`, matching the app\'s live `+` control rather than the published `Type=Tools` glyph — which belongs to `ChatAttachmentButton`. `aria-pressed` is emitted because an open menu is genuinely a toggle.',
  },

  /**
   * The attach control — `02 Tools`, `Type=Tools`.
   */
  ChatAttachmentButton: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      state: ['default', 'active'],
      /** 32px in a chat, 36px on the landing hero, the same two heights as the voice bar it swaps with. Ours; no Figma. */
      size: ['compact', 'landing'],
    },
    booleans: [],
    divergences: [
      {
        figma: '`Type=Tools`',
        ours: '`ChatAttachmentButton` — the published word "Tools" names the paperclip',
        reason:
          'The app also has a control it calls tools (the `+` menu), so carrying Figma\'s word would make the two indistinguishable at every call site and put the wrong glyph on whichever one a reader reached for first. The published NAME is the only thing changed; the treatment and both glyphs are as drawn.',
      },
    ],
    note:
      'The active glyph is the published minus at 24px while the idle attach is 20px — a real difference in the set, carried as a per-state glyph size rather than normalised away.',
  },

  /**
   * Voice input — `02 Tools`, `Type=Mic`. The only button that goes red.
   */
  ChatVoiceButton: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      state: ['default', 'active'],
      /** 32px in a chat, 36px on the landing hero, the same two heights as the voice bar it swaps with. Ours; no Figma. */
      size: ['compact', 'landing'],
    },
    booleans: [],
    divergences: [
      {
        figma: 'one `State=Active` treatment read across all three published types',
        ours: 'an active fill that is PER BUTTON — red here, blue on the other three',
        reason:
          'The published set draws it that way already; what is recorded is that it must not be collapsed. Read as one state it looks like a single accent colour, and a later "consolidation" onto one constant compiles, renders, and turns a recording indicator into an arming one. The two facts genuinely differ: red says the microphone is live, blue says the next turn is armed. The guard asserts this button disagrees with the rest.',
      },
      {
        figma: '`State=Default` draws the mic as an outlined white circle',
        ours: 'the same — SETTLED against the app\'s docked layout, which fills it grey',
        reason:
          'The app disagrees with itself here: its docked composer rests the mic on a flat grey while its hero composer rests it outlined, matching the published set. Recorded because "match the app" does not resolve on this button, and the answer chosen is the published one — so the docked layout is what moves at adoption, not this component. A grey fill was available as a token (`surface.secondary` is within 2/255 of the app\'s value) and was not taken.',
      },
    ],
    note:
      'The glyph becomes a pause when active — a variant swap, not a recolour, and the detail an implementation reading only the colours would miss. The accessible name is the caller\'s because only the caller knows whether the next tap starts or stops the recording.',
  },

  /**
   * Send — `02 Tools`, `Type=Send`. The one that is not a toggle.
   */
  ChatSendButton: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /**
       * WHAT THE CONTROL IS, not whether it is pressed. Figma publishes `State=Default | Active`
       * for all three tool types; on send that pairing describes a toggle send does not have, and
       * it left the composer unable to express the state it spends every streaming turn in.
       *
       * `stop` interrupts a reply already in flight — different action, different glyph, different
       * colour. `waiting` is send with uploads not yet finished: nothing wrong, nothing to
       * interrupt, just not yet. Neither is a "pressed send".
       */
      state: ['send', 'stop', 'waiting'],
      /** 32px in a chat, 36px on the landing hero, the same two heights as the voice bar it swaps with. Ours; no Figma. */
      size: ['compact', 'landing'],
    },
    booleans: [],
    divergences: [
      {
        figma: '`State=Default` draws send as an outlined white circle, like the other two types',
        ours: 'send rests FILLED, and its disabled state is a flat neutral rather than a fade',
        reason:
          'On the live surface send is the one control that is always the next thing you want, and drawing it like its neighbours makes the composer\'s primary action indistinguishable from its secondary ones. The disabled treatment follows from that: an opacity fade on a filled blue circle still reads as blue, so a send that cannot be pressed would still look primary — and the composer starts empty, so disabled is the state it spends most of its time in. Both are product decisions against the published set, recorded so neither is "corrected" back.',
      },
      {
        figma: '`State=Default | Active` — a pressed treatment, like the other two types',
        ours: '`state: send | stop | waiting`, and NO `active` boolean at all',
        reason:
          'Send is an action, not a switch, so it emits no `aria-pressed`: announcing `aria-pressed="false"` describes a toggle that can never be toggled, which is worse for a screen-reader user than announcing nothing. The axis replaced the boolean because the boolean could not say the thing that matters. This shipped briefly with `active` documented as "the in-flight look" while drawing the ordinary blue send glyph — so a composer on a surface that STREAMS EVERY REPLY had no way to become a stop button, and the one state a user most needs to see looked identical to every other. `stop` is the error surface, the same fill the recording microphone takes, because both interrupt something already running. `waiting` stays blue and only changes its glyph. The published `Active` has no successor here and is deliberately unimplemented rather than renamed.',
      },
    ],
    note:
      'Availability is the host\'s rule — text length, attachments, uploads in flight — so this takes the ordinary `disabled` and owns none of it. THE LABEL AND THE HANDLER ARE THE HOST\'S TOO, and in `stop` that is load-bearing rather than stylistic: a button drawing a stop square while still announcing "Kirim pesan" and still calling send is worse than one that never changed, so the component owns neither and the state cannot be set without the caller confronting both.',
  },

  /**
   * THE WAVEFORM. Five bars that say a microphone is open.
   *
   * ITS OWN ENTRY RATHER THAN A PART OF THE BAR, because it is the one piece of that bar with a
   * second consumer waiting: a transcript row playing back a recording wants the same five bars,
   * and so does a voice-note preview. Exposed separately it is four lines to reuse; folded into
   * `ChatVoiceBar` it is a copy.
   *
   * IT READS NO AMPLITUDE, and that is settled rather than pending. Neither shipped surface meters
   * anything — the web's five bars run a fixed staggered loop and the native port reproduces it
   * exactly, with a comment saying wiring real metering there would be a DIFFERENCE and not a fix.
   */
  ChatSoundWave: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /**
       * Whether the bars are moving. `idle` is a real drawing and not a disabled one: the bar can
       * be mounted before the microphone opens, and bars frozen at FULL height read as a level
       * meter pinned at maximum, so the resting state is the same 0.3 the keyframe starts from.
       *
       * It is also what reduced motion resolves to, which is why the value had to exist before
       * the animation did — `motion-reduce:animate-none` alone leaves the bars wherever the
       * keyframe happened to stop, the same trap `Skeleton`'s shimmer records.
       */
      state: ['idle', 'listening'],
    },
    booleans: [],
    divergences: [
      {
        figma: 'no published design source — `01 Chat Bar` draws the composer row and stops',
        ours: 'five bars on one keyframe and five delays, scaled rather than resized',
        reason:
          'Recorded against the absence rather than left blank. `scaleY` rather than `height` because the bars sit inside a flex line: animating height reflows the row every frame and remeasures the label beside it. The stagger is five `animation-delay` values rather than five keyframe sets, which is what makes a waveform out of a single rule.',
      },
    ],
    note:
      'THE BAR COUNT IS A PROP, NOT AN AXIS. Five is what both surfaces draw and what the default is; a different count is a quantity rather than a look, and folding it into an enum would make `bars: 7` unsayable while adding nothing a reader could not already see. The bars take their colour from the brand fill and are not themable — a caller who wants a different one is asking for a different component.',
  },

  /**
   * The LISTENING bar: the row the composer shows in place of its icon row while recording.
   *
   * IT REPLACES THE ICON ROW, BELOW THE EDITOR — it does not sit above it. That was the arrangement
   * once and it was moved (UMK-679), and the placement is the whole reason `size` exists: the two
   * rows it can stand in for are 32px and 36px tall, so a bar of one height makes the composer jump
   * the moment recording starts.
   */
  ChatVoiceBar: {
    category: 'Chat',
    family: 'composer',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /**
       * WHICH ROW THIS IS STANDING IN FOR, which is why the values are not a general scale. Both
       * are the height of something else — the in-thread composer's icon row and the landing
       * composer's — so `sm`/`md` would be a name with no drawing behind it and would invite a
       * third rung nothing is the height of.
       *
       * `ChatComposerInput` records `size` as PENDING for a different reason; this one is answered.
       */
      size: ['compact', 'landing'],
    },
    booleans: [],
    divergences: [
      {
        figma: 'no published design source — `01 Chat Bar` publishes the microphone, not the listening state',
        ours: 'a greenfield bar: puck and halo, label, waveform, stop',
        reason:
          'Recorded against the absence rather than left blank. The one published piece is the microphone glyph, which comes from the registry (`composer-mic`) rather than being redrawn here — the app inlined that artwork at both call sites and the two copies had already diverged, which is the same drift this entry exists to end.',
      },
      {
        // ds-raw-ok: Figma/doc description prose naming a hex, never painted
        figma: 'nothing published; the live surfaces paint `#F2F8FE`, `rgba(0,116,231,0.2)` and `#E5202E`',
        ours: 'the `Surface/weak/brand` fill, the brand border at 20%, and the `Surface/default/error` stop',
        reason:
          // ds-raw-ok: Figma/doc description prose naming a hex, never painted
          'THREE OF THE FOUR HUES MOVE AT ADOPTION, stated here rather than discovered in a browser. The fill goes `#F2F8FE` → `#F0F7FF`, the stop `#E5202E` → `#E70000`; the halo and the border are the brand blue at 20% and are unchanged, since `#0074E7` IS the brand token. A literal colour is not sayable in this package — the family purge guard bans a hex and a raw palette step alike — so the choice was a token or a new token, and nothing about a listening bar argues for a colour the system does not publish. Native spelled these four in `apps/mobile/src/temanai/palette.ts` under a recorded delta (UMK-878) until UMK-1317 deleted that file, which is where the same question was answered the other way and for the other reason.',
      },
    ],
    note:
      'THE STOP CONTROL\'S LABEL IS THE CALLER\'S, and on this one that is not boilerplate: the button draws a PAUSE glyph on the error fill because the recording halts rather than being discarded, and a component that announced "Berhenti" over a pause shape would be describing a different outcome to a screen-reader user than to a sighted one. The bar announces itself politely — a row that appears mid-composition and is not focusable has no other way to be noticed — and owns no microphone, no permission prompt and no transcript: it is told it is listening.',
  },

  /**
   * ONE message row. THE TRANSCRIPT HALF of the `Chat` category, and the first entry of the
   * second family in it.
   *
   * NO PUBLISHED SOURCE. Ensyra publishes no message, bubble or transcript set at all — the chat
   * canvas holds the composer and nothing above it, and no message component set exists anywhere
   * in the file. So every axis here is greenfield and the divergence below is recorded against
   * that absence rather than against a node, the way `Dialog`, `Menu` and `ChatToolsButton`
   * already are.
   *
   * IT TAKES NO MESSAGE OBJECT, WHICH IS THE WHOLE DESIGN. Three surfaces carry three
   * incompatible message shapes, and a component that took any one of them would serve one
   * surface and be unadoptable on the other two. This owns the chrome and the slots; the content
   * is children.
   */
  ChatMessage: {
    category: 'Chat',
    family: 'message',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /**
       * Whose turn this is. It decides which edge the turn is aligned against, the bubble fill,
       * and which edge a grouped run tucks toward.
       *
       * `system` is not a third speaker: it suppresses the avatar, the name and the metadata and
       * centres the content, because a notice pinned to the assistant edge reads as something the
       * assistant said.
       */
      sender: ['assistant', 'user', 'system'],
      /**
       * How much room the row takes. Three values because three is what the padding and radius
       * tables actually distinguish; a fourth would be a name with no drawing behind it.
       *
       * It flows to the bubble and the metadata through context rather than being repeated as a
       * prop on each, so a transcript sets it once on the list.
       */
      density: ['compact', 'balanced', 'spacious'],
    },
    booleans: [],
    divergences: [
      {
        figma: 'no published design source — no message, bubble or transcript set exists in the file',
        ours: 'a greenfield row with a sender axis, a density axis, and three slots',
        reason:
          'Recorded as a divergence rather than left blank because an absent source reads as "nobody checked". The prop shapes are read off a studied external reference implementation so the two APIs stay interchangeable, and every value is mapped onto this repo\'s own token ladder — the reference\'s numeric spacing scale is deliberately not carried, because a foreign ladder beside the named one would contradict the vocabulary the rest of this package reads.',
      },
      {
        figma: 'nothing published about grouping, avatars or metadata placement',
        ours: 'an avatar and a name in one header above the turn, a metadata slot below it, and no message object anywhere in the API',
        reason:
          'The three surfaces this has to serve carry three incompatible message shapes — the package contract, the agent store and the mobile client each name a different one — so a component taking any of them would be adoptable on exactly one surface. Owning chrome and slots is the only shape that serves all three, and it is the boundary the composer family already took: its shell records 24 things the app has that the component does not own.',
      },
    ],
    note:
      'SHIPS UNCONSUMED. Nothing in the app imports it — adoption at the call sites is UMK-878\'s, and it is where the four disagreeing scroll implementations get reconciled. The speaker is a header above the turn rather than a face beside it, because that is what both shipped surfaces draw and neither gives the user a face at all; a row beside the content was the first shape here and it was a layout nothing could adopt. The user-side flip is the column alignment rather than a reordered child list, so the accessibility order is identical on both sides of the transcript; asserting that is what the family behaviour guard exists for. It carries a stable marker attribute the scroll machinery finds the last message by — remove it and the pill and the new-message flag go quietly dead, which is why the attribute is asserted rather than merely written.',
  },

  /**
   * The visible bubble. A FRAGMENT, not a wrapper — see the note.
   */
  ChatMessageBubble: {
    category: 'Chat',
    family: 'message',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /**
       * Where this bubble sits in a run of consecutive bubbles from one sender. `none` is the
       * standalone case and keeps all four corners.
       *
       * The tightened corners are LOGICAL rather than physical, so a right-to-left reader gets
       * the tuck on the side the message is actually on.
       */
      group: ['none', 'first', 'middle', 'last'],
      /**
       * Escapes the default width cap. `auto` is the cap — what keeps a one-line reply from
       * spanning a desktop column — and `full` is the override a media grid needs to span the
       * message column.
       *
       * The override clears the cap in the same entry. Setting a width alone leaves the cap
       * winning, which looks like the prop doing nothing on a wide viewport and working on a
       * narrow one.
       */
      width: ['auto', 'full'],
    },
    booleans: ['ghost'],
    divergences: [
      {
        figma: 'no published design source — see `ChatMessage`',
        ours: 'a greenfield bubble with a grouping axis, a width override and a ghost presentation',
        reason:
          'Greenfield for the same reason the row is, and recorded rather than left blank so an absent source does not read as an unchecked one. The filled surface is the published callout surface, which is the exact colour the app bubble hardcodes today — so the value is not invented even though the component is.',
      },
      {
        figma: 'nothing published about non-text content inside a message',
        ours: 'a ghost presentation that keeps the inline padding and zeroes the block padding',
        reason:
          'This is the placement contract for artifacts, and it is a padding rule rather than a component. A generated image, a video or an attachment renders as children; a raw child sits flush with the message edge, and wrapping it in a ghost bubble gives it the bubble inline padding so its leading edge matches the text column above it. Existing primitives supply the content — the attachment chip this package already publishes is hand-copied in both apps — so no media grid, player or generated-image component is needed for the arrangement to work.',
      },
    ],
    note:
      'IT RETURNS A FRAGMENT. The name and metadata slots are SIBLINGS of the bubble inside the row content column flex, each pulling back most of the column gap with a negative margin — wrap the three in a box and every grouped run gains a gap it did not ask for at each end. It reads its sender from the row it sits in and defaults to the assistant side when it stands alone, which is why `sender` is the row entry\'s axis and not restated here: the bubble never accepts one. The image primitive refuses any source that is not remote https, and generated images arrive as data, cache and presigned URLs, so those pass a plain element — the same carve-out the chat prose already records for composer previews.',
  },

  /**
   * The metadata row under a message — a timestamp, whatever the host wants beside it, and a
   * delivery status.
   *
   * IT RENDERS NOTHING WHEN GIVEN NOTHING, which is a real branch rather than a nicety: callers
   * render it unconditionally under every row and most rows have nothing to say. An always-present
   * empty row would add a gap to the transcript's commonest state.
   */
  ChatMessageMetadata: {
    category: 'Chat',
    family: 'message',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /**
       * Where the message got to. Five values, and only two of them draw anything of their own —
       * `sending` moves, `error` changes colour, and the three settled states stay on the row's
       * quiet tone because a delivered message is not news.
       *
       * DECLARED AS AN AXIS RATHER THAN EXCLUDED AS A LIFECYCLE. `ChatSendButton.state` is the
       * precedent: a state that changes what is drawn is a look, not progress. The composer
       * attachment's upload lifecycle went the other way and is recorded as a non-variant union,
       * because nothing about it is a treatment.
       */
      status: ['sending', 'sent', 'delivered', 'read', 'error'],
    },
    booleans: [],
    divergences: [
      {
        figma: 'no published design source — no message, bubble or transcript set exists in the file',
        ours: 'a greenfield row with a status axis and two free-form slots',
        reason:
          'Recorded against the absence rather than left blank, because an absent source reads as "nobody checked". The prop shapes follow a studied external reference so the two APIs stay interchangeable; the values resolve through this repo\'s own tokens.',
      },
      {
        figma: 'nothing published about delivery status at all',
        ours: 'five statuses, of which two share one glyph and differ only by label',
        reason:
          'Delivered and read are the same mark to a reader glancing at a transcript — the distinction is in the words, not the drawing, and giving them different glyphs would invent a visual difference the product has no opinion about. Only `error` takes a colour and only `sending` moves, so a settled row stays a timestamp rather than becoming a traffic light.',
      },
    ],
    note:
      'THE LABEL IS USED THREE WAYS and that composition is the contract: it is the visible word, the hover title, and — lower-cased — the accessible name, so a reader hearing the row hears one sentence rather than a capitalised fragment mid-phrase. THE SEPARATORS ARE COMPUTED from which pieces are actually present, so no dangling dot appears at either end when the host supplies only one of the three. The user-side reversal is the flex direction alone; the authored order stays timestamp, footer, status on both sides of the transcript.',
  },

  /**
   * The transcript's log region — a presentational list of message rows.
   *
   * IT OWNS NO SCROLLER. The frame above it does; this one only announces, spaces and aligns what
   * it holds, and publishes its inner content element so the frame can watch that grow. Two
   * elements, and the split is what keeps content growth a separate measurement from the scroll
   * box's own size.
   */
  ChatMessageList: {
    category: 'Chat',
    family: 'message',
    status: 'implemented',
    native: {
      state: 'partial',
      missingProps: ['children', 'flush'],
      reason:
        'A PERMANENT PLATFORM DIFFERENCE, NOT A QUEUE POSITION. On native the platform list owns scrolling and virtualisation, and a virtualised list renders from `data` through `renderItem` — rows outside the viewport are never mounted, which is the reason to reach for one on a phone. So the sibling takes `data`/`renderItem`/`keyExtractor` where the web list takes its rows as children. Flattening children into data was refused: it builds every row element up front and hands the list a key only React knows. Every axis crosses. THE ARRIVAL SIGNAL IS REPLACED RATHER THAN CARRIED: the web log region reads each arriving row aloud, and native sets no live region, because an Android live region on a scroll container re-reads the whole transcript on every change — once per streamed token. In its place, inside a `ChatThread`, a message that ARRIVES while the reader is scrolled away (the list grew and its last item changed) is announced once with a one-shot platform announcement, queued on iOS ("Ada pesan baru", the frame\'s `newMessageAnnouncement`), and the default pill\'s accessible name becomes "Ke pesan terbaru, ada pesan baru" while its mark is up; `streaming` reaches assistive technology as the busy state. What still does not carry, under the same standing decision: the CONTENT of an arriving row is never read aloud, and nothing is announced to a reader who is following at the bottom. `flush` (UMK-1579) is a web-only opt-in that omits the density padding; native has no list padding to omit.',
      owner: 'UMK-1127',
    },
    axes: {
      /** How much room the rows take. Flows to every row and bubble inside through context. */
      density: ['compact', 'balanced', 'spacious'],
      /**
       * Where a SHORT conversation sits. `bottom` seats it above the composer, which is what a
       * chat surface wants; `top` is for a transcript embedded in a page that reads downward.
       *
       * Once the content overflows the two are identical — the spacer collapses — so this is a
       * decision about the empty and nearly-empty states only.
       */
      align: ['top', 'bottom'],
      /**
       * The gap between rows, overriding the density's own. Our named spacing rungs rather than a
       * numeric ladder: a second, foreign scale would contradict the one the rest of this package
       * reads, in the one place a caller picks a spacing by hand.
       */
      gap: ['none', '2xs', 'xs', 'sm', 'md', 'lg'],
    },
    booleans: ['streaming', 'flush'],
    divergences: [
      {
        figma: 'no published design source — no message, bubble or transcript set exists in the file',
        ours: 'a greenfield log region with a density, an alignment and a gap override',
        reason:
          'Recorded against the absence rather than left blank, because an absent source reads as "nobody checked". The prop shapes follow a studied external reference so the two APIs stay interchangeable; the spacing resolves through this repo\'s own named rungs rather than through that reference\'s numeric ladder.',
      },
      {
        figma: 'nothing published about loading older messages',
        ours: 'an action fired from a sentinel at the top of the content, with a pending row of its own',
        reason:
          'The component holds the in-flight state rather than exposing a re-entrant callback, and that is the whole of the decision: the pending row renders BELOW the sentinel, so showing it pushes content down without un-intersecting the sentinel — the observer can fire again while the first call is still unresolved. Owning the guard here pairs it with the spinner already rendered here and keeps the contract for an adopter to one callback.',
      },
    ],
    note:
      'THE BUSY STATE IS ABSENT RATHER THAN FALSE when nothing is streaming: a region permanently announcing that it is not busy is noise on every settled turn, and a naive boolean binding produces exactly that with nothing failing. IT PUBLISHES ITS INNER CONTENT ELEMENT to the frame around it, which is the seam the scroll machinery attaches to — a list rendered outside a frame simply registers nothing and still works. Its own guard asserts the registration, because a context with a working default is a successful read rather than a blank screen.',
  },

  /**
   * The transcript FRAME — the element that owns the scroller, calls the scroll seam, and pins the
   * return-to-bottom affordance inside itself.
   *
   * NO AXES, AND THAT IS THE HONEST ANSWER RATHER THAN A GAP. It draws one presentation: a scroll
   * box with an absolutely-placed slot at its foot. Every decision a caller makes about how the
   * transcript LOOKS belongs to the list inside it, which is where the density, the alignment and
   * the gap live. `ChatComposerInput` is the precedent for an entry with a real component and no
   * vocabulary of its own.
   */
  ChatThread: {
    category: 'Chat',
    family: 'message',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {},
    /**
     * THE SAME HONEST-EMPTINESS CASE `AppShell` IS, and spelled out for the same reason. There is
     * no published set for a transcript frame, so there are no unread values waiting in a file,
     * and the code offers no evidence for an axis either: it renders one way. `axes: {}` is
     * written explicitly because inventing a multi-value axis to satisfy the structural guard is
     * exactly the fabrication this file exists to prevent.
     *
     * What IS pending is where the return affordance sits inside the frame. It is centred at the
     * foot today; a narrow surface tucking it to the end edge is a real arrangement and this frame
     * is the only component that could decide it, because it owns the slot. If a surface ever
     * wants the other one, this is the axis it becomes.
     */
    pendingAxes: ['pillPlacement'],
    booleans: [],
    divergences: [
      {
        figma: 'no published design source — no message, bubble or transcript set exists in the file',
        ours: 'a greenfield frame that owns the scroller and publishes it to the list inside',
        reason:
          'Recorded against the absence rather than left blank, because an absent source reads as "nobody checked". The seam is ours rather than borrowed: four hand-built scroll implementations exist in this product and no two agree on their thresholds, which is the defect this frame exists to end.',
      },
      {
        figma: 'nothing published about the app frame this sits inside',
        ours: 'a frame that composes in the shell\'s content slot and changes nothing about the shell',
        reason:
          'There is no collision to resolve, which is worth recording because it looks like one. The shell documents its content slot as owning the scroller and pins both minimums on that region precisely so a child can scroll; its scroll spy resolves the region once and tests containment, so it sees this scroller\'s events and keeps feeding the header. A chat surface rendered inside the existing shell works with no change to either.',
      },
    ],
    note:
      'IT PUBLISHES THE SCROLLER AND COLLECTS THE LIST\'S INNER ELEMENT, which is the whole seam — a missing frame is a SUCCESSFUL read of an absent-tolerant context rather than a blank screen, so a list that registered nothing would leave the follow permanently inert with nothing throwing. Its own guard asserts the wiring. THE PILL IS A SLOT with a working default, so a surface can supply its own without this component growing a prop per affordance; the default is rendered only while the reader is away from the bottom.',
  },

  /**
   * The return-to-bottom pill. Presentational: it knows nothing about scrolling.
   */
  ChatScrollButton: {
    category: 'Chat',
    family: 'message',
    status: 'implemented',
    /* Native accepts every axis and boolean, and ADDS two things the web does not need: while
       `hasNewMessages` is set the accessible name gains "ada pesan baru" (the web's log region
       already reads the arrival; native has none — see ChatMessageList's record), and `hitSlop`
       takes the 36pt circle's touch target to 48. */
    native: { state: 'implemented' },
    axes: {
      /**
       * Which of the two geometries the pill draws. A single padded shape leaves the icon-only
       * form a wide lozenge with a glyph floating in it, which is what every hand-built version of
       * this control in the product currently draws.
       *
       * AN AXIS RATHER THAN A BOOLEAN, and the distinction is the one `ChatSendButton.state`
       * settled: a value that changes WHAT IS DRAWN is a look. `label` stays required either way —
       * it is the accessible name, and `icon` decides only whether it is also visible.
       */
      shape: ['icon', 'labelled'],
    },
    booleans: ['hasNewMessages'],
    divergences: [
      {
        figma: 'no published design source — no message, bubble or transcript set exists in the file',
        ours: 'a greenfield pill, circular without a visible label and expanded with one',
        reason:
          'Recorded against the absence rather than left blank. Two shapes rather than one padded shape: a single geometry leaves the icon-only form a wide lozenge with a glyph floating in it, which is the arrangement every hand-built version of this control in the product currently draws.',
      },
      {
        figma: 'nothing published about announcing a message that arrived off-screen',
        ours: 'a textless mark, gated on a boolean the frame owns; a host that wants words passes `shape="labelled"` while it is set',
        reason:
          'A count was the obvious alternative and is refused: a number here would be copy in a language this component does not own, and it would have to be pluralised by a component that holds no messages. The mark says "something arrived" and the reader finds out what by pressing it. Textless also keeps the label-less pill genuinely textless, which is the regression its own guard pins. REVERSED FOR THE WEB CHAT SURFACES (UMK-1373): the product wants the words "Pesan baru" while something waits below, so both surfaces render the labelled shape for as long as `hasNewMessages` is set and the icon otherwise. The component is unchanged and the count is still refused; what changed is that the host, not this mark, supplies the words. Native already has `newMessagesLabel`.',
      },
    ],
    note:
      'THE `label` IS THE ACCESSIBLE NAME AND IS REQUIRED; `shape` decides whether it is also DRAWN. That split is the contract rather than a convenience: an icon-only pill still has to be announceable, and a pill that drew its label unconditionally would clip a translated string inside a 36px circle — which renders, reads as a styling bug, and is what its guard asserts against. The three composer buttons make the same split.',
  },

  /**
   * The per-message LISTEN control, and the first entry in this file that exists because two
   * copies of one component had already drifted.
   *
   * NO PUBLISHED SOURCE, like the rest of the message family. Ensyra draws no transcript at all,
   * so the five drawings below are read off the app's own two implementations rather than off a
   * node — `ai-chat/ChatMessage.tsx` and `ai-chat-agent/AgentMessage.tsx`, which are the same
   * button written twice. The second one's docblock already records that its GLYPHS were
   * de-duplicated into the icon registry (UMK-956) while the button around them was not; this
   * entry is the rest of that job.
   *
   * IT OWNS NO AUDIO. Playback is a fetch, a cache, an `<audio>` element, a speech-synthesis
   * fallback and a rule that only one message speaks at a time — host machinery, none of which a
   * design system may hold. What is contracted is the control: five states, a label, a press.
   */
  ChatMessageTTSButton: {
    category: 'Chat',
    family: 'message',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /**
       * WHERE PLAYBACK HAS GOT TO, which is a look rather than a toggle — the reason this is an
       * axis and not a two-value toggle like the composer buttons' `default | active`. Five values because
       * five drawings exist: idle and paused resume, playing pauses, loading refuses the press,
       * and error says the last attempt did not work.
       *
       * `error` HAS NO COUNTERPART ON EITHER LIVE SURFACE. Both fall back to the idle drawing
       * when playback fails, so a failure is indistinguishable from a control nobody pressed —
       * and the host's state machine has had the value all along. Drawing it is the divergence,
       * not an invention.
       */
      state: ['idle', 'loading', 'playing', 'paused', 'error'],
    },
    booleans: [],
    divergences: [
      {
        figma: 'no published design source — no message, bubble or transcript set exists in the file',
        ours: 'a greenfield control with five states, read off the app\'s own two copies of it',
        reason:
          'Recorded against the absence rather than left blank, the way every other entry in this family is. The prop shape is deliberately host-facing: `state` in, `onToggle` out, and no audio, no cache and no message object anywhere near it — which is what lets the classic surface, the agent surface and the native screen all adopt one control.',
      },
      {
        figma: 'nothing published; the two live surfaces paint teal and orange from Tailwind\'s ramp',
        ours: 'the `success` and `warning` semantic token groups — different hues, same meaning',
        reason:
          // ds-raw-ok: Figma/doc description prose naming a hex, never painted
          'THE HUES GENUINELY CHANGE AT ADOPTION and that is stated here rather than discovered in a browser. the ramp\'s playing hue is `#0D9488` and the `Text/success` token is `#0EA06E`; the paused hue is `#F97316` and `Text/warning` is `#F59E0B`. A raw palette step is not sayable in this package at all — `message.purge.test.ts` bans one precisely so an app\'s untokenised chrome cannot be copied into the library — so the choice was a token or a new one, and nothing about "playback is running" argues for a colour the system does not already publish. Pinning it here matters because no guard can see it: UMK-978 records that every gate in this repo proves a class RESOLVES and none proves it resolves to the right hex.',
      },
    ],
    note:
      'THE LABEL IS THE CALLER\'S, and on this control that is load-bearing rather than stylistic: the same button means "Dengarkan", "Jeda", "Lanjutkan" and "Memproses…" depending on the state it is in, and a component that drew its own word would be announcing the wrong action on four of five states or shipping copy in a language it does not own. The three composer buttons make the same split for the same reason. `loading` is drawn as a spinner rather than a faded speaker — a still glyph reads as a broken icon — and it is the one state that refuses the press, which the host expresses as the ordinary `disabled`.',
  },

  Dialog: {
    category: 'Overlays',
    family: 'overlays',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['size', 'side', 'rounded'],
      missingProps: ['centered', 'fullHeight', 'keyboardAware', 'titleClassName'],
      reason:
        'Native has NO centred dialog, by decision rather than by backlog (UMK-1075): on a phone the native Dialog is always a bottom sheet, so it accepts neither `centered` nor `size`. The size ladder is the web card\'s `maxWidth`, and a sheet spans the screen width by definition, so on native it had nothing to draw and was removed rather than kept as an inert prop. What the web card also buys — no backdrop, no Back, no swipe — is carried on both by the `dismissible` boolean, a locked dialog (UMK-959 gave the web the same prop); `closeDisabled`, a busy close that keeps the X visible but disabled, is web-only. Recorded as partial so the web axis and boolean do not read as shared. This is a decided, STANDING divergence (made in UMK-1075, owner decision 17 Sep 2026) and it is tracked by the standing decision ticket UMK-1076, which stays open while the divergence exists: nothing is queued to close it, and UMK-1076 closes only if the decision is reversed and native regains a centred dialog. `side` (UMK-1186) is the same decision from the other direction: a left or right drawer is a web placement, and native stays a bottom sheet. `fullHeight` (UMK-1497) is web-only for now; native sheet height parity is a separate mobile ticket. On web it is also keyboard-aware (UMK-1499): with the on-screen keyboard open the sheet takes the height and top of the visual viewport instead of `100dvh`; native already lifts its sheet with the keyboard through `react-native-keyboard-controller`. `keyboardAware` (UMK-1499) is a web-only opt-in that lifts a non-full-height sheet above the keyboard and caps it to the visible height (native lifts through `react-native-keyboard-controller`). `rounded` (UMK-1548, `default | lg`: the 24px `ds-2xl` sheet/card radius) is a web-only opt-in axis: the native sheet keeps its fixed radius and has no radius option. `dismissOnOutsidePress` (UMK-1498) is shared on web and native and only stops the backdrop tap: Escape or Back, the close button and the swipe still close. `titleClassName` (UMK-1579) is a web-only class hook that replaces the visible title\'s class string; native draws its own title.',
      owner: 'UMK-1076',
    },
    axes: {
      size: ['small', 'medium', 'large', 'xlarge'],
      /**
       * A drawer from the left or right edge, at EVERY width (UMK-1186). `none` is the
       * default presentation below. Exclusive with `centered` in the prop types: a centred
       * card has no edge to slide from.
       */
      side: ['none', 'left', 'right'],
      /**
       * OPT-IN corner radius of the sheet and the centred card (UMK-1548): `default` is the long-standing `2xl`, `lg` the 24px
       * `ds-2xl` token. Web only; a `side` drawer ignores it.
       */
      rounded: ['default', 'lg'],
    },
    booleans: ['centered', 'fullHeight', 'keyboardAware', 'showCloseButton', 'dismissible', 'dismissOnOutsidePress', 'closeDisabled'],
    note: 'No Figma set exists for this component, so the axis was read off the code: `Modal.tsx`\'s four-step width ladder, all four steps live. Recorded so a later reader does not go looking for a published set to reconcile it against. Placement is fixed rather than exposed: a sheet below md, centred from md up. The one exception is `side`, a drawer from the left or right edge at every width, which suppresses the drag gesture like `centered` does.',
  },

  /**
   * No Figma component set for this one either. `size` stays pending for the same reason it
   * always did — nothing in the code offers evidence for a width ladder — but the TREATMENT
   * axis below is read off two shipped surfaces, the way `Card`'s was.
   */
  Menu: {
    category: 'Overlays',
    family: 'overlays',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /**
       * Which of the two shipped menu treatments a surface renders. Read off the code,
       * because there is no design to read it off: `pill` is the chat composer's tools menu
       * and `boxed` is the user-settings popover.
       */
      variant: ['pill', 'boxed'],
    },
    pendingAxes: ['size'],
    divergences: [
      {
        figma: 'no published set for Menu at all — neither treatment has a design source',
        ours: "a `variant` axis carrying both: `pill` (default) and `boxed`",
        reason:
          "The app ships two visibly different menus. `pill` is the treatment slice 4 invented when it migrated the chat composer; `boxed` is derived from the user-settings popover, which has always drawn square-cornered rows in a bordered card. With no published set neither is wrong, so restyling the settings popover onto the composer's look would be an unsourced visual change to a live surface dressed up as a migration. Carried as an axis instead, so moving that surface onto this component is a port. A designer reconciling the two into one set later is the expected resolution, and the axis is where that lands.",
      },
    ],
    note: 'A DIFFERENT situation from the usual pending case: there is no published Figma set for Menu at all, so there are no unread values waiting in a file — the set has to be designed before it can be read. Do not go looking for a Figma page; the Storybook render is what a designer works against. UMK-963 widened the ROW, not the axes: a row may now declare child rows (a submenu) or a destination (a real anchor, rendered through an app-supplied link component because this package may not import a router), and onSelect carries the cancellable event so a link row can keep the menu open. None of that was a variant. The SECOND treatment is: UMK-963 later added `variant`, because the settings popover renders a different menu from the composer and both are shipped. One width still, so `size` stays pending. Native follows the AXIS but not the nesting: Menu is a bottom sheet there with nothing to nest a level inside, so submenus and link rows are the recorded divergence (packages/ui/src/native/Menu.tsx and the parity table). `variant` DID carry over in UMK-986 — it describes the rows and the panel chrome, which a sheet draws too, and only the anchoring was ever platform-specific.',
  },

  /**
   * No Figma set. Extracted from `DateTimeInput`'s inline calendar surface (UMK-1185) so admin's
   * pickers have a library popover to move onto.
   */
  Popover: {
    category: 'Overlays',
    family: 'overlays',
    status: 'implemented',
    native: {
      state: 'absent',
      reason:
        'A phone has no anchored floating panel to mirror: the native surface for arbitrary content opened from a control is the bottom sheet, which native Menu and Dialog already are (UMK-1075 made native Dialog always a sheet). A native Popover would be a different component, not a sibling of this one.',
    },
    axes: {
      /** Admin uses both `start` (the phone input) and the default `center`. */
      align: ['start', 'center', 'end'],
    },
    booleans: ['portal'],
    note: 'No Figma set exists, so the surface is the one DateTimeInput already drew. Renders IN PLACE by default, for the reason Select gives (a portalled panel inside a modal dialog meets the non-modal-parent conflict). `portal` is the opt-in, added because UMK-1185\'s audit found admin\'s page shell carries a backdrop filter and overflow-hidden, which makes it the containing block for the fixed-positioned panel and clips it on most admin pages. DateTimeInput and Select pass `portal` through.',
  },

  /**
   * Figma: Card (component set 494:417) — read, and deliberately NOT adopted.
   *
   * The published set is a course card: it publishes a `Type` of Mobile Search, Homepage and
   * Search plus booleans for a rating, a struck-through price, a best-seller flag and a tag.
   * That is a content component with a card's chrome, not the container this is. Ours takes a
   * padding ladder and nothing else.
   */
  Card: {
    category: 'Content',
    family: 'content',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['appearance'],
      missingProps: ['rounded'],
      reason: `${A2UI_NATIVE_REASON} The web-only \`rounded\` radius prop (UMK-960) has no native counterpart yet: native Card keeps its fixed 2xl radius.`,
      owner: A2UI_NATIVE_OWNER,
    },
    axes: {
      /**
       * How the card separates itself from the page. Read off the code, not a design: the
       * published set is a course card rather than a container, so there is nothing to read a
       * container treatment from. All three values are live in the app today; `outlined` is also
       * native-ui-v2's card on the white page (the fourth value, `glass`, was deleted in UMK-1603).
       */
      variant: ['elevated', 'outlined', 'plain'],
      padding: ['none', 'small', 'medium', 'large'],
      /** UMK-1290. `a2ui` is the agent surface's bare container (no classes); `a2ui-hero` its gradient banner. Ours; no Figma. */
      appearance: ['default', 'a2ui', 'a2ui-hero'],
    },
    divergences: [
      {
        figma:
          '`Type` is a three-value axis — Mobile Search, Homepage, Search — alongside Show Rating, Show Harga Coret, Show Best Seller, Show Tag and Show more',
        ours: 'a `padding` axis only; no type axis and none of the content booleans',
        reason:
          'Every one of those describes a COURSE card — its rating row, its price, its tags — so adopting them would make this container refuse to hold anything that is not a course. The course card is a composition built on top of this, and it already exists in the app as `CourseCard.tsx`.',
      },
    ],
    note: "`variant` and `padding` are read off the code rather than a design, since the published set is a course card. The padding ladder is the step list the two live consumers choose from, spelled out rather than the abbreviated `sm | md | lg` the legacy component shipped. UMK-960: `rounded` (none | sm | md | lg | full, each an existing radius token; `lg` is the default 24px, `full` a pill or circle) is a PROP rather than an axis, for the same reason Image's is: it selects one token and adds no treatment. On native a card with `onPress` presses with `PressableScale scale=\"card\"`. UMK-1603 DELETED the native-ui-v2 `glass` value: on the white page it had become a white fill with the one 1px `border.default.primary` edge, which is exactly `outlined`, so its call sites moved there and nothing on either platform passed it any more. Native has no `rounded` yet (recorded in `missingProps`). THE `variant` AXIS WAS DROPPED AND RESTORED, and the reason is worth keeping: it was dropped because no consumer passed it, which was true only because the component was unused — and a survey of the TemanAI surfaces then found all three treatments live, with `outlined` the dominant one. 'No consumer' is evidence about adoption, never about need.",
  },

  /**
   * Figma: no component set — the `Divider` the ticket lists has no published set in Ensyra —
   * DS, so the axis below is read off the code the same way `Dialog`'s was.
   */
  Divider: {
    category: 'Content',
    family: 'content',
    status: 'implemented',
    native: { state: 'partial', missingAxes: ['appearance'], reason: A2UI_NATIVE_REASON, owner: A2UI_NATIVE_OWNER },
    axes: {
      /** The line treatment. Both values render a genuinely different rule. */
      variant: ['default', 'dashed'],
      /**
       * Which way the rule runs. A vertical divider separates items inside a row and takes its
       * height from that row, so it is a different element rather than a rotated one.
       */
      orientation: ['horizontal', 'vertical'],
      /** UMK-1307. `a2ui` is the agent surface's pre-library look for this component, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    divergences: [
      {
        figma: 'no divider is published',
        ours: 'a two-value line treatment, read off the legacy component',
        reason:
          'The axis was not read from Figma because there is nothing to read. Recorded so a later reader does not assume the vocabulary was copied from a design and quietly "correct" it against a set that does not exist. The legacy component ALSO carried this axis on its wrapper, where both values mapped to the empty string — the axis is real on the rule and was a no-op on the wrapper, and only the real half survives.',
      },
    ],
  },

  /**
   * Figma: no component set. UNLIKE `Divider`, the code offers no evidence for an axis either
   * — the a2ui renderer this covers has one visual treatment and three directions, and a
   * direction is not a variant vocabulary a designer would publish.
   */
  List: {
    category: 'Content',
    family: 'content',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {},
    pendingAxes: ['size'],
    note: 'A different situation from `Tabs`, whose values sat unread in a published file: there is no List set in Ensyra — DS at all, so nothing is waiting to be read and the set has to be designed first. `direction` is a layout choice rather than a design variant and is deliberately not contracted as an axis. `as` (div by default, or ul/ol with an li per child, UMK-960) is structural for the same reason, as are `gap` (one spacing rung, selected in place of the direction\'s own) and `marker` (native disc or decimal on a block list); native stays implemented because a native list has no tag.',
  },

  /** Figma: no component set. Same situation as `List` — nothing published to read. */
  Disclosure: {
    category: 'Content',
    family: 'content',
    status: 'implemented',
    native: { state: 'partial', missingAxes: ['appearance'], reason: A2UI_NATIVE_REASON, owner: A2UI_NATIVE_OWNER },
    axes: {
      /** UMK-1307. `a2ui` is the agent surface's pre-library look for this component, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    pendingAxes: ['size'],
    note: 'No Disclosure set exists in Ensyra — DS, so this is the design-it-first case rather than the read-it case. The a2ui renderer that covers the same ground is an ADAPTER pinned to the upstream A2UI spec and to `umkmall.catalog.json`; its prop names are not evidence for ours.',
  },

  /** Figma: Image (component set 494:461), axes read 2026-09-05. */
  Image: {
    category: 'Content',
    family: 'content',
    status: 'implemented',
    native: { state: 'partial', missingAxes: ['appearance'], reason: A2UI_NATIVE_REASON, owner: A2UI_NATIVE_OWNER },
    axes: {
      type: ['thumbnail', 'banner', 'natural', 'avatar'],
      size: ['regular', 'small', 'blog'],
      /** UMK-1307. `a2ui` is the agent surface's pre-library look for this component, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    booleans: ['hover'],
    divergences: [
      {
        figma: '`Hover` is a two-value variant: No and Yes',
        ours: 'a `hover` boolean rather than a third axis',
        reason:
          'A hover treatment composes with every type and size at once, so folding it into an enum makes invalid states representable — the same reasoning the booleans field on this interface already records for `Button.disabled`.',
      },
      {
        figma: '`Type` publishes two values, Thumbnail and Banner — both fixed ratios',
        ours: 'a third `natural` type that constrains no ratio',
        reason:
          "Almost every image the TemanAI surfaces render is at its own ratio — a generated result, the lightbox, the photo-edit and camera previews — and exactly one is a square thumbnail. A fixed ratio crops a generated portrait, which is a defect rather than a styling difference, so the published pair cannot serve the app's main case on its own.",
      },
      {
        figma: 'no fit or object-position vocabulary is published',
        ours: 'a separate `fit` prop, not folded into `type`',
        reason:
          "How a photo sits inside its box is a CSS concern rather than a design variant, and the a2ui renderer this covers already treats them separately. Collapsing the two would make `type` mean both what the image IS and how it CROPS, which is the axis-overload this file exists to prevent.",
      },
      {
        figma: 'no avatar in the published `Type` values',
        ours: 'an `avatar` type: a square ratio with a full round',
        reason:
          "Admin draws user avatars (UMK-1186), and a circle is a shape, which is what `type` already carries. A separate Avatar component would be this one with a different radius.",
      },
    ],
    note: '`avatar` IS SIZED BY THE CALLER, with a className (admin uses 28-64px). The `size` axis stays orthogonal, so `avatar` with `regular` is a full-width circle and no guard catches it. INITIALS come from the existing `placeholder`, which shows when `src` is missing or not https. A URL that fails to LOAD shows a broken image rather than the placeholder: that branch is deliberately single for security, and a load-error fallback is not built (UMK-1186). UMK-960: `allowRelative` (a same-origin path) and `allowDataImage` (a raster data URL, never SVG) are OPT-IN props, off by default because the a2ui adapter forwards a model-authored url; `as` is a render slot so an app passes in its own image element (the package never imports next), and `imgProps` is forwarded to it. `src` may also be a static import (`ImageAsset`): the gate reads its `.src`, and the whole object reaches the slot so next/image keeps its blur data. `bare` (intrinsic mode: no ratio, background, clipping or size step; the caller\'s className is the layout, as for `avatar`), `ratio` (an inline aspect-ratio) and `rounded` (one radius token, SELECTED out of the type\'s own) are props rather than axes, for the same reason `fit` is. `imgProps` carries priority, fill, sizes, width, height, unoptimized, referrerPolicy, placeholder, blurDataURL, loading, decoding and quality. Native has none of these: a native Image takes a source object, not a URL string to vet.',
  },

  /**
   * No Figma component set. The three entries below are the LEGACY web primitives that
   * predate the re-baseline — `cva` blocks over the Tailwind palette, never contracted
   * because no slice owned them. Their native siblings exist now (UMK-952), and the rule is
   * that a sibling consumes the contract rather than restating a vocabulary locally — so the
   * axes are read off the web code and recorded here, the way `Dialog`'s and `Card`'s were.
   *
   * Slice 6 (UMK-900) owns reconciling the web originals; a rename there is a rename here.
   */
  /**
   * NO FIGMA SET. Shaped against the option payloads the agent surface actually renders — its
   * choice picker is the second most-used component in that corpus and had no counterpart
   * here at all. See the note.
   */
  SelectionCard: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['appearance'],
      missingProps: ['maxSelect', 'renderText', 'columns', 'activation', 'option.detail'],
      reason:
        'UMK-1295 added maxSelect, renderText, columns and an uppercase eyebrow, and UMK-1296 added the `choice` appearance and the activation mode, and UMK-1537 the optional per-option `detail` slot, on web only; the native sibling is not updated until UMK-1297, so its eyebrow stays sentence case and it has neither.',
      owner: 'UMK-1297',
    },
    axes: {
      size: ['large', 'small'],
      state: ['default', 'selected', 'disabled'],
      /**
       * UMK-1218. `tile` is the pack picker's card (Teman AI Page mobile coin cards 14275:102539):
       * centred content and the control DRAWN in the top-right corner. Ours, like the rest of this
       * entry — Figma publishes no selectable-card set to name it.
       */
      layout: ['row', 'tile'],
      /** UMK-1296. `choice` is the agent surface's pre-library option card, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'choice'],
    },
    note: "Ensyra publishes no selectable-card set; all 35 non-icon sets were enumerated. The fields come from the agent catalog's own option type rather than from preference - a field invented here is a field no payload can supply. The size ramp follows the other form controls. The selection VALUE is an array in single-select too: one return shape behind one prop, rather than a consumer branching on the mode to read its own value. An option whose description carries a leading line inverts the hierarchy - that line becomes the heading and the authored label demotes to an eyebrow - because the flow validation matches the authored label, so a generated title has nowhere else to go. That eyebrow is uppercase by default. `maxSelect` (multi-select) disables every unselected option once the cap is reached; `renderText` renders the split title and body (markdown enters there, `description` stays a string); `columns={2}` is layout, a prop rather than an axis, and swaps the flex column for a grid. `appearance` (`default` | `choice`, row layout only) is a named look: `choice` reproduces the agent surface's pre-library ChoicePicker cards value for value (UMK-1296; two of its colours have no token, so its classes live outside `field-classes.ts` and its hex is deliberate), and the default look is unchanged. `activation` turns every option into a plain `<button>` that never holds a selection, for one-tap steps: a radio group would let an arrow key move AND check the next radio, submitting an answer with no press. An option's optional `detail` (ReactNode, UMK-1537) renders inside its card below the description in every appearance; unset, the card is unchanged.",
  },

  /**
   * Figma: Upload Area. It shares nine property IDs with the text area — they are one shell
   * seen twice, which is why this composes the text fields' label wiring.
   */
  Upload: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: { state: 'partial', missingAxes: ['appearance'], reason: A2UI_NATIVE_REASON, owner: A2UI_NATIVE_OWNER },
    axes: {
      size: ['large', 'small'],
      status: ['default', 'filled', 'error', 'disabled', 'busy'],
      border: ['solid', 'dashed'],
      /** UMK-1307. `a2ui` is the agent surface's pre-library dropzone, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    divergences: [
      {
        figma: '`Status` spells the error value `Error Not Filled`',
        ours: '`error`',
        reason:
          'The published phrase encodes the absence of a file into the name of an error, which makes "error and filled" unsayable while it is a real state — a rejected upload that still shows what was rejected. Shortened to the condition itself, with filled derived separately, exactly as the text field already does with the same nine-value enum.',
      },
      {
        figma: '`Show Label`, `Show Info`, `Show Icon Left`, `Show Mandatory` and `Show Tooltip` are boolean slots',
        ours: 'the slot props themselves, whose absence is the "off" state, and `required` for the mandatory mark',
        reason:
          'Absence is already expressible in code, so a boolean beside each slot makes "no icon, but here is the icon" representable — the same collapse this file already records for the alert glyph. The mandatory mark rides `required` because the visual and the semantics must not be separately switchable: a decorative asterisk on a control that is not required, or a required control with no mark, are both reachable if they are two props. TWO OF THE FIVE WERE MISSING RATHER THAN COLLAPSED until UMK-963: there was no info row and no tooltip slot at all, so this entry described a collapse it had not made. `helperText` and `tooltip` are those two, and the record is now checkable against `UploadProps`.',
      },
      /* THE FOUR STATES BELOW ARE OURS. Figma publishes none of them, which is why each says so
         in its own `figma` field rather than being folded into one entry — a reader has to be
         able to tell "we added this" from "Figma has this", per state. They are what makes the
         primitive adoptable by the seven hand-rolled uploads in the app; the divergence record
         is the artifact for asking design to publish them, or to reject them. */
      {
        figma: 'no drag-over state — the set publishes `Default`, `Filled`, `Error Not Filled` and `Disable` only',
        ours: 'a drag-over treatment that composes OVER the resolved status, rather than a value on the status axis',
        reason:
          'A dropzone that does not react while a file is over it gives no signal that the drop will land, and every hand-rolled upload in this repo has one. It is kept OFF the status axis on purpose: web and native siblings consume this one declaration, there is no drag on native, and a status value native can never reach would still force a native sibling to define a style for it. Additive keeps the shared axis sayable on both platforms — every value on it is caller-declared, while this one is a pointer condition the web derives.',
      },
      {
        figma: 'no busy state',
        ours: '`busy` on the status ramp, given by the caller',
        reason:
          'An upload in flight has to refuse a second file — this component is presentation-only and the caller owns file handling, so a caller mid-upload has no safe way to accept one without its own queueing. Ranked directly under `disabled` for that reason, which also keeps the emit guard a single condition.',
      },
      {
        figma: 'no preview — the zone shows its placeholder in every published state',
        ours: 'a `preview` slot that replaces the placeholder and the glyph',
        reason:
          'A chosen file has to be visible for the choice to be reviewable, and the instruction to choose has nothing left to say once one is. A SLOT rather than a status: the component creates no object URL and holds no file, so what to show is the caller\'s.',
      },
      {
        figma: 'only a solid stroke — `Upload Area` sets `strokeDashes: None`, and publishes no dashed variant',
        ours: 'a `border` axis whose default is `solid` and whose second value is `dashed`',
        reason:
          'A dashed rule is the near-universal "drop a file here" convention, and the app\'s own live dropzone ships it — so the library refusing to say it would push every such caller into a `className` override, which lives in the consumer where this package\'s purge guard cannot see it. An axis makes the choice sayable, guarded, and visible to design as one decision rather than as scattered drift. The default stays `solid`, so parity is what a caller gets by saying nothing.',
      },
      {
        figma: 'no failure state',
        ours: 'no separate value either — a failed upload is the `error` status carrying the message it already had a prop for',
        reason:
          'RECORDED AS A NON-ADDITION on purpose. A second `failure` message channel would put two live regions on one control with no stated precedence, so a reader hears both or one, unpredictably. Reusing `error` removes the question rather than answering it, and keeps the single text row Figma publishes.',
      },
    ],
  },

  /**
   * NO FIGMA SET, and the enumeration is the evidence: all 35 non-icon sets were read and
   * there is no Select, Dropdown, Listbox or Combobox among them. The axes come from the three
   * live app implementations.
   */
  Select: {
    category: 'Form',
    family: 'form-controls',
    status: 'implemented',
    native: {
      state: 'partial',
      missingProps: ['multiple', 'portal', 'option.detail', 'labelSize'],
      reason:
        'UMK-1185 added two web-only props for the admin pickers: `multiple` (a string[] value, the list staying open between picks) and `portal` (render the list at the page root when an ancestor would clip it). Native\'s list is a bottom sheet, so `portal` has nothing to mean there; `multiple` is queued. UMK-955 added `option.detail`, a second full-weight column in an option row (a ratio beside its platforms) and a contained Escape (the key closes the list and never reaches an enclosing dialog); both are web-only. UMK-955 also added `labelSize` (the caption draws through the web-only Label field look, Figma Field Input).',
      owner: 'UMK-1193',
    },
    axes: {
      size: ['large', 'small'],
      status: ['default', 'filled', 'error', 'disabled'],
    },
    booleans: ['multiple', 'portal'],
    note: "Menu cannot substitute: it carries items with their own handlers and an optional per-row tick, but no value/onValueChange pair, so a caller holds the selection itself and Menu never reflects it. Type-to-search is a boolean affordance rather than a second component - the three live implementations are one component with the search on or off. No new package: this repo declares four Radix scopes and not the select one, the native-purity guard classifies that scope by prefix and only walks the native entry graph, so adding it would have gone green while reaching every consumer's bundle. The list renders in place rather than portalled, which sidesteps the standing conflict between the dialog guidance and the overlay guard. The four caller-facing props beyond the axes - an option hint, caller-owned search, a loading state and a disabled hint - are what the live searchable implementation needs: its two consumers (onboarding step 2 and the profile modal) fetch their options, disable the city field until a province is chosen, and tell two same-named cities apart by hint alone. Passing onSearch means the caller owns filtering outright and the options render verbatim; a component that also filtered a remotely-searched list would drop rows the server deliberately returned. UMK-1122: the open web list takes the trigger's size (radius, padding, type step) rather than inheriting the page's; native's sheet is not anchored to the trigger and is unchanged. UMK-1119: onCreate offers a `Tambah \"<query>\"` row on both platforms when a search of at least createMinLength (default 3) trimmed characters matches nothing and nothing is loading; the created option is selected at once, while options stay caller-owned.",
  },

  /**
   * NO FIGMA SET. Shaped against the two live sites that carry a byte-identical copy of it —
   * see the note. The axis is ours and recorded as such rather than passed off as read.
   *
   * NAME CLASH TO SETTLE AT MIGRATION: `apps/admin-dashboard` already has a local `CodeBlock`
   * (`features/users/ai-usage/markdown-components.tsx`). The rename makes that a real collision
   * rather than a latent one — whoever dedupes those two owns picking which survives.
   *
   * NAMED FOR ITS CONTENT, not its affordance. It was `CopyBlock` while the copy control was the
   * novel part, but both live sites are markdown CODE FENCES and the header bar carries a
   * language — so the content is always code and copying is one thing it offers. The name that
   * describes the content is also the one that leaves room for syntax highlighting later.
   */
  CodeBlock: {
    category: 'Content',
    family: 'content',
    status: 'implemented',
    native: { state: 'partial', missingAxes: ['appearance'], reason: A2UI_NATIVE_REASON, owner: A2UI_NATIVE_OWNER },
    axes: {
      size: ['large', 'small'],
      /** UMK-1307. `a2ui` is the agent surface's pre-library look for this component, reproduced value for value. Ours; no Figma. */
      appearance: ['default', 'a2ui'],
    },
    note: "Ensyra publishes no fenced-block or code-block set; all 35 non-icon sets were enumerated. The shape comes from the two duplicated app implementations, which are identical down to their class strings and their Indonesian labels. The size ramp is additive and ours: a fenced block inside a chat bubble and one in a full-width panel are the two live contexts, and without the axis the second is a padding override at the call site. Copy feedback is transient state inside the component rather than an axis - it is not a variant a designer picks.",
  },

  /**
   * Figma publishes this idea THREE times, under three disagreeing vocabularies. All three are
   * recorded below rather than one being silently preferred.
   *
   * The set published under the name `Stepper` has node name `03 Single Stepper Vertical` — a
   * name-based lookup gets a stale answer here.
   */
  Stepper: {
    category: 'Navigation',
    family: 'content',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      position: ['first', 'middle', 'last'],
      state: ['default', 'current', 'done'],
      orientation: ['horizontal', 'vertical'],
    },
    divergences: [
      {
        figma: '`02 Single Stepper Horizontal` publishes `Position: First | Mid | Last`',
        ours: '`position: first | middle | last`',
        reason:
          'The abbreviation is spelled out because every other ramp in this file spells its values, and slice 3 already reverted one abbreviation for that reason. More importantly the same word is a STATE in a sibling set, so keeping it would leave one spelling meaning two things depending on which set a reader had open.',
      },
      {
        figma: '`03 Single Stepper Vertical` publishes `Section: First | Middle | Last` plus `Status: Default | Active`',
        ours: 'the horizontal set’s richer state ramp, under one `state` axis, in both orientations',
        reason:
          'The two sets are one component seen twice rather than two components, so they get one vocabulary and an orientation axis instead of two near-identical entries. The vertical set publishes no completed state at all; rendering one is a gap in that set rather than an invention here, and it is named so a reader does not go looking for it.',
      },
      {
        figma: '`01 Mark` publishes `Type: Default | Done | Mid`',
        ours: 'the mark has no vocabulary of its own; it renders the step’s `state`',
        reason:
          'That set mixes a position value into a state enum — `Mid` is a position in the horizontal set and a step appearance here — which makes "done and mid" unrepresentable while "mid and default" is representable twice. Splitting position from state is what lets a single step render correctly in isolation, which is how the design source publishes it.',
      },
    ],
    note: 'Consumers: the journey run page stage trail (UMK-1809: a finished stage passes `onSelect`, which wraps its mark and label in one button, outside the connector) and the account-deletion flow. The vocabulary was first validated against the design source alone, and the divergences above keep a revision cheap.',
  },

  /** Figma: Pagination (component set 165:443), axes read 2026-09-25 (UMK-1184). */
  Pagination: {
    category: 'Navigation',
    status: 'implemented',
    /**
     * `partial` since UMK-1601. It was `absent` by decision ("native lists … load more on scroll
     * rather than paging"); the Paket Teman AI page reverses that, because the web's Riwayat
     * Pembelian already pages by number and the app's Figma frame (`Mobile/Package` 14987:94832)
     * draws numbered pages with "Item per page". Listed for the contract owner in that PR.
     */
    native: {
      state: 'partial',
      missingAxes: ['density'],
      missingProps: ['hasPrev', 'hasNext', 'summary'],
      reason:
        'Native draws the numbered strip and the page-size Select for one screen (Riwayat Pembelian, UMK-1601), with no server-side table chrome around it. It has no `density` axis (type only, the desktop 14/20 step a phone never takes), no cursor mode (`hasPrev` / `hasNext` with no `pageCount`: no native source pages by cursor) and no `summary` slot. It also draws no previous arrow, as the phone frame draws none: the strip always holds the page before the current one, so going back is a tap on that number.',
      owner: 'UMK-1614',
    },
    axes: {
      /** 36px squares at radius 8, or 32px at radius 6. */
      size: ['large', 'small'],
      /**
       * Type only: `comfortable` is the 14/20 desktop step the Riwayat Pembelian frame publishes
       * for the numbers and the page-size label (UMK-1306); the squares' geometry stays `size`'s.
       */
      density: ['compact', 'comfortable'],
    },
    booleans: ['disabled'],
    divergences: [
      {
        figma: '`Page: <9 | >9`',
        ours: 'no such axis — the ellipsis appears whenever `pageCount` leaves a gap',
        reason:
          'Whether the strip needs an ellipsis is a fact about how many pages exist, not a choice a caller makes. As a prop it could claim a short strip over forty pages and draw every number.',
      },
      {
        figma: '`Type: Default | Center | End`',
        ours: 'no such axis — derived from `page`: previous is disabled on the first page and next on the last',
        reason:
          'The three values are the current page sitting at the start, the middle or the end of the range. As a prop it could disagree with `page`, which is the state it depicts.',
      },
    ],
    note:
      'NO TANSTACK HERE, deliberately: `page`, `pageCount`, `pageSize` and two callbacks, so `DataTable` adapts its table state onto it and a gallery pager can use it with no table at all. The page-size control is not in the published set; it is the DS `Select`, kept because every admin table has one. `density` is type only: `comfortable` moves the page numbers and the page-size label onto the desktop 14/20 step at either `size` (no frame publishes a small comfortable pager); heights, radii and colours are one value each at either density.',
  },

  /**
   * Figma: `01 Table Header Cell` (149:4990) and `02 Table Cell` (149:5011), read 2026-09-25
   * (UMK-1184). Exports the parts AND `DataTable`, which is the only one depending on tanstack.
   */
  Table: {
    category: 'Content',
    status: 'implemented',
    native: {
      state: 'absent',
      reason:
        'A column grid has no phone form here: admin is desktop-only, and native lists render rows (for example `apps/mobile/src/purchases/views/HistoryScreen.tsx` uses `FlatList`), not columns.',
    },
    axes: {
      /**
       * Type only (UMK-1306): `compact` is the 10/16 mobile body step the library shipped before
       * the axis existed, `comfortable` the Riwayat Pembelian frame's 12/18 desktop step at body
       * weight 500. Padding, heights and colours do not vary with it — the published 64px body
       * row is still not implemented.
       */
      density: ['compact', 'comfortable'],
    },
    booleans: ['loading', 'serverSide', 'hidePagination', 'fixedLayout', 'noBorder', 'slimScrollbar'],
    divergences: [
      {
        figma: '`Type Col: First | Next` on both cell sets',
        ours: 'no such axis — a cell is first because of where the column sits',
        reason:
          'Position in the row is a fact about the column order, which the column definitions already hold. As a prop it could mark two cells first, or none.',
      },
      {
        figma: '`State: Default | Active` on the header cell, `Variant: Default | Active | Icon Default | Icon Active` on the body cell',
        ours: 'no such axis — `Active` is a selected row (`data-state`), and the icon variants are whatever the column renders',
        reason:
          'Selection is state the table holds, not a look a caller picks, and a cell\'s content is the column definition\'s `cell`. The checkbox, trash, tooltip and thumbnail booleans in the set are the same: content a column draws, not props of the table.',
      },
      {
        figma: 'a `sort` glyph with one state',
        ours: 'a chevron that points up when ascending and down when descending, dimmed while unsorted',
        reason:
          'The published glyph cannot say which way a column is sorted. Admin\'s explicit Asc/Desc dropdown is gone too: one mechanism, a header click cycling ascending, descending, unsorted — so a descending sort takes two clicks.',
      },
    ],
    note:
      'Both published sets vary by position and by state, and neither is a variant — `density` is the one axis they earn, and it is TYPE only: `comfortable` moves the header and body text onto the desktop step and the body to weight 500 (UMK-1306, Riwayat Pembelian), while the published 64px body row height is still NOT implemented and the two densities share one padding and one height. Whoever adds that row to `comfortable` changes the Riwayat Pembelian row height with it, and must check that screen — today it keeps the compact height by decision. Column visibility is CONTROLLED only (`columnVisibility`) with no toggle menu, because no screen uses one; search, filters and actions are a `toolbar` slot because they are admin UI built from admin selects.',
  },

  Spinner: {
    category: 'Feedback',
    family: 'feedback',
    status: 'implemented',
    native: { state: 'implemented' },
    axes: {
      /** Tailwind palette words on the web (`z-primary`, `white`, `gray-500`); the native sibling resolves each to an `Icon` token. */
      variant: ['primary', 'white', 'gray', 'gradient'],
      /** `h-4` … `h-16`: 16, 32, 48, 64. */
      size: ['sm', 'md', 'lg', 'xl'],
    },
    note: 'Read off `primitives/Spinner/Spinner.tsx`. The abbreviated size words are the legacy spelling, kept until slice 6 decides — spelling them out here while the web still reads `sm` would make the two disagree, which is the one thing this file exists to prevent.',
  },

  ProgressBar: {
    category: 'Feedback',
    family: 'feedback',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['shape'],
      reason:
        '`size` is closed. `radial` is blocked on a token, not on effort: the web gauge\'s `large` diameter is `h-24` (96), and the measurement ladder has no 96 rung — it runs 80, then 120. Building it would mean either a raw 96 in a native style or silently redrawing the gauge at 80. The rung is the fix.',
      owner: 'UMK-987',
    },
    axes: {
      variant: ['default', 'success', 'warning', 'error', 'gray', 'gradient'],
      /**
       * The track height, which was a hardcoded single value with no way to say anything
       * else. Spelled out rather than abbreviated — see the divergence.
       */
      size: ['large', 'medium', 'small'],
      /** A bar or a gauge. See the divergence: `radial` is the shape a2ui's chart needs. */
      shape: ['linear', 'radial'],
    },
    divergences: [
      {
        figma: 'no progress set is published, and this component predates the re-baseline entirely',
        ours: 'a spelled-out size ramp beside a sibling that keeps its abbreviated one',
        reason:
          'The height was a single hardcoded value, so any second height had to be a class override at the call site. Every ramp added since the re-baseline spells its steps out, and slice 3 already reverted one abbreviation for that reason; the sibling next door keeps its abbreviated words because changing a shipped vocabulary belongs to the slice that owns reconciling both, not to the change that gives one of them a table.',
      },
      {
        figma: 'nothing published, radial or otherwise',
        ours: '`shape: linear | radial`, defaulting to `linear`',
        reason:
          'The agent surface renders a gauge in three places and had no library shape to reach for. An axis rather than a second component: the two forms share the value, the maximum, the clamping and the announced semantics, and only the drawing differs — two components would be two copies of all of that, kept in step by hand. The size axis carries a diameter for this shape rather than a thickness, so a gauge is never sized by a class override at the call site.',
      },
    ],
    note: 'Read off `primitives/ProgressBar/ProgressBar.tsx`. `error` rather than `danger`: the legacy word, kept for the same reason as Spinner\'s abbreviations. `value`, `max` and `label` are plain props, not axes.',
  },

  /**
   * The toast HOST, entered here for the first time (UMK-979). It has no Figma set of its
   * own - Figma publishes `Alerts & Toast`, and `Alert`'s `type: toast` is that set's toast
   * arm. So these axes are read off `primitives/Toaster/Toaster.tsx` rather than from a
   * published component (A3), and the entry exists because the contract and the story set
   * must correspond one-to-one: `Toaster.stories.tsx` had no entry to answer to.
   *
   * `position` is the only real axis. `visibleToasts` and `duration` are numbers, not closed
   * sets, and `ToastOptions.variant`/`size` are `Alert`'s vocabulary passed through - they
   * belong to that entry and are deliberately not restated here.
   */
  Toaster: {
    category: 'Feedback',
    family: 'feedback',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['position'],
      reason:
        'Native `Toaster` pins itself to the TOP and takes a `topInset` for the safe area; the six-corner `position` vocabulary is sonner\'s, and a bottom-anchored toast on a phone lands under the keyboard and the home indicator. Argued and recorded as a deliberate divergence under standing decision UMK-1127 (native adapts to the OS): this entry did not exist when UMK-986 audited, so the gap was invisible until then.',
      owner: 'UMK-1127',
    },
    axes: {
      /** sonner's own placement vocabulary, narrowed to nothing - the library owns the set. */
      position: [
        'top-left',
        'top-center',
        'top-right',
        'bottom-left',
        'bottom-center',
        'bottom-right',
      ],
    },
    note: "Read off `primitives/Toaster/Toaster.tsx`. `visibleToasts` (queue cap) and `duration` (auto-dismiss ms) are numeric props, not axes. A raised toast renders `Alert` at `type='toast'`, so its severity and size vocabulary lives on the `Alert` entry and is not duplicated here. Two things both hosts decide the same way and neither publishes as an axis (UMK-1039 web, UMK-1057 native): the toast's `size` DEFAULTS from the width — Medium from 768 up, Small below (`sizeForViewport` / `toastSizeForWidth`) — with the close glyph at 20px beside Medium and 18px beside Small; and the `success` TOAST draws `check-circle-filled` where the inline Alert keeps the outline `check-circle`. That fork lives in each platform's `Alert`, not in `ALERT_VARIANT_ICON`, so one table does not answer for both.",
  },

  Label: {
    category: 'Form',
    status: 'implemented',
    native: {
      state: 'partial',
      missingAxes: ['look'],
      reason:
        'UMK-955 added the web-only field looks: the caption a web form control draws over its own box, exact to Figma Field Input 127:1459 (Large 14/20, Small 12/18, regular weight 400, no margin). Native fields render their own label, so native Label has nothing to adopt.',
      owner: 'UMK-877',
    },
    axes: {
      variant: ['default', 'error', 'success'],
      size: ['sm', 'md', 'lg'],
      /** UMK-955. `field-large` / `field-small` are Figma Field Input's two caption sizes, one axis so an invalid size-by-look pair cannot be written; they ignore `size` and `variant`. Ours as an axis; the values are Figma's. */
      look: ['default', 'field-large', 'field-small'],
    },
    booleans: ['required'],
    note: 'Read off `primitives/Label/Label.tsx`. Every slice-2 control owns its own label (see the TextField divergence), so this is the standalone form for a group heading or a non-control. Both variant tables are now pinned to these axes rather than being the source of them (UMK-900); reconciling this with the per-control labels is a BEHAVIOUR gap that outlived slice 6 and has no owner — see `unfamilied-coverage.test.ts`.',
  },

  /**
   * native-ui-v2 (the Profil card in the identity plan; labelled per identity §8). A person's photo in a circle,
   * falling back to their initials on the brand fill, then to a user glyph. Native only.
   */
  Avatar: {
    category: 'Content',
    status: 'declared',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {
      /**
       * 36, 44 and 56 pt, off the measurement ladder. The identity asks for 52; the ladder has no 52 step.
       * `profile` is 50 pt: the Profil header's avatar (Figma Mobile/Profile, UMK-1601), built as the 20 Bold initial's 26 line with 12 round it.
       */
      size: ['small', 'medium', 'large', 'profile'],
      /** The initials fallback: `two` letters (default, first and last word) or `one` (the first word's — the Profil header's "B", UMK-1601). */
      initials: ['two', 'one'],
    },
    divergences: [
      {
        figma: 'not published',
        ours: 'a circular avatar: an https photo, else initials on `surface.default.brand` in white, else a user glyph',
        reason:
          'native-ui-v2 identity component (docs/guidelines/mobile-design-identity.md); the web does not follow this identity',
      },
    ],
    note: '`src`, `name` and `label` are plain props, not axes. The photo goes through `Image`, so it inherits that component\'s https-only rule: a non-https `src` is never requested and the fallback shows instead.',
  },

  /**
   * native-ui-v2 identity components (docs/guidelines/mobile-design-identity.md §4.5), and since
   * UMK-1840 their web copies for the web Profil page (`primitives/ListGroup`, `primitives/ListRow`),
   * every axis value included.
   */
  ListGroup: {
    category: 'Content',
    status: 'implemented',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {
      /** `outlined` (default): the solid white card with the one card edge. `plain`: no container, a sentence-case label (Profil, UMK-1601). */
      variant: ['outlined', 'plain'],
    },
    divergences: [
      {
        figma: 'not published',
        ours: '`variant="outlined"`: a section label (Bold, uppercase, muted) over a white container with the one 1px `border.default.primary` card edge, padding 4, stacking ListRows through List',
        reason:
          'native-ui-v2 identity component (docs/guidelines/mobile-design-identity.md); the web does not follow this identity. The value was `glass` until UMK-1603 (UMK-1516 D1, "white solid surfaces as in Figma, no glass"), which renamed it after what it draws: the solid white card `Card variant="outlined"` draws.',
      },
      {
        figma: 'Teman AI v2 › Profile, frame Mobile/Profile (14980:77345) in the app design file, not the Ensyra library',
        ours: '`variant="plain"`: no container and no separators, the label in sentence case, SemiBold 14 in the secondary ink (`text.default.secondary`)',
        reason:
          'the Profil redesign (UMK-1601, UMK-1614) draws its groups on the white page with no card; drawn in the app design file, not the Ensyra library',
      },
      {
        figma: 'Teman AI Page, frame Website/Mobile/Profile (15044:52555) in the app design file, not the Ensyra library',
        ours: 'the web copy (UMK-1840): the same two variants; its label is an h2 that names the group (`role="group"`), and its rows stack in a plain div rather than through a web List',
        reason:
          'the web Profil page (UMK-1840) draws the same groups as native; the web List is the a2ui prose stack, so the rows need no part of it',
      },
    ],
    note: 'Not a List variant: List is the content stack the a2ui renderer draws prose into and keeps `direction` off the contract, while this is labelled navigation chrome. It stacks its rows THROUGH List. Destructive actions never go in a group (see ListRow).',
  },

  ListRow: {
    category: 'Content',
    status: 'implemented',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {
      /**
       * `chevron`, `external` or `none`, one glyph per row. Which one a row draws follows its design: native's Profil marks a
       * row that leaves the app `external`, while the web Profil frame (15044:52555) draws `chevron` on those rows too (author,
       * UMK-1845). The glyph only says it; opening a new tab is the row's own `external` prop.
       */
      trailing: ['chevron', 'external', 'none'],
      /** `tile` (default): the glyph in a 36 pt brand tile. `plain`: a bare 18 pt outline glyph in the default ink (Profil, UMK-1601). */
      variant: ['tile', 'plain'],
      /** The ink of the optional trailing `value` text: `muted` (default) or `brand` (Profil's plan name, "Basic"). */
      valueTone: ['muted', 'brand'],
    },
    booleans: ['active', 'disabled'],
    divergences: [
      {
        figma: 'not published',
        ours: 'a 56 pt row: a 36 pt brand icon tile, a label and optional meta line, and a trailing chevron or external glyph; pressed and active tint surface.weak.brand',
        reason:
          'native-ui-v2 identity component (docs/guidelines/mobile-design-identity.md); the web does not follow this identity',
      },
      {
        figma: 'Teman AI v2 › Profile, frame Mobile/Profile (14980:77345) in the app design file, not the Ensyra library',
        ours: '`variant="plain"`: a 52 pt row with no inset of its own, a bare 18 pt outline glyph, a Medium 14 label, an optional SemiBold 14 trailing value and an 18 pt chevron; it presses at the card scale while a surface.weak.brand highlight fades in over duration.press, and an external row nudges its glyph distance.nudge up and right',
        reason:
          'the Profil redesign (UMK-1601, UMK-1614) draws plain rows with no tile and no card; drawn in the app design file, not the Ensyra library',
      },
      {
        figma: 'Teman AI Page, frame Website/Mobile/Profile (15044:52555) in the app design file, not the Ensyra library',
        ours: 'the web copy (UMK-1840): every axis value; an anchor when it has a destination and a button otherwise, a caller link component for in-product links, and `external` opening a new tab on a plain anchor; hover, press and current share the tint, which a colour transition eases in, and an external row does not nudge its glyph',
        reason:
          'the web Profil page (UMK-1840) draws the same rows as native; a web row is a link or a button, so routing and the new tab are the web halves of what native does on press',
      },
    ],
    note: 'Destructive actions ("Keluar") are NOT rows: they are a full-width outlined danger Button (`type="ghost" color="danger" width="full"`) below the groups.',
  },

  /**
   * The Profil header (UMK-1601 / UMK-1614): avatar, name and one "phone - business name" line, drawn
   * in the app design file rather than the Ensyra library. Since UMK-1840 the web Profil page has its
   * own copy (`primitives/ProfileHeader`).
   */
  ProfileHeader: {
    category: 'Content',
    status: 'implemented',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {},
    /* Pending, as `List`'s is: the one size is Profil's, read from the app design file, and no set is
       published, so a second size has to be designed before it can become an axis. */
    pendingAxes: ['size'],
    divergences: [
      {
        figma: 'Teman AI v2 › Profile, frame Mobile/Profile (14980:77345) in the app design file, not the Ensyra library',
        ours: 'a left-aligned row: a 50 pt Avatar (one 20 Bold initial, white on surface.default.brand) 16 from the text, the name 16 Bold, and one 12 Regular secondary line "phone - business name" whose separator drops when either half is absent',
        reason:
          'the Profil redesign (UMK-1601, UMK-1614) opens the page with this header; drawn in the app design file, not the Ensyra library',
      },
      {
        figma: 'Teman AI Page, frame Website/Mobile/Profile (15044:52555) in the app design file, not the Ensyra library',
        ours: 'the web copy (UMK-1840) draws its own 50 circle with one initial (the user glyph when there is no name) rather than an Avatar, hides it from screen readers, and lets the name and the line be read as text',
        reason:
          'Avatar stays native-only (UMK-1840, the author\'s call): one initial on a fill is all the web header needs',
      },
    ],
    note: 'No axes: one presentation. `name`, `phone` and `meta` (the business name) are plain props, and the header is one accessible element announcing the name and the line.',
  },

  /**
   * The Jadwal month calendar (UMK-1358): the month and year between arrows, a Monday-first grid of days, and a count chip under
   * every day that holds posts. NATIVE-ONLY, drawn in the app design file (Teman AI v2 › Jadwal), not the Ensyra library.
   */
  MonthCalendar: {
    category: 'Form',
    status: 'declared',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {},
    divergences: [
      {
        figma: 'Teman AI v2 › Jadwal, frame 15198:103890 in the app design file, not the Ensyra library (whose Calendar page is a single-date picker with no counts)',
        ours: 'the month and year centred between two 44 pt arrows; Sen to Min over seven equal columns; each day a 20 type number over a count chip; the selected day a filled brand square with a white chip; the days before the 1st and after the last left blank',
        reason:
          'the Jadwal screen needs a day that says how many posts it holds, which a date picker has no place for; the Ensyra calendar (and the web DateTimeInput popover) stays the way to pick ONE date',
      },
    ],
    note: 'No axes: one presentation. `month` and `selected` are controlled props, `counts` maps a day to its post count, and the host owns the state (the component holds none and has no clock). Dates are `YYYY-MM` and `YYYY-MM-DD` strings; the grid is built from UTC arithmetic so a phone in another zone draws the same month.',
  },

  /**
   * The native-ui-v2 bottom tab bar (docs/guidelines/mobile-design-identity.md §5.1), and since
   * UMK-1757 its web copy for phone widths (`primitives/TabBar`, hidden from `md` up). No published
   * axes: a tab is active or it is not, which is the `active` boolean, and `state` stays pending until
   * the item's faces are read from a published set. The items are data, not vocabulary.
   */
  TabBar: {
    category: 'Navigation',
    status: 'implemented',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {},
    booleans: ['active'],
    /* The design's tab item has an active and an inactive face; its values have not been read out
       of a published set, because the item lives in the app design file rather than Ensyra. */
    pendingAxes: ['state'],
    divergences: [
      {
        figma: 'not published',
        ours: 'a white bar on the bottom edge of four equal tabs, each a glyph over its label, with a brand line over the active one that slides and stretches between tabs (the app design "Teman AI v2", UMK-1604); presentational, with an expo-router adapter (`navigatorTabBar`) beside it',
        reason:
          'native-ui-v2 identity component (docs/guidelines/mobile-design-identity.md), drawn in the app design file rather than the Ensyra library',
      },
      {
        figma: 'not published',
        ours: 'the web copy (UMK-1757, "Teman AI Page" mobile frames) takes `TabBarItem` children rather than an item array, so an item can be a menu trigger; its top edge is a border rather than the native upward shadow, which the web token build does not publish; and the brand line moves with the active item instead of sliding',
        reason:
          'an item may be a menu trigger (Teman AI\'s Profil tab links its page since UMK-1840, but a tab that opens a menu stays possible), and a menu hands its trigger a ref and its handlers, which only a caller-rendered element can take',
      },
    ],
  },

  /**
   * A round 44 pt icon-only control (native-ui-v2). NATIVE-ONLY: the web's icon-only buttons
   * are `Button`'s icon shape, which this identity does not use.
   */
  IconButton: {
    category: 'Form',
    status: 'declared',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {
      /** `outlined` (default; a white disc with the one card edge), `solid` for the one brand action, `plain` a bare glyph at full target. */
      variant: ['outlined', 'solid', 'plain'],
    },
    divergences: [
      {
        figma: 'not published',
        ours: 'a 44 × 44 round icon button in three treatments (outlined, solid brand, plain), pressed at the icon scale, with a required accessibility label',
        reason:
          'native-ui-v2 identity component (docs/guidelines/mobile-design-identity.md); the web does not follow this identity. `outlined` was `glass` until UMK-1603 (UMK-1516 D1, "white solid surfaces as in Figma, no glass"), which renamed it after what it draws: a solid `surface.default.primary` disc with the one 1px `border.default.primary` card edge.',
      },
    ],
  },

  /**
   * native-ui-v2 identity cards (docs/guidelines/mobile-design-identity.md §4.2, §4.3, §4.7).
   * NATIVE-ONLY: the web does not follow this identity, so these entries are `declared` for the
   * web and `implemented` on native, and each carries the one divergence that says why.
   */
  FeatureTile: {
    category: 'Content',
    status: 'declared',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {
      /** The seven identity tile tones (§2.3) — the keys of `surface.tile.*` and `icon.tile.*`. `neutral` is Operasional's grey tile (UMK-1887). */
      tone: ['blue', 'yellow', 'red', 'green', 'purple', 'orange', 'neutral'],
      /** `grid`: the "Pilih Template" card, the solid white card. `row`: the composer's Alat sheet row. `stack`: the TemanAI home's category tile, the toned square with its name under it (UMK-1743). */
      layout: ['grid', 'row', 'stack'],
    },
    booleans: ['selected', 'disabled'],
    divergences: [
      {
        figma: 'not published',
        ours: 'a toned icon tile, title, one-line purpose and an optional coin price slot, as a grid card or a sheet row, with a check-circle selected state; or, as `stack` (UMK-1744, Figma Teman AI Page 15256-71436), no card at all: the toned square fills its column with a 36 pt glyph and the name sits centred under it, no purpose line, price or check',
        reason:
          'native-ui-v2 identity component (docs/guidelines/mobile-design-identity.md); the web does not follow this identity. Since UMK-1603 (UMK-1516 D1, "white solid surfaces as in Figma, no glass") the `grid` card is the solid white card: a `surface.default.primary` fill, no blur, and the one 1px `border.default.primary` edge the other cards in the app wear.',
      },
    ],
    note: '`selected` has no default: omitted, the tile is an action; passed, it is a toggle with a check. The price is a slot (normally `CoinChip`) and the tile never computes one.',
  },

  PhotoCard: {
    category: 'Content',
    status: 'declared',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {},
    booleans: ['disabled'],
    divergences: [
      {
        figma: 'not published',
        ours: 'a 200 pt journey card: cover art anchored right-bottom, title and purpose top-left, a promo coin-price corner tab and a "Mulai" pill',
        reason:
          'native-ui-v2 identity component (docs/guidelines/mobile-design-identity.md); the web does not follow this identity',
      },
    ],
    note: 'No axes: one card shape. `price` is a number from the live price book or absent, never a guess; `ctaLabel` defaults to "Mulai".',
  },

  CoinChip: {
    category: 'Content',
    status: 'declared',
    slice: 'native-ui-v2',
    native: { state: 'implemented' },
    axes: {
      /** `price` (inline cost), `balance` (the white header chip that counts up). No "Gratis": native shows a coin only where the web shows a cost. */
      variant: ['price', 'balance'],
      /** The inline chips' ramp. `balance` is one size by role (40 pt) and does not read it. */
      size: ['sm', 'md'],
    },
    divergences: [
      {
        figma: 'not published',
        ours: 'the coin glyph and an Indonesian-formatted amount, as a price chip or a white balance chip with a count-up',
        reason:
          'native-ui-v2 identity component (docs/guidelines/mobile-design-identity.md); the web does not follow this identity. Since UMK-1603 (UMK-1516 D1, "white solid surfaces as in Figma, no glass") the `balance` chip is solid white: a `surface.default.primary` fill, no blur, and the one 1px `border.default.primary` edge the other cards in the app wear.',
      },
    ],
    note: "`sm`/`md` follow the abbreviated spelling the identity doc uses for chips. The amount is formatted the way the app's `formatCredits` formats it (`2.813`, `null` as unlimited).",
  },
} as const satisfies Readonly<Record<string, ComponentContract>>

export type Contract = typeof contract
export type ComponentName = keyof Contract

/**
 * The Storybook title a component's category derives (UMK-979 KTD3).
 *
 * Storybook's CSF indexer extracts `title` by STATIC ANALYSIS, without executing the module,
 * so a computed title is not read at all — the story silently falls back to path-derived
 * autotitling and lands in a section nobody chose. That is why every `meta.title` is a
 * hand-written literal and this function is only ever used by the GUARDS: the literal is what
 * can be wrong, the expectation is what is derived, and a guard that read both from the same
 * place would be measuring itself.
 *
 * `Foundations` is a top-level section beside `Components`, so its members lose the
 * `Components/` prefix rather than nesting under it.
 */
export const storyTitle = (name: ComponentName): string => {
  const { category } = contract[name]
  return category === 'Foundations' ? `Foundations/${name}` : `Components/${category}/${name}`
}

