import { useEffect, useSyncExternalStore } from 'react'
import { initialState, planSend, reduce, rehydrate, reopened, serialize, type PendingEvent, type PendingState, type SendPlan } from './-pending'

// The register's memory of unfinished sales, kept per tab (like the open bill). Every decision is in `-pending.ts`;
// this file only holds the state, hands it out and is the ONLY code that reads or writes its storage record (guard
// test in `-pending.test.ts`).
//
// ONE store per tab, not one per mounted screen: a sale request that answers after the cashier left the register
// (and came back to a new screen) still writes to the state everybody reads, never over it with an old copy.

const STORAGE_KEY = 'pos.kasir.pending'
/** The record of the first format (one sale id, `own`): read once, then removed. */
const LEGACY_KEY = 'pos.online-sale'

export type PendingStore = {
  /** The state right now (for a decision taken in a handler or a retry: never a render's copy). */
  current: () => PendingState
  dispatch: (ev: PendingEvent) => PendingState
  /**
   * A sale request is about to be sent with this method: the key to send, or why it must not be sent. The state that
   * says "a request is out" is stored before this returns, so a reload in the middle of the request still knows.
   */
  send: (methodId: string, bank?: string | null) => SendPlan
  /**
   * The register opened (a reload, or coming back from another page): the stored state is read as after a reload,
   * because what the last screen knew of each sale (its payment, its waiting screen) is gone with it.
   */
  open: () => void
  /**
   * false once a write to the tab's storage failed (private window, storage full or blocked): the state then lives
   * for this page load only, and the screen must say that a reload forgets a sale in progress.
   */
  durable: () => boolean
  subscribe: (listener: () => void) => () => void
}

export type PendingIo = {
  /** The stored text of a record, or null. May throw (private window): read as nothing. */
  read: (key: string) => string | null
  write: (key: string, text: string) => void
  remove: (key: string) => void
  /** An unused Idempotency-Key. */
  fresh: () => string
}

/** The store without React or a browser, so it is tested as it is. */
export function createPendingStore(io: PendingIo): PendingStore {
  let state: PendingState | null = null
  let durable = true
  const listeners = new Set<() => void>()
  const read = (key: string) => {
    try {
      return io.read(key)
    } catch {
      return null // private window or blocked storage: nothing is remembered across a reload
    }
  }
  const load = () => rehydrate(read(STORAGE_KEY), read(LEGACY_KEY), io.fresh())
  const keep = (next: PendingState) => {
    state = next
    try {
      io.write(STORAGE_KEY, serialize(next))
      io.remove(LEGACY_KEY)
      durable = true
    } catch {
      durable = false // not hidden: `durable()` makes the pay dialog warn that a reload forgets this
    }
    return next
  }
  const apply = (next: PendingState) => {
    if (next === state) return next
    keep(next)
    listeners.forEach((l) => l())
    return next
  }
  /** The stored state is read before anything is decided on it (no listener is told: a render may be the reader). */
  const current = () => state ?? keep(load())
  return {
    current,
    dispatch: (ev) => apply(reduce(current(), ev, io.fresh())),
    send: (methodId, bank) => {
      const { state: next, plan } = planSend(current(), methodId, io.fresh(), bank ?? null)
      apply(next)
      return plan
    },
    // What is in memory is newer than (or equal to) what is stored, so it is the memory that is read "as after a reload".
    open: () => void apply(state ? reopened(state, io.fresh()) : load()),
    durable: () => durable,
    subscribe: (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
}

let tabStore: PendingStore | null = null
/** The tab's one store. Only ever made in the browser: a server render holds no till state. */
function store(): PendingStore {
  tabStore ??= createPendingStore({
    read: (key) => sessionStorage.getItem(key),
    write: (key, text) => sessionStorage.setItem(key, text),
    remove: (key) => sessionStorage.removeItem(key),
    fresh: () => crypto.randomUUID(),
  })
  return tabStore
}

/** What a server render (and the first client render, before the stored state is read) sees: nothing remembered. */
const NOTHING = initialState('')

export type PendingHandle = Pick<PendingStore, 'current' | 'dispatch' | 'send'> & {
  /** The state of this render (for what a screen shows). */
  state: PendingState
  /** Whether the state is stored for a reload (see `PendingStore.durable`). */
  durable: boolean
}

export function usePending(): PendingHandle {
  const state = useSyncExternalStore(
    (l) => store().subscribe(l),
    () => store().current(),
    () => NOTHING,
  )
  useEffect(() => store().open(), [])
  return {
    state,
    // every write follows a state change, which renders this again; before the browser's state is read: nothing to warn of
    durable: state === NOTHING || store().durable(),
    current: () => store().current(),
    dispatch: (ev) => store().dispatch(ev),
    send: (methodId, bank) => store().send(methodId, bank),
  }
}
