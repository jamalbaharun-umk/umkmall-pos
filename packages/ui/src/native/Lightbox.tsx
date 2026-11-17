import React from 'react';
import { BackHandler, Image, Modal, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import {
  LIGHTBOX_ACTION,
  LIGHTBOX_ACTIONS,
  LIGHTBOX_CLOSE,
  LIGHTBOX_IMAGE,
  LIGHTBOX_PANEL,
  LIGHTBOX_SCRIM,
} from './overlay-styles';
import { Text } from './Text';

export interface LightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A URI, where the web takes a URL. */
  src: string;
  /**
   * The image's accessible name. Empty makes it decorative, matching the web — a viewer
   * opened FROM a described thumbnail need not repeat the description.
   */
  alt?: string;
  /** Names the viewer itself, distinctly from the image inside it. */
  label?: string;
  onDownload?: () => void;
  onShare?: () => void;
  downloadLabel?: string;
  shareLabel?: string;
  closeLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A full-bleed image viewer.
 *
 * NOT BUILT ON `Dialog`, and that is the one structural call worth stating. The web composes
 * the Radix dialog directly for its scroll lock, focus trap and background inertness; native
 * has none of those problems, because a `Modal` there is already its own layer and already
 * inert behind. Reaching for our own `Dialog` would bring a sheet's handle, its swipe, its
 * size ladder and its panel chrome to a component whose whole design is "nothing but the
 * image" — so it takes `Modal` directly, exactly as the web takes Radix directly.
 *
 * NO ZOOM AND NO GALLERY, matching the web. Both are real features and neither is this
 * component; adding them here would make the two surfaces diverge in what a lightbox IS.
 *
 * THE BACKDROP DISMISSES, THE IMAGE DOES NOT. The web decides this on `pointerdown` rather
 * than click, because a drag beginning on the image and ending on the panel reports the panel
 * as the target and would close the viewer on every slipped press. Native gets that for free:
 * the scrim is its own sibling `Pressable`, so a press on the image never reaches it. Same
 * behaviour, and here it is structural rather than defended.
 */
export const Lightbox = ({
  open,
  onOpenChange,
  src,
  alt = '',
  label = 'Pratinjau gambar',
  onDownload,
  onShare,
  downloadLabel = 'Unduh',
  shareLabel = 'Bagikan',
  closeLabel = 'Tutup',
  style,
}: LightboxProps) => {
  const close = () => onOpenChange(false);

  /* Android's hardware Back closes the viewer, which `Modal`'s `onRequestClose` gives us. The
     subscription is belt-and-braces for the case where a host renders this outside a
     navigator that would otherwise swallow the event. */
  React.useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      /* `onOpenChange` rather than the `close` helper: that one is rebuilt every render, so
         depending on it would tear down and re-add the listener on each one. Depending on the
         prop instead keeps the subscription tied to what actually changes. */
      onOpenChange(false);
      return true;
    });
    return () => sub.remove();
  }, [open, onOpenChange]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close} accessibilityViewIsModal>
      <View style={[{ flex: 1 }, style]}>
        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={close} style={LIGHTBOX_SCRIM} />

        <View accessibilityViewIsModal accessibilityLabel={label} pointerEvents="box-none" style={LIGHTBOX_PANEL}>
          <Image
            source={{ uri: src }}
            resizeMode="contain"
            accessible={alt !== ''}
            accessibilityRole={alt === '' ? undefined : 'image'}
            accessibilityLabel={alt === '' ? undefined : alt}
            accessibilityElementsHidden={alt === ''}
            importantForAccessibility={alt === '' ? 'no-hide-descendants' : 'yes'}
            style={LIGHTBOX_IMAGE}
          />
        </View>

        {(onDownload !== undefined || onShare !== undefined) && (
          <View style={LIGHTBOX_ACTIONS}>
            {onDownload !== undefined && (
              <Pressable accessibilityRole="button" accessibilityLabel={downloadLabel} onPress={onDownload} style={LIGHTBOX_ACTION}>
                <Icon name="download" size="sm" color="primary" />
                <Text variant="bodyLg" weight="medium">
                  {downloadLabel}
                </Text>
              </Pressable>
            )}
            {onShare !== undefined && (
              <Pressable accessibilityRole="button" accessibilityLabel={shareLabel} onPress={onShare} style={LIGHTBOX_ACTION}>
                <Icon name="share" size="sm" color="primary" />
                <Text variant="bodyLg" weight="medium">
                  {shareLabel}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={close} style={LIGHTBOX_CLOSE}>
          <Icon name="x" size="md" color="primary" />
        </Pressable>
      </View>
    </Modal>
  );
};

Lightbox.displayName = 'Lightbox';
