import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { DISCLOSURE_BASE, DISCLOSURE_PANEL, DISCLOSURE_SUMMARY } from './content-styles';
import { Icon } from './Icon';
import { Text } from './Text';

export interface DisclosureProps {
  /** The always-visible label. */
  title: React.ReactNode;
  /** Start expanded. Folded is the default, which is what a disclosure is for. */
  defaultOpen?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A fold-out panel.
 *
 * The web gets this from `<details>` for free; here the toggle, the state and its
 * announcement are wired by hand, and the announcement is the one a hand-rolled version
 * always forgets — `accessibilityState.expanded` is what makes the fold audible.
 *
 * THE PROP NAMES ARE OURS: `title`, not the a2ui adapter's `summary`.
 */
export const Disclosure = ({ title, defaultOpen = false, children, style }: DisclosureProps) => {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <View style={[DISCLOSURE_BASE, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={DISCLOSURE_SUMMARY}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="md" color="secondary" />
        {typeof title === 'string' ? (
          <Text variant="paragraph" weight="bold" style={{ flex: 1 }}>
            {title}
          </Text>
        ) : (
          <View style={{ flex: 1 }}>{title}</View>
        )}
      </Pressable>
      {open && <View style={DISCLOSURE_PANEL}>{children}</View>}
    </View>
  );
};

Disclosure.displayName = 'Disclosure';
