import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Image } from './Image';

const SAMPLE = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=640';

/**
 * THE PLACEHOLDER IS A SECURITY BRANCH, not a nicety. A non-https source renders it and NO
 * `<img>` at all, so nothing is ever requested — defence in depth against an SSRF-shaped
 * source, and the branch a refactor chasing a single render path drops without noticing. The
 * `NonHttps` story below is what it looks like, and the guard probes it directly.
 *
 * It doubles as the empty state, which is why there is one branch and not two: a missing
 * before-photo in a side-by-side pair reads as an empty slot rather than collapsing the row.
 *
 * `alt` is required, or `decorative` in its place. The a2ui renderer falls back to an empty
 * string when nothing labels the image, which is right for a decorative photo and wrong as a
 * silent default — every unlabelled image disappears for a screen reader and nothing says so.
 */
const meta = {
  title: 'Components/Content/Image',
  component: Image,
  args: { src: SAMPLE, alt: 'Etalase toko kelontong' },
} satisfies Meta<typeof Image>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  types,
  sizes,
}: {
  types: typeof contract.Image.axes.type;
  sizes: typeof contract.Image.axes.size;
}) => (
  <div style={{ display: 'grid', gap: 24 }}>
    {types.map((type) => (
      <div key={type} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {sizes.map((size) => (
          <div key={size} style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.6 }}>{`${type} · ${size}`}</span>
            <Image src={SAMPLE} alt={`${type} ${size}`} type={type} size={size} />
          </div>
        ))}
      </div>
    ))}
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Image src="https://images.unsplash.com/photo-..." alt="Etalase toko kelontong" type="banner" />`,
      },
    },
  },
  render: () => <Grid types={contract.Image.axes.type} sizes={contract.Image.axes.size} />,
};

export const Default: Story = {};
export const Banner: Story = { args: { type: 'banner', fit: 'cover' } };

/** No ratio constraint — what almost every generated image in TemanAI actually needs. */
export const Natural: Story = { args: { type: 'natural' } };
/** A circle sized by the caller (UMK-1186); initials come from `placeholder` when there is no photo. */
export const Avatar: Story = { args: { type: 'avatar', className: 'h-16 w-16' } };
export const AvatarInitials: Story = {
  args: { type: 'avatar', src: '', placeholder: 'BS', className: 'h-16 w-16' },
};
export const Hover: Story = { args: { hover: true } };

/** The security branch. No `<img>` is rendered and no request is made. */
export const NonHttps: Story = { args: { src: 'http://example.com/foto.jpg' } };
export const Empty: Story = { args: { src: '' } };
export const Decorative: Story = { args: { alt: undefined, decorative: true } };

/** Opt-ins (UMK-960). A raster data URL renders only under `allowDataImage`; a relative path only under `allowRelative`. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==';
export const DataOptIn: Story = { args: { src: PIXEL, allowDataImage: true, fit: 'cover' } };
/** Same source without the opt-in: the placeholder and no request. */
export const DataRefused: Story = { args: { src: PIXEL } };

/** Intrinsic mode (UMK-960): no ratio, background or clipping; the caller's className is the layout. */
export const Bare: Story = { args: { bare: true, className: 'h-16' } };
/** A custom aspect ratio and one radius token, for a wrapper that is not 1:1 or 16:9. */
export const CustomRatio: Story = { args: { type: 'natural', ratio: '25 / 18', rounded: 'xl', fit: 'cover' } };
