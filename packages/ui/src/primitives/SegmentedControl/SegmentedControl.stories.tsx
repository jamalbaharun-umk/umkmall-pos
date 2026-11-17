import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'sm', label: 'A-', ariaLabel: 'Kecil' },
  { value: 'md', label: 'A', ariaLabel: 'Normal' },
  { value: 'lg', label: 'A+', ariaLabel: 'Besar' },
  { value: 'xl', label: 'A++', ariaLabel: 'Sangat besar' },
];

/* Stories carry their full args: the state guard renders `story.args` alone, without meta's. */
const BASE = { options: OPTIONS, value: 'md', onChange: () => {}, 'aria-label': 'Ukuran teks' };

const meta = {
  title: 'Components/Form/SegmentedControl',
  component: SegmentedControl,
  args: BASE,
} satisfies Meta<typeof SegmentedControl>;
export default meta;
type Story = StoryObj<typeof meta>;

const Live = (args: React.ComponentProps<typeof SegmentedControl>) => {
  const [value, setValue] = React.useState(args.value);
  return <SegmentedControl {...args} value={value} onChange={setValue} />;
};

const Sizes = ({ sizes }: { sizes: readonly ('medium' | 'small')[] }) => (
  <div style={{ display: 'grid', gap: 12 }}>
    {sizes.map((size) => (
      <SegmentedControl key={size} aria-label={size} options={OPTIONS} value="md" onChange={() => {}} size={size} />
    ))}
  </div>
);

export const AllSizes: Story = { render: () => <Sizes sizes={contract.SegmentedControl.axes.size} /> };

export const Default: Story = { args: BASE, render: (args) => <Live {...args} /> };
export const Checked: Story = { args: { ...BASE, value: 'xl' } };
export const Disabled: Story = { args: { ...BASE, disabled: true } };
