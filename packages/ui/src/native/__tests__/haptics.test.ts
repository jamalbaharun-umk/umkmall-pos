import { beforeEach, describe, expect, it, vi } from 'vitest';

/* `expo-haptics` is a native module: its real entry imports React Native, which vitest cannot load.
   The factory replaces it before anything resolves, and the spy is hoisted with it. */
const { selectionAsync, impactAsync, notificationAsync } = vi.hoisted(() => ({
  selectionAsync: vi.fn<() => Promise<void>>(),
  impactAsync: vi.fn<(style: string) => Promise<void>>(),
  notificationAsync: vi.fn<(type: string) => Promise<void>>(),
}));
vi.mock('expo-haptics', () => ({
  selectionAsync,
  impactAsync,
  notificationAsync,
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import { haptic } from '../haptics';

describe('haptic (UMK-1604, motion contract UMK-1602)', () => {
  beforeEach(() => {
    selectionAsync.mockReset();
    selectionAsync.mockResolvedValue(undefined);
    impactAsync.mockReset();
    impactAsync.mockResolvedValue(undefined);
    notificationAsync.mockReset();
    notificationAsync.mockResolvedValue(undefined);
  });

  it("'light' plays the platform's LIGHT impact, once per call, and no selection tick (UMK-1605: the header bell)", () => {
    haptic('light');
    expect(impactAsync).toHaveBeenCalledTimes(1);
    expect(impactAsync).toHaveBeenCalledWith('light');
    expect(selectionAsync).not.toHaveBeenCalled();
  });

  it("a rejected 'light' is handled as silently as a rejected selection", () => {
    const rejected = Promise.reject(new Error('UnavailabilityError'));
    const handled = vi.spyOn(rejected, 'catch');
    impactAsync.mockReturnValue(rejected);
    expect(() => haptic('light')).not.toThrow();
    expect(handled).toHaveBeenCalledTimes(1);
    return rejected.then(
      () => undefined,
      () => undefined,
    );
  });

  it("'selection' plays the platform's selection tick, once per call", () => {
    haptic('selection');
    expect(selectionAsync).toHaveBeenCalledTimes(1);
    haptic('selection');
    expect(selectionAsync).toHaveBeenCalledTimes(2);
  });

  it('a device with no haptics (the call rejects) is silent: nothing throws and the rejection is handled', () => {
    /* Vitest does not report an unhandled rejection here, so "nothing is unhandled" is checked at the
       source: the rejected call must get a handler attached. */
    const rejected = Promise.reject(new Error('UnavailabilityError: haptics are not available on web'));
    const handled = vi.spyOn(rejected, 'catch');
    selectionAsync.mockReturnValue(rejected);
    expect(() => haptic('selection')).not.toThrow();
    expect(handled).toHaveBeenCalledTimes(1);
    return rejected.then(
      () => undefined,
      () => undefined,
    );
  });

  /* UMK-1601: the toast host's two kinds. Each is the platform's NOTIFICATION feedback, not an impact or
     a selection tick, and each plays its OWN type — a success that played the error buzz is the bug a
     "was called" check alone would pass. */
  it.each([
    ['success', 'success'],
    ['error', 'error'],
  ] as const)("'%s' plays the platform's %s notification, once per call, and nothing else", (kind, type) => {
    haptic(kind);
    expect(notificationAsync).toHaveBeenCalledTimes(1);
    expect(notificationAsync).toHaveBeenCalledWith(type);
    expect(impactAsync).not.toHaveBeenCalled();
    expect(selectionAsync).not.toHaveBeenCalled();
  });

  it.each(['success', 'error'] as const)("a rejected '%s' is handled as silently as the others", (kind) => {
    const rejected = Promise.reject(new Error('UnavailabilityError'));
    const handled = vi.spyOn(rejected, 'catch');
    notificationAsync.mockReturnValue(rejected);
    expect(() => haptic(kind)).not.toThrow();
    expect(handled).toHaveBeenCalledTimes(1);
    return rejected.then(
      () => undefined,
      () => undefined,
    );
  });

  it.each(['success', 'error'] as const)("a '%s' whose module throws synchronously is silent too", (kind) => {
    notificationAsync.mockImplementation(() => {
      throw new Error('native module missing');
    });
    expect(() => haptic(kind)).not.toThrow();
  });

  it('a call that throws synchronously is silent too', () => {
    selectionAsync.mockImplementation(() => {
      throw new Error('native module missing');
    });
    expect(() => haptic('selection')).not.toThrow();
  });
});
