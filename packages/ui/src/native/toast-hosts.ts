/**
 * Which `Toaster` host draws the queue — ONE at a time (UMK-1487).
 *
 * The app mounts its root host once, and a sheet that must show a toast over itself mounts a
 * second one inside its `Modal` (a `Modal` is its own native window, so the root host draws
 * BENEATH it): the OTP sheet, `Lightbox`, `FeedGrid`'s sheet. When every host drew the queue, the
 * root's copy showed through the sheet's translucent scrim as a dimmed twin of the real toast, and
 * on Android two live regions could each speak it. So hosts register here, the most recently
 * mounted one is the ACTIVE host, and every other host renders nothing — no toast, no dwell timer,
 * no live region. When a nested host unmounts (its sheet closed), the one below it takes over again
 * with whatever is still queued.
 *
 * Pure — no `react-native` import — so vitest can load and pin it (`__tests__/toast-hosts.test.ts`).
 */

export type ToastHostToken = object;

let hosts: readonly ToastHostToken[] = [];
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/** Adds a host on top; returns the function that removes it again. */
export const registerToastHost = (token: ToastHostToken): (() => void) => {
  hosts = [...hosts.filter((h) => h !== token), token];
  notify();
  return () => {
    hosts = hosts.filter((h) => h !== token);
    notify();
  };
};

/** Whether this host draws the queue: it is the most recently mounted host still mounted. */
export const isActiveToastHost = (token: ToastHostToken): boolean => hosts[hosts.length - 1] === token;

/** Called whenever the set of hosts changes. Returns the unsubscribe. */
export const subscribeToastHosts = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
