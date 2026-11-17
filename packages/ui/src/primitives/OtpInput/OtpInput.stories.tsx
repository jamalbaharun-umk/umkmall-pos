import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { OtpInput, type OtpInputSize } from './OtpInput';

/**
 * One real input drawn as boxes. Paste a formatted code ("12 34-56") into it, or let the
 * browser autofill one — both land in the single field.
 */
const meta = {
  title: 'Components/Form/OtpInput',
  component: OtpInput,
  args: { label: 'Kode OTP', value: '', onChange: () => {} },
} satisfies Meta<typeof OtpInput>;
export default meta;
type Story = StoryObj<typeof meta>;

const Live = ({ size }: { size?: OtpInputSize }) => {
  const [value, setValue] = React.useState('');
  return <OtpInput label={`Kode OTP (${size ?? 'large'})`} size={size} value={value} onChange={setValue} />;
};

const Sizes = ({ sizes }: { sizes: readonly OtpInputSize[] }) => (
  <div style={{ display: 'grid', gap: 24 }}>
    {sizes.map((size) => (
      <Live key={size} size={size} />
    ))}
  </div>
);

/** Fed from the contract; type a code, paste a formatted one, or let autofill land one. */
export const AllSizes: Story = {
  render: () => <Sizes sizes={contract.OtpInput.axes.size} />,
};

/* Every story carries its full args: the state guard mounts `story.args` alone. */
const base = { label: 'Kode OTP', value: '', onChange: () => {} };
export const Empty: Story = { args: base };
export const Filled: Story = { args: { ...base, value: '1234' } };
export const WithError: Story = { args: { ...base, value: '123456', error: 'Kode salah. Coba lagi.' } };
export const Disabled: Story = { args: { ...base, value: '12', disabled: true } };
