import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Avatar } from './Avatar';
import { profileMetaLine } from './profile-header-support';
import { Text } from './Text';
import { tokens } from './theme';

/**
 * The avatar and the text column 16 apart (Figma's header frame). No padding: the page carries
 * its 16 inset, so the avatar starts on the same edge as the plain rows' glyphs below it.
 */
const ROW = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing.md,
} as const satisfies ViewStyle;

export interface ProfileHeaderProps {
  /** The person's name: the bold line, and the avatar's initial. */
  name: string;
  /** The phone number, first half of the muted line. */
  phone?: string;
  /** The business name, second half of the muted line. */
  meta?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The top of Profil (UMK-1601 / UMK-1614, Figma `Mobile/Profile` 14980:77345): a 50 pt `Avatar` —
 * ONE initial, 20 Bold and white on the brand fill ("B" for "Bambang Pamungkas") — then the name
 * in 16 Bold over one 12 Regular line in the light secondary ink, "08123456789 - Donat Bateng".
 * Figma sets that line as three runs 4 apart; one string with spaced " - " reads the same within
 * a point and truncates as one. Either half of that line may be absent, and neither leaves a
 * dangling " - " (`profileMetaLine`); with both absent the line is not drawn at all.
 *
 * ONE ACCESSIBLE ELEMENT: a `header` announcing the name and the line together. The avatar's own
 * `image` label would only say the name a second time, so it is hidden inside the group.
 *
 * Not pressable: the header shows who is signed in, and editing lives in Pengaturan Profil.
 */
export const ProfileHeader = ({ name, phone, meta, style, testID }: ProfileHeaderProps) => {
  const line = profileMetaLine(phone, meta);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="header"
      accessibilityLabel={[name, line].filter(Boolean).join(', ')}
      style={[ROW, style]}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Avatar size="profile" initials="one" name={name} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h6" weight="bold" numberOfLines={1}>
          {name}
        </Text>
        {line !== undefined && (
          <Text variant="bodyLg" color="secondary" numberOfLines={1}>
            {line}
          </Text>
        )}
      </View>
    </View>
  );
};

ProfileHeader.displayName = 'ProfileHeader';
