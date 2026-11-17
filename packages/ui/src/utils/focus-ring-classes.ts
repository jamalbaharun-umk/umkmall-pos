/**
 * The focus ring, as the Tailwind classes that render it.
 *
 * Lives here rather than in `contract/` for the same reason as `text-color-classes.ts`: the
 * contract declares VOCABULARY and may not name a Tailwind class, and a guard test enforces
 * it. This is the web mapping, so all six form controls read one file instead of each
 * hand-keeping a copy that nothing compares.
 *
 * THE MISNOMER IS GONE, AND THIS FILE IS WHY IT COST ONE LINE (UMK-872, closed by UMK-978).
 * The pair used to be `composer.borderFocus` / `composer.ringFocus` — named for the chat
 * composer rather than for the role they play — and containing that name here is what made
 * the rename a one-line change instead of a six-component sweep. The strong stop is now the
 * published `Border/Focus/Brand`; the pale one is the overlay's `Focus/Halo`, which has no
 * upstream successor at any name. Keep them contained here: `form-controls.stories.test.tsx`
 * enforces it, and the containment is the whole reason the last rename was cheap. Do not swap
 * these for the hand-kept `border.focus` in the preset — same colour, but that group is the
 * one scheduled to retire.
 */

/**
 * `field` — the ring sits on a wrapper that contains the real input, so focus is detected
 * with `focus-within`. `control` — the focusable element IS the styled element. `surface` —
 * `field`'s shape for a LARGE wrapper; see below for why it is not the same value.
 *
 * WHY `surface` EXISTS, AND WHY IT IS NOT A STYLE PREFERENCE. `field` and `control` pair a STRONG
 * border colour with a PALE ring colour. On a checkbox, a switch or a text input the two are close
 * enough together to read as one treatment. On a surface the size of a chat composer they separate:
 * the strong inner edge reads as a dark line drawn INSIDE a pale glow, which is not a focus ring so
 * much as two of them.
 *
 * IT TOOK TWO GOES TO GET RIGHT, AND THE FIRST ONE IS THE INSTRUCTIVE HALF. `surface` began as the
 * strong border with the SAME token softened outward by opacity — one hue, which was the diagnosis,
 * but the dark line was still there because the border was still the strong stop. One hue was
 * necessary and not sufficient. It now draws the band entirely in the PALE stop: border and ring
 * name one token at one strength, so a focused composer gains a soft blue edge and no hairline
 * inside it. The strong stop stays where it belongs, on the small controls.
 *
 * AND THE HALO IS `ring-1`, NOT `ring-2`. Ring width does not scale with the element: a 2px halo
 * that reads as a delicate edge around a 20px checkbox reads as a heavy band around a full-width
 * composer, because the eye judges it against the shape it surrounds. The border and the ring
 * together are the whole treatment here, so 1 + 1 is the two pixels this needs.
 *
 * It lives here rather than in the composer's own class table because of the misnomer below: this
 * file is the only place the token name is written, and that containment is what keeps UMK-872's
 * rename a one-line change. `form-controls.stories.test.tsx` enforces it across the package.
 */
export const FOCUS_RING = {
  /* `data-quiet-focus` (utils/focus-modality.ts): a text field focused by code, not by the user, stays
     unringed. Every other holder of this string never sets the attribute, so for them the guard is inert. */
  field:
    '[&:not([data-quiet-focus])]:focus-within:border-focus-brand [&:not([data-quiet-focus])]:focus-within:ring-2 [&:not([data-quiet-focus])]:focus-within:ring-halo',
  control:
    'focus-visible:outline-none focus-visible:border-focus-brand focus-visible:ring-2 focus-visible:ring-halo',
  surface:
    'focus-within:border-halo focus-within:ring-1 focus-within:ring-halo',
} as const;

export type FocusRingRole = keyof typeof FOCUS_RING;
