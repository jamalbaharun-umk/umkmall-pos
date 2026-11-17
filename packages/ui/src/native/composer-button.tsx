import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import {
  COMPOSER_BUTTON_ACTIVE,
  COMPOSER_BUTTON_BADGE,
  COMPOSER_BUTTON_BASE,
  COMPOSER_BUTTON_DISABLED,
  COMPOSER_BUTTON_IDLE,
  COMPOSER_BUTTON_SIZE,
} from './composer-styles';
import { Icon, type IconName } from './Icon';
import type { TextColor } from './theme';

export type ComposerButtonKind = keyof typeof COMPOSER_BUTTON_IDLE;

/*
 * The base's own reading of the toggle axis. Each wrapper ALSO types its `state` from its own
 * entry, so a wrapper whose entry widens away from this one stops compiling where it hands the
 * value down — the web keeps the same three in step with a test, this keeps them with `tsc`.
 */
type Axes = typeof contract.ChatToolsButton.axes;
export type ComposerButtonState = Axes['state'][number];
/* The same arrangement for `size`: all four entries declare `compact | landing`, each wrapper
   types its own prop off its own entry, and this is the base's reading of the shared pair. */
export type ComposerButtonSize = Axes['size'][number];

/**
 * The props all four composer buttons share. The ENGAGED state is not here: the three toggles
 * add the contract's `state` axis in their own files, and send adds its own three-value axis.
 */
export interface ComposerButtonProps extends Omit<PressableProps, 'style' | 'children' | 'disabled'> {
  /** The accessible name. Required — the button has no text. */
  label: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The glyph box. Figma draws the active MINUS at 24 and every other glyph at 20 — the web's
 * `COMPOSER_GLYPH.wide` and `.default` — so the size follows the glyph actually drawn rather
 * than the button. Native drew the minus at 20 until UMK-1128.
 *
 * ON `landing` EVERY GLYPH GOES UP A RUNG, the web's `COMPOSER_GLYPH_LANDING`: 20 becomes 24.
 * ONE KNOWN SIZE DELTA: the web draws the landing minus at 28, and `Icon`'s ladder is closed
 * with no 28 step (24, then 32 — which is a block inside a 36 circle), so it draws at 24 here.
 */
const glyphSizeFor = (name: IconName, size: ComposerButtonSize): 'md' | 'lg' =>
  size === 'landing' || name === 'composer-minus' ? 'lg' : 'md';

/**
 * The shape the four composer buttons share. Not exported from the package — each button is
 * its own export, exactly as on the web, because the KIND is not a prop a caller chooses.
 */
export const ComposerButton = ({
  kind,
  glyph,
  toggle,
  glyphSize,
  fill,
  badge = false,
  size = 'compact',
  state = 'default',
  label,
  disabled,
  style,
  ...props
}: ComposerButtonProps & {
  kind: ComposerButtonKind;
  glyph: { default: IconName; active: IconName };
  /** Announce the selected state. Off for buttons that are actions rather than toggles. */
  toggle: boolean;
  /**
   * Overrides the glyph sizing rule above — send's stop square and spinner sit tighter.
   *
   * Deliberately NARROWER than what the rule can produce: `glyphSizeFor` returns `'lg'` for the
   * open-menu minus (24, matching the web and the published set), but an override may only go
   * smaller, because its one caller is send's tighter glyphs. A caller cannot opt into `lg` by
   * override — only the minus rule reaches it. Widen this union, not the rule, if that changes.
   */
  glyphSize?: 'sm' | 'md';
  /** A per-state treatment over the resting one, while enabled — send's `stop`. */
  fill?: ViewStyle & { ink?: TextColor };
  /** The corner dot. Only the tools button publishes it — see `ChatToolsButton`. */
  badge?: boolean;
  size?: ComposerButtonSize;
  state?: ComposerButtonState;
}) => {
  /* The boolean survives INSIDE, where the API it feeds is boolean-shaped. */
  const active = state === 'active';
  const treatment = disabled
    ? { ...COMPOSER_BUTTON_IDLE[kind], ...COMPOSER_BUTTON_DISABLED[kind] }
    : active
      ? COMPOSER_BUTTON_ACTIVE[kind]
      : { ...COMPOSER_BUTTON_IDLE[kind], ...fill };
  const { ink, ...box } = treatment as ViewStyle & { ink: TextColor };
  const name = active ? glyph.active : glyph.default;

  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={label}
      /* Announced only for the buttons that genuinely toggle. Emitting a pressed state on an
         action button tells a screen reader it is a switch, which it is not. */
      accessibilityState={toggle ? { selected: active, disabled: Boolean(disabled) } : { disabled: Boolean(disabled) }}
      disabled={disabled}
      style={[COMPOSER_BUTTON_BASE, COMPOSER_BUTTON_SIZE[size], box, style]}
    >
      <Icon name={name} size={glyphSize ?? glyphSizeFor(name, size)} color={ink} />
      {/* Drawn, not spoken: what the dot means is the host's to put in `label`. */}
      {badge && <View accessibilityElementsHidden importantForAccessibility="no" style={COMPOSER_BUTTON_BADGE} />}
    </Pressable>
  );
};
