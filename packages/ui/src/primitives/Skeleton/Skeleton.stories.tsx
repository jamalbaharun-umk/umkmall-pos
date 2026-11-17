import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Skeleton } from './Skeleton';

/**
 * THIS STORY IS THE DELIVERABLE. Ensyra publishes no skeleton at all, so there is nothing
 * to compare an implementation against — this is what Agil designs to, rather than
 * documentation of a design that already exists.
 *
 * Reduced motion cannot be forced from a story: switch it on in the OS (or DevTools'
 * "Emulate prefers-reduced-motion") and the sweep disappears while the tint stays. A
 * paused sweep would freeze mid-travel and leave a permanent bright band, which is why it
 * is removed rather than stopped.
 */
const meta = {
  title: 'Components/Feedback/Skeleton',
  component: Skeleton,
  args: {},
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

const Shapes = ({ shapes }: { shapes: readonly ('text' | 'circle' | 'rect')[] }) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
    {shapes.map((shape) => (
      <div key={shape} style={{ display: 'grid', gap: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{shape}</span>
        <Skeleton shape={shape} className={shape === 'circle' ? 'w-12' : undefined} />
      </div>
    ))}
  </div>
);

export const AllShapes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Skeleton shape="circle" className="w-10" />`,
      },
    },
  },
  render: () => <Shapes shapes={contract.Skeleton.axes.shape} />,
};

/** What the three compose into — a loading card, which is how they are actually used. */
export const LoadingCard: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Skeleton shape="circle" className="w-10" />
        <div style={{ display: 'grid', gap: 8, flex: 1 }}>
          <Skeleton shape="text" />
          <Skeleton shape="text" className="w-1/2" />
        </div>
      </div>
      <Skeleton shape="rect" />
    </div>
  ),
};
