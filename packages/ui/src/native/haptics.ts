import * as Haptics from 'expo-haptics';

/**
 * The haptics of the native-ui-v2 motion contract (UMK-1602): the one place a view asks the phone to
 * tick, so no view imports `expo-haptics` itself and the set of haptics stays the reviewed list.
 *
 * A kind lands with its first caller and not before (nothing in V2 is left unused):
 *
 * | Kind | Where |
 * | -- | -- |
 * | `selection` | a switch to another tab (`TabBar`) |
 * | `light` | a press on the header bell (UMK-1605) |
 * | `success` | a success toast shown (`Toaster`, UMK-1601) |
 * | `error` | a danger toast shown (`Toaster`, UMK-1601) |
 *
 * Fire and forget. A device with no haptics, or the web, rejects or throws; that is silent, because a
 * missing tick must never cost the reader the action it accompanied. The module is imported
 * statically, as `glass.tsx` imported `expo-blur` until UMK-1603: `expo-haptics` is a native module, so it moves the
 * runtime fingerprint and reaches a phone only in a binary built with it (the `fingerprint` update
 * policy in `apps/mobile/app.config.ts`), never as an over-the-air update to an older one.
 */
export type HapticKind = 'selection' | 'light' | 'success' | 'error';

/** Each kind's call. A record rather than a chain of ternaries, so a kind added to the union without
 *  its call does not compile — and cannot fall through to another kind's tick. */
const PLAY: Record<HapticKind, () => Promise<void>> = {
  selection: () => Haptics.selectionAsync(),
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

export const haptic = (kind: HapticKind): void => {
  try {
    const played = PLAY[kind]();
    void played?.catch(() => undefined);
  } catch {
    /* A synchronous throw from a missing or unavailable module: as silent as a rejection. */
  }
};
