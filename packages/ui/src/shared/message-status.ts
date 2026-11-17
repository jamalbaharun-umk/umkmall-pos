/**
 * What a message's delivery status DRAWS and what it is CALLED, on both platforms (UMK-1129).
 *
 * Extracted for the same reason as `select.ts` and `selection-card.ts` next door: the web
 * `ChatMessageMetadata` that owned this table imports React and the class tables, so
 * `@umkmall/ui/native` cannot reach it, and a second native copy of five Indonesian labels would
 * agree with the first only until someone edited one. This module imports NOTHING.
 *
 * `delivered` and `read` SHARE A GLYPH and differ only by label, and that is the decision rather
 * than an oversight: to a reader glancing at a transcript the two are the same mark, and inventing
 * a second drawing would claim a visual distinction the product has no opinion about.
 *
 * The copy is Indonesian and sentence case, matching every other label in this package. It is the
 * one piece of copy these components own — everything else in the message family is the host's —
 * because a status vocabulary is closed and a caller passing five strings would be re-typing the
 * same five.
 *
 * THE ICON NAMES ARE PLAIN STRINGS HERE, and each platform narrows them with `satisfies` against
 * its own registry's `IconName`. The two registries hold the same names (`icon-parity.test.ts`),
 * so a name that stops existing reds the typecheck on whichever side lost it.
 */
export const MESSAGE_STATUS_DRAWN = {
  sending: { icon: 'rotate-cw', label: 'Mengirim' },
  sent: { icon: 'check-circle', label: 'Terkirim' },
  delivered: { icon: 'check-circle-filled', label: 'Sampai' },
  read: { icon: 'check-circle-filled', label: 'Dibaca' },
  error: { icon: 'alert-circle', label: 'Gagal terkirim' },
} as const;

/**
 * Whether a metadata slot holds something to draw.
 *
 * ONE RULE FOR BOTH PLATFORMS, because the separators are computed from it: the dot belongs
 * BETWEEN two present pieces, so a platform that counted an empty string as present would draw a
 * dangling dot the other one does not. `0` IS present — a zero is a value a host meant to show.
 */
export const isMetadataPresent = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '' && value !== false;
