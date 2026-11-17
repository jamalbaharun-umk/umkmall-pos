import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { A2UI_IMAGE, A2UI_IMAGE_PLACEHOLDER } from '../a2ui-classes';
import {
  IMAGE_BARE,
  IMAGE_BARE_IMG,
  IMAGE_BASE,
  IMAGE_HOVER,
  IMAGE_PLACEHOLDER,
  IMAGE_ROUNDED,
  IMAGE_SIZE,
  IMAGE_TYPE,
} from '../content-classes';

type Axes = typeof contract.Image.axes;

export type ImageType = Axes['type'][number];
export type ImageSize = Axes['size'][number];

/** How the photo sits inside its box. A CSS concern, kept out of the `type` axis. */
const FIT = {
  contain: 'max-h-full max-w-full object-contain',
  cover: 'h-full w-full object-cover',
  fill: 'h-full w-full object-fill',
  /** The image's own `width`/`height` attributes size it: nothing in CSS overrides them (UMK-960). */
  intrinsic: 'block max-w-full',
} as const;

export type ImageFit = keyof typeof FIT;

/** The radius rungs a caller may pick. Selected, never appended — see `IMAGE_ROUNDED`. */
export type ImageRounded = keyof typeof IMAGE_ROUNDED;

/**
 * A statically imported asset, as a bundler hands it over. Declared here rather than imported
 * from `next` (this package never imports it): only `src` is read by the gate, and the WHOLE
 * object is passed to the render slot so `next/image` keeps its blur data and intrinsic size.
 */
export interface ImageAsset {
  src: string;
  width?: number;
  height?: number;
  blurDataURL?: string;
}

export interface ImageForwardedProps {
  unoptimized?: boolean;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  placeholder?: 'blur' | 'empty';
  blurDataURL?: string;
  loading?: 'lazy' | 'eager';
  draggable?: boolean;
  /** A decorative mark hidden from assistive tech as well as given an empty `alt`. */
  'aria-hidden'?: boolean;
  decoding?: 'async' | 'sync' | 'auto';
  quality?: number;
  /** On the image element itself — `objectPosition` for a focal point, which no class table can name. */
  style?: React.CSSProperties;
  /** `data-*` hooks a stylesheet keys on (an animation selector), forwarded untouched. */
  [dataAttribute: `data-${string}`]: string | undefined;
  priority?: boolean;
  fill?: boolean;
  sizes?: string;
  width?: number;
  height?: number;
}

/** A same-origin path, decided by PARSING and not by prefix — see `Image`'s docblock. */
const SAME_ORIGIN_PROBE = 'https://same-origin.invalid';
function isSameOriginPath(src: string): boolean {
  /* The WHATWG URL parser strips tab, LF and CR, so `/\t/evil.example/x` passes a `/` prefix
     check and is fetched as `//evil.example/x`. Refuse every control or space and any backslash
     before the parser sees it. */
  if (/[\u0000-\u0020\\]/.test(src) || !src.startsWith('/')) return false;
  try {
    return new URL(src, SAME_ORIGIN_PROBE).origin === SAME_ORIGIN_PROBE;
  } catch {
    return false;
  }
}

/** Anchored, closed and case-insensitive. No SVG: it can carry script. */
const RASTER_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i;

function isRenderableSrc(src: string, allowRelative: boolean, allowDataImage: boolean): boolean {
  /* ANCHORED, case-insensitive. A URL scheme is case-insensitive per RFC 3986, so a literal
     `startsWith('https://')` placeholders a perfectly valid `HTTPS://…` — a false NEGATIVE
     that hides a real photo, not a bypass. The anchor is what keeps the security posture:
     matching anywhere in the string would let `http://evil/?x=https://` through. */
  if (/^https:\/\//i.test(src)) return true;
  if (allowRelative && isSameOriginPath(src)) return true;
  return allowDataImage && RASTER_DATA_URL.test(src);
}

interface ImageBase {
  /** Only `https://` is rendered, plus the two opt-ins below. Anything else becomes the placeholder — see the docblock. */
  src: string | ImageAsset;
  /**
   * Opt-in (UMK-960): also render a same-origin path such as `/images/a.png`. Off by default
   * because the a2ui adapter hands a model-authored url straight through, and a relative path
   * there is a same-origin GET carrying the user's cookies. The a2ui adapter never sets it.
   */
  allowRelative?: boolean;
  /**
   * Opt-in (UMK-960): also render a `data:image/(jpeg|png|webp);base64,…` URL, which is what a
   * camera capture is. SVG stays refused even so, because it can carry script.
   */
  allowDataImage?: boolean;
  /**
   * Render slot (UMK-960): the element that draws the photo, in place of `<img>`. This is how
   * an app passes in `next/image` without this package importing `next`. It receives `src`,
   * `alt`, `className` and `imgProps`, and is never called for a refused `src`.
   */
  as?: React.ElementType;
  /**
   * Intrinsic mode (UMK-960): a logo, an icon or a decorative mark that is sized by its own
   * pixels or by the caller's `className`, so none of the box chrome applies — no ratio, no
   * background, no clipping, no `size` step. The security gate is unchanged.
   */
  bare?: boolean;
  /** A custom aspect ratio for the box, e.g. `25 / 18` — an inline style, so no class has to survive the purge. */
  ratio?: number | string;
  /**
   * Forwarded to the BOX, which carries the caller's `className`: a class that depends on client
   * state (a header logo inverted over a hero) differs between the server and the first client render.
   */
  suppressHydrationWarning?: boolean;
  /** Inline style for the BOX (a positioned watermark's width and offsets); `ratio` merges into it. */
  style?: React.CSSProperties;
  /** Picks the radius token, replacing the one `type` carries. */
  rounded?: ImageRounded;
  /** Forwarded to the `as` element untouched — `priority`, `fill`, `sizes`, `width`, `height`. */
  imgProps?: ImageForwardedProps;
  type?: ImageType;
  size?: ImageSize;
  /** Default `contain`, or `cover` for an `avatar`. */
  fit?: ImageFit;
  /** `natural` constrains no ratio — see the type table. */
  /** Figma's `Hover` variant, taken as a boolean because it composes with every type and size. */
  hover?: boolean;
  /** `a2ui` is the agent surface's pre-library image slot (UMK-1307); only its adapter passes it. */
  appearance?: Axes['appearance'][number];
  /** Shown in place of the image when there is nothing to show. */
  placeholder?: React.ReactNode;
  className?: string;
}

/**
 * `alt` OR an explicit decorative opt-out, never neither.
 *
 * The a2ui renderer falls back to `alt=""` when its accessibility context carries no label,
 * which is right for a decorative image and wrong as a SILENT default: every unlabelled
 * photo becomes invisible to a screen reader and nothing anywhere says so. Making the
 * decorative case a word someone has to type is the whole difference. The a2ui adapter
 * imports this component (`appearance="a2ui"`) and always names `alt` or `decorative`.
 */
export type ImageProps = ImageBase & ({ alt: string } | { decorative: true; alt?: never });

/**
 * A photo in a fixed box.
 *
 * THE NON-HTTPS BRANCH IS A SECURITY CONTROL, not an empty state that happens to look tidy.
 * A non-https `src` renders the placeholder and NO `<img>`, so no request is made at all —
 * the same SSRF defence-in-depth the a2ui renderer carries, and the branch a refactor
 * chasing "one render path" quietly drops. The guard probes it directly.
 *
 * It doubles as the empty state, which is why there is one branch rather than two: a missing
 * before-photo in a side-by-side pair reads as an empty slot rather than vanishing and
 * collapsing the layout.
 *
 * `next/image` is DELIBERATELY not pulled in here. It would make this package depend on the
 * Next runtime for one component; an app passes it through the `as` slot instead (UMK-960).
 *
 * TWO OPT-INS WIDEN THE GATE, both off by default (`allowRelative`, `allowDataImage`). The a2ui
 * adapter imports this component and forwards a model-authored url, so a default that accepted
 * a relative path would let a model make a same-origin GET with the user's cookies.
 */
export const Image = React.forwardRef<HTMLDivElement, ImageProps>((props, ref) => {
  const {
    src,
    type = 'thumbnail',
    size = 'regular',
    /* An avatar FILLS its circle; letterboxed, a photo drew as a pill inside it. */
    fit = type === 'avatar' ? 'cover' : 'contain',
    hover = false,
    appearance = 'default',
    placeholder = 'Tidak ada gambar',
    className,
    allowRelative = false,
    allowDataImage = false,
    as: Img = 'img',
    imgProps,
    bare = false,
    ratio,
    rounded,
    style: boxStyle,
    suppressHydrationWarning,
  } = props;
  const srcString = typeof src === 'string' ? src : src.src;
  const alt = 'alt' in props && props.alt !== undefined ? props.alt : '';
  const a2ui = appearance === 'a2ui';
  /* The radius is SELECTED out of the type's classes, never appended after them: tailwind-merge
     does not know the `ds-` radius scale, so two rungs would both ship. */
  const typeClass = rounded ? IMAGE_TYPE[type].replace(/rounded-(?:ds-\w+|full)/, '') : IMAGE_TYPE[type];
  const radius = rounded ? IMAGE_ROUNDED[rounded] : '';
  const box = a2ui
    ? cn(A2UI_IMAGE, className)
    : bare
      ? cn(IMAGE_BARE, rounded && 'overflow-hidden', radius, hover && IMAGE_HOVER, className)
      : cn(IMAGE_BASE, typeClass, radius, IMAGE_SIZE[size], hover && IMAGE_HOVER, className);
  const style = ratio === undefined && !boxStyle ? undefined : { ...(ratio === undefined ? {} : { aspectRatio: ratio }), ...boxStyle };
  const imgClass = bare && props.fit === undefined ? IMAGE_BARE_IMG : FIT[fit];

  if (!isRenderableSrc(srcString, allowRelative, allowDataImage)) {
    return (
      <div ref={ref} style={style} suppressHydrationWarning={suppressHydrationWarning} className={cn(box, a2ui ? A2UI_IMAGE_PLACEHOLDER : IMAGE_PLACEHOLDER)}>
        {placeholder}
      </div>
    );
  }

  return (
    <div ref={ref} style={style} suppressHydrationWarning={suppressHydrationWarning} className={box}>
      <Img src={typeof Img === 'string' ? srcString : src} alt={alt} className={imgClass} {...imgProps} />
    </div>
  );
});

Image.displayName = 'Image';
