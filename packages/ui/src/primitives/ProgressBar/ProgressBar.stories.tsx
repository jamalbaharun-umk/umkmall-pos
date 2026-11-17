import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { ProgressBar } from './ProgressBar';

/**
 * THIS STORY IS A DELIVERABLE. Ensyra publishes no progress set at all, so the grid is what a
 * designer works against — and what makes "the colours are tokens now" visible, since the
 * component shipped a raw Tailwind palette until UMK-961.
 */
const meta = {
  title: 'Components/Feedback/ProgressBar',
  component: ProgressBar,
  args: { value: 60 },
} satisfies Meta<typeof ProgressBar>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  variants,
  sizes,
}: {
  variants: typeof contract.ProgressBar.axes.variant;
  sizes: typeof contract.ProgressBar.axes.size;
}) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
    {variants.map((variant) => (
      <div key={variant} style={{ display: 'grid', gap: 8 }}>
        {sizes.map((size) => (
          <ProgressBar key={size} variant={variant} size={size} value={60} label={`${variant} ${size}`} />
        ))}
      </div>
    ))}
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<ProgressBar value={60} variant="success" label="Diunggah" />`,
      },
    },
  },
  render: () => (
    <Grid variants={contract.ProgressBar.axes.variant} sizes={contract.ProgressBar.axes.size} />
  ),
};

export const Empty: Story = { args: { value: 0, label: 'Belum mulai' } };
export const Complete: Story = { args: { value: 100, variant: 'success', label: 'Selesai' } };

/** Past the maximum. The bar stops at full and announces the clamped number, not the raw one. */
export const BeyondMax: Story = { args: { value: 150, max: 100, label: 'Melebihi batas' } };

/** The segmented form — a password-strength meter is three bars, one of them in the track hue. */
export const Segmented: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 4, maxWidth: 240 }}>
      <ProgressBar value={100} variant="success" style={{ flex: 1 }} />
      <ProgressBar value={100} variant="success" style={{ flex: 1 }} />
      <ProgressBar value={100} variant="gray" style={{ flex: 1 }} />
    </div>
  ),
};

/**
 * THE RADIAL SHAPE, at the real gauge value the agent surface renders.
 *
 * What to look at: the arc starts at twelve o'clock, each diameter comes off the size axis
 * rather than a class override, and the ring behind it is the same track colour the bar uses.
 */
export const Radial: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
      {contract.ProgressBar.axes.size.map((size) => (
        <ProgressBar key={size} shape="radial" size={size} value={72} label={`Skor ${size}`} />
      ))}
    </div>
  ),
};

/** Every colour on the gauge, so the stroke tokens are visible side by side. */
export const RadialVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      {contract.ProgressBar.axes.variant.map((variant) => (
        <ProgressBar key={variant} shape="radial" variant={variant} value={72} label={variant} />
      ))}
    </div>
  ),
};

/** The sweep at both bounds and halfway. */
export const RadialExtremes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      {[0, 50, 100].map((value) => (
        <ProgressBar key={value} shape="radial" value={value} label={`${value}`} />
      ))}
    </div>
  ),
};
