// Pure helpers of device pairing by code (UMK-2022): the countdown, the code's look, the pairing cookie and the
// address a relay must pass on. No React, no I/O: unit-tested on their own. A code or a pairing token is never logged.

export const CODE_LENGTH = 6
/** Seconds before the end at which the screen already warns. */
export const WARN_SECONDS = 60

export const isPairingCode = (v: string) => /^[0-9]{6}$/.test(v)

/** "482913" -> "482 913" for reading aloud across a shop. */
export const groupCode = (code: string) => (code.length === CODE_LENGTH ? `${code.slice(0, 3)} ${code.slice(3)}` : code)

/** Whole seconds left until `deadline` (epoch ms), never negative. */
export const secondsLeft = (deadline: number, now: number) => Math.max(0, Math.ceil((deadline - now) / 1000))

/** 580 -> "9:40". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The `X-Forwarded-For` value a relay sends to pos-api: what the relay itself received (its own proxies' chain),
 * then the address it saw the device connect from. pos-api, with `POS_TRUSTED_PROXIES` set, walks that chain from
 * the right to find the device. Without a socket address nothing is sent at all (undefined): a chain with no
 * address of ours at its end is client-supplied, and forwarding it would let a caller pick its own per-address key.
 * pos-api then counts the relay's own address, which is the shared cap `POS_TRUSTED_PROXIES` warns about.
 */
export function buildForwardedFor(incoming: string | null | undefined, socketAddress: string | null | undefined): string | undefined {
  const own = socketAddress?.trim()
  if (!own) return undefined
  const chain = (incoming ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  chain.push(own)
  return chain.join(', ')
}

export type PairingCookie = { token: string; code: string; expiresAt: number }

export const encodePairingCookie = (p: PairingCookie) => JSON.stringify({ t: p.token, c: p.code, e: p.expiresAt })

/** The cookie's content when it is well formed and not over; otherwise null (a new code must be asked for). */
export function parsePairingCookie(raw: string | undefined, now: number): PairingCookie | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { t?: unknown; c?: unknown; e?: unknown }
    if (typeof v.t !== 'string' || typeof v.c !== 'string' || typeof v.e !== 'number') return null
    if (!isPairingCode(v.c) || v.e <= now) return null
    return { token: v.t, code: v.c, expiresAt: v.e }
  } catch {
    return null
  }
}
