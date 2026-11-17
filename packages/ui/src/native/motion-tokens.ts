import { tokens } from '../tokens';

/**
 * The pure half of the native-ui-v2 motion layer: `tokens.motion` resolved to plain numbers,
 * with no `react-native` import, so vitest can load it (`react-native`'s entry is Flow and does
 * not load there). `motion.tsx` turns these into `Animated` configs.
 */

const M = tokens.motion;

/** `cubic-bezier(a, b, c, d)` → its four numbers. The token is a CSS string so the web can
 *  read it too; native parses it ONCE. A malformed token throws at import rather than letting
 *  every animation in the app silently ease linearly. */
export const parseCubicBezier = (css: string): [number, number, number, number] => {
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(css.trim());
  if (!m) throw new Error(`motion: "${css}" is not a cubic-bezier() token`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
};

/** Every motion value the identity publishes, as numbers. */
export const MOTION = {
  duration: M.duration,
  easing: { standard: parseCubicBezier(M.easing.standard), exit: parseCubicBezier(M.easing.exit) },
  spring: {
    press: { damping: M.spring.press.damping, stiffness: M.spring.press.stiffness, mass: 1 },
    sheet: { damping: M.spring.sheet.damping, stiffness: M.spring.sheet.stiffness, mass: 1 },
    /** Fast with no visible overshoot: the tab bar's indicator (UMK-1604). */
    snappy: { damping: M.spring.snappy.damping, stiffness: M.spring.snappy.stiffness, mass: 1 },
    /** A visible overshoot: the header bell's badge popping in (UMK-1605). A SPRING — not `pop`
     *  below, which is the tab icon's scale keyframes. */
    pop: { damping: M.spring.pop.damping, stiffness: M.spring.pop.stiffness, mass: 1 },
  },
  stagger: M.stagger,
  distance: M.distance,
  /** Waits before a beat that must land after another: the toast's check pops `toastIcon` after the
   *  toast starts in (UMK-1601). One named member per wait, never a free number. */
  delay: M.delay,
  scale: M.scale.press,
  /** The newly active tab icon's pop: 1 → `squash` → `overshoot` → 1 (identity §7.2 "Tab switch"). */
  pop: M.scale.pop,
  /** The header bell's ring (UMK-1605): four swings about its top-centre pivot, in degrees, each
   *  over `duration.ring`, then a fifth back to rest. Four scalar tokens, assembled here: the token
   *  pipeline has no array type. */
  ring: { angles: [M.rotate.ring['1'], M.rotate.ring['2'], M.rotate.ring['3'], M.rotate.ring['4']] as const },
} as const;

export type PressScale = keyof typeof MOTION.scale;

/** The delay before list item `index` enters: one step per item, capped at `stagger.max`
 *  items so a long list's tail does not wait seconds for its turn. */
export const staggerDelay = (index: number): number =>
  Math.min(Math.max(index, 0), MOTION.stagger.max - 1) * MOTION.stagger.step;
