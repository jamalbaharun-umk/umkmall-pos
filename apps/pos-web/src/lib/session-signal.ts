// UMK-2124: a handover (or its end) swaps this browser's session. The tab that did it reloads onto the till, and every
// other open tab of the POS is told to reload, so none keeps showing the owner's pages (a profit report, the owner
// shell) to the helper. Pure browser code: localStorage's `storage` event reaches the other tabs, BroadcastChannel
// too where it exists; either one is enough.

export const SESSION_SIGNAL_KEY = 'pos.session.changed'
const CHANNEL = 'pos-session'

/** Tells the other tabs that the session changed. Never throws (storage may be blocked). */
export function announceSessionChange(now = Date.now()): void {
  try {
    localStorage.setItem(SESSION_SIGNAL_KEY, String(now))
  } catch {
    // no storage: BroadcastChannel below may still carry it
  }
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage(now)
    ch.close()
  } catch {
    // an old browser without BroadcastChannel: the storage event carries it
  }
}

const TOAST_KEY = 'pos.toast.after-reload'

/**
 * The acting tab: announce, then load the till afresh (no cached owner page or shell survives). `toast` is shown
 * once the new page has loaded (`takeToastAfterReload`), so the success message is not lost to the reload.
 */
export function switchSessionAndReload(toast?: string, path = '/kasir'): void {
  announceSessionChange()
  try {
    if (toast) sessionStorage.setItem(TOAST_KEY, toast)
  } catch {
    // no storage: the reload goes on without the message
  }
  window.location.replace(path)
}

/** The message a session swap left for this page load, read once. */
export function takeToastAfterReload(): string | null {
  try {
    const t = sessionStorage.getItem(TOAST_KEY)
    sessionStorage.removeItem(TOAST_KEY)
    return t
  } catch {
    return null
  }
}

/** Whether a `storage` event is the session signal (and not another key, or a removal). */
export const isSessionSignal = (e: { key: string | null; newValue: string | null }) =>
  e.key === SESSION_SIGNAL_KEY && e.newValue !== null

/** Listens for another tab's session change; returns the unsubscribe. */
export function onSessionChange(handler: () => void): () => void {
  const onStorage = (e: StorageEvent) => isSessionSignal(e) && handler()
  window.addEventListener('storage', onStorage)
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = () => handler()
  } catch {
    ch = null
  }
  return () => {
    window.removeEventListener('storage', onStorage)
    ch?.close()
  }
}
