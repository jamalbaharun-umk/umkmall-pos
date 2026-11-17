import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { initialsOf } from './avatar-support';
import { Icon, type IconSize } from './Icon';
import { Image, isRenderableImageSrc } from './Image';
import { Text } from './Text';
import { measure, tokens, type TextRole } from './theme';

type Axes = typeof contract.Avatar.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type AvatarSize = Of<'size'>;
export type AvatarInitials = Of<'initials'>;

/** How many letters each `initials` value draws (`initialsOf`'s `max`). */
const INITIALS = { two: 2, one: 1 } as const satisfies Record<AvatarInitials, 1 | 2>;

/**
 * Diameter, initials step and glyph step per size, off the measurement ladder and the type
 * scale. The identity's profile card asks for 52; the ladder has no 52 step (48 and 56 sit
 * either side), so `large` takes 56 rather than a literal. Every size clears the 44pt floor
 * only from `medium` up — a `small` avatar inside a tappable row borrows the row's hit area.
 *
 * `profile` is the 50 the Profil redesign draws (`ProfileHeader`, Figma `Mobile/Profile`
 * 14980:77345, UMK-1601) — a size of its own rather than `large` resized under the screens that
 * already read 56. 50 is on no ladder, so it is built the way Figma builds the disc: the initial's
 * own 26 line (`h4`, 20 Bold) with `spacing.sm` (12) round it. Figma sets that initial Bold; the
 * other sizes stay semibold.
 */
const PROFILE_DIAMETER = tokens.typography.mobile.h4.bold.lineHeight + 2 * tokens.spacing.sm;

const SIZE = {
  small: { diameter: measure['2-25'], role: 'paragraph', icon: 'sm', weight: 'semibold' },
  medium: { diameter: measure['2-75'], role: 'h6', icon: 'md', weight: 'semibold' },
  large: { diameter: measure['3-5'], role: 'h5', icon: 'lg', weight: 'semibold' },
  profile: { diameter: PROFILE_DIAMETER, role: 'h4', icon: 'lg', weight: 'bold' },
} as const satisfies Record<AvatarSize, { diameter: number; role: TextRole; icon: IconSize; weight: 'semibold' | 'bold' }>;

export interface AvatarProps {
  size?: AvatarSize;
  /**
   * The person's name. Gives the initials fallback AND the accessible label. Absent, the avatar
   * falls back to the user glyph and is decorative.
   */
  name?: string;
  /**
   * How many letters the initials fallback draws: `two` (default, first and last word) or `one`
   * (first word only — the Profil header's single "B", Figma `Mobile/Profile`, UMK-1601).
   */
  initials?: AvatarInitials;
  /**
   * The photo. Goes through `Image`, so ONLY `https://` is ever requested: anything else shows
   * the fallback with no request made, the same security rule `Image` documents.
   */
  src?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A person in a circle (native-ui-v2): the photo, else their initials in white on the brand
 * fill, else a user glyph on the same fill.
 *
 * THE FALLBACK IS ALWAYS PAINTED, and the photo sits on top of it. A photo that is still
 * loading, or whose request fails, is transparent — so the initials show through rather than a
 * blank disc, without this component tracking load state. `Image`'s own white box is cleared to
 * let that happen.
 *
 * One accessible element: the disc carries the name as an `image`; the photo inside is
 * decorative, so a screen reader announces the person once.
 */
export const Avatar = ({ size = 'medium', initials = 'two', name, src, style, testID }: AvatarProps) => {
  const step = SIZE[size];
  const letters = initialsOf(name, INITIALS[initials]);
  const label = name?.trim() || undefined;

  return (
    <View
      testID={testID}
      accessible={label !== undefined}
      accessibilityRole={label !== undefined ? 'image' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.disc,
        { width: step.diameter, height: step.diameter, backgroundColor: tokens.surface.default.brand },
        style,
      ]}
    >
      {letters ? (
        <Text variant={step.role} weight={step.weight} color="invert" numberOfLines={1}>
          {letters}
        </Text>
      ) : (
        <Icon name="user" size={step.icon} color="invert" />
      )}
      {isRenderableImageSrc(src) ? (
        <Image src={src} type="avatar" fit="cover" decorative style={[StyleSheet.absoluteFill, styles.photo]} />
      ) : null}
    </View>
  );
};

Avatar.displayName = 'Avatar';

const styles = StyleSheet.create({
  /* 9999 rather than `radius.full` (360), for the reason `IMAGE_TYPE.avatar` gives. */
  disc: { borderRadius: 9999, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photo: { backgroundColor: 'transparent' },
});
