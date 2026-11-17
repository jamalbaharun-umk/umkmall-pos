import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Spinner } from './Spinner';

/**
 * WHAT TO CHECK IN A BROWSER: turn on "reduce motion" and every ring here stops. That is the
 * correct answer rather than a degraded one — the busy state travels as a word through
 * `role="status"` and the label, never through the movement.
 *
 * The `white` variant is on a dark ground here because it is invisible on the default one, and
 * a story that renders a component you cannot see proves nothing about it.
 */
const meta = {
  title: 'Components/Feedback/Spinner',
  component: Spinner,
} satisfies Meta<typeof Spinner>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  variants,
  sizes,
}: {
  variants: typeof contract.Spinner.axes.variant;
  sizes: typeof contract.Spinner.axes.size;
}) => (
  <div style={{ display: 'grid', gap: 24 }}>
    {variants.map((variant) => (
      <div
        key={variant}
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          padding: 12,
          background: variant === 'white' ? '#021629' : undefined,
        }}
      >
        {sizes.map((size) => (
          <Spinner key={size} variant={variant} size={size} label={`${variant} ${size}`} />
        ))}
      </div>
    ))}
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Spinner size="md" label="Loading..." />`,
      },
    },
  },
  render: () => (
    <Grid variants={contract.Spinner.axes.variant} sizes={contract.Spinner.axes.size} />
  ),
};

export const Default: Story = {};

/** An empty label is a real choice: inside a button, the default would join that button's name. */
export const Decorative: Story = { args: { label: '', size: 'sm' } };
