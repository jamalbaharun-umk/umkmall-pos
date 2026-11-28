/** The owner's solo block from `/tenant/me` (UMK-2121); null for a cashier. */
export type SoloStatus = { active: boolean; storeCash: boolean; ownerPin: boolean; freshSignIn: boolean }

/**
 * Design 40: right after the owner signs in (`/?masuk=1`), a store whose owner has no PIN yet asks for one. Only
 * while the sign-in is fresh: pos-api makes the owner's first PIN only within 5 minutes of a sign-in (UMK-2054).
 */
export function shouldAskOwnerPin(solo: SoloStatus | null | undefined, justSignedIn: boolean): boolean {
  return justSignedIn && solo != null && !solo.ownerPin && solo.freshSignIn
}

/** "Nanti saja": the owner can still make the PIN later, but only after a new WhatsApp sign-in. */
export const OWNER_PIN_LATER =
  'PIN bisa dibuat nanti di Pengaturan, Keamanan. Untuk itu Anda perlu masuk lagi lewat WhatsApp.'
