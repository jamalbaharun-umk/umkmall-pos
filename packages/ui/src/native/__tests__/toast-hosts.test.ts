import { afterEach, describe, expect, it } from 'vitest';
import { isActiveToastHost, registerToastHost, subscribeToastHosts } from '../toast-hosts';

/**
 * One toast, one host (UMK-1487).
 *
 * Every mounted `Toaster` used to draw the whole queue, so a sheet with its own host showed each
 * toast twice: its own over the scrim, and the root host's through the scrim as a dimmed twin (seen
 * on the iPhone 18 Pro over the OTP sheet). The registry decides which ONE host draws; `Toaster.tsx`
 * returns nothing unless `isActiveToastHost` says it is the one. The render-level half — two
 * `Toaster`s mounted, one toast on screen — is `apps/mobile/src/design/__tests__/toaster-one-host.test.tsx`.
 *
 * PROVED RED: `isActiveToastHost` returning `hosts.includes(token)` (every mounted host active, the
 * old behaviour) fails "only the nested host draws while it is mounted".
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
const mount = (token: object) => {
  const unregister = registerToastHost(token);
  cleanups.push(unregister);
  return unregister;
};

describe('toast hosts', () => {
  it('a lone root host draws', () => {
    const root = {};
    mount(root);
    expect(isActiveToastHost(root)).toBe(true);
  });

  it('only the nested host draws while it is mounted', () => {
    const root = {};
    const sheet = {};
    mount(root);
    mount(sheet);
    expect([isActiveToastHost(root), isActiveToastHost(sheet)]).toEqual([false, true]);
  });

  it('hands the queue back to the root host when the nested one unmounts', () => {
    const root = {};
    const sheet = {};
    mount(root);
    const unmountSheet = mount(sheet);
    unmountSheet();
    expect(isActiveToastHost(root)).toBe(true);
    expect(isActiveToastHost(sheet)).toBe(false);
  });

  it('tells every host when the active one changes', () => {
    const root = {};
    mount(root);
    let calls = 0;
    const unsubscribe = subscribeToastHosts(() => calls++);
    const unmountSheet = mount({});
    unmountSheet();
    unsubscribe();
    expect(calls).toBe(2);
  });

  it('a host never mounted does not draw', () => {
    mount({});
    expect(isActiveToastHost({})).toBe(false);
  });
});
