import { contract } from '../contract';
import { tokens } from './theme';

type Axes = typeof contract.Button.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * What one Button cell paints in one state. Every value is a resolved token hex (or
 * `transparent`), never a palette WORD: the published ramp moves the ink per state —
 * `text.hover.invert`, `text.disable.brand` — and the `TextColor` vocabulary names only the
 * default step and a single disable, so reading the ink through it would round every hover
 * and every disabled ink to the nearest word.
 */
export interface ButtonPaint {
  backgroundColor: string;
  ink: string;
  /** Absent on a cell Figma draws with no stroke. */
  borderColor?: string;
}

export interface ButtonTreatment {
  rest: ButtonPaint;
  /** Where the web has `hover:` — touch has no hover, and `pressed` is its reading. */
  pressed: ButtonPaint;
  /** Taken by `disabled` AND by `isLoading`, which disables the button on both surfaces. */
  disabled: ButtonPaint;
  /** 1px everywhere Figma strokes, except `dark`, whose published stroke is 2px. */
  strokeWidth: 0 | 1 | 2;
  spinner: 'primary' | 'white' | 'gray';
}

const { surface: s, text: t, border: b } = tokens;
const clear = 'transparent';

/**
 * THE NATIVE READING OF THE WEB'S `FILLED`/`OUTLINED`/`BARE` TABLES (UMK-1091), cell for cell.
 *
 * Transcribed from Figma's `General` 120:202 matrix — 3 types x 4 colours x 3 states, read
 * 2026-09-18 — through the same tokens the web classes name: a `bg-` class reads the Surface
 * group, `text-` the Text group, `ring-` the Border group. `button-paint.test.ts` resolves
 * the web's class strings through those three groups and requires this table to agree with
 * them in every cell and state, so the two surfaces cannot drift apart silently.
 *
 * **`dark` IS A BUTTON FOR DARK CHROME** — white ink at every type and state, a near-black
 * fill, a LIGHT `#F0F0F0` stroke. This table used to read `dark` as navy ink on a light
 * surface (the legacy palette's meaning), which draws a ghost or text `dark` button invisibly
 * on the chrome it exists for. A call site on a light surface wants `light`.
 *
 * **NO OPACITY FADE.** Each cell carries its own disabled paint. One `opacity: 0.5` made four
 * disabled colours look like one and is not a treatment Figma publishes.
 */
export const BUTTON_TREATMENT = {
  primary: {
    primary: {
      rest: { backgroundColor: s.default.brand, ink: t.default.invert },
      pressed: { backgroundColor: s.hover.brand, ink: t.hover.invert },
      disabled: { backgroundColor: s.disable.brand, ink: t.default.invert },
      strokeWidth: 0,
      spinner: 'white',
    },
    light: {
      rest: { backgroundColor: s.default.primary, ink: t.default.primary, borderColor: b.default.primary },
      pressed: { backgroundColor: s.weak.brand, ink: t.hover.primary, borderColor: b.hover.primary },
      disabled: { backgroundColor: s.disable.primary, ink: t.disable.primary, borderColor: b.disable.primary },
      strokeWidth: 1,
      spinner: 'gray',
    },
    danger: {
      rest: { backgroundColor: s.default.error, ink: t.default.invert },
      pressed: { backgroundColor: s.hover.error, ink: t.hover.invert },
      disabled: { backgroundColor: s.disable.error, ink: t.hover.invert },
      strokeWidth: 0,
      spinner: 'white',
    },
    dark: {
      rest: { backgroundColor: s.default.invert, ink: t.default.invert, borderColor: b.default.primary },
      pressed: { backgroundColor: s.hover.invert, ink: t.default.invert, borderColor: b.hover.primary },
      disabled: { backgroundColor: s.disable.invert, ink: t.disable.invert, borderColor: b.disable.invert },
      strokeWidth: 2,
      spinner: 'white',
    },
  },
  ghost: {
    primary: {
      rest: { backgroundColor: clear, ink: t.default.brand, borderColor: b.default.brand },
      pressed: { backgroundColor: s.weak.brand, ink: t.hover.brand, borderColor: b.hover.brand },
      disabled: { backgroundColor: clear, ink: t.disable.brand, borderColor: b.disable.brand },
      strokeWidth: 1,
      spinner: 'primary',
    },
    light: {
      rest: { backgroundColor: clear, ink: t.default.primary, borderColor: b.default.primary },
      pressed: { backgroundColor: s.weak.brand, ink: t.hover.primary, borderColor: b.hover.primary },
      disabled: { backgroundColor: clear, ink: t.disable.primary, borderColor: b.disable.primary },
      strokeWidth: 1,
      spinner: 'gray',
    },
    danger: {
      rest: { backgroundColor: clear, ink: t.default.error, borderColor: b.default.error },
      pressed: { backgroundColor: s.weak.error, ink: t.hover.error, borderColor: b.hover.error },
      disabled: { backgroundColor: clear, ink: t.disable.error, borderColor: b.disable.error },
      strokeWidth: 1,
      spinner: 'primary',
    },
    dark: {
      rest: { backgroundColor: clear, ink: t.default.invert, borderColor: b.default.primary },
      pressed: { backgroundColor: s.hover.invert, ink: t.default.invert, borderColor: b.hover.primary },
      disabled: { backgroundColor: clear, ink: t.disable.invert, borderColor: b.disable.invert },
      strokeWidth: 2,
      spinner: 'white',
    },
  },
  outline: {
    primary: {
      rest: { backgroundColor: s.default.primary, ink: t.default.brand, borderColor: b.default.brand },
      pressed: { backgroundColor: s.weak.brand, ink: t.hover.brand, borderColor: b.hover.brand },
      disabled: { backgroundColor: s.default.primary, ink: t.disable.brand, borderColor: b.disable.brand },
      strokeWidth: 1,
      spinner: 'primary',
    },
    light: {
      rest: { backgroundColor: s.default.primary, ink: t.default.primary, borderColor: b.default.primary },
      pressed: { backgroundColor: s.weak.brand, ink: t.hover.primary, borderColor: b.hover.primary },
      disabled: { backgroundColor: s.default.primary, ink: t.disable.primary, borderColor: b.disable.primary },
      strokeWidth: 1,
      spinner: 'gray',
    },
    danger: {
      rest: { backgroundColor: s.default.primary, ink: t.default.error, borderColor: b.default.error },
      pressed: { backgroundColor: s.weak.error, ink: t.hover.error, borderColor: b.hover.error },
      disabled: { backgroundColor: s.default.primary, ink: t.disable.error, borderColor: b.disable.error },
      strokeWidth: 1,
      spinner: 'primary',
    },
    dark: {
      rest: { backgroundColor: s.default.invert, ink: t.default.invert, borderColor: b.default.primary },
      pressed: { backgroundColor: s.hover.invert, ink: t.default.invert, borderColor: b.hover.primary },
      disabled: { backgroundColor: s.default.invert, ink: t.disable.invert, borderColor: b.disable.invert },
      strokeWidth: 2,
      spinner: 'white',
    },
  },
  text: {
    primary: {
      rest: { backgroundColor: clear, ink: t.default.brand },
      pressed: { backgroundColor: s.weak.brand, ink: t.hover.brand },
      disabled: { backgroundColor: clear, ink: t.disable.brand },
      strokeWidth: 0,
      spinner: 'primary',
    },
    light: {
      rest: { backgroundColor: clear, ink: t.default.primary },
      pressed: { backgroundColor: s.weak.brand, ink: t.hover.primary },
      disabled: { backgroundColor: clear, ink: t.disable.primary },
      strokeWidth: 0,
      spinner: 'gray',
    },
    danger: {
      rest: { backgroundColor: clear, ink: t.default.error },
      pressed: { backgroundColor: s.weak.error, ink: t.hover.error },
      disabled: { backgroundColor: clear, ink: t.disable.error },
      strokeWidth: 0,
      spinner: 'primary',
    },
    dark: {
      rest: { backgroundColor: clear, ink: t.default.invert },
      pressed: { backgroundColor: s.hover.invert, ink: t.hover.invert },
      disabled: { backgroundColor: clear, ink: t.disable.invert },
      strokeWidth: 0,
      spinner: 'white',
    },
  },
} as const satisfies Record<Of<'type'>, Record<Of<'color'>, ButtonTreatment>>;

/**
 * The one resolution from a cell and its interaction state to a paint. `inert` wins over
 * `pressed`: a disabled button that is somehow pressed (the playbook forces it) must still
 * read as disabled.
 */
export const buttonPaint = (
  treatment: ButtonTreatment,
  { pressed, inert }: { pressed: boolean; inert: boolean },
): ButtonPaint => (inert ? treatment.disabled : pressed ? treatment.pressed : treatment.rest);
