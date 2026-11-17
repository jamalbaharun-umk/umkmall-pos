import React from 'react';
import { Image as RNImage, View, type ImageResizeMode, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { IMAGE_BASE, IMAGE_PLACEHOLDER, IMAGE_SIZE, IMAGE_TYPE } from './content-styles';
import { Text } from './Text';

type Axes = typeof contract.Image.axes;

export type ImageType = Axes['type'][number];
export type ImageSize = Axes['size'][number];

const TYPE = IMAGE_TYPE satisfies Record<ImageType, ViewStyle>;
const SIZE = IMAGE_SIZE satisfies Record<ImageSize, ViewStyle>;

/** How the photo sits inside its box, as the platform's resize modes. */
const FIT = {
  contain: 'contain',
  cover: 'cover',
  fill: 'stretch',
} as const satisfies Record<string, ImageResizeMode>;

export type ImageFit = keyof typeof FIT;

interface ImageBase {
  /** Only `https://` is rendered. Anything else becomes the placeholder — see the docblock. */
  src: string;
  type?: ImageType;
  size?: ImageSize;
  fit?: ImageFit;
  /** Shown in place of the image when there is nothing to show. */
  placeholder?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * `alt` OR an explicit decorative opt-out, never neither — the same rule as the web, so an
 * unlabelled photo is a word someone has to type rather than a silent default.
 *
 * NO `hover` HERE. Figma's `Hover` variant is taken as a boolean on the web; touch has no
 * hover, and a prop that does nothing on the platform it is offered on is the
 * looks-right-does-nothing shape this package refuses elsewhere. The shared surface is what
 * both platforms can honour: `src`, `type`, `size`, `fit`, the label.
 */
export type ImageProps = ImageBase & ({ alt: string } | { decorative: true; alt?: never });

/**
 * Whether `Image` will request this source at all. The ONE copy of the rule — `Avatar` asks
 * it too, to decide between the photo and its fallback, rather than restating the pattern.
 *
 * ANCHORED, case-insensitive: a scheme is case-insensitive per RFC 3986, and matching
 * anywhere in the string would let `http://evil/?x=https://` through.
 */
export const isRenderableImageSrc = (src: string | undefined): src is string => !!src && /^https:\/\//i.test(src);

/**
 * A photo in a fixed box, on the core `Image`.
 *
 * THE NON-HTTPS BRANCH IS A SECURITY CONTROL, not an empty state that happens to look tidy:
 * a non-https `src` renders the placeholder and NO image, so no request is made at all.
 *
 * `expo-image` is DELIBERATELY not pulled in here — this package carries no Expo
 * dependency, so the web build never has to resolve it. An app wanting caching and
 * priority wraps this with its own.
 */
export const Image = (props: ImageProps) => {
  const { src, type = 'thumbnail', size = 'regular', fit = type === 'avatar' ? 'cover' : 'contain', placeholder = 'Tidak ada gambar', style } = props;
  const alt = 'alt' in props && props.alt !== undefined ? props.alt : undefined;
  const box = [IMAGE_BASE, TYPE[type], SIZE[size], style];

  if (!isRenderableImageSrc(src)) {
    return (
      <View style={[...box, IMAGE_PLACEHOLDER]} accessibilityLabel={alt}>
        {typeof placeholder === 'string' ? (
          <Text variant="bodyLg" color="secondary">
            {placeholder}
          </Text>
        ) : (
          placeholder
        )}
      </View>
    );
  }

  return (
    <View style={box}>
      <RNImage
        source={{ uri: src }}
        resizeMode={FIT[fit]}
        accessible={alt !== undefined}
        accessibilityRole={alt !== undefined ? 'image' : undefined}
        accessibilityLabel={alt}
        accessibilityElementsHidden={alt === undefined}
        importantForAccessibility={alt === undefined ? 'no-hide-descendants' : 'auto'}
        style={type === 'natural' ? { width: '100%', aspectRatio: 1 } : { width: '100%', height: '100%' }}
      />
    </View>
  );
};

Image.displayName = 'Image';
