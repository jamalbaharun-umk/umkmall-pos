import React from 'react';
import { Image, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
/* The FILE, not the barrel: `utils/index.ts` re-exports `cn`, which pulls `tailwind-merge`
   and `clsx` onto the native import graph for a function that formats a number. */
import { formatFileSize } from '../utils/format-file-size';
import {
  COMPOSER_ATTACHMENT,
  COMPOSER_CAPTION,
  COMPOSER_CLOSE,
  COMPOSER_FILE_BADGE,
  COMPOSER_FILE_CHIP,
  COMPOSER_FILE_TILE,
  COMPOSER_PREVIEW,
  COMPOSER_PREVIEW_SIZE,
  COMPOSER_STATUS,
} from './composer-styles';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { Text } from './Text';

type Axes = typeof contract.ChatAttachment.axes;
export type ChatAttachmentVariant = Axes['variant'][number];
export type ChatAttachmentSize = Axes['size'][number];

/** Not an axis: a lifecycle the host drives, which the chip only reflects. The web's five. */
export type ChatAttachmentStatus = 'idle' | 'compressing' | 'uploading' | 'error' | 'done';

export interface ChatAttachmentProps {
  variant?: ChatAttachmentVariant;
  /** What the user sees. For a file this is the name; for an image it is also the alt text. */
  name: string;
  /** The image treatment's source — a local file URI is expected and must work. */
  previewUrl?: string;
  /** The file treatment's caption — "XLSX", "PDF", or whatever the host decides to call it. */
  typeLabel?: string;
  /** The badge's letters. Falls back to the extension in `name`. */
  extension?: string;
  sizeBytes?: number;
  showSize?: boolean;
  status?: ChatAttachmentStatus;
  /** The `tile` treatment's glyph. Falls back to the generic file glyph. */
  icon?: IconName;
  /** Words under the status glyph (not `done`). The host's copy, in its language. */
  statusLabel?: string;
  /** The image and tile box: the published 80, or the 96 `large`. */
  size?: ChatAttachmentSize;
  /** Makes the image a button, so a host can open it in a lightbox. Image treatment only. */
  onPreview?: () => void;
  /** A filename under the image or tile. The file chip already prints its own name. */
  caption?: string;
  onRemove?: () => void;
  removeLabel?: string;
  /**
   * Anything the host must place INSIDE this attachment — a retry panel, a progress readout, a
   * per-file error. It cannot be a sibling: these overlays are positioned against THIS box, and
   * a host cannot place them from outside it.
   */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Shared with the web, character for character — see `extensionOf` there. */
const extensionOf = (name: string, explicit?: string): string =>
  explicit ?? (name.includes('.') ? (name.split('.').pop() as string) : '?');

/**
 * One attachment in the composer's drawer.
 *
 * `formatFileSize` IS IMPORTED, NOT REIMPLEMENTED, and the contract entry says why: a chip
 * reading "4.8 KB" beside a sent message's card reading "4,915 bytes" is one file described two
 * ways in two places a user sees seconds apart.
 *
 * THE PREVIEW USES CORE `Image`, not the library primitive — the same call the web makes in
 * reverse. There it renders a plain `<img>` because the library `Image` carries an SSRF control
 * that a local blob URL would not survive; here the source is a local file URI for the same
 * reason, and the library `Image`'s `type`/`size` ladder has nothing to say about a fixed 80dp
 * square.
 *
 * THE CHIP MUST NOT CLIP. The remove control sits outside the box (`-right-2 -top-2` on the
 * web), and React Native clips any child overflowing a parent with `overflow: 'hidden'`. Only
 * the preview box sets that, and the control is the box's SIBLING — put it inside and it
 * silently disappears at the corner.
 *
 * THREE TREATMENTS, AND `tile` WAS THE SILENT ONE (UMK-1371). `variant` is typed off the
 * contract, so the day the web gained `tile` this component accepted it and drew the IMAGE
 * branch — an empty grey square, no error. Each value now has its own arm, and the last one is
 * the image only because the image is what remains.
 *
 * THE STATUS IS DRAWN OVER THE TILE, NOT OVER THE CAPTION — the web's rule. The box the veil,
 * the host's `children` and the remove control position against is the inner one; the caption
 * sits under it, outside, or an upload would dim the filename too.
 */
export const ChatAttachment = ({
  variant = 'image',
  name,
  previewUrl,
  typeLabel,
  extension,
  sizeBytes,
  showSize = false,
  status = 'idle',
  icon,
  statusLabel,
  size = 'default',
  onPreview,
  caption,
  onRemove,
  removeLabel = 'Hapus lampiran',
  children,
  style,
}: ChatAttachmentProps) => {
  const meta = [typeLabel ?? extensionOf(name, extension), showSize && sizeBytes !== undefined ? formatFileSize(sizeBytes) : null]
    .filter(Boolean)
    .join(' • ');
  const box = COMPOSER_PREVIEW_SIZE[size];
  const busy = status === 'uploading' || status === 'compressing';

  const preview = (
    <View style={[COMPOSER_PREVIEW, box]}>
      {previewUrl !== undefined && (
        <Image source={{ uri: previewUrl }} accessibilityLabel={name} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      )}
    </View>
  );

  return (
    <View accessibilityLabel={name} accessibilityState={{ busy }} style={[COMPOSER_ATTACHMENT, style]}>
      {/* The anchor its overlays position against: the tile, NOT the caption under it. */}
      <View>
        {variant === 'tile' ? (
          <View style={[COMPOSER_FILE_TILE, box]}>
            <Icon name={icon ?? 'file-generic'} size="xl" color="secondary" />
            <Text variant="bodySm" weight="medium" numberOfLines={1}>
              {extensionOf(name, extension).toUpperCase()}
            </Text>
          </View>
        ) : variant === 'file' ? (
          <View style={COMPOSER_FILE_CHIP}>
            <View accessibilityElementsHidden style={COMPOSER_FILE_BADGE}>
              <Text variant="bodySm" weight="semibold" color="invert">
                {extensionOf(name, extension).slice(0, 4).toUpperCase()}
              </Text>
            </View>
            <View style={{ minWidth: 0, flexShrink: 1 }}>
              <Text variant="bodyLg" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="bodyMd" color="secondary">
                {meta.toUpperCase()}
              </Text>
            </View>
          </View>
        ) : onPreview !== undefined ? (
          <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onPreview}>
            {preview}
          </Pressable>
        ) : (
          preview
        )}

        {/* Inert, so a tap on a tile that is still uploading reaches the preview under it. */}
        {status !== 'idle' && (
          <View pointerEvents="none" style={COMPOSER_STATUS[status]}>
            {busy ? (
              /* Decorative: the busy state is already on the attachment, and the words are below. */
              <Spinner variant="white" size="sm" label="" />
            ) : (
              <Icon name={status === 'done' ? 'check' : 'alert-triangle'} size="sm" color="invert" />
            )}
            {statusLabel !== undefined && status !== 'done' && (
              <Text variant="bodySm" weight="medium" color="invert" style={{ textAlign: 'center' }}>
                {statusLabel}
              </Text>
            )}
          </View>
        )}

        {children}

        {onRemove !== undefined && (
          <Pressable accessibilityRole="button" accessibilityLabel={removeLabel} onPress={onRemove} style={COMPOSER_CLOSE}>
            <Icon name="x" size="sm" color="primary" />
          </Pressable>
        )}
      </View>

      {caption !== undefined && variant !== 'file' && (
        <Text variant="paragraph" numberOfLines={1} style={[COMPOSER_CAPTION, { width: box.width, textAlign: 'center' }]}>
          {caption}
        </Text>
      )}
    </View>
  );
};

ChatAttachment.displayName = 'ChatAttachment';
