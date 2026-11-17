import React from 'react';
import {
  Image as RNImage,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { CoinGlyph } from './coin-glyph';
import {
  COIN_CHIP_SIZE,
  DISABLED_OPACITY,
  MUTED_TEXT,
  PHOTO_CARD_CLIP,
  PHOTO_CARD_CTA,
  PHOTO_CARD_FRAME,
  PHOTO_CARD_PRICE,
  PHOTO_CARD_TEXT,
  PHOTO_CARD_TITLE_COLUMN,
  coverAnchoredSize,
  formatCoins,
  type Size,
} from './identity-card-styles';
import { PressableScale } from './motion';
import { Text } from './Text';
import { tokens } from './theme';

/** The CTA's default label (§4.3). */
const PHOTO_CARD_DEFAULT_CTA = 'Mulai';

export interface PhotoCardProps {
  /**
   * The cover art: a bundled asset (`require(...)`, how journey art ships today) or an `{ uri }`.
   * A remote `uri` must be `https://` — anything else draws NO image and makes no request, the
   * same rule (and the same anchored, case-insensitive check) as the library `Image`.
   */
  image: ImageSourcePropType;
  title: string;
  description?: string;
  /**
   * The coin price for the corner tab, read from the live price book. Omit it (or pass `null`
   * when the book has no price) and there is no tab: the card never shows a guess.
   */
  price?: number | null;
  /** The CTA pill's label. "Mulai" by default. */
  ctaLabel?: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HTTPS = /^https:\/\//i;

/** Whether this source may be drawn: bundled assets always, remote ones only over https. */
const drawable = (source: ImageSourcePropType): boolean => {
  if (typeof source === 'number') return true;
  const first = Array.isArray(source) ? source[0] : source;
  const uri = first && typeof first === 'object' && 'uri' in first ? first.uri : undefined;
  return uri === undefined || HTTPS.test(uri);
};

/** The art's intrinsic size, where React Native can tell without a request (bundled assets, or a
 *  `{ uri, width, height }` the caller sized). */
const intrinsicSize = (source: ImageSourcePropType): Size | undefined => {
  const resolved = RNImage.resolveAssetSource?.(source as Parameters<typeof RNImage.resolveAssetSource>[0]);
  return resolved && resolved.width > 0 && resolved.height > 0 ? { width: resolved.width, height: resolved.height } : undefined;
};

/**
 * A photo card (identity §4.3): the Mini Learning Journey's "Semua jalur" card. Cover art
 * anchored right-bottom, the title and purpose top-left, the coin price as a promo corner tab,
 * and a "Mulai" pill bottom-left.
 *
 * REACT NATIVE'S `Image`, NOT THE LIBRARY'S. The library `Image` takes an https STRING only and
 * draws it in a fixed box with a centred `resizeMode`; journey art is BUNDLED (`require`d assets)
 * and must be anchored right-bottom, which no `resizeMode` does. So the art is sized here from its
 * intrinsic dimensions (`coverAnchoredSize`) and pinned to the corner; the library's https-only
 * rule is kept for remote sources. When the size is unknowable (a remote `uri` with no
 * dimensions) it falls back to a centred cover rather than guess.
 *
 * The CTA is DRAWN, not a second button: the whole card is the one target, so there is never a
 * nested pressable whose tap lands on the wrong handler.
 */
export const PhotoCard = ({
  image,
  title,
  description,
  price,
  ctaLabel = PHOTO_CARD_DEFAULT_CTA,
  onPress,
  disabled,
  accessibilityHint,
  style,
  testID,
}: PhotoCardProps) => {
  const [box, setBox] = React.useState<Size | undefined>();
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const art = drawable(image) ? image : undefined;
  const intrinsic = art === undefined ? undefined : intrinsicSize(art);
  const cover = box && intrinsic ? coverAnchoredSize(box, intrinsic) : undefined;
  const hasPrice = price !== undefined && price !== null;
  const spoken = [title, description, hasPrice ? `${formatCoins(price)} koin` : undefined, ctaLabel].filter(Boolean).join(', ');

  return (
    <PressableScale
      scale="card"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID={testID}
      style={[PHOTO_CARD_FRAME, disabled ? { opacity: DISABLED_OPACITY } : undefined, style]}
    >
      <View style={PHOTO_CARD_CLIP} onLayout={onLayout}>
        {art !== undefined ? (
          <RNImage
            testID="photo-card-art"
            source={art}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            resizeMode={cover ? 'stretch' : 'cover'}
            style={cover ? [styles.anchored, cover] : StyleSheet.absoluteFill}
          />
        ) : null}

        <View style={PHOTO_CARD_TITLE_COLUMN}>
          <Text variant={PHOTO_CARD_TEXT.title.role} weight={PHOTO_CARD_TEXT.title.weight} numberOfLines={2}>
            {title}
          </Text>
          {description ? (
            <Text variant={PHOTO_CARD_TEXT.description.role} weight={PHOTO_CARD_TEXT.description.weight} numberOfLines={2} style={MUTED_TEXT}>
              {description}
            </Text>
          ) : null}
        </View>

        <View style={PHOTO_CARD_CTA} testID="photo-card-cta">
          <Text variant={PHOTO_CARD_TEXT.cta.role} weight={PHOTO_CARD_TEXT.cta.weight} color="invert">
            {ctaLabel}
          </Text>
        </View>

        {hasPrice ? (
          <View style={PHOTO_CARD_PRICE} testID="photo-card-price">
            <CoinGlyph size={COIN_CHIP_SIZE.md.glyph} />
            <Text variant={PHOTO_CARD_TEXT.price.role} weight={PHOTO_CARD_TEXT.price.weight} color="invert">
              {formatCoins(price)}
            </Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
};

PhotoCard.displayName = 'PhotoCard';

const styles = StyleSheet.create({
  anchored: { position: 'absolute', right: tokens.spacing.null, bottom: tokens.spacing.null },
});
