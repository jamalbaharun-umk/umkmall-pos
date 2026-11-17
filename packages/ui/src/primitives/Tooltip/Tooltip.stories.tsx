import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Icon } from '../Icon';
import { Tooltip } from './Tooltip';

/**
 * The three things the suite cannot see live here: flipping at a viewport edge,
 * repositioning on scroll, and how the arrow looks when the tip lands somewhere other than
 * where it was asked to. happy-dom has no layout, so a positioning assertion there measures
 * nothing.
 *
 * Every story renders with `defaultOpen` so a static snapshot has a tip in it.
 */
const meta = {
  /**
   * PORTALLED, so it CANNOT render inline on a docs page. A docs page renders every story into
   * the same document; this component renders into `document.body`, so it escapes its story
   * container and covers the whole page — the title, the props table and every other story
   * underneath it. The story view looks fine because Storybook already iframes that one.
   *
   * `inline: false` gives this component's stories their own iframe on the docs page too, which
   * is the same isolation the story view has. The height is the frame's, not the component's.
   */
  parameters: {
    docs: { story: { inline: false, height: '260px' } },
  },
  title: 'Components/Feedback/Tooltip',
  component: Tooltip,
  args: { content: 'Nilai tukar hari ini', children: <button type="button">Kurs</button> },
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  colors,
  sizes,
}: {
  colors: readonly ('dark' | 'white')[];
  sizes: readonly ('large' | 'small')[];
}) => (
  <div style={{ display: 'grid', gap: 96, padding: 64, justifyItems: 'start' }}>
    {colors.map((color) =>
      sizes.map((size) => (
        <Tooltip
          key={`${color}-${size}`}
          color={color}
          size={size}
          content={`${color} · ${size}`}
          icon={<Icon name="info" className="h-full w-full" />}
          defaultOpen
        >
          <button type="button">{`${color} ${size}`}</button>
        </Tooltip>
      )),
    )}
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Tooltip content="Nilai tukar hari ini">
  <button type="button">Kurs</button>
</Tooltip>`,
      },
    },
  },
  render: () => <Grid colors={contract.Tooltip.axes.color} sizes={contract.Tooltip.axes.size} />,
};

/** Figma's `Show Close`. Off by default here — a tip that closes on pointer-leave has
 *  nothing for a close button to do — so this is the click-to-open case. */
export const Dismissible: Story = {
  args: {
    content: 'Tutup manual',
    showClose: true,
    defaultOpen: true,
    children: <button type="button">Dengan tombol tutup</button>,
  },
};

/**
 * The arrow follows the RESOLVED placement, not a prop. Pin the trigger near an edge in
 * the canvas and watch the tip flip: the arrow moves with it.
 */
export const FlipsAtTheEdge: Story = {
  render: () => (
    <div style={{ height: 240, display: 'flex', alignItems: 'flex-start' }}>
      <Tooltip content="Dekat tepi atas" side="top" defaultOpen>
        <button type="button">Di tepi</button>
      </Tooltip>
    </div>
  ),
};

/** The tip stays attached to its trigger while an ancestor scrolls — the defect the
 *  replaced component shipped was measuring once and never again. */
export const FollowsAScroll: Story = {
  render: () => (
    <div style={{ height: 160, overflow: 'auto', border: '1px solid #ccc', padding: 16 }}>
      <div style={{ height: 400, paddingTop: 80 }}>
        <Tooltip content="Gulir kotak ini" defaultOpen>
          <button type="button">Gulir saya</button>
        </Tooltip>
      </div>
    </div>
  ),
};
