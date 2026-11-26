import { createServerFn } from '@tanstack/react-start'
import { api, trySetStatus } from '@/lib/api.server'
import { refusalOf } from '@/lib/refusal'
import { voidFailure, type Approver, type VoidFailure } from '../kasir/-void-helpers'
import { needsFreshSignIn } from './-keamanan-helpers'

// Server functions for the void PIN screen (UMK-1962). The PIN passes through `setPin` and is never stored, logged or
// echoed; pos-api hashes it. Each actor sets their own PIN; only the owner unlocks or removes another's.
// UMK-2054: the owner's own PIN is made, removed or unlocked without the old PIN only after a fresh sign-in; pos-api's
// refusal of that (403 `fresh_sign_in_required`) comes back as `fresh: true`, and the page offers "Masuk lagi".

export type PinStatus = { hasPin: boolean; lockedUntil: string | null }

async function read<T>(path: string): Promise<T | null> {
  const res = await api(path)
  if (res.status === 403) {
    trySetStatus(200) // expected: the page still renders, without this part
    return null
  }
  if (!res.ok) throw new Error((await refusalOf(res)).error)
  return (await res.json()) as T
}

/** The actor's own PIN state (needs sales.void) and who can approve a void here (needs sales.create). */
export const loadSecurity = createServerFn().handler(async () => ({
  status: await read<PinStatus>('/void-pin'),
  approvers: await read<Approver[]>('/void-pin/approvers'),
}))

export type PinAnswer = { ok: true; status?: PinStatus } | { ok: false; failure: VoidFailure; fresh?: true }

async function answer(path: string, method: string, body?: unknown): Promise<PinAnswer> {
  const res = await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }).catch(
    () => null,
  )
  if (!res) return { ok: false, failure: voidFailure(0, null) }
  if (!res.ok) {
    const refusal: unknown = await res.json().catch(() => null)
    return {
      ok: false,
      failure: voidFailure(res.status, refusal),
      ...(needsFreshSignIn(res.status, refusal) ? { fresh: true as const } : {}),
    }
  }
  return { ok: true, status: (await res.json().catch(() => undefined)) as PinStatus | undefined }
}

export const setPin = createServerFn({ method: 'POST' })
  .validator((d: { pin: string; currentPin?: string }) => d)
  .handler(({ data }) => answer('/void-pin', 'PUT', data))

export const unlockPin = createServerFn({ method: 'POST' })
  .validator((actorId: string) => actorId)
  .handler(({ data }) => answer(`/void-pin/${encodeURIComponent(data)}/unlock`, 'POST'))

export const resetPin = createServerFn({ method: 'POST' })
  .validator((actorId: string) => actorId)
  .handler(({ data }) => answer(`/void-pin/${encodeURIComponent(data)}`, 'DELETE'))

/**
 * The owner's "Lupa PIN" after signing in again (UMK-2054): removes the forgotten PIN (and its lock), then saves the
 * new one. Both steps need the fresh sign-in; a PIN that is already gone (404) is not a failure. If the second step
 * fails the owner has no PIN, and the page shows the plain "make a PIN" form.
 */
export const replaceForgottenPin = createServerFn({ method: 'POST' })
  .validator((d: { actorId: string; pin: string }) => d)
  .handler(async ({ data }): Promise<PinAnswer> => {
    const removed = await answer(`/void-pin/${encodeURIComponent(data.actorId)}`, 'DELETE')
    if (!removed.ok && removed.failure.kind !== 'gone') return removed
    return answer('/void-pin', 'PUT', { pin: data.pin })
  })
