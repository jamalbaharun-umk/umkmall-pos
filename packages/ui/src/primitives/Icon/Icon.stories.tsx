import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon } from './Icon';
import * as glyphs from './glyphs';
import { ICON_NAMES, ICON_REGISTRY, type IconName } from './registry';

/**
 * The whole registry, lucide-backed and house artwork together and unlabelled as to which is
 * which. That is the point of the grid: if you can tell the two sources apart at a glance,
 * the registry is not doing its job.
 */
const meta = {
  title: 'Foundations/Icon',
  component: Icon,
  // `name` is required, and a story that only sets `render` still has to satisfy the
  // component's args. This is the default the grid stories never actually use.
  args: { name: 'check' },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

const Cell = ({ name }: { name: IconName }) => (
  <div
    style={{
      display: 'grid',
      justifyItems: 'center',
      gap: 6,
      padding: 12,
      border: '1px solid #e6e9ed',
      borderRadius: 8,
      fontFamily: 'system-ui, sans-serif',
      fontSize: 11,
      color: '#61768c',
    }}
  >
    <Icon name={name} className="h-6 w-6 text-[#03203d]" />
    <span style={{ textAlign: 'center', wordBreak: 'break-word' }}>{name}</span>
  </div>
);

const Grid = ({ names }: { names: readonly IconName[] }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8 }}>
    {names.map((name) => (
      <Cell key={name} name={name} />
    ))}
  </div>
);

export const AllIcons: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Icon name="check" className="h-5 w-5" />`,
      },
    },
  },
  render: () => <Grid names={ICON_NAMES} />,
};

/**
 * The props real call sites depend on. `strokeWidth={0}` with `fill-white` is how
 * ChatInputArea turns lucide's Square OUTLINE into the solid stop button — drop either and
 * it silently becomes an outline again.
 */
export const StrokeAndFill: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', background: '#03203d', padding: 16, borderRadius: 8 }}>
      <Icon name="square" className="h-6 w-6 text-white" />
      <Icon name="square" className="h-6 w-6 text-white fill-white" strokeWidth={0} />
      <Icon name="check" className="h-6 w-6 text-white" strokeWidth={3} />
      <Icon name="check" className="h-6 w-6 text-white" strokeWidth={1} />
    </div>
  ),
};

/**
 * `credit-coin` is fixed-palette: Figma's coin, a `surface.gradient.yellow` token sweep with the
 * white mark, deliberately not `currentColor` (UMK-1218). A `color` prop is ignored on it, which is
 * why it is shown next to one that honours it.
 */
export const FixedPalette: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
      <Icon name="credit-coin" className="h-8 w-8" color="brand" />
      <Icon name="credit-coin" className="h-8 w-8" color="error" />
      <Icon name="sparkles" className="h-8 w-8" color="brand" />
      <Icon name="sparkles" className="h-8 w-8" color="error" />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <Icon key={size} name="sparkles" size={size} />
      ))}
    </div>
  ),
};

/** The file-type badges are self-coloured tiles: a host must not wrap them in a coloured circle. */
export const FileBadges: Story = {
  render: () => <Grid names={ICON_NAMES.filter((n) => n.startsWith('file-'))} />,
};

/** The 20x20 Figma tiles, which take their colour from the call site. */
export const Tiles: Story = {
  render: () => <Grid names={ICON_NAMES.filter((n) => n.startsWith('tile-'))} />,
};

/** Every glyph the registry does NOT get from lucide. */
const HOUSE = new Set<unknown>(Object.values(glyphs));
export const HouseArtwork: Story = {
  render: () => <Grid names={ICON_NAMES.filter((n) => HOUSE.has(ICON_REGISTRY[n].component))} />,
};
