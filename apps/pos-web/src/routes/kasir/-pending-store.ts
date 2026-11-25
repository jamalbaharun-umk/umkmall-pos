import { useCallback, useEffect, useRef, useState } from 'react'
import { initialState, planSend, reduce, rehydrate, serialize, type PendingEvent, type PendingState, type SendPlan } from './-pending'

// The register's memory of unfinished sales, kept per tab (like the open bill). Every decision is in `-pending.ts`;
// this file only holds the state, hands it out and is the ONLY code that reads or writes its storage record (guard
// test in `-pending.test.ts`).

const STORAGE_KEY = 'pos.kasir.pending'
/** The record of the first format (one sale id, `own`): read once, then removed. */
const LEGACY_KEY = 'pos.online-sale'

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null // private window or blocked storage: nothing is remembered across a reload
  }
}
function write(state: PendingState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, serialize(state))
    sessionStorage.removeItem(LEGACY_KEY)
  } catch {
    // storage unavailable: the state lives for this page load only
  }
}

export type PendingStore = {
  /** The state of this render (for what a screen shows). */
  state: PendingState
  /** The state right now (for a decision taken in a handler or a retry: never the render's copy). */
  current: () => PendingState
  dispatch: (ev: PendingEvent) => PendingState
  /** A sale request is about to be sent with this method: the key to send, or why it must not be sent. */
  send: (methodId: string) => SendPlan
}

export function usePending(): PendingStore {
  const ref = useRef<PendingState | null>(null)
  if (ref.current === null) ref.current = initialState(crypto.randomUUID())
  const loaded = useRef(false)
  const [state, setState] = useState<PendingState>(ref.current)

  const apply = useCallback((next: PendingState) => {
    if (next === ref.current) return next
    ref.current = next
    write(next)
    setState(next)
    return next
  }, [])
  /** The stored state replaces the empty one once, in the browser, before anything is decided on it. */
  const load = useCallback(() => {
    if (loaded.current) return
    loaded.current = true
    apply(rehydrate(read(STORAGE_KEY), read(LEGACY_KEY), crypto.randomUUID()))
  }, [apply])
  useEffect(load, [load])

  const current = useCallback(() => {
    load()
    return ref.current as PendingState
  }, [load])
  const dispatch = useCallback(
    (ev: PendingEvent) => apply(reduce(current(), ev, crypto.randomUUID())),
    [apply, current],
  )
  const send = useCallback(
    (methodId: string) => {
      const { state: next, plan } = planSend(current(), methodId, crypto.randomUUID())
      apply(next)
      return plan
    },
    [apply, current],
  )
  return { state, current, dispatch, send }
}
