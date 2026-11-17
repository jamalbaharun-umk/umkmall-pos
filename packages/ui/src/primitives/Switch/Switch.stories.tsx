import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Switch } from './Switch';

/**
 * Named stories rather than a grid: the axes are small, and the states worth seeing here are
 * the ones easy to forget — loading, and loading composed with disabled.
 *
 * KEYBOARD: Space and Enter activate the control. That is verified here rather than in the
 * suite; happy-dom supplies no native key defaults, so a test asserting it would fail
 * against correct code.
 */
const meta = {
  title: 'Components/Form/Switch',
  component: Switch,
  args: { label: 'Notifikasi' },
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

const Sizes = ({ sizes }: { sizes: readonly ('large' | 'medium' | 'small')[] }) => (
  <div style={{ display: 'grid', gap: 12 }}>
    {sizes.map((size) => (
      <Switch key={size} label={size} size={size} defaultChecked />
    ))}
  </div>
);

export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Switch label="Notifikasi" checked={on} onCheckedChange={setOn} />`,
      },
    },
  },
  render: () => <Sizes sizes={contract.Switch.axes.size} />,
};

export const Off: Story = { args: { label: 'Notifikasi' } };
export const On: Story = { args: { label: 'Notifikasi', defaultChecked: true } };
export const Loading: Story = { args: { label: 'Notifikasi', loading: true, defaultChecked: true } };
export const Disabled: Story = { args: { label: 'Notifikasi', disabled: true } };

/**
 * ALL FOUR COMBINATIONS of on-ness and disabledness, and the only place the fixed defect is
 * visible: a locked-ON switch used to paint as OFF, so this grid read as three greys and a
 * blue instead of two greys and two blues. No test in this repo can see a wrong colour
 * (UMK-1091 KTD6) — look at the second row.
 */
export const OnAndDisabled: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'max-content max-content' }}>
      <Switch label="Mati" />
      <Switch label="Hidup" defaultChecked />
      <Switch label="Mati, terkunci" disabled />
      <Switch label="Hidup, terkunci" defaultChecked disabled />
    </div>
  ),
};

/** The label never changes with the state — "Notifikasi" stays "Notifikasi" either way. */
export const LabelDoesNotFlip: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <Switch label="Notifikasi" />
      <Switch label="Notifikasi" defaultChecked />
    </div>
  ),
};
